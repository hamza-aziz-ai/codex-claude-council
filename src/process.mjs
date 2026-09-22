// Finding and running the codex / claude CLIs on Windows, macOS and Linux.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { userConfigPath } from './config.mjs';

const IS_WINDOWS = process.platform === 'win32';

// Set by agent hosts for their own session; a nested CLI must not inherit them.
const HOST_VARS = [
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED',
];
// Removed unless allow_api_key_auth is true, so calls bill the user's subscriptions, not an API account.
const API_VARS = [
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];

export function cleanEnv(config = {}) {
  const drop = new Set([...HOST_VARS, ...(config.allow_api_key_auth ? [] : API_VARS)]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !drop.has(key.toUpperCase())));
}

function isRunnable(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() && (IS_WINDOWS || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

// GUI apps (Claude Desktop, ChatGPT desktop) often start MCP servers with a minimal PATH.
function fallbackDirs(name) {
  const home = homedir();
  const dirs = [join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'), join(home, '.bun', 'bin')];
  if (IS_WINDOWS) {
    const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    dirs.push(join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm'));
    if (name === 'codex') dirs.push(join(local, 'Programs', 'OpenAI', 'Codex', 'bin'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  return dirs;
}

/** Absolute path of a CLI: explicit config value, else PATH, else common install locations. */
export function findExecutable(name, configured) {
  const wanted = typeof configured === 'string' && configured.trim() ? configured.trim() : name;
  if (/[\\/]/.test(wanted)) {
    if (isRunnable(wanted)) return wanted;
    throw new Error(`${name} CLI not found at ${wanted} (check "${name}.command" in ${userConfigPath()})`);
  }
  const extensions = IS_WINDOWS
    ? ['.exe', '.cmd', '.bat', '.com'].filter(ext => (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').toLowerCase().includes(ext))
    : [''];
  const dirs = [...(process.env.PATH || '').split(delimiter), ...fallbackDirs(name)].filter(Boolean);
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir.replace(/^"|"$/g, ''), wanted + ext);
      if (isRunnable(candidate)) return candidate;
    }
  }
  throw new Error(`${name} CLI not found. Install it and sign in (see README), or set "${name}.command" in ${userConfigPath()}`);
}

// cmd.exe quoting, as in the widely used cross-spawn package. Needed because Node can only
// start .cmd/.bat files (e.g. npm-installed CLIs) through cmd.exe.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function cmdQuote(arg, doubleEscape) {
  let quoted = String(arg).replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1');
  quoted = `"${quoted}"`.replace(CMD_META, '^$1');
  return doubleEscape ? quoted.replace(CMD_META, '^$1') : quoted;
}

function command(file, args) {
  if (!IS_WINDOWS || !/\.(cmd|bat)$/i.test(file)) return { file, args, verbatim: false };
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
  const line = [file.replace(CMD_META, '^$1'), ...args.map(arg => cmdQuote(arg, doubleEscape))].join(' ');
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (IS_WINDOWS) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** Run a CLI with stdin input; resolves { code, stdout, stderr } and rejects on timeout or abort. */
export function run(file, args, { input = '', cwd, env = process.env, timeoutMs = 600_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const spec = command(file, args);
    const child = spawn(spec.file, spec.args, {
      cwd, env, windowsHide: true, windowsVerbatimArguments: spec.verbatim, detached: !IS_WINDOWS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle(value);
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish(reject, new Error(`${basename(file)} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    const onAbort = () => {
      killTree(child);
      finish(reject, new Error('cancelled'));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish(reject, new Error(`could not start ${basename(file)}: ${error.message}`)));
    child.on('close', code => finish(resolve, { code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}

/** The most useful part of a failed CLI's output: its ERROR lines, else the tail. */
export function failureDetail(output, limit = 1200) {
  const errors = [...new Set(String(output).split(/\r?\n/).map(line => line.trim()).filter(line => /^error\b/i.test(line)))];
  const detail = errors.length ? errors.join(' ') : String(output).trim();
  return detail.length > limit ? `…${detail.slice(-limit)}` : detail || 'no output';
}
