// Stand-in for the real `codex` and `claude` CLIs. Records every call to $FAKE_LOG (JSON lines).
// Controls: FAKE_FAIL=codex|claude, FAKE_SLEEP_MS, FAKE_CODEX_AUTH (login status text), FAKE_CLAUDE_AUTH (JSON).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const [cli, ...args] = process.argv.slice(2);
const input = readFileSync(0, 'utf8');
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ cli, args, input, cwd: process.cwd() })}\n`);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const lastLine = input.split(/\r?\n/).filter(line => line.trim()).pop() || '';
const failing = process.env.FAKE_FAIL === cli;

function codex() {
  if (args[0] === '--version') return console.log('codex-cli 0.0.0-fake');
  if (args[0] === 'login') return console.error(process.env.FAKE_CODEX_AUTH || 'Logged in using ChatGPT');
  const effort = (flag('-c') || '').replace('model_reasoning_effort=', '') || '-';
  console.error(`model: ${flag('-m') || '-'}\nreasoning effort: ${effort}`);
  if (failing) {
    console.error("ERROR: You've hit your usage limit.");
    process.exit(1);
  }
  writeFileSync(flag('--output-last-message'), `codex[${flag('-m') || '-'}|${effort}] ${lastLine}`);
}

function claude() {
  if (args[0] === '--version') return console.log('0.0.0 (Claude Code fake)');
  if (args[0] === 'auth') return console.log(process.env.FAKE_CLAUDE_AUTH || '{"loggedIn":true,"authMethod":"claude.ai"}');
  if (failing) {
    console.log(JSON.stringify({ is_error: true, result: 'fake claude failure' }));
    process.exit(1);
  }
  console.log(JSON.stringify({ is_error: false, result: `claude[${flag('--model') || '-'}|${flag('--effort') || '-'}] ${lastLine}` }));
}

const main = cli === 'codex' ? codex : claude;
const isQuestion = !['--version', 'login', 'auth'].includes(args[0]);
setTimeout(main, isQuestion ? Number(process.env.FAKE_SLEEP_MS || 0) : 0);
