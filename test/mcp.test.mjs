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

test('tools/list exposes the four council tools, with per-tool model/effort inputs, and the job tools', async () => {
  const { result } = await request('tools/list', {});
  const tools = Object.fromEntries(result.tools.map(tool => [tool.name, tool.inputSchema]));
  const councilFields = ['question', 'codex_model', 'codex_effort', 'claude_model', 'claude_effort', 'synthesizer', 'max_rounds', 'workspace', 'web_search'];
  assert.deepEqual(Object.keys(tools).sort(), ['ask_claude', 'ask_codex', 'council_ask', 'council_cancel', 'council_result', 'debate']);
  assert.deepEqual(Object.keys(tools.council_result.properties), ['job_id']);
  assert.deepEqual(Object.keys(tools.council_cancel.properties), ['job_id']);
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

// Hosts such as Claude Desktop end any tool call after about 60 s; a council takes minutes.
test('a council that outlasts the wait window returns a job id, and council_result gets the answer', async () => {
  fake.writeConfig({ tool_wait_seconds: 1 });
  try {
    const started = Date.now();
    const first = (await call('council_ask', { question: 'slow council' })).result;
    assert.ok(Date.now() - started < 2500, 'the first call returns within the wait window');
    assert.ok(!first.isError, first.content[0].text);
    const text = first.content[0].text;
    assert.match(text, /The council is still working \(\d+ s so far; now: .+\)/);
    const jobId = text.match(/job_id: (\S+)/)[1];
    assert.match(text, new RegExp(`call council_result with \\{"job_id": "${jobId}"\\}`));
    let answer;
    for (let polls = 0; polls < 30 && !answer; polls += 1) {
      const polled = (await call('council_result', polls % 2 ? { job_id: jobId } : {})).result;
      assert.ok(!polled.isError, polled.content[0].text);
      if (!/still working/.test(polled.content[0].text)) answer = polled.content[0].text;
    }
    assert.match(answer, /both agree with this answer/);
    const gone = (await call('council_result', { job_id: jobId })).result;
    assert.equal(gone.isError, true, 'a job is forgotten once its answer is returned');
    assert.match(gone.content[0].text, /already returned its answer/);
  } finally {
    fake.writeConfig();
  }
});

test('council_cancel stops a running job', async () => {
  fake.writeConfig({ tool_wait_seconds: 1 });
  try {
    const text = (await call('debate', { question: 'to cancel' })).result.content[0].text;
    const jobId = text.match(/job_id: (\S+)/)[1];
    assert.match((await call('council_cancel', { job_id: jobId })).result.content[0].text, new RegExp(`Stopped ${jobId}`));
    assert.equal((await call('council_result', { job_id: jobId })).result.isError, true);
  } finally {
    fake.writeConfig();
  }
});

test('with tool_wait_seconds 0, a call waits until the answer is ready', async () => {
  fake.writeConfig({ tool_wait_seconds: 0 });
  try {
    const { result } = await call('ask_codex', { question: 'wait for me' });
    assert.equal(result.content[0].text, 'codex[-|high] wait for me');
  } finally {
    fake.writeConfig();
  }
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
