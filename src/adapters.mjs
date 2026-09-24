// One question to one CLI, using the user's own subscription sign-in.
// Each side keeps one CLI session for as long as this process lives (for the MCP server, that is the
// host's session), so a model remembers the discussion and what it has already read of the project.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_ROOT, SIDES, loadConfig, resolveSide } from './config.mjs';
import { cleanEnv, failureDetail, findExecutable, run } from './process.mjs';

const EMPTY_MCP_CONFIG = join(PACKAGE_ROOT, 'src', 'empty-mcp.json');

// GIT_OPTIONAL_LOCKS=0 stops read-only git commands (git status) from refreshing the index.
const READ_ONLY_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat' };

function options(config, signal, cwd) {
  return { cwd, env: { ...cleanEnv(config), ...READ_ONLY_ENV }, timeoutMs: Number(config.timeout_seconds) * 1000, signal };
}

// Claude reads the project with its file tools (confined to the working folder by --restricted) and
// these git commands; any other command is refused (--permission-mode dontAsk). The deny rules close
// the options that make an allowed command write a file (--output), run a program (--ext-diff) or read
// a file outside the project (--no-index, blame --contents / -S / --ignore-revs-file, ls-files -X /
// --exclude-from, diff -O / --orderfile). Checked against the real CLI.
const GIT_READ_COMMANDS = ['log', 'diff', 'show', 'status', 'blame', 'ls-files', 'rev-parse', 'describe', 'shortlog'];
export const CLAUDE_ALLOWED = GIT_READ_COMMANDS.flatMap(command => [`Bash(git ${command})`, `Bash(git ${command} *)`]);
export const CLAUDE_DENIED = ['Edit', 'Write', 'NotebookEdit', 'Bash(*--output*)', 'Bash(*--ext-diff*)', 'Bash(*--no-index*)',
  'Bash(*--contents*)', 'Bash(*--ignore-revs-file*)', 'Bash(git blame*-S*)', 'Bash(*--exclude-from*)', 'Bash(git ls-files*-X*)',
  'Bash(* -O*)', 'Bash(*--orderfile*)'];

// One session per side, workspace and model. Calls to one session run one at a time.
const sessions = new Map();
const keptDirs = new Set();
process.once('exit', () => { for (const dir of keptDirs) try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function sessionFor(side, workspace, model) {
  const key = JSON.stringify([side, workspace || null, model || null]);
  if (!sessions.has(key)) sessions.set(key, { id: null, dir: null, queue: Promise.resolve() });
  return sessions.get(key);
}

async function inSession(session, work) {
  const previous = session.queue;
  let release;
  session.queue = new Promise(resolve => { release = resolve; });
  try {
    await previous;
    return await work();
  } finally {
    release();
  }
}

/**
 * Hold these sessions ({ side, workspace, model }) for the whole of work, so no other council or question
 * takes a turn in them meanwhile: each prompt assumes the turns before it in the session are its own.
 * Calls made inside pass { held: true }. Sessions are taken in a fixed order, so two councils cannot
 * each hold one and wait for the other.
 */
export async function holdSessions(entries, work) {
  const ordered = [...entries].sort((a, b) => a.side.localeCompare(b.side));
  const hold = index => (index === ordered.length ? work()
    : inSession(sessionFor(ordered[index].side, ordered[index].workspace, ordered[index].model), () => hold(index + 1)));
  return hold(0);
}

// Without a workspace, a side works in an empty folder that lasts as long as its session.
function workingDir(session, workspace, prefix) {
  if (workspace) return workspace;
  if (!session.dir) keptDirs.add(session.dir = mkdtempSync(join(tmpdir(), prefix)));
  return session.dir;
}

/** Forget every session, so the next call to each side starts a new one. */
export function resetSessions() {
  sessions.clear();
}

const UPDATE_HINT = { codex: ' (update the Codex CLI: `npm install -g @openai/codex`)', claude: ' (update Claude Code: `claude update`)' };
const withHint = (side, detail) => (/unknown option|unexpected argument|unrecognized/i.test(detail) ? `${detail}${UPDATE_HINT[side]}` : detail);

// Codex output files go to a folder of their own, outside the project.
async function inTempDir(prefix, work) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await work(dir);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** null when Codex is signed in with ChatGPT, otherwise a message saying what to do. */
export async function codexSignInProblem(exe, config, opts = {}) {
  const status = await run(exe, ['login', 'status'], { env: cleanEnv(config), timeoutMs: 60_000, ...opts });
  const output = `${status.stdout}\n${status.stderr}`;
  if (status.code === 0 && /chatgpt/i.test(output)) return null;
  if (config.allow_api_key_auth && status.code === 0 && /logged in/i.test(output)) return null;
  return /api key/i.test(output)
    ? 'Codex is signed in with an API key. Run `codex login` and choose "Sign in with ChatGPT", or set "allow_api_key_auth": true.'
    : 'Codex is not signed in. Run `codex login` and choose "Sign in with ChatGPT".';
}

/** null when Claude Code is signed in with a Claude subscription, otherwise what to do. */
export async function claudeSignInProblem(exe, config, opts = {}) {
  const status = await run(exe, ['auth', 'status'], { env: cleanEnv(config), timeoutMs: 60_000, ...opts });
  let auth = {};
  try { auth = JSON.parse(status.stdout); } catch { /* reported below */ }
  if (!auth.loggedIn) return 'Claude Code is not signed in. Run `claude auth login`.';
  if (!config.allow_api_key_auth && /api/i.test(String(auth.authMethod || ''))) {
    return 'Claude Code is using an API key. Run `claude auth login` with your Claude subscription, or set "allow_api_key_auth": true.';
  }
  return null;
}

const SIGN_IN_PROBLEM = { codex: codexSignInProblem, claude: claudeSignInProblem };
const CLI_NAME = { codex: 'Codex (ChatGPT)', claude: 'Claude Code' };

/**
 * Before a council starts: check that both CLIs are installed and signed in, side by side.
 * Throws one error naming every problem, so nothing is sent to either model until both are ready.
 */
export async function requireBothSignedIn(config = loadConfig(), { signal } = {}) {
  const problems = await Promise.all(SIDES.map(async side => {
    try {
      return await SIGN_IN_PROBLEM[side](findExecutable(side, config[side].command), config, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      return error.message;
    }
  }));
  const lines = SIDES.flatMap((side, i) => (problems[i] ? [`- ${CLI_NAME[side]}: ${problems[i]}`] : []));
  if (lines.length) {
    throw new Error(`The council needs both Codex and Claude Code signed in. Nothing was sent to either model.\n${lines.join('\n')}`);
  }
}

/** The thread id from `codex exec --json` output (a "thread.started" event). */
function codexThreadId(stdout) {
  for (const line of String(stdout).split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event?.type === 'thread.started' && typeof event.thread_id === 'string') return event.thread_id;
    } catch { /* not an event */ }
  }
  return null;
}

/**
 * workspace: the project folder the model may read (never write), or undefined for no file access.
 * Codex always runs in its read-only sandbox, enforced by the operating system.
 */
export async function askCodex(prompt, overrides = {}, { config = loadConfig(), signal, workspace, held = false } = {}) {
  const chosen = resolveSide('codex', overrides, config);
  const exe = findExecutable('codex', config.codex.command);
  const session = sessionFor('codex', workspace, chosen.model);
  const call = () => inTempDir('council-codex-out-', async outDir => {
    const cwd = workingDir(session, workspace, 'council-codex-');
    const opts = options(config, signal, cwd);
    const problem = await codexSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    const answerFile = join(outDir, 'answer.txt');
    // --ignore-user-config and --ignore-rules keep ~/.codex/config.toml (plugins, hooks, MCP servers) and
    // .rules files out. The sandbox is also set with -c because `codex exec resume` has no --sandbox flag.
    const common = ['--json', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
      '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"'];
    if (chosen.model) common.push('-m', chosen.model);
    if (chosen.effort) common.push('-c', `model_reasoning_effort=${chosen.effort}`);
    common.push('--output-last-message', answerFile);
    const args = session.id
      ? ['exec', 'resume', ...common, session.id, '-']
      : ['exec', ...common, '--sandbox', 'read-only', '-C', cwd, '-'];
    const result = await run(exe, args, { ...opts, input: prompt });
    session.id ??= codexThreadId(result.stdout);
    if (result.code !== 0) throw new Error(`codex failed: ${withHint('codex', failureDetail(result.stderr || result.stdout))}`);
    if (!session.id) throw new Error('codex did not report a session id; update the Codex CLI (`npm install -g @openai/codex`)');
    let answer = '';
    try { answer = readFileSync(answerFile, 'utf8').trim(); } catch { /* empty */ }
    if (!answer) throw new Error('codex returned an empty answer');
    return answer;
  });
  return held ? call() : inSession(session, call);
}

/**
 * workspace: the project folder the model may read (never write), or undefined for no tools at all.
 * --restricted ignores user, project and local settings (so no hooks, plugins or allow rules from them)
 * and confines the file tools to the working folder; dontAsk refuses anything not allowed here.
 */
export async function askClaude(prompt, overrides = {}, { config = loadConfig(), signal, workspace, held = false } = {}) {
  const chosen = resolveSide('claude', overrides, config);
  const exe = findExecutable('claude', config.claude.command);
  const session = sessionFor('claude', workspace, chosen.model);
  const call = async () => {
    const cwd = workingDir(session, workspace, 'council-claude-');
    const opts = options(config, signal, cwd);
    const problem = await claudeSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    const id = session.id ?? randomUUID();
    const args = ['-p', '--output-format', 'json', session.id ? '--resume' : '--session-id', id,
      '--restricted', '--permission-mode', 'dontAsk', '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', EMPTY_MCP_CONFIG];
    if (workspace) args.push('--tools', 'Read,Grep,Glob,Bash', '--allowedTools', ...CLAUDE_ALLOWED, '--disallowedTools', ...CLAUDE_DENIED);
    else args.push('--tools', '');
    if (chosen.model) args.push('--model', chosen.model);
    if (chosen.effort) args.push('--effort', chosen.effort);
    const result = await run(exe, args, { ...opts, input: prompt });
    let data;
    try { data = JSON.parse(result.stdout); } catch { /* reported below */ }
    if (typeof data?.session_id === 'string') session.id = data.session_id;
    const answer = typeof data?.result === 'string' ? data.result.trim() : '';
    if (result.code !== 0 || !data || data.is_error || !answer) {
      throw new Error(`claude failed: ${withHint('claude', failureDetail(answer || result.stderr || result.stdout))}`);
    }
    return answer;
  };
  return held ? call() : inSession(session, call);
}
