// Test setup: fake `codex` / `claude` executables in a folder whose name contains a space.
// On Windows they are .cmd shims like npm creates, which exercises the cmd.exe quoting path.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fake-cli.mjs', import.meta.url));
const IS_WINDOWS = process.platform === 'win32';

export function setup(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'council test '));
  const commands = {};
  for (const cli of ['codex', 'claude']) {
    const path = join(dir, IS_WINDOWS ? `${cli}.cmd` : cli);
    writeFileSync(path, IS_WINDOWS
      ? `@"${process.execPath}" "${FAKE}" ${cli} %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${cli} "$@"\n`);
    if (!IS_WINDOWS) chmodSync(path, 0o755);
    commands[cli] = path;
  }
  const log = join(dir, 'calls.jsonl');
  const configPath = join(dir, 'config.json');
  const write = (extra = {}) => writeFileSync(configPath, JSON.stringify({
    ...config, ...extra,
    codex: { command: commands.codex, ...(config.codex || {}), ...(extra.codex || {}) },
    claude: { command: commands.claude, ...(config.claude || {}), ...(extra.claude || {}) },
  }));
  write();
  // Empty Claude Code and Codex homes: no natively installed skills or saved sessions of the machine leak in.
  const env = { COUNCIL_CONFIG: configPath, FAKE_LOG: log, CLAUDE_CONFIG_DIR: join(dir, 'claude-home'), CODEX_HOME: join(dir, 'codex-home') };
  const saved = {};
  for (const key of Object.keys(env)) { saved[key] = process.env[key]; process.env[key] = env[key]; }
  return {
    dir, commands, env, writeConfig: write,
    calls: () => { try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } },
    questionCalls() { return this.calls().filter(c => !['--version', 'login', 'auth'].includes(c.args[0])); },
    clearCalls: () => writeFileSync(log, ''),
    cleanup() {
      for (const key of Object.keys(saved)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) { saved[key] = process.env[key]; process.env[key] = value; }
  const restore = () => { for (const key of Object.keys(saved)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } };
  try {
    const result = fn();
    return result instanceof Promise ? result.finally(restore) : (restore(), result);
  } catch (error) {
    restore();
    throw error;
  }
}
