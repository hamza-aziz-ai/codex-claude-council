import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ROOT, setup } from './helpers.mjs';

let fake;
let server;
let nextId = 1;
const waiting = new Map();
const unexpected = [];

function start(extraEnv = {}) {
  const child = spawn(process.execPath, [join(ROOT, 'src', 'mcp-server.mjs')], {
    env: { ...process.env, ...fake.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    const resolve = waiting.get(message.id);
    if (resolve) { waiting.delete(message.id); resolve(message); } else unexpected.push(message);
  });
  return child;
}

function request(method, params, id = nextId++) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise(resolve => waiting.set(id, resolve));
}
const notify = (method, params) => server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
const call = (name, args) => request('tools/call', { name, arguments: args });

before(() => {
  fake = setup({ codex: { effort: 'high' }, claude: { effort: 'high' } });
  server = start({ FAKE_SLEEP_MS: '300' });
});
after(() => { server.kill(); fake.cleanup(); });

test('initialize reports the server and tool capability', async () => {
  const { result } = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.equal(result.serverInfo.name, 'codex-claude-council');
  assert.ok(result.capabilities.tools);
  notify('notifications/initialized');
});

test('tools/list exposes four tools with per-tool model/effort inputs', async () => {
  const { result } = await request('tools/list', {});
  const tools = Object.fromEntries(result.tools.map(tool => [tool.name, tool.inputSchema]));
  const councilFields = ['question', 'codex_model', 'codex_effort', 'claude_model', 'claude_effort', 'synthesizer', 'max_rounds', 'workspace', 'web_search'];
  assert.deepEqual(Object.keys(tools).sort(), ['ask_claude', 'ask_codex', 'council_ask', 'debate']);
  assert.deepEqual(Object.keys(tools.council_ask.properties), councilFields);
  assert.deepEqual(Object.keys(tools.debate.properties), councilFields);
  assert.deepEqual(Object.keys(tools.ask_codex.properties), ['question', 'model', 'effort', 'workspace', 'web_search']);
  assert.deepEqual(tools.ask_codex.properties.effort.enum, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(tools.ask_claude.properties.effort.enum, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(tools.debate.properties.synthesizer.enum, ['claude', 'codex']);
  assert.deepEqual({ type: tools.council_ask.properties.max_rounds.type, minimum: tools.council_ask.properties.max_rounds.minimum }, { type: 'integer', minimum: 0 });
  for (const schema of Object.values(tools)) assert.equal(schema.additionalProperties, false);
});

test('council_ask with max_rounds sends progress notifications when asked', async () => {
  const progress = [];
  const listener = message => { if (message.method === 'notifications/progress') progress.push(message.params); };
  const before = unexpected.length;
  const response = await request('tools/call', { name: 'council_ask', arguments: { question: 'q', max_rounds: 2 }, _meta: { progressToken: 'p1' } });
  unexpected.slice(before).forEach(listener);
  assert.ok(!response.result.isError, response.result.content[0].text);
  assert.match(response.result.content[0].text, /both agree with this answer \(1 round\)/);
  assert.ok(progress.length >= 4 && progress.every(p => p.progressToken === 'p1'));
  assert.deepEqual(progress.map(p => p.progress), progress.map((_, i) => i + 1));
  assert.ok(progress.some(p => /Round 1 of 2: Codex \(ChatGPT\) agrees/.test(p.message)), JSON.stringify(progress));
});

test('tools/call answers, and runs concurrent calls in parallel', async () => {
  const started = Date.now();
  const [a, b] = await Promise.all([
    call('ask_claude', { question: 'one', model: 'sonnet', effort: 'low' }),
    call('ask_codex', { question: 'two', effort: 'medium' }),
  ]);
  assert.equal(a.result.content[0].text, 'claude[sonnet|low] one');
  assert.equal(b.result.content[0].text, 'codex[-|medium] two');
  assert.ok(!a.result.isError && !b.result.isError);
  assert.ok(Date.now() - started < 2500, 'calls should overlap');
});

test('tool errors come back as isError results', async () => {
  const { result } = await call('council_ask', { question: 'q', claude_effort: 'none' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /claude effort must be one of/);
});

test('protocol errors and ping', async () => {
  assert.deepEqual((await request('ping')).result, {});
  assert.equal((await request('resources/list')).error.code, -32601);
  server.stdin.write('{not json\n');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(unexpected.pop()?.error?.code, -32700);
});

test('a cancelled call stops and sends no response', async () => {
  const id = nextId++;
  const pending = request('tools/call', { name: 'ask_codex', arguments: { question: 'slow' } }, id);
  await new Promise(resolve => setTimeout(resolve, 100));
  notify('notifications/cancelled', { requestId: id, reason: 'test' });
  const outcome = await Promise.race([pending.then(() => 'answered'), new Promise(resolve => setTimeout(() => resolve('silent'), 1500))]);
  assert.equal(outcome, 'silent');
  waiting.delete(id);
});
