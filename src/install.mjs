// Prerequisite checks, install, uninstall and doctor for the command-line installer.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { claudeSignInProblem, codexSignInProblem } from './adapters.mjs';
import { NAME, PACKAGE_ROOT, SIDES, loadConfig, resolveSide, userConfigPath } from './config.mjs';
import { cleanEnv, findExecutable, run } from './process.mjs';
import { banner, c, ui } from './ui.mjs';

export const DEFAULT_SOURCE = 'hamza-aziz-ai/codex-claude-council';
const PLUGIN = `${NAME}@${NAME}`;
const MIN_NODE = 20;
const LABEL = { claude: 'Claude Code CLI', codex: 'Codex CLI' };
const HOST = { claude: 'Claude Code', codex: 'Codex' };
const VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
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


/** Check Node.js, both CLIs, their versions and sign-ins. Both CLIs are required. */
export async function preflight({ quiet = false } = {}) {
  const show = quiet ? { ok() {}, warn() {}, fail() {}, spin: (label, work) => work() } : ui;
  const result = { ok: true, missing: [], signIn: [], exes: {} };
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE) result.ok = false;
  (major >= MIN_NODE ? show.ok : show.fail)(`Node.js ${process.version}${major >= MIN_NODE ? '' : ` (${MIN_NODE}+ required)`}`);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    show.fail(`Config: ${error.message}`);
    return { ...result, ok: false };
  }
  for (const side of ['claude', 'codex']) {
    let exe;
    try {
      exe = findExecutable(side, config[side].command);
    } catch {
      result.ok = false;
      result.missing.push(side);
      show.fail(`${LABEL[side]}: not found`);
      continue;
    }
    result.exes[side] = exe;
    const opts = { env: cleanEnv(config), timeoutMs: 60_000 };
    const [version, problem] = await show.spin(`Checking the ${LABEL[side]}`, () => Promise.all([
      run(exe, ['--version'], opts).then(r => (r.stdout || r.stderr).trim().split(/\r?\n/)[0] || 'unknown version').catch(error => error.message),
      (side === 'codex' ? codexSignInProblem : claudeSignInProblem)(exe, config, opts).catch(error => error.message),
    ]));
    show.ok(`${LABEL[side]}: ${version} ${c.dim(`(${exe})`)}`);
    if (problem) result.signIn.push(problem);
    if (problem) show.warn(`${LABEL[side]} sign-in: ${problem}`); else show.ok(`${LABEL[side]} sign-in: subscription`);
  }
  return result;
}

export async function doctor() {
  ui.intro(`${NAME} doctor  ${c.dim(`v${VERSION}`)}`);
  ui.gap();
  const result = await preflight();
  ui.gap();
  if (result.missing.length) ui.note('Install what is missing', installHelp(result.missing));
  let config;
  try { config = loadConfig(); } catch { ui.outro('Fix the config file, then run doctor again.'); return 1; }
  const rounds = config.max_rounds === null ? '1' : config.max_rounds === 0 ? 'until both agree' : `at most ${config.max_rounds}`;
  ui.note('Config', [
    `File: ${userConfigPath()}${existsSync(userConfigPath()) ? '' : c.dim(' (not created; using defaults)')}`,
    ...SIDES.map(side => { const { model, effort } = resolveSide(side, {}, config); return `${side}: model=${model || '(CLI default)'} effort=${effort || '(CLI default)'}`; }),
    `timeout=${config.timeout_seconds}s per call, synthesizer=${config.synthesizer}, exchanges=${rounds}`,
  ]);
  const ready = result.ok && !result.signIn.length;
  ui.outro(ready ? `Ready. Try: ${c.bold('"Ask the council: <your question>"')}` : 'Fix the items marked above, then run doctor again.');
  return ready ? 0 : 1;
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
  if (dryRun) { ui.ok(`$ ${shown}`); return 'done'; }
  const result = await ui.spin(`$ ${shown}`, () => run(exe, args, { timeoutMs: 300_000 }));
  const output = `${result.stdout}\n${result.stderr}`.trim();
  let status = null;
  if (/already/i.test(output) && (result.code === 0 || /already (added|exists|installed|on disk)/i.test(output))) status = 'already';
  else if (result.code === 0) status = 'done';
  else if (tolerate && tolerate.test(output)) status = 'skipped';
  (status ? ui.ok : ui.fail)(`$ ${shown}${{ already: c.dim('  (already there)'), skipped: c.dim('  (nothing to do)') }[status] ?? ''}`);
  for (const line of output.split(/\r?\n/).filter(line => line.trim() && !/could not create PATH aliases/.test(line))) ui.line(c.dim(`  ${line.trim()}`));
  if (!status) throw new Error(`\`${shown}\` failed (exit code ${result.code}).${failureHint(output)}`);
  return status;
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
  ui.ok(`${dryRun ? 'Would update' : 'Updated'} ${path}`);
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
  ui.ok(`${dryRun ? 'Would copy' : 'Copied'} the server to ${appDir()}`);
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
    ui.ok(`${dryRun ? 'Would remove' : 'Removed'} ${appDir()}`);
  }
}

// The install instructions for the missing CLIs, a blank line between them.
const installHelp = missing => missing.flatMap((side, i) => [...(i ? [''] : []), ...INSTALL_HELP[side]]);

function hostsFrom(only) {
  if (!only) return ['claude', 'codex'];
  if (!['claude', 'codex'].includes(only)) throw new Error('--only must be "claude" or "codex"');
  return [only];
}

/** The prerequisite checks install and update share; null when something is missing (and reported). */
async function prerequisites() {
  const check = await preflight();
  if (check.ok) return check;
  ui.gap();
  ui.fail(`${NAME} needs both the Claude Code CLI and the Codex CLI (and Node.js ${MIN_NODE}+). Install what is missing, then run this again.`);
  if (check.missing.length) ui.note('Install what is missing', installHelp(check.missing));
  ui.outro('Nothing was changed.');
  return null;
}

export async function install({ only, source = DEFAULT_SOURCE, claudeDesktop = false, dryRun = false } = {}) {
  banner(VERSION);
  ui.intro(`Installing ${NAME}${dryRun ? c.dim('  (dry run: nothing is changed)') : ''}`);
  ui.gap();
  const check = await prerequisites();
  if (!check) return 1;
  const hosts = hostsFrom(only);
  if (hosts.includes('claude')) {
    ui.gap();
    ui.info(c.bold('Claude Code plugin'));
    const claude = check.exes.claude;
    if (await step(claude, ['plugin', 'marketplace', 'add', source], { dryRun }) === 'already') {
      await step(claude, ['plugin', 'marketplace', 'update', NAME], { dryRun });
    }
    if (await step(claude, ['plugin', 'install', PLUGIN, '--scope', 'user'], { dryRun }) === 'already') {
      await step(claude, ['plugin', 'update', PLUGIN], { dryRun, tolerate: /latest|up to date/i });
    }
  }
  if (hosts.includes('codex')) {
    ui.gap();
    ui.info(c.bold('Codex plugin'));
    const codex = check.exes.codex;
    if (await step(codex, ['plugin', 'marketplace', 'add', source], { dryRun }) === 'already') {
      await step(codex, ['plugin', 'marketplace', 'upgrade', NAME], { dryRun, tolerate: /local|not a git|nothing to upgrade/i });
    }
    await step(codex, ['plugin', 'add', PLUGIN], { dryRun });
  }
  if (claudeDesktop) {
    ui.gap();
    ui.info(c.bold('Claude Desktop chat (MCP server)'));
    installDesktop(dryRun);
  }
  ui.gap();
  const done = host => (hosts.includes(host) ? (dryRun ? 'would be installed' : 'plugin installed') : `skipped (--only ${hosts[0]})`);
  ui.note(dryRun ? 'Dry run complete' : 'Installation complete', [
    `Version:       ${VERSION}`,
    `Claude Code:   ${done('claude')}`,
    `Codex:         ${done('codex')}`,
    `Desktop chat:  ${claudeDesktop ? 'MCP server added' : c.dim('not set up (add --claude-desktop)')}`,
    `Config:        ${userConfigPath()}${existsSync(userConfigPath()) ? '' : c.dim(' (defaults; not created)')}`,
  ]);
  ui.gap();
  ui.note('Next steps', [
    `1. Restart Claude Code and Codex (and Claude Desktop) so they load the plugin.`,
    `2. Claude Desktop: Settings > Plugins (under Customize) > + Add > Add marketplace > Add from a repository > ${DEFAULT_SOURCE} > Sync, then install ${NAME}.`,
    `3. ChatGPT desktop: Settings > Plugins > Add > + Add a marketplace > https://github.com/${DEFAULT_SOURCE}.git > Add marketplace, then install ${NAME}.`,
    `4. Optional defaults (model, effort, timeout): npx -y github:${DEFAULT_SOURCE} config --init, then edit ${userConfigPath()}`,
  ]);
  signInReminder(check);
  ui.outro(`Try it: ${c.bold('"Ask the council: <your question>"')}`);
  return 0;
}

// Sign-ins still missing: the council cannot answer until they are done.
function signInReminder(check) {
  if (!check.signIn.length) return;
  ui.gap();
  for (const problem of check.signIn) ui.warn(`Sign-in still needed: ${problem}`);
  ui.gap();
}

/**
 * Update an installed plugin to the latest version: refresh the marketplace, then update the plugin, in
 * Claude Code and in Codex. (`install` does the same when the plugin is already installed.)
 */
export async function update({ only, dryRun = false } = {}) {
  banner(VERSION);
  ui.intro(`Updating ${NAME}${dryRun ? c.dim('  (dry run: nothing is changed)') : ''}`);
  ui.gap();
  const check = await prerequisites();
  if (!check) return 1;
  const notInstalled = error => new Error(`${error.message} If ${NAME} is not installed yet, run \`npx -y github:${DEFAULT_SOURCE} install\` instead.`);
  const hosts = hostsFrom(only);
  try {
    if (hosts.includes('claude')) {
      ui.gap();
      ui.info(c.bold('Claude Code plugin'));
      await step(check.exes.claude, ['plugin', 'marketplace', 'update', NAME], { dryRun });
      await step(check.exes.claude, ['plugin', 'update', PLUGIN], { dryRun, tolerate: /latest|up to date/i });
    }
    if (hosts.includes('codex')) {
      ui.gap();
      ui.info(c.bold('Codex plugin'));
      await step(check.exes.codex, ['plugin', 'marketplace', 'upgrade', NAME], { dryRun, tolerate: /local|not a git|nothing to upgrade/i });
      await step(check.exes.codex, ['plugin', 'add', PLUGIN], { dryRun });
    }
  } catch (error) {
    throw failureHint(error.message) ? error : notInstalled(error);
  }
  ui.gap();
  ui.note(dryRun ? 'Dry run complete' : `Updated to ${VERSION}`, [
    'Fully quit and reopen Claude Code and Codex (and the desktop apps) to load the new version.',
    'Claude Desktop and the ChatGPT desktop app update the plugin themselves under Settings > Plugins.',
  ]);
  signInReminder(check);
  ui.outro('Done.');
  return 0;
}

export async function uninstall({ only, claudeDesktop = false, dryRun = false } = {}) {
  ui.intro(`Removing ${NAME}${dryRun ? c.dim('  (dry run: nothing is changed)') : ''}`);
  const config = loadConfig();
  for (const host of hostsFrom(only)) {
    ui.gap();
    ui.info(c.bold(`${HOST[host]} plugin`));
    let exe;
    try { exe = findExecutable(host, config[host].command); } catch { ui.warn(`${LABEL[host]} not found; skipped`); continue; }
    if (host === 'claude') {
      await step(exe, ['plugin', 'uninstall', PLUGIN], { dryRun, tolerate: /not (found|installed)/i });
      await step(exe, ['plugin', 'marketplace', 'remove', NAME], { dryRun, tolerate: /not found|no marketplace/i });
    } else {
      await step(exe, ['plugin', 'remove', PLUGIN], { dryRun, tolerate: /not (found|installed)/i });
      await step(exe, ['plugin', 'marketplace', 'remove', NAME], { dryRun, tolerate: /not found|no marketplace/i });
    }
  }
  if (claudeDesktop || !only) {
    ui.gap();
    ui.info(c.bold('Claude Desktop chat (MCP server)'));
    uninstallDesktop(dryRun);
  }
  ui.gap();
  if (existsSync(userConfigPath())) ui.info(`Your settings in ${userConfigPath()} were kept.`);
  ui.outro(dryRun ? 'Dry run complete.' : 'Removed.');
  return 0;
}

export function initConfig() {
  const path = userConfigPath();
  if (existsSync(path)) {
    console.log(`${path} already exists:\n${readFileSync(path, 'utf8')}`);
    return 0;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(join(PACKAGE_ROOT, 'src', 'defaults.json')));
  console.log(`Created ${path}. Edit it to change the default model, effort or timeout; changes apply on the next call.`);
  return 0;
}
