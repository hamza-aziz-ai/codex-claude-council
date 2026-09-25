// One question to one CLI, using the user's own subscription sign-in.
// Each side keeps one CLI session for as long as this process lives (for the MCP server, that is the
// host's session), so a model remembers the discussion and what it has already read of the project.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_ROOT, SIDES, loadConfig, resolveSide } from './config.mjs';
import { cleanEnv, failureDetail, findExecutable, run } from './process.mjs';

const EMPTY_MCP_CONFIG = join(PACKAGE_ROOT, 'src', 'empty-mcp.json');

// GIT_OPTIONAL_LOCKS=0 stops read-only git commands (git status) from refreshing the index.
const READ_ONLY_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat' };

// A step that uses a skill runs its sub-agents too, so it gets the longer skill_timeout_seconds.
function options(config, signal, cwd, skill) {
  const seconds = skill ? Math.max(Number(config.timeout_seconds), Number(config.skill_timeout_seconds)) : Number(config.timeout_seconds);
  return { cwd, env: { ...cleanEnv(config), ...READ_ONLY_ENV }, timeoutMs: seconds * 1000, signal };
}

// Claude reads the project with its file tools (Read, Grep, Glob; confined to the working folder by
// --restricted) and the read-only git tools of git-mcp.mjs, which check every path and revision. It has no
// shell; anything else is refused (--permission-mode dontAsk).
const GIT_SERVER = join(PACKAGE_ROOT, 'src', 'git-mcp.mjs');
export const CLAUDE_TOOLS = 'Read,Grep,Glob';
export const CLAUDE_ALLOWED = ['mcp__council-git'];
export const CLAUDE_DENIED = ['Edit', 'Write', 'NotebookEdit', 'Bash'];
// With web access, Claude may also search the web and fetch pages.
export const CLAUDE_WEB = ['WebSearch', 'WebFetch'];
// With a skill, Claude may spawn sub-agents. They get no more tools than Claude itself (checked with the real CLI).
export const CLAUDE_SUBAGENTS = ['Agent'];

// One session per side, workspace and model. Calls to one session run one at a time.
const sessions = new Map();
const keptDirs = new Set();
process.once('exit', () => { for (const dir of keptDirs) try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function sessionFor(side, workspace, model) {
  const key = JSON.stringify([side, workspace || null, model || null]);
  if (!sessions.has(key)) sessions.set(key, { id: null, dir: null, queue: Promise.resolve() });
  return sessions.get(key);
}

// Wait for promise, or reject as soon as signal aborts.
function untilDoneOrAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('cancelled'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(() => { signal.removeEventListener('abort', onAbort); resolve(); });
  });
}

// One call at a time per session. A caller cancelled while it waits leaves the queue at once; its place
// passes on when the call before it finishes, so the calls behind it still never overlap.
async function inSession(session, work, signal) {
  const previous = session.queue;
  let release;
  session.queue = new Promise(resolve => { release = resolve; });
  try {
    await untilDoneOrAborted(previous, signal);
  } catch (error) {
    previous.then(release);
    throw error;
  }
  try {
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
export async function holdSessions(entries, work, { signal } = {}) {
  const ordered = [...entries].sort((a, b) => a.side.localeCompare(b.side));
  const hold = index => (index === ordered.length ? work()
    : inSession(sessionFor(ordered[index].side, ordered[index].workspace, ordered[index].model), () => hold(index + 1), signal));
  return hold(0);
}

// Without a workspace, a side works in an empty folder that lasts as long as its session.
function workingDir(session, workspace, prefix) {
  if (workspace) return workspace;
  if (!session.dir) keptDirs.add(session.dir = mkdtempSync(join(tmpdir(), prefix)));
  return session.dir;
}

// The MCP config that gives Claude the read-only git tools for one workspace, kept with its session.
function gitToolsConfig(session, workspace) {
  if (!session.mcpConfig) {
    const dir = mkdtempSync(join(tmpdir(), 'council-claude-git-'));
    keptDirs.add(dir);
    session.mcpConfig = join(dir, 'mcp.json');
    writeFileSync(session.mcpConfig, JSON.stringify({ mcpServers: { 'council-git': { type: 'stdio', command: process.execPath, args: [GIT_SERVER, workspace] } } }));
  }
  return session.mcpConfig;
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
 * web: whether it may search the web (default: the config's web_search). Codex's web search runs on
 * OpenAI's side; its sandbox stays read-only with no network for commands.
 */
export async function askCodex(prompt, overrides = {}, { config = loadConfig(), signal, workspace, web = config.web_search, skill = false, held = false } = {}) {
  const chosen = resolveSide('codex', overrides, config);
  const exe = findExecutable('codex', config.codex.command);
  const session = sessionFor('codex', workspace, chosen.model);
  const call = () => inTempDir('council-codex-out-', async outDir => {
    const cwd = workingDir(session, workspace, 'council-codex-');
    const opts = options(config, signal, cwd, skill);
    const problem = await codexSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    const answerFile = join(outDir, 'answer.txt');
    // --ignore-user-config and --ignore-rules keep ~/.codex/config.toml (plugins, hooks, MCP servers) and
    // .rules files out. The sandbox is also set with -c because `codex exec resume` has no --sandbox flag.
    const common = ['--json', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
      '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"'];
    if (chosen.model) common.push('-m', chosen.model);
    if (chosen.effort) common.push('-c', `model_reasoning_effort=${chosen.effort}`);
    common.push('-c', `web_search="${web ? 'live' : 'disabled'}"`);
    if (skill) common.push('--enable', 'multi_agent'); // sub-agents, for skills that call for them
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
  return held ? call() : inSession(session, call, signal);
}

/**
 * Claude's answer from `--output-format stream-json`: the main agent's text after its last tool result,
 * within its final turn. A model that writes a verdict and then closes with "see above" keeps the verdict;
 * sub-agents' messages and "still waiting for the sub-agents" turns (each ends with its own result event)
 * are left out. Falls back to the last result event's text.
 */
export function claudeAnswer(stdout) {
  const events = String(stdout).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const results = events.flatMap((event, i) => (event?.type === 'result' ? [i] : []));
  const end = results.length ? results.at(-1) : events.length;
  let start = results.length > 1 ? results.at(-2) : -1;
  const main = event => event?.parent_tool_use_id === null || event?.parent_tool_use_id === undefined;
  const blocks = event => (Array.isArray(event?.message?.content) ? event.message.content : []);
  events.forEach((event, i) => {
    if (i < end && event?.type === 'user' && main(event) && blocks(event).some(block => block.type === 'tool_result')) start = Math.max(start, i);
  });
  const text = events.slice(start + 1, end).filter(event => event?.type === 'assistant' && main(event))
    .flatMap(event => blocks(event).filter(block => block.type === 'text').map(block => String(block.text).trim())).filter(Boolean).join('\n\n');
  const last = results.length ? events[end] : null;
  return { data: last, text: text || (typeof last?.result === 'string' ? last.result.trim() : '') };
}

/**
 * workspace: the project folder the model may read (never write), or undefined for no file access.
 * web: whether it may search the web and fetch pages (default: the config's web_search).
 * --restricted ignores user, project and local settings (so no hooks, plugins or allow rules from them)
 * and confines the file tools to the working folder; dontAsk refuses anything not allowed here.
 */
export async function askClaude(prompt, overrides = {}, { config = loadConfig(), signal, workspace, web = config.web_search, skill = false, held = false } = {}) {
  const chosen = resolveSide('claude', overrides, config);
  const exe = findExecutable('claude', config.claude.command);
  const session = sessionFor('claude', workspace, chosen.model);
  const call = async () => {
    const cwd = workingDir(session, workspace, 'council-claude-');
    const opts = options(config, signal, cwd, skill);
    const problem = await claudeSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    const id = session.id ?? randomUUID();
    const args = ['-p', '--output-format', 'stream-json', '--verbose', session.id ? '--resume' : '--session-id', id,
      '--restricted', '--permission-mode', 'dontAsk', '--disable-slash-commands', '--strict-mcp-config',
      '--mcp-config', workspace ? gitToolsConfig(session, workspace) : EMPTY_MCP_CONFIG];
    const tools = [...(workspace ? [CLAUDE_TOOLS] : []), ...(web ? CLAUDE_WEB : []), ...(skill ? CLAUDE_SUBAGENTS : [])];
    const allowed = [...(workspace ? CLAUDE_ALLOWED : []), ...(web ? CLAUDE_WEB : []), ...(skill ? CLAUDE_SUBAGENTS : [])];
    args.push('--tools', tools.join(','));
    if (allowed.length) args.push('--allowedTools', ...allowed);
    args.push('--disallowedTools', ...CLAUDE_DENIED);
    if (chosen.model) args.push('--model', chosen.model);
    if (chosen.effort) args.push('--effort', chosen.effort);
    const result = await run(exe, args, { ...opts, input: prompt });
    const { data, text: answer } = claudeAnswer(result.stdout);
    if (typeof data?.session_id === 'string') session.id = data.session_id;
    if (result.code !== 0 || !data || data.is_error || !answer) {
      throw new Error(`claude failed: ${withHint('claude', failureDetail(answer || result.stderr || result.stdout))}`);
    }
    return answer;
  };
  return held ? call() : inSession(session, call, signal);
}
