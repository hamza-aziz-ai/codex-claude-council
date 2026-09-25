// One question to one CLI, using the user's own subscription sign-in.
// Each side keeps one CLI session for as long as this process lives (for the MCP server, that is the
// host's session), so a model remembers the discussion and what it has already read of the project.
// Both run with the user's own setup (their skills, plugins, MCP servers, CLAUDE.md / AGENTS.md) and can
// read anything, but neither can change anything: Claude runs in plan mode, Codex in its read-only sandbox.
// A session can also be one the user started themselves, passed by id; it then continues in place.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAME, SIDES, loadConfig, resolveSide } from './config.mjs';
import { cleanEnv, failureDetail, findExecutable, run } from './process.mjs';

// GIT_OPTIONAL_LOCKS=0 stops read-only git commands (git status) from refreshing the index.
// MEMBER_ENV tells this plugin's own server, if a member's setup starts it, that it runs inside a council.
export const MEMBER_ENV = 'CODEX_CLAUDE_COUNCIL_MEMBER';
const READ_ONLY_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat', [MEMBER_ENV]: '1' };

// A step that uses a skill runs its sub-agents too, so it gets the longer skill_timeout_seconds.
function options(config, signal, cwd, skill) {
  const seconds = skill ? Math.max(Number(config.timeout_seconds), Number(config.skill_timeout_seconds)) : Number(config.timeout_seconds);
  return { cwd, env: { ...cleanEnv(config), ...READ_ONLY_ENV }, timeoutMs: seconds * 1000, signal };
}

// Claude runs in plan mode: it reads, searches and runs read-only commands, and anything that would change
// something is refused (checked with the real CLI). Plan mode steers it towards a plan and ExitPlanMode,
// which a council member has no use for; this note keeps its answer in its reply.
export const CLAUDE_MEMBER_NOTE = 'You are a member of a council of two AI models (Claude and Codex), running in plan mode: '
  + 'you can read, search and run read-only commands, but you cannot change anything, and ExitPlanMode is not available. '
  + 'Your final reply is your deliverable and is all that is passed on: always end your turn with your complete answer to the prompt, '
  + 'not with a note about plan mode or a reference to a plan file. Do not comment on plan mode unless you are asked to change something.';
// The plugin's own tools would let a member start a council inside a council.
const PLUGIN_ID = `${NAME}@${NAME}`;
export const CLAUDE_DENIED = ['ExitPlanMode', `mcp__plugin_${NAME}_council`];
export const CLAUDE_WEB = ['WebSearch', 'WebFetch'];

// A Claude session id is a UUID; a Codex one a UUID or a thread name.
const SESSION_ID = { claude: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, codex: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ };

/** A session id the user passed, checked; throws if it cannot be one. */
export function checkSessionId(side, value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!SESSION_ID[side].test(id)) {
    throw new Error(side === 'claude' ? `not a Claude Code session id (a UUID): ${JSON.stringify(value)}` : `not a Codex session id: ${JSON.stringify(value)}`);
  }
  return id;
}

function firstMatch(file, pick) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/, 50)) {
      try { const found = pick(JSON.parse(line)); if (found) return found; } catch { /* not JSON */ }
    }
  } catch { /* unreadable */ }
  return null;
}

function findFile(dir, test, depth = 4) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) if (entry.isFile() && test(entry.name)) return join(dir, entry.name);
  if (depth > 0) for (const entry of entries) if (entry.isDirectory()) { const found = findFile(join(dir, entry.name), test, depth - 1); if (found) return found; }
  return null;
}

/** The folder a user's Claude Code or Codex session was started in, from its saved transcript; null if not found. */
export function sessionFolder(side, id) {
  if (side === 'claude') {
    const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
    const file = findFile(projects, name => name === `${id}.jsonl`, 1);
    return file && firstMatch(file, event => (typeof event?.cwd === 'string' ? event.cwd : null));
  }
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  for (const dir of ['sessions', 'archived_sessions']) {
    const file = findFile(join(home, dir), name => name.startsWith('rollout-') && name.endsWith(`${id}.jsonl`));
    const cwd = file && firstMatch(file, event => (event?.type === 'session_meta' && typeof event.payload?.cwd === 'string' ? event.payload.cwd : null));
    if (cwd) return cwd;
  }
  return null;
}

// One session per side, workspace and model, or per session id the user passed (resume). Calls to one
// session run one at a time.
const sessions = new Map();
const keptDirs = new Set();
process.once('exit', () => { for (const dir of keptDirs) try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function sessionFor(side, workspace, model, resume) {
  const key = JSON.stringify(resume ? ['resume', side, resume] : [side, workspace || null, model || null]);
  if (!sessions.has(key)) {
    const folder = resume ? sessionFolder(side, resume) : null;
    sessions.set(key, { id: resume || null, folder: folder && existsSync(folder) ? folder : null, dir: null, queue: Promise.resolve() });
  }
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
 * Hold these sessions ({ side, workspace, model, resume }) for the whole of work, so no other council or question
 * takes a turn in them meanwhile: each prompt assumes the turns before it in the session are its own.
 * Calls made inside pass { held: true }. Sessions are taken in a fixed order, so two councils cannot
 * each hold one and wait for the other.
 */
export async function holdSessions(entries, work, { signal } = {}) {
  const ordered = [...entries].sort((a, b) => a.side.localeCompare(b.side));
  const hold = index => (index === ordered.length ? work()
    : inSession(sessionFor(ordered[index].side, ordered[index].workspace, ordered[index].model, ordered[index].resume), () => hold(index + 1), signal));
  return hold(0);
}

// A side works in the workspace; a user's session without one, in the folder it was started in; otherwise
// in an empty folder that lasts as long as its session.
function workingDir(session, workspace, prefix) {
  if (workspace) return workspace;
  if (session.folder) return session.folder;
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
export async function requireBothSignedIn(config = loadConfig(), { signal, sides = SIDES } = {}) {
  const problems = await Promise.all(sides.map(async side => {
    try {
      return await SIGN_IN_PROBLEM[side](findExecutable(side, config[side].command), config, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      return error.message;
    }
  }));
  const lines = sides.flatMap((side, i) => (problems[i] ? [`- ${CLI_NAME[side]}: ${problems[i]}`] : []));
  if (lines.length) {
    const needs = sides.length === 1 ? `${CLI_NAME[sides[0]]} signed in. Nothing was sent to it.` : 'both Codex and Claude Code signed in. Nothing was sent to either model.';
    throw new Error(`The council needs ${needs}\n${lines.join('\n')}`);
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
 * workspace: the project folder the model works in and may read (never write).
 * web: whether it may search the web (default: the config's web_search). Codex's web search runs on
 * OpenAI's side; its sandbox stays read-only with no network for commands.
 * resume: the id of a Codex session the user started, continued in place (it keeps its memory).
 */
export async function askCodex(prompt, overrides = {}, { config = loadConfig(), signal, workspace, web = config.web_search, skill = false, resume, held = false } = {}) {
  const chosen = resolveSide('codex', overrides, config);
  const exe = findExecutable('codex', config.codex.command);
  const session = sessionFor('codex', workspace, chosen.model, resume && checkSessionId('codex', resume));
  const call = () => inTempDir('council-codex-out-', async outDir => {
    const cwd = workingDir(session, workspace, 'council-codex-');
    const opts = options(config, signal, cwd, skill);
    const problem = await codexSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    const answerFile = join(outDir, 'answer.txt');
    // The user's own config applies (their skills, plugins, MCP servers), but -c overrides it: the sandbox
    // stays read-only even where the config grants more (checked with the real CLI), and this plugin is off.
    // The sandbox is set with -c because `codex exec resume` has no --sandbox flag.
    const common = ['--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"',
      '-c', `plugins."${PLUGIN_ID}".enabled=false`];
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
    if (result.code !== 0) {
      const detail = result.stderr || result.stdout;
      if (resume && /already has an active writer/i.test(detail)) {
        throw new Error(`Codex session ${resume} is open in another Codex process, and Codex lets only one program write to a session at a time. `
          + 'Close that session (exit or /quit), then try again, or try again without the session id to start a new session.');
      }
      if (resume && /no rollout found/i.test(detail)) {
        throw new Error(`Codex has not saved session ${resume}: it saves a session after its first message. `
          + 'Send one message in that session first, or check the id with `codex resume`.');
      }
      throw new Error(`codex failed: ${withHint('codex', failureDetail(detail))}`);
    }
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
 * workspace: the project folder the model works in and may read (never write).
 * web: whether it may search the web and fetch pages (default: the config's web_search).
 * resume: the id of a Claude Code session the user started, continued in place (it keeps its memory).
 * Plan mode applies on top of the user's own settings, whatever mode they use themselves.
 */
export async function askClaude(prompt, overrides = {}, { config = loadConfig(), signal, workspace, web = config.web_search, skill = false, resume, held = false } = {}) {
  const chosen = resolveSide('claude', overrides, config);
  const exe = findExecutable('claude', config.claude.command);
  const session = sessionFor('claude', workspace, chosen.model, resume && checkSessionId('claude', resume));
  const call = async () => {
    const cwd = workingDir(session, workspace, 'council-claude-');
    const opts = options(config, signal, cwd, skill);
    const problem = await claudeSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    const id = session.id ?? randomUUID();
    const args = ['-p', '--output-format', 'stream-json', '--verbose', session.id ? '--resume' : '--session-id', id,
      '--permission-mode', 'plan', '--append-system-prompt', CLAUDE_MEMBER_NOTE,
      '--disallowedTools', ...CLAUDE_DENIED, ...(web ? [] : CLAUDE_WEB)];
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
