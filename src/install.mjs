// Prerequisite checks, install, uninstall and doctor for the command-line installer.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { claudeSignInProblem, codexSignInProblem } from './adapters.mjs';
import { NAME, PACKAGE_ROOT, SIDES, loadConfig, resolveSide, userConfigPath } from './config.mjs';
import { cleanEnv, findExecutable, run } from './process.mjs';

export const DEFAULT_SOURCE = 'hamza-aziz-ai/codex-claude-council';
const PLUGIN = `${NAME}@${NAME}`;
const MIN_NODE = 20;
const LABEL = { claude: 'Claude Code CLI', codex: 'Codex CLI' };
const INSTALL_HELP = {
  claude: [
    'Claude Code: https://code.claude.com/docs/en/setup',
    '  macOS / Linux / WSL:  curl -fsSL https://claude.ai/install.sh | bash',
    '  Windows PowerShell:   irm https://claude.ai/install.ps1 | iex',
    '  then sign in:         claude auth login   (Pro, Max, Team or Enterprise plan)',
  ],
  codex: [
    'Codex CLI: https://developers.openai.com/codex/cli',
    '  any OS (Node.js):     npm install -g @openai/codex',
    '  macOS (Homebrew):     brew install --cask codex',
    '  then sign in:         codex login   (choose "Sign in with ChatGPT")',
  ],
};

const say = (...lines) => console.log(lines.join('\n'));
const mark = { ok: '[ok]', fail: '[x] ', warn: '[!] ' };

/** Check Node.js, both CLIs, their versions and sign-ins. Both CLIs are required. */
export async function preflight({ quiet = false } = {}) {
  const print = quiet ? () => {} : say;
  const result = { ok: true, missing: [], signIn: [], exes: {} };
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE) result.ok = false;
  print(`${major >= MIN_NODE ? mark.ok : mark.fail} Node.js ${process.version}${major >= MIN_NODE ? '' : ` (${MIN_NODE}+ required)`}`);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    print(`${mark.fail} Config: ${error.message}`);
    return { ...result, ok: false };
  }
  for (const side of ['claude', 'codex']) {
    let exe;
    try {
      exe = findExecutable(side, config[side].command);
    } catch {
      result.ok = false;
      result.missing.push(side);
      print(`${mark.fail} ${LABEL[side]}: not found`);
      continue;
    }
    result.exes[side] = exe;
    const opts = { env: cleanEnv(config), timeoutMs: 60_000 };
    const version = await run(exe, ['--version'], opts)
      .then(r => (r.stdout || r.stderr).trim().split(/\r?\n/)[0] || 'unknown version')
      .catch(error => error.message);
    print(`${mark.ok} ${LABEL[side]}: ${version} (${exe})`);
    const problem = await (side === 'codex' ? codexSignInProblem : claudeSignInProblem)(exe, config, opts)
      .catch(error => error.message);
    if (problem) result.signIn.push(problem);
    print(problem ? `${mark.warn} ${LABEL[side]} sign-in: ${problem}` : `${mark.ok} ${LABEL[side]} sign-in: subscription`);
  }
  return result;
}

export async function doctor() {
  say(`${NAME} doctor`, '');
  const result = await preflight();
  const config = loadConfig();
  say('', `Config file: ${userConfigPath()}${existsSync(userConfigPath()) ? '' : ' (not created; using defaults)'}`);
  for (const side of SIDES) {
    const { model, effort } = resolveSide(side, {}, config);
    say(`  ${side}: model=${model || '(CLI default)'} effort=${effort || '(CLI default)'}`);
  }
  const rounds = config.max_rounds === null ? 'single pass' : config.max_rounds === 0 ? 'until both agree' : `at most ${config.max_rounds}`;
  say(`  timeout=${config.timeout_seconds}s per call, synthesizer=${config.synthesizer}, agreement rounds=${rounds}`);
  if (result.missing.length) say('', ...result.missing.flatMap(side => INSTALL_HELP[side]));
  return result.ok && !result.signIn.length ? 0 : 1;
}

/** What to do about a host command that failed because files are still in use (Windows). */
export function failureHint(output) {
  return /access is denied|os error 5\b|EBUSY|EPERM|resource busy|being used by another process/i.test(output)
    ? ' Its files are still in use, usually by a running Codex or Claude Code session or app (CLI, IDE extension, ChatGPT or Claude desktop app). Quit them all, then run this again.'
    : '';
}

/** Run one host command. Returns "already" when it reports the item already exists, else "done". */
async function step(exe, args, { dryRun, tolerate } = {}) {
  const shown = [basename(exe).replace(/\.(exe|cmd|bat)$/i, ''), ...args].join(' ');
  say(`  $ ${shown}`);
  if (dryRun) return 'done';
  const result = await run(exe, args, { timeoutMs: 300_000 });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (output) say(output.split(/\r?\n/).filter(line => !/could not create PATH aliases/.test(line)).map(line => `    ${line}`).join('\n'));
  if (/already/i.test(output) && (result.code === 0 || /already (added|exists|installed|on disk)/i.test(output))) return 'already';
  if (result.code === 0) return 'done';
  if (tolerate && tolerate.test(output)) return 'skipped';
  throw new Error(`\`${shown}\` failed (exit code ${result.code}).${failureHint(output)}`);
}

function desktopConfigPaths() {
  const home = homedir();
  if (process.platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
  if (process.platform !== 'win32') {
    return [join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json')];
  }
  // The Microsoft Store (MSIX) build of Claude Desktop reads a per-package copy of AppData.
  const paths = [];
  const packages = join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Packages');
  try {
    for (const dir of readdirSync(packages)) {
      if (/^Claude_/i.test(dir)) paths.push(join(packages, dir, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
    }
  } catch { /* no packaged install */ }
  paths.push(join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'));
  return paths;
}

function desktopTargets() {
  const paths = desktopConfigPaths();
  const existing = paths.filter(path => existsSync(path));
  if (existing.length) return existing;
  const withFolder = paths.filter(path => existsSync(dirname(dirname(path))));
  return withFolder.length ? withFolder.slice(0, 1) : paths.slice(0, 1);
}

function editDesktopConfig(path, edit, dryRun) {
  const exists = existsSync(path);
  const config = exists ? JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '') || '{}') : {};
  if (!edit(config)) return false;
  say(`  ${dryRun ? 'would update' : 'updated'} ${path}`);
  if (dryRun) return true;
  mkdirSync(dirname(path), { recursive: true });
  if (exists) writeFileSync(`${path}.bak-${NAME}`, readFileSync(path));
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

const appDir = () => join(homedir(), `.${NAME}`, 'app');

function installDesktop(dryRun) {
  const server = join(appDir(), 'src', 'mcp-server.mjs');
  if (!dryRun) {
    rmSync(appDir(), { recursive: true, force: true });
    mkdirSync(appDir(), { recursive: true });
    for (const item of ['src', 'package.json', 'LICENSE']) {
      if (existsSync(join(PACKAGE_ROOT, item))) cpSync(join(PACKAGE_ROOT, item), join(appDir(), item), { recursive: true });
    }
  }
  say(`  ${dryRun ? 'would copy' : 'copied'} the server to ${appDir()}`);
  for (const path of desktopTargets()) {
    editDesktopConfig(path, config => {
      config.mcpServers = { ...(config.mcpServers || {}), [NAME]: { command: process.execPath, args: [server] } };
      return true;
    }, dryRun);
  }
}

function uninstallDesktop(dryRun) {
  for (const path of desktopConfigPaths().filter(p => existsSync(p))) {
    editDesktopConfig(path, config => {
      if (!config.mcpServers?.[NAME]) return false;
      delete config.mcpServers[NAME];
      return true;
    }, dryRun);
  }
  if (existsSync(appDir())) {
    if (!dryRun) rmSync(appDir(), { recursive: true, force: true });
    say(`  ${dryRun ? 'would remove' : 'removed'} ${appDir()}`);
  }
}

function hostsFrom(only) {
  if (!only) return ['claude', 'codex'];
  if (!['claude', 'codex'].includes(only)) throw new Error('--only must be "claude" or "codex"');
  return [only];
}

/** The prerequisite checks install and update share; null when something is missing (and reported). */
async function prerequisites() {
  const check = await preflight();
  if (check.ok) return check;
  say('', `${NAME} needs both the Claude Code CLI and the Codex CLI (and Node.js ${MIN_NODE}+). Install what is missing, then run this again:`, '');
  if (check.missing.length) say(...check.missing.flatMap(side => [...INSTALL_HELP[side], '']));
  return null;
}

export async function install({ only, source = DEFAULT_SOURCE, claudeDesktop = false, dryRun = false } = {}) {
  say(`Installing ${NAME}${dryRun ? ' (dry run)' : ''}`, '', 'Checking prerequisites:');
  const check = await prerequisites();
  if (!check) return 1;
  const hosts = hostsFrom(only);
  if (hosts.includes('claude')) {
    say('', 'Claude Code plugin:');
    const claude = check.exes.claude;
    if (await step(claude, ['plugin', 'marketplace', 'add', source], { dryRun }) === 'already') {
      await step(claude, ['plugin', 'marketplace', 'update', NAME], { dryRun });
    }
    if (await step(claude, ['plugin', 'install', PLUGIN, '--scope', 'user'], { dryRun }) === 'already') {
      await step(claude, ['plugin', 'update', PLUGIN], { dryRun, tolerate: /latest|up to date/i });
    }
  }
  if (hosts.includes('codex')) {
    say('', 'Codex plugin:');
    const codex = check.exes.codex;
    if (await step(codex, ['plugin', 'marketplace', 'add', source], { dryRun }) === 'already') {
      await step(codex, ['plugin', 'marketplace', 'upgrade', NAME], { dryRun, tolerate: /local|not a git|nothing to upgrade/i });
    }
    await step(codex, ['plugin', 'add', PLUGIN], { dryRun });
  }
  if (claudeDesktop) {
    say('', 'Claude Desktop chat (MCP server):');
    installDesktop(dryRun);
  }
  say('', 'Done. Next:',
    '  - Restart Claude Code and Codex (and Claude Desktop) so they load the plugin.',
    `  - Claude Desktop: Settings > Plugins (under Customize) > + Add > Add marketplace > Add from a repository > ${DEFAULT_SOURCE} > Sync, then install ${NAME}.`,
    `  - ChatGPT desktop: Settings > Plugins > Add > + Add a marketplace > https://github.com/${DEFAULT_SOURCE}.git > Add marketplace, then install ${NAME}.`,
    `  - Optional defaults (model, effort, timeout): npx -y github:${DEFAULT_SOURCE} config --init, then edit ${userConfigPath()}`,
    '  - Try it: "Ask the council: <your question>"');
  if (check.signIn.length) say('', 'Sign-in still needed before the council can answer:', ...check.signIn.map(p => `  - ${p}`));
  return 0;
}

/**
 * Update an installed plugin to the latest version: refresh the marketplace, then update the plugin, in
 * Claude Code and in Codex. (`install` does the same when the plugin is already installed.)
 */
export async function update({ only, dryRun = false } = {}) {
  say(`Updating ${NAME}${dryRun ? ' (dry run)' : ''}`, '', 'Checking prerequisites:');
  const check = await prerequisites();
  if (!check) return 1;
  const notInstalled = error => new Error(`${error.message} If ${NAME} is not installed yet, run \`npx -y github:${DEFAULT_SOURCE} install\` instead.`);
  const hosts = hostsFrom(only);
  try {
    if (hosts.includes('claude')) {
      say('', 'Claude Code plugin:');
      await step(check.exes.claude, ['plugin', 'marketplace', 'update', NAME], { dryRun });
      await step(check.exes.claude, ['plugin', 'update', PLUGIN], { dryRun, tolerate: /latest|up to date/i });
    }
    if (hosts.includes('codex')) {
      say('', 'Codex plugin:');
      await step(check.exes.codex, ['plugin', 'marketplace', 'upgrade', NAME], { dryRun, tolerate: /local|not a git|nothing to upgrade/i });
      await step(check.exes.codex, ['plugin', 'add', PLUGIN], { dryRun });
    }
  } catch (error) {
    throw failureHint(error.message) ? error : notInstalled(error);
  }
  say('', 'Done. Fully quit and reopen Claude Code and Codex (and the desktop apps) to load the new version.',
    'Claude Desktop and the ChatGPT desktop app update the plugin themselves under Settings > Plugins.');
  if (check.signIn.length) say('', 'Sign-in still needed before the council can answer:', ...check.signIn.map(p => `  - ${p}`));
  return 0;
}

export async function uninstall({ only, claudeDesktop = false, dryRun = false } = {}) {
  say(`Removing ${NAME}${dryRun ? ' (dry run)' : ''}`);
  const config = loadConfig();
  for (const host of hostsFrom(only)) {
    let exe;
    try { exe = findExecutable(host, config[host].command); } catch { say(`  ${LABEL[host]} not found; skipped`); continue; }
    if (host === 'claude') {
      await step(exe, ['plugin', 'uninstall', PLUGIN], { dryRun, tolerate: /not (found|installed)/i });
      await step(exe, ['plugin', 'marketplace', 'remove', NAME], { dryRun, tolerate: /not found|no marketplace/i });
    } else {
      await step(exe, ['plugin', 'remove', PLUGIN], { dryRun, tolerate: /not (found|installed)/i });
      await step(exe, ['plugin', 'marketplace', 'remove', NAME], { dryRun, tolerate: /not found|no marketplace/i });
    }
  }
  if (claudeDesktop || !only) uninstallDesktop(dryRun);
  if (existsSync(userConfigPath())) say('', `Your settings in ${userConfigPath()} were kept.`);
  return 0;
}

export function initConfig() {
  const path = userConfigPath();
  if (existsSync(path)) {
    say(`${path} already exists:`, readFileSync(path, 'utf8'));
    return 0;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(join(PACKAGE_ROOT, 'src', 'defaults.json')));
  say(`Created ${path}. Edit it to change the default model, effort or timeout; changes apply on the next call.`);
  return 0;
}
