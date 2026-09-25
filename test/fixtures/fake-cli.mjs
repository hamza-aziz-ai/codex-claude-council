// Stand-in for the real `codex` and `claude` CLIs. Records every call to $FAKE_LOG (JSON lines).
// Controls: FAKE_FAIL=codex|claude, FAKE_SLEEP_MS (or FAKE_SLEEP_MS_CODEX / _CLAUDE for one side), FAKE_CODEX_AUTH (login status text), FAKE_CLAUDE_AUTH (JSON).
// Reviews (prompts asking for a VERDICT line): FAKE_AGREE_AT=n agrees on the n-th review (default 1, 0 = never);
// FAKE_FAIL_REVIEW_AT=n fails the n-th review. Reviews are counted in the file $FAKE_STATE.
// Sessions: codex --json reports a new thread (or the resumed one); claude echoes --session-id / --resume.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [cli, ...args] = process.argv.slice(2);
const input = readFileSync(0, 'utf8');
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ cli, args, input, cwd: process.cwd(), pid: process.pid, env: { CODEX_CLAUDE_COUNCIL_MEMBER: process.env.CODEX_CLAUDE_COUNCIL_MEMBER } })}\n`);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const lastLine = input.split(/\r?\n/).filter(line => line.trim()).pop() || '';
let failing = process.env.FAKE_FAIL === cli;

// For a review prompt, the fake's answer ends with a verdict line.
let reply = lastLine;
if (input.includes('VERDICT: AGREE or VERDICT: DISAGREE')) {
  const state = process.env.FAKE_STATE;
  const count = (state && existsSync(state) ? Number(readFileSync(state, 'utf8')) : 0) + 1;
  if (state) writeFileSync(state, String(count));
  const agreeAt = Number(process.env.FAKE_AGREE_AT ?? 1);
  if (Number(process.env.FAKE_FAIL_REVIEW_AT) === count) failing = true;
  reply = agreeAt > 0 && count >= agreeAt ? `review ${count}: looks right\nVERDICT: AGREE` : `review ${count}: objection ${count}\nVERDICT: DISAGREE`;
}

function codex() {
  if (args[0] === '--version') return console.log('codex-cli 0.0.0-fake');
  if (args[0] === 'login') return console.error(process.env.FAKE_CODEX_AUTH || 'Logged in using ChatGPT');
  const effort = args.find(arg => arg.startsWith('model_reasoning_effort='))?.replace('model_reasoning_effort=', '') || '-';
  console.error(`model: ${flag('-m') || '-'}\nreasoning effort: ${effort}`);
  if (failing) {
    console.error("ERROR: You've hit your usage limit.");
    process.exit(1);
  }
  const thread = args[1] === 'resume' ? args.at(-2) : randomUUID();
  if (args.includes('--json')) console.log(JSON.stringify({ type: 'thread.started', thread_id: thread }));
  writeFileSync(flag('--output-last-message'), `codex[${flag('-m') || '-'}|${effort}] ${reply}`);
}

function claude() {
  if (args[0] === '--version') return console.log('0.0.0 (Claude Code fake)');
  if (args[0] === 'auth') return console.log(process.env.FAKE_CLAUDE_AUTH || '{"loggedIn":true,"authMethod":"claude.ai"}');
  // Like `--output-format stream-json --verbose`: an init event, the main agent's message, then the result.
  const session = flag('--resume') || flag('--session-id');
  const text = failing ? 'fake claude failure' : `claude[${flag('--model') || '-'}|${flag('--effort') || '-'}] ${reply}`;
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: session }));
  console.log(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: failing ? 'error' : 'success', is_error: failing, session_id: session, result: text }));
  if (failing) process.exit(1);
}

const main = cli === 'codex' ? codex : claude;
const isQuestion = !['--version', 'login', 'auth'].includes(args[0]);
setTimeout(main, isQuestion ? Number(process.env[`FAKE_SLEEP_MS_${cli.toUpperCase()}`] ?? process.env.FAKE_SLEEP_MS ?? 0) : 0);
