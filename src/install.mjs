// Prerequisite checks, install, uninstall and doctor for the command-line installer.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { claudeSignInProblem, codexSignInProblem } from './adapters.mjs';
import { NAME, PACKAGE_ROOT, SIDES, loadConfig, resolveSide, userConfigPath, usesApiKey } from './config.mjs';
import { cleanEnv, findExecutable, run } from './process.mjs';
import { banner, blend, c, ui } from './ui.mjs';

export const DEFAULT_SOURCE = 'hamza-aziz-ai/codex-claude-council';
const PLUGIN = `${NAME}@${NAME}`;
const MIN_NODE = 20;
const LABEL = { claude: 'Claude Code CLI', codex: 'Codex CLI' };
const HOST = { claude: 'Claude Code', codex: 'Codex' };
// Each CLI's color, as in the banner: Claude orange, Codex (ChatGPT) green.
const TINT = { claude: c.claude, codex: c.codex };
// A menu path, its steps separated by a dim >.
const menu = steps => steps.join(c.dim(' > '));
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
      show.fail(`${TINT[side](LABEL[side])}: not found`);
      continue;
    }
    result.exes[side] = exe;
    const opts = { env: cleanEnv(config, side), timeoutMs: 60_000 };
    const [version, problem] = await show.spin(`Checking the ${LABEL[side]}`, () => Promise.all([
      run(exe, ['--version'], opts).then(r => (r.stdout || r.stderr).trim().split(/\r?\n/)[0] || 'unknown version').catch(error => error.message),
      (side === 'codex' ? codexSignInProblem : claudeSignInProblem)(exe, config, opts).catch(error => error.message),
    ]));
    show.ok(`${TINT[side](LABEL[side])}: ${version} ${c.dim(`(${exe})`)}`);
    if (problem) result.signIn.push(problem);
    if (problem) show.warn(`${TINT[side](LABEL[side])} sign-in: ${problem}`); else show.ok(`${TINT[side](LABEL[side])} sign-in: ${c.green(usesApiKey(config, side) ? 'subscription or API key' : 'subscription')}`);
  }
  return result;
}

export async function doctor() {
  ui.intro(`${blend(NAME)} doctor  ${c.dim(`v${VERSION}`)}`);
  ui.gap();
  const result = await preflight();
  ui.gap();
  if (result.missing.length) ui.note('Install what is missing', installHelp(result.missing));
  let config;
  try { config = loadConfig(); } catch { ui.outro('Fix the config file, then run doctor again.'); return 1; }
  const rounds = config.max_rounds === null ? '1' : config.max_rounds === 0 ? 'until both agree' : `at most ${config.max_rounds}`;
  ui.note('Config', [
    `${c.dim('File:')} ${c.link(userConfigPath())}${existsSync(userConfigPath()) ? '' : c.dim(' (not created; using defaults)')}`,
    ...SIDES.map(side => { const { model, effort } = resolveSide(side, {}, config); return `${TINT[side](`${side}:`)} ${c.dim('model=')}${model || '(CLI default)'} ${c.dim('effort=')}${effort || '(CLI default)'}`; }),
    `${c.dim('timeout=')}${config.timeout_seconds}s per call, ${c.dim('synthesizer=')}${config.synthesizer}, ${c.dim('exchanges=')}${rounds}`,
  ]);
  const ready = result.ok && !result.signIn.length;
  ui.outro(ready ? `${c.green('Ready.')} ${c.dim('Try:')} ${c.gold('"Ask the council: <your question>"')}` : c.yellow('Fix the items marked above, then run doctor again.'));
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
  const name = basename(exe).replace(/\.(exe|cmd|bat)$/i, '');
  const command = `${c.dim('$')} ${(TINT[name] ?? (text => text))(name)} ${args.join(' ')}`;
  if (dryRun) { ui.ok(command); return 'done'; }
  const result = await ui.spin(command, () => run(exe, args, { timeoutMs: 300_000 }));
  const output = `${result.stdout}\n${result.stderr}`.trim();
  let status = null;
  if (/already/i.test(output) && (result.code === 0 || /already (added|exists|installed|on disk)/i.test(output))) status = 'already';
  else if (result.code === 0) status = 'done';
  else if (tolerate && tolerate.test(output)) status = 'skipped';
  (status ? ui.ok : ui.fail)(`${command}${{ already: c.dim('  (already there)'), skipped: c.dim('  (nothing to do)') }[status] ?? ''}`);
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
  ui.ok(`${dryRun ? 'Would update' : 'Updated'} ${c.link(path)}`);
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
  ui.ok(`${dryRun ? 'Would copy' : 'Copied'} the server to ${c.link(appDir())}`);
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
    ui.ok(`${dryRun ? 'Would remove' : 'Removed'} ${c.link(appDir())}`);
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
  ui.outro(c.yellow('Nothing was changed.'));
  return null;
}

export async function install({ only, source = DEFAULT_SOURCE, claudeDesktop = false, dryRun = false } = {}) {
  await banner(VERSION);
  ui.intro(`Installing ${blend(NAME)}${dryRun ? c.dim('  (dry run: nothing is changed)') : ''}`);
  ui.gap();
  const check = await prerequisites();
  if (!check) return 1;
  const hosts = hostsFrom(only);
  if (hosts.includes('claude')) {
    ui.gap();
    ui.section('Claude Code plugin', c.claude);
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
    ui.section('Codex plugin', c.codex);
    const codex = check.exes.codex;
    if (await step(codex, ['plugin', 'marketplace', 'add', source], { dryRun }) === 'already') {
      await step(codex, ['plugin', 'marketplace', 'upgrade', NAME], { dryRun, tolerate: /local|not a git|nothing to upgrade/i });
    }
    await step(codex, ['plugin', 'add', PLUGIN], { dryRun });
  }
  if (claudeDesktop) {
    ui.gap();
    ui.section('Claude Desktop chat (MCP server)', c.claude);
    installDesktop(dryRun);
  }
  ui.gap();
  const done = host => (hosts.includes(host) ? c.green(dryRun ? 'would be installed' : 'plugin installed') : c.dim(`skipped (--only ${hosts[0]})`));
  ui.note(dryRun ? 'Dry run complete' : 'Installation complete', [
    `${c.dim('Version:')}       ${c.gold(VERSION)}`,
    `${c.claude('Claude Code:')}   ${done('claude')}`,
    `${c.codex('Codex:')}         ${done('codex')}`,
    `${c.dim('Desktop chat:')}  ${claudeDesktop ? c.green('MCP server added') : c.dim('not set up (add --claude-desktop)')}`,
    `${c.dim('Config:')}        ${c.link(userConfigPath())}${existsSync(userConfigPath()) ? '' : c.dim(' (defaults; not created)')}`,
  ]);
  ui.gap();
  ui.note('Next steps', [
    `${c.gold('1.')} Restart ${c.claude('Claude Code')} and ${c.codex('Codex')} (and ${c.claude('Claude Desktop')}) so they load the plugin.`,
    `${c.gold('2.')} ${c.claude('Claude Desktop')}: ${menu(['Settings', 'Plugins (under Customize)', '+ Add', 'Add marketplace', 'Add from a repository', c.link(DEFAULT_SOURCE), 'Sync'])}, then install ${blend(NAME)}.`,
    `${c.gold('3.')} ${c.codex('ChatGPT desktop')}: ${menu(['Settings', 'Plugins', 'Add', '+ Add a marketplace', c.link(`https://github.com/${DEFAULT_SOURCE}.git`), 'Add marketplace'])}, then install ${blend(NAME)}.`,
    `${c.gold('4.')} Optional defaults (model, effort, timeout): ${c.link(`npx -y ${NAME} config --init`)}, then edit ${c.link(userConfigPath())}`,
  ]);
  signInReminder(check);
  ui.outro(`${c.dim('Try it:')} ${c.gold('"Ask the council: <your question>"')}`);
  return 0;
}

// Sign-ins still missing: the council cannot answer until they are done.
function signInReminder(check) {
  if (!check.signIn.length) return;
  ui.gap();
  for (const problem of check.signIn) ui.warn(`${c.yellow('Sign-in still needed:')} ${problem}`);
  ui.gap();
}

/**
 * Update an installed plugin to the latest version: refresh the marketplace, then update the plugin, in
 * Claude Code and in Codex. (`install` does the same when the plugin is already installed.)
 */
export async function update({ only, dryRun = false } = {}) {
  await banner(VERSION);
  ui.intro(`Updating ${blend(NAME)}${dryRun ? c.dim('  (dry run: nothing is changed)') : ''}`);
  ui.gap();
  const check = await prerequisites();
  if (!check) return 1;
  const notInstalled = error => new Error(`${error.message} If ${NAME} is not installed yet, run \`npx -y ${NAME} install\` instead.`);
  const hosts = hostsFrom(only);
  try {
    if (hosts.includes('claude')) {
      ui.gap();
      ui.section('Claude Code plugin', c.claude);
      await step(check.exes.claude, ['plugin', 'marketplace', 'update', NAME], { dryRun });
      await step(check.exes.claude, ['plugin', 'update', PLUGIN], { dryRun, tolerate: /latest|up to date/i });
    }
    if (hosts.includes('codex')) {
      ui.gap();
      ui.section('Codex plugin', c.codex);
      await step(check.exes.codex, ['plugin', 'marketplace', 'upgrade', NAME], { dryRun, tolerate: /local|not a git|nothing to upgrade/i });
      await step(check.exes.codex, ['plugin', 'add', PLUGIN], { dryRun });
    }
  } catch (error) {
    throw failureHint(error.message) ? error : notInstalled(error);
  }
  ui.gap();
  ui.note(dryRun ? 'Dry run complete' : `Updated to ${VERSION}`, [
    `Fully quit and reopen ${c.claude('Claude Code')} and ${c.codex('Codex')} (and the desktop apps) to load the new version.`,
    `${c.claude('Claude Desktop')} and the ${c.codex('ChatGPT desktop app')} update the plugin themselves under ${menu(['Settings', 'Plugins'])}.`,
  ]);
  signInReminder(check);
  ui.outro(c.green('Done.'));
  return 0;
}

export async function uninstall({ only, claudeDesktop = false, dryRun = false } = {}) {
  ui.intro(`Removing ${blend(NAME)}${dryRun ? c.dim('  (dry run: nothing is changed)') : ''}`);
  const config = loadConfig();
  for (const host of hostsFrom(only)) {
    ui.gap();
    ui.section(`${HOST[host]} plugin`, TINT[host]);
    let exe;
    try { exe = findExecutable(host, config[host].command); } catch { ui.warn(`${TINT[host](LABEL[host])} not found; skipped`); continue; }
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
    ui.section('Claude Desktop chat (MCP server)', c.claude);
    uninstallDesktop(dryRun);
  }
  ui.gap();
  if (existsSync(userConfigPath())) ui.info(`Your settings in ${c.link(userConfigPath())} were kept.`);
  ui.outro(c.green(dryRun ? 'Dry run complete.' : 'Removed.'));
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
