// One question to one CLI, using the user's own subscription sign-in.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_ROOT, SIDES, loadConfig, resolveSide } from './config.mjs';
import { cleanEnv, failureDetail, findExecutable, run } from './process.mjs';

const EMPTY_MCP_CONFIG = join(PACKAGE_ROOT, 'src', 'empty-mcp.json');

function options(config, signal, cwd) {
  return { cwd, env: cleanEnv(config), timeoutMs: Number(config.timeout_seconds) * 1000, signal };
}

// Each call runs in an empty temporary folder, so no project files or instructions leak in.
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

export async function askCodex(prompt, overrides = {}, { config = loadConfig(), signal } = {}) {
  const chosen = resolveSide('codex', overrides, config);
  const exe = findExecutable('codex', config.codex.command);
  return inTempDir('council-codex-', async dir => {
    const opts = options(config, signal, dir);
    const problem = await codexSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    const answerFile = join(dir, 'answer.txt');
    // --ignore-user-config keeps ~/.codex/config.toml (plugins, hooks, MCP servers, model settings)
    // out of council calls, so model and reasoning effort are always passed explicitly.
    const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-C', dir];
    if (chosen.model) args.push('-m', chosen.model);
    if (chosen.effort) args.push('-c', `model_reasoning_effort=${chosen.effort}`);
    args.push('--output-last-message', answerFile, '-');
    const result = await run(exe, args, { ...opts, input: prompt });
    if (result.code !== 0) throw new Error(`codex failed: ${failureDetail(result.stderr || result.stdout)}`);
    let answer = '';
    try { answer = readFileSync(answerFile, 'utf8').trim(); } catch { /* empty */ }
    if (!answer) throw new Error('codex returned an empty answer');
    return answer;
  });
}

export async function askClaude(prompt, overrides = {}, { config = loadConfig(), signal } = {}) {
  const chosen = resolveSide('claude', overrides, config);
  const exe = findExecutable('claude', config.claude.command);
  return inTempDir('council-claude-', async dir => {
    const opts = options(config, signal, dir);
    const problem = await claudeSignInProblem(exe, config, opts);
    if (problem) throw new Error(problem);
    // No tools, no skills, no MCP servers and no user/local settings (so no plugin hooks).
    const args = ['-p', '--output-format', 'json', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
      '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', EMPTY_MCP_CONFIG];
    if (chosen.model) args.push('--model', chosen.model);
    if (chosen.effort) args.push('--effort', chosen.effort);
    const result = await run(exe, args, { ...opts, input: prompt });
    let data;
    try { data = JSON.parse(result.stdout); } catch { /* reported below */ }
    const answer = typeof data?.result === 'string' ? data.result.trim() : '';
    if (result.code !== 0 || !data || data.is_error || !answer) {
      throw new Error(`claude failed: ${failureDetail(answer || result.stderr || result.stdout)}`);
    }
    return answer;
  });
}
