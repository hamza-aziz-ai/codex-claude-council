#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NAME, SIDES, loadConfig, packageVersion, userConfigPath, usesApiKey } from '../src/config.mjs';
import { councilText, invoke } from '../src/council.mjs';
import { debateHtml } from '../src/share.mjs';
import { doctor, initConfig, install, uninstall, update } from '../src/install.mjs';
import { CLI_NAME, askClaude, askCodex, resolveSession, sessionFolder, signInProblem } from '../src/adapters.mjs';
import { cleanEnv, findExecutable, run, runInteractive, start } from '../src/process.mjs';
import { addSkill, installedFor, listSkills, nativeSkills, removeSkill, skillsDir } from '../src/skills.mjs';

const HELP = `${NAME} ${packageVersion()}
Ask Codex (ChatGPT) and Claude through your own signed-in CLIs.

Usage:
  ${NAME} install [options]        Check prerequisites, then add the plugin to Claude Code and Codex
  ${NAME} update [options]         Update the plugin in Claude Code and Codex to the latest version
  ${NAME} uninstall [options]      Remove it again (your config file is kept)
  ${NAME} doctor                   Check Node.js, both CLIs, sign-ins and config
  ${NAME} login                    Sign in each CLI that is not signed in yet (Codex with ChatGPT, Claude Code
                                   with your Claude plan); COUNCIL_DEVICE_AUTH=1 signs Codex in with a code
  ${NAME} api-setup                Install the Anthropic and OpenAI SDKs for sides set to "via": "api", where the
                                   plugin's own copy lacks them (Claude Code, Codex, Claude Desktop)
  ${NAME} skill add <url|path>     Install the skills (SKILL.md folders) of a GitHub repository or local folder/file
  ${NAME} skill list               List installed skills
  ${NAME} skill remove <name>      Remove an installed skill
  ${NAME} config [--init]          Show the effective config, or create an editable config file
  ${NAME} ask "question"           Both answer, then reply to each other until they agree on one final answer
  ${NAME} debate "question"        Same, printing the answers, every exchange and the settings as JSON
  ${NAME} codex "question"         Codex (ChatGPT) only
  ${NAME} claude "question"        Claude only
  ${NAME} mcp                      Run the MCP server on stdio
  ${NAME} serve [options]          Run the MCP server over HTTP, at a secret URL (Streamable HTTP)

Model and effort (omit to use your config):
  codex, claude:   --model <name>  --effort <level>
  ask, debate:     --codex-model <name>  --codex-effort <level>  --claude-model <name>  --claude-effort <level>
                   --synthesizer <claude|codex>   who writes the final answer (default: claude; chatgpt = codex)
                   --max-rounds <n>   exchanges until both agree: n = at most n, 0 = no limit
                                      (default: 5, "max_rounds" in the config)
  all four:        --workspace <dir>  project folder both models work in, in plan mode (read, never change);
                                      default: the session's folder with a session id, else the git
                                      repository you are in, if any
                   --no-workspace     no project folder
                   --no-web           no web search or web pages (default: on, "web_search" in the config)
                   --network          let Codex's commands reach the network, still read-only on disk
                                      (default: off, "network" in the config; not for the claude command)
                   --skill <name>     both models may use this installed skill where a step needs it;
                                      repeat it, or separate names with commas, for several
  codex, claude:   --session <id|name>  continue your own Codex / Claude Code session in place (keeps its memory);
                                        its id from /status, or the name you gave it with /rename
  ask, debate:     --codex-session <id|name>  --claude-session <id|name>   the same, per side
                   --html <file>      also save the whole discussion as a page to share
  Codex effort: none, minimal, low, medium, high, xhigh.  Claude effort: low, medium, high, xhigh, max.

Install / update / uninstall options:
  --only <claude|codex>   One host only (both CLIs are still required)
  --claude-desktop        Also register the MCP server with Claude Desktop chat
  --source <repo|path>    Marketplace source (default: hamza-aziz-ai/${NAME})
  --dry-run               Show what would run without changing anything

Serve options:
  --port <n>              Port to listen on (default: 8000)
  --host <address>        Address to listen on (default: 127.0.0.1, this computer only; 0.0.0.0 for every network)
  --token <secret>        The secret in the URL (default: COUNCIL_TOKEN, else one generated once and saved
                          next to the config file)
  --tunnel                Also put it online over HTTPS, through a Cloudflare quick tunnel (needs cloudflared),
                          and print that URL; with TUNNEL_TOKEN and COUNCIL_PUBLIC_URL set, through your named
                          tunnel instead, at a fixed address

The question can also be piped on stdin.`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  model: { type: 'string' },
  effort: { type: 'string' },
  'codex-model': { type: 'string' },
  'codex-effort': { type: 'string' },
  'claude-model': { type: 'string' },
  'claude-effort': { type: 'string' },
  'max-rounds': { type: 'string' },
  workspace: { type: 'string' },
  'no-workspace': { type: 'boolean' },
  'no-web': { type: 'boolean' },
  network: { type: 'boolean' },
  skill: { type: 'string', multiple: true },
  session: { type: 'string' },
  'codex-session': { type: 'string' },
  'claude-session': { type: 'string' },
  synthesizer: { type: 'string' },
  only: { type: 'string' },
  source: { type: 'string' },
  'claude-desktop': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  init: { type: 'boolean' },
  html: { type: 'string' },
  raw: { type: 'boolean' },
  'skill-step': { type: 'boolean' },
  port: { type: 'string' },
  host: { type: 'string' },
  token: { type: 'string' },
  tunnel: { type: 'boolean' },
};
const TOOLS = { ask: 'council_ask', debate: 'debate', codex: 'ask_codex', claude: 'ask_claude' };

/** The git repository containing dir (the nearest folder with a .git entry), if any. */
function gitRoot(dir) {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) return current;
    if (dirname(current) === current) return undefined;
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let text = '';
  for await (const chunk of process.stdin.setEncoding('utf8')) text += chunk;
  return text;
}

/** The secret in the serve URL: --token, COUNCIL_TOKEN, or one generated once and kept next to the config file. */
function serveToken(given) {
  if (given ?? process.env.COUNCIL_TOKEN) return given ?? process.env.COUNCIL_TOKEN;
  const path = join(dirname(userConfigPath()), 'serve-token');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const token = randomBytes(24).toString('base64url');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  return token;
}

async function serveCommand(values) {
  const port = values.port === undefined ? 8000 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a port number');
  const { serveHttp } = await import('../src/mcp.mjs');
  const { url, close } = await serveHttp({ token: serveToken(values.token), port, host: values.host });
  // Where this computer reaches the server: a server listening on every address is reached at 127.0.0.1.
  const local = new URL(url).origin.replace(/\/\/(0\.0\.0\.0|\[::\])/, '//127.0.0.1');
  const path = new URL(url).pathname;
  let tunnel;
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    close();
    Promise.resolve(tunnel?.stop()).finally(() => process.exit(code));
  };
  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(0));
  const secret = 'Anyone who has it can run the council on this computer, under your plans: keep it secret.';
  if (!values.tunnel) {
    console.log(`${url}
The council's MCP server is listening at the URL above (Streamable HTTP). ${secret}
To use it from claude.ai, ChatGPT or another computer, it needs HTTPS: run serve --tunnel instead, or put your own
tunnel or reverse proxy in front, such as: cloudflared tunnel --url ${local}
then add https://<its host>${path} as a custom connector. Ctrl+C stops the server.`);
    return null;
  }
  try {
    tunnel = await startTunnel(local);
  } catch (error) {
    close();
    throw error;
  }
  tunnel.child.once('exit', code => {
    if (stopping) return;
    console.error(`${NAME}: the tunnel stopped (cloudflared exited with ${code}); stopping the server.`);
    stop(1);
  });
  console.log(`${tunnel.origin}${path}
The council's MCP server is online at the URL above, through ${tunnel.named ? 'your Cloudflare named tunnel' : 'a Cloudflare quick tunnel'} (HTTPS). ${secret}
Add it as a custom connector (claude.ai: Settings > Connectors > Add custom connector; no sign-in). ${tunnel.named
    ? 'The address stays the same across restarts.'
    : 'The tunnel\'s\naddress changes each time serve starts: update the connector then.'} Ctrl+C stops the server and the tunnel.`);
  return null;
}

/**
 * A Cloudflare quick tunnel (no account needed) to the server at local: resolves to { origin, child, stop } once
 * cloudflared reports its https://<words>.trycloudflare.com address.
 */
async function startTunnel(local) {
  let file;
  try {
    file = findExecutable('cloudflared');
  } catch {
    throw new Error('--tunnel needs cloudflared. Install it (Windows: winget install Cloudflare.cloudflared; macOS: brew install cloudflared; '
      + 'Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then run serve --tunnel again.');
  }
  // A named tunnel of your own (a fixed address): cloudflared reads its token from TUNNEL_TOKEN, and the tunnel's
  // public hostname, which cloudflared doesn't print, comes from COUNCIL_PUBLIC_URL.
  const named = Boolean(process.env.TUNNEL_TOKEN);
  const publicUrl = process.env.COUNCIL_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (named && !/^https:\/\/[^/\s]+$/.test(publicUrl ?? '')) {
    throw new Error('With TUNNEL_TOKEN (a named tunnel), set COUNCIL_PUBLIC_URL to its address, such as https://council.example.com');
  }
  const tunnel = start(file, named ? ['tunnel', '--no-autoupdate', 'run', '--url', local] : ['tunnel', '--no-autoupdate', '--url', local]);
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    const fail = message => { clearTimeout(timer); tunnel.stop(); reject(new Error(`${message}\n${output.trim().slice(-1500)}`)); };
    const timer = setTimeout(() => fail(`cloudflared ${named ? 'connected no tunnel' : 'gave no tunnel address'} within 60 s:`), 60_000);
    const read = chunk => {
      if (output === null) return; // found already: the rest is cloudflared's log, read and dropped
      output += chunk;
      const found = named ? /Registered tunnel connection/.test(output) && publicUrl : output.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      if (found) { clearTimeout(timer); output = null; resolve(found); }
    };
    tunnel.child.stdout.setEncoding('utf8').on('data', read);
    tunnel.child.stderr.setEncoding('utf8').on('data', read);
    tunnel.child.once('error', error => fail(`could not start cloudflared: ${error.message}`));
    tunnel.child.once('exit', code => { if (output !== null) fail(`cloudflared stopped (exit ${code}) before it had a tunnel address:`); });
  });
  return { origin, named, ...tunnel };
}

/**
 * Sign in each CLI the council needs that is not signed in yet, one after the other, in this terminal. Codex signs in
 * with a code to enter on any device when COUNCIL_DEVICE_AUTH is set (the Docker image sets it: no browser there).
 * A side set to "auth": "api_key" signs in with its key: Codex stores OPENAI_API_KEY (codex login --with-api-key);
 * Claude Code uses ANTHROPIC_API_KEY as it is, or signs in to the Anthropic Console.
 */
async function login() {
  const config = loadConfig();
  let failed = 0;
  for (const side of SIDES) {
    if (!(await signInProblem(side, config))) { console.log(`${CLI_NAME[side]} is signed in.`); continue; }
    let file;
    try {
      file = findExecutable(side, config[side].command);
    } catch (error) {
      console.error(`${CLI_NAME[side]}: ${error.message}`);
      failed += 1;
      continue;
    }
    const env = cleanEnv(config, side);
    const apiKey = usesApiKey(config, side);
    if (side === 'codex' && apiKey && env.OPENAI_API_KEY?.trim()) {
      console.log(`Signing in to ${CLI_NAME[side]} with OPENAI_API_KEY (codex login --with-api-key)…`);
      await run(file, ['login', '--with-api-key'], { env, input: `${env.OPENAI_API_KEY.trim()}\n`, timeoutMs: 60_000 });
    } else {
      const args = side === 'claude'
        ? ['auth', 'login', ...(apiKey ? ['--console'] : [])]
        : ['login', ...(process.env.COUNCIL_DEVICE_AUTH ? ['--device-auth'] : [])];
      const how = side === 'codex' ? ': choose Sign in with ChatGPT' : apiKey ? ': sign in to the Anthropic Console (billed per token)' : '';
      console.log(`Signing in to ${CLI_NAME[side]} (${side} ${args.join(' ')})${how}…`);
      await runInteractive(file, args, { env });
    }
    const problem = await signInProblem(side, config);
    if (problem) { console.error(`${CLI_NAME[side]}: ${problem}`); failed += 1; } else console.log(`${CLI_NAME[side]} is signed in.`);
  }
  return failed ? 1 : 0;
}

async function main() {
  const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
  const [commandName, ...rest] = positionals;
  if (values.version) return console.log(packageVersion()), 0;
  if (values.help || !commandName) return console.log(HELP), values.help ? 0 : 1;

  if (commandName === 'mcp') {
    await import('../src/mcp-server.mjs');
    return null;
  }
  if (commandName === 'serve') return serveCommand(values);
  if (commandName === 'doctor') return doctor();
  if (commandName === 'login') return login();
  if (commandName === 'api-setup') {
    const { apiSetup } = await import('../src/api.mjs');
    console.log('Installing the Anthropic and OpenAI SDKs, for sides that run through their APIs ("via": "api")…');
    const { specs, dir } = await apiSetup();
    console.log(`Installed ${specs.join(', ')} in ${dir}.`);
    return 0;
  }
  if (commandName === 'skill') {
    const [action, target] = rest;
    if (action === 'add' && target) {
      const skills = await addSkill(target);
      for (const skill of skills) console.log(`Installed skill "${skill.name}" at ${skill.path}${skill.files > 1 ? ` (${skill.files} files)` : ''}`);
      console.log(`Use ${skills.length > 1 ? 'one' : 'it'} with: --skill <name> (terminal) or skill: "<name>" (any council tool), e.g. --skill ${skills[0].name}. `
        + 'Restart Claude Code / Codex to see it listed.');
      return 0;
    }
    if (action === 'list') {
      const line = s => `${s.name}\n  ${s.description.slice(0, 160)}${s.description.length > 160 ? '…' : ''}`;
      const skills = listSkills();
      console.log(skills.length ? skills.map(line).join('\n') : `No skills installed for the council (folder: ${skillsDir()}).`);
      const native = nativeSkills();
      if (native.length) console.log(`\nAlso usable by name (installed natively for Claude Code or Codex):\n${native.map(s => `${line(s)}\n  (${s.dir})`).join('\n')}`);
      return 0;
    }
    if (action === 'remove' && target) return console.log(`Removed skill "${removeSkill(target).name}".`), 0;
    // For a council member on another machine: which of these skills are installed for that CLI here, in the folder of
    // --session too, as a JSON list.
    if (action === 'installed' && ['claude', 'codex'].includes(target)) {
      const names = rest.slice(2).filter(name => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(name));
      const folder = values.session ? sessionFolder(target, await resolveSession(target, values.session)) : null;
      return console.log(JSON.stringify([...installedFor(target, names.map(name => ({ name })), folder ?? undefined)])), 0;
    }
    throw new Error('usage: skill add <GitHub URL | SKILL.md path | folder>, skill list, skill remove <name>');
  }
  if (commandName === 'config') {
    if (values.init) return initConfig();
    console.log(`# ${userConfigPath()}\n${JSON.stringify(loadConfig(), null, 2)}`);
    return 0;
  }
  const hostOptions = { only: values.only, claudeDesktop: values['claude-desktop'], dryRun: values['dry-run'] };
  if (commandName === 'install') return install({ ...hostOptions, source: values.source });
  if (commandName === 'update') return update(hostOptions);
  if (commandName === 'uninstall') return uninstall(hostOptions);

  const tool = TOOLS[commandName];
  if (!tool) throw new Error(`unknown command: ${commandName} (see --help)`);
  const question = rest.join(' ') || (await readStdin());
  const single = tool === 'ask_codex' || tool === 'ask_claude';
  const pairs = single
    ? { model: values.model, effort: values.effort, session_id: values.session }
    : { codex_model: values['codex-model'], codex_effort: values['codex-effort'], claude_model: values['claude-model'],
      claude_effort: values['claude-effort'], max_rounds: values['max-rounds'], synthesizer: values.synthesizer,
      codex_session_id: values['codex-session'], claude_session_id: values['claude-session'] };
  const wrong = single
    ? ['codex-model', 'codex-effort', 'claude-model', 'claude-effort', 'max-rounds', 'synthesizer', 'codex-session', 'claude-session'].filter(key => values[key] !== undefined)
    : ['model', 'effort', 'session'].filter(key => values[key] !== undefined);
  if (single && values.html !== undefined) wrong.push('html');
  if (wrong.length) throw new Error(`${commandName} does not take --${wrong.join(', --')} (see --help)`);
  if (values.workspace !== undefined && values['no-workspace']) throw new Error('use --workspace or --no-workspace, not both');
  if (values['no-web']) pairs.web_search = false;
  if (values.network) pairs.network = true;
  if (values.skill !== undefined) pairs.skill = values.skill;
  // With a session id, the session's own folder is the default (see council.mjs); otherwise the git repository here.
  const resuming = [values.session, values['codex-session'], values['claude-session']].some(value => value !== undefined);
  pairs.workspace = values['no-workspace'] ? undefined : values.workspace !== undefined ? resolve(values.workspace) : resuming ? undefined : gitRoot(process.cwd());
  const options = Object.fromEntries(Object.entries(pairs).filter(([, value]) => value !== undefined));
  const onProgress = message => process.stderr.write(`[council] ${message}\n`);
  // Ctrl+C stops the codex/claude processes too, not just this one.
  const controller = new AbortController();
  process.once('SIGINT', () => {
    controller.abort();
    process.stderr.write('[council] cancelled\n');
    setTimeout(() => process.exit(130), 500);
  });
  // --raw (a council member on another machine): the prompt is a council step, sent to the model as it is.
  if (values.raw) {
    if (!single || values.session === undefined) throw new Error('--raw is for the codex and claude commands with --session');
    const ask = commandName === 'codex' ? askCodex : askClaude;
    console.log(await ask(question, { model: values.model, effort: values.effort },
      { resume: values.session, signal: controller.signal, skill: Boolean(values['skill-step']), ...(values['no-web'] ? { web: false } : {}), ...(values.network ? { network: true } : {}) }));
    return 0;
  }
  if (values.html === undefined) {
    console.log(await invoke(tool, question, options, { onProgress, signal: controller.signal }));
    return 0;
  }
  // The page needs the whole discussion, which the debate tool returns.
  const json = await invoke('debate', question, options, { onProgress, signal: controller.signal });
  const result = JSON.parse(json);
  writeFileSync(resolve(values.html), debateHtml(result, question));
  onProgress(`saved the discussion to ${resolve(values.html)}`);
  console.log(tool === 'debate' ? json : councilText(result));
  return 0;
}

main().then(
  code => { if (code !== null && code !== undefined) process.exitCode = code; },
  error => { console.error(`${NAME}: ${error.message}`); process.exitCode = 1; },
);
