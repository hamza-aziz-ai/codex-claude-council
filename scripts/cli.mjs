#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NAME, loadConfig, packageVersion, userConfigPath } from '../src/config.mjs';
import { invoke } from '../src/council.mjs';
import { doctor, initConfig, install, uninstall, update } from '../src/install.mjs';
import { addSkill, listSkills, removeSkill, skillsDir } from '../src/skills.mjs';

const HELP = `${NAME} ${packageVersion()}
Ask Codex (ChatGPT) and Claude through your own signed-in CLIs.

Usage:
  ${NAME} install [options]        Check prerequisites, then add the plugin to Claude Code and Codex
  ${NAME} update [options]         Update the plugin in Claude Code and Codex to the latest version
  ${NAME} uninstall [options]      Remove it again (your config file is kept)
  ${NAME} doctor                   Check Node.js, both CLIs, sign-ins and config
  ${NAME} skill add <url|path>     Install a skill (a SKILL.md) from a GitHub repository or a local file/folder
  ${NAME} skill list               List installed skills
  ${NAME} skill remove <name>      Remove an installed skill
  ${NAME} config [--init]          Show the effective config, or create an editable config file
  ${NAME} ask "question"           Both answer, critique each other, reply, then agree on one final answer
  ${NAME} debate "question"        Same, printing answers, critiques, replies, rounds and settings as JSON
  ${NAME} codex "question"         Codex (ChatGPT) only
  ${NAME} claude "question"        Claude only
  ${NAME} mcp                      Run the MCP server on stdio

Model and effort (omit to use your config):
  codex, claude:   --model <name>  --effort <level>
  ask, debate:     --codex-model <name>  --codex-effort <level>  --claude-model <name>  --claude-effort <level>
                   --synthesizer <claude|codex>   who writes the final answer (default: claude; chatgpt = codex)
                   --max-rounds <n>   draft/review until both agree: n = at most n rounds, 0 = no limit
                                      (default: 3; "max_rounds": null in the config for a single pass)
  all four:        --workspace <dir>  project folder both models can read (never change);
                                      default: the git repository you are in, if any
                   --no-workspace     no file access at all
                   --no-web           no web search or web pages (default: on, "web_search" in the config)
                   --skill <name>     both models may use this installed skill where a step needs it
  Codex effort: none, minimal, low, medium, high, xhigh.  Claude effort: low, medium, high, xhigh, max.

Install / update / uninstall options:
  --only <claude|codex>   One host only (both CLIs are still required)
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
  workspace: { type: 'string' },
  'no-workspace': { type: 'boolean' },
  'no-web': { type: 'boolean' },
  skill: { type: 'string' },
  synthesizer: { type: 'string' },
  only: { type: 'string' },
  source: { type: 'string' },
  'claude-desktop': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  init: { type: 'boolean' },
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
  if (commandName === 'skill') {
    const [action, target] = rest;
    if (action === 'add' && target) {
      const skill = await addSkill(target);
      console.log(`Installed skill "${skill.name}" at ${skill.path}\nUse it with: --skill ${skill.name} (terminal) or skill: "${skill.name}" (any council tool). Restart Claude Code / Codex to see it listed.`);
      return 0;
    }
    if (action === 'list') {
      const skills = listSkills();
      console.log(skills.length ? skills.map(s => `${s.name}\n  ${s.description.slice(0, 160)}${s.description.length > 160 ? '…' : ''}`).join('\n') : `No skills installed (folder: ${skillsDir()}).`);
      return 0;
    }
    if (action === 'remove' && target) return console.log(`Removed skill "${removeSkill(target).name}".`), 0;
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
    ? { model: values.model, effort: values.effort }
    : { codex_model: values['codex-model'], codex_effort: values['codex-effort'], claude_model: values['claude-model'],
      claude_effort: values['claude-effort'], max_rounds: values['max-rounds'], synthesizer: values.synthesizer };
  const wrong = single
    ? ['codex-model', 'codex-effort', 'claude-model', 'claude-effort', 'max-rounds', 'synthesizer'].filter(key => values[key] !== undefined)
    : ['model', 'effort'].filter(key => values[key] !== undefined);
  if (wrong.length) throw new Error(`${commandName} does not take --${wrong.join(', --')} (see --help)`);
  if (values.workspace !== undefined && values['no-workspace']) throw new Error('use --workspace or --no-workspace, not both');
  if (values['no-web']) pairs.web_search = false;
  if (values.skill !== undefined) pairs.skill = values.skill;
  pairs.workspace = values['no-workspace'] ? undefined : values.workspace !== undefined ? resolve(values.workspace) : gitRoot(process.cwd());
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
