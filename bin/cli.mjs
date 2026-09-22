#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { NAME, loadConfig, packageVersion, userConfigPath } from '../src/config.mjs';
import { invoke } from '../src/council.mjs';
import { doctor, initConfig, install, uninstall } from '../src/install.mjs';

const HELP = `${NAME} ${packageVersion()}
Ask Codex (ChatGPT) and Claude through your own signed-in CLIs.

Usage:
  ${NAME} install [options]        Check prerequisites, then add the plugin to Claude Code and Codex
  ${NAME} uninstall [options]      Remove it again (your config file is kept)
  ${NAME} doctor                   Check Node.js, both CLIs, sign-ins and config
  ${NAME} config [--init]          Show the effective config, or create an editable config file
  ${NAME} ask "question"           Both answer, cross-critique, one final answer
  ${NAME} debate "question"        Same, printing answers, critiques and settings as JSON
  ${NAME} codex "question"         Codex (ChatGPT) only
  ${NAME} claude "question"        Claude only
  ${NAME} mcp                      Run the MCP server on stdio

Model and effort (omit to use your config):
  codex, claude:   --model <name>  --effort <level>
  ask, debate:     --codex-model <name>  --codex-effort <level>  --claude-model <name>  --claude-effort <level>
                   --max-rounds <n>   draft/review until both agree: n = at most n rounds, 0 = no limit
  Codex effort: none, minimal, low, medium, high, xhigh.  Claude effort: low, medium, high, xhigh, max.

Install options:
  --only <claude|codex>   Add the plugin to one host only (both CLIs are still required)
  --claude-desktop        Also register the MCP server with Claude Desktop chat
  --source <repo|path>    Marketplace source (default: hamza-aziz-ai/${NAME})
  --dry-run               Show what would run without changing anything

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
  only: { type: 'string' },
  source: { type: 'string' },
  'claude-desktop': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  init: { type: 'boolean' },
};
const TOOLS = { ask: 'council_ask', debate: 'debate', codex: 'ask_codex', claude: 'ask_claude' };

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let text = '';
  for await (const chunk of process.stdin.setEncoding('utf8')) text += chunk;
  return text;
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
  if (commandName === 'doctor') return doctor();
  if (commandName === 'config') {
    if (values.init) return initConfig();
    console.log(`# ${userConfigPath()}\n${JSON.stringify(loadConfig(), null, 2)}`);
    return 0;
  }
  const hostOptions = { only: values.only, claudeDesktop: values['claude-desktop'], dryRun: values['dry-run'] };
  if (commandName === 'install') return install({ ...hostOptions, source: values.source });
  if (commandName === 'uninstall') return uninstall(hostOptions);

  const tool = TOOLS[commandName];
  if (!tool) throw new Error(`unknown command: ${commandName} (see --help)`);
  const question = rest.join(' ') || (await readStdin());
  const single = tool === 'ask_codex' || tool === 'ask_claude';
  const pairs = single
    ? { model: values.model, effort: values.effort }
    : { codex_model: values['codex-model'], codex_effort: values['codex-effort'], claude_model: values['claude-model'],
      claude_effort: values['claude-effort'], max_rounds: values['max-rounds'] };
  const wrong = single
    ? ['codex-model', 'codex-effort', 'claude-model', 'claude-effort', 'max-rounds'].filter(key => values[key] !== undefined)
    : ['model', 'effort'].filter(key => values[key] !== undefined);
  if (wrong.length) throw new Error(`${commandName} does not take --${wrong.join(', --')} (see --help)`);
  const options = Object.fromEntries(Object.entries(pairs).filter(([, value]) => value !== undefined));
  const onProgress = message => process.stderr.write(`[council] ${message}\n`);
  // Ctrl+C stops the codex/claude processes too, not just this one.
  const controller = new AbortController();
  process.once('SIGINT', () => {
    controller.abort();
    process.stderr.write('[council] cancelled\n');
    setTimeout(() => process.exit(130), 500);
  });
  console.log(await invoke(tool, question, options, { onProgress, signal: controller.signal }));
  return 0;
}

main().then(
  code => { if (code !== null && code !== undefined) process.exitCode = code; },
  error => { console.error(`${NAME}: ${error.message}`); process.exitCode = 1; },
);
