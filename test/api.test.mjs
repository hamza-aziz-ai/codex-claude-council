import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { resetSessions } from '../src/adapters.mjs';
import { runTool } from '../src/api.mjs';
import { invoke } from '../src/council.mjs';
import { setup, withEnv } from './helpers.mjs';

// A stand-in for both providers' APIs: Anthropic's Messages API (POST /v1/messages) and OpenAI's Responses API
// (POST /v1/responses). On a first turn with tools it asks for list_files of the project, then answers with what the
// tool returned; otherwise it answers like the fake CLIs: a verdict for a review prompt, else the prompt's last line.
const requests = [];
let server;
let base;
const lastLine = text => String(text).split(/\r?\n/).filter(line => line.trim()).pop() || '';
const reply = text => (text.includes('VERDICT: AGREE or VERDICT: DISAGREE') ? 'review: looks right\nVERDICT: AGREE' : lastLine(text));

function anthropic(body) {
  const last = body.messages.at(-1);
  const wantsFiles = body.tools?.some(tool => tool.name === 'list_files');
  if (typeof last.content === 'string' && wantsFiles && last.content.includes('LIST THE PROJECT')) {
    return { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use', stop_details: null,
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'list_files', input: { path: '.' } }], usage: { input_tokens: 1, output_tokens: 1 } };
  }
  const text = Array.isArray(last.content) ? `files: ${last.content[0].content}` : reply(last.content);
  return { id: 'msg_2', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_details: null,
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: `claude-api: ${text}` }], usage: { input_tokens: 1, output_tokens: 1 } };
}

function openai(body) {
  const last = body.input.at(-1);
  const message = (id, text) => ({ id: `resp_${id}`, object: 'response', status: 'completed', model: body.model, output_text: text,
    output: [{ type: 'message', id: `msg_${id}`, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }] });
  if (last.type === 'function_call_output') return message('2', `codex-api: read ${last.output.split('\n').length} lines`);
  if (last.role === 'user' && last.content.includes('READ THE README') && body.tools?.some(tool => tool.name === 'read_file')) {
    return { id: 'resp_1', object: 'response', status: 'completed', model: body.model, output_text: '',
      output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }), status: 'completed' }] };
  }
  return message('3', `codex-api: ${reply(last.content)}`);
}

let fake;
let project;
before(async () => {
  fake = setup({ codex: { effort: 'high' }, claude: { effort: 'high' } });
  project = mkdtempSync(join(tmpdir(), 'council api project '));
  mkdirSync(join(project, 'src'));
  writeFileSync(join(project, 'README.md'), 'line one\nline two\nline three\n');
  writeFileSync(join(project, 'src', 'app.js'), 'const answer = 42;\nexport default answer;\n');
  server = createServer((req, res) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      const body = JSON.parse(data);
      requests.push({ path: req.url, headers: req.headers, body: structuredClone(body) });
      const result = req.url.startsWith('/v1/messages') ? anthropic(body) : openai(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fake.cleanup(); rmSync(project, { recursive: true, force: true }); });

const apiEnv = () => ({ ANTHROPIC_API_KEY: randomUUID(), ANTHROPIC_BASE_URL: base, OPENAI_API_KEY: randomUUID(), OPENAI_BASE_URL: `${base}/v1` });

test('the workspace tools read the project, and only the project', () => {
  assert.equal(runTool(project, 'list_files', { path: '.' }), '.:\nREADME.md\nsrc/');
  assert.equal(runTool(project, 'read_file', { path: 'README.md', offset: 2, limit: 1 }), '2\tline two\n… 2 more lines (read on with offset 3)');
  assert.equal(runTool(project, 'search', { pattern: 'ANSWER', ignore_case: true }), 'src/app.js:1: const answer = 42;\nsrc/app.js:2: export default answer;');
  assert.throws(() => runTool(project, 'read_file', { path: '../outside.txt' }), /no such file|outside the project/);
  assert.throws(() => runTool(project, 'list_files', { path: tmpdir() }), /outside the project/);
  assert.throws(() => runTool(project, 'search', { pattern: '(' }), /invalid pattern/);
});

test('"via": "api": a council with both sides through the APIs, with no CLI installed', async () => {
  // Commands that don't exist: neither CLI is run, or even looked for.
  fake.writeConfig({ codex: { via: 'api', command: join(project, 'no-codex') }, claude: { via: 'api', command: join(project, 'no-claude') } });
  resetSessions();
  requests.length = 0;
  try {
    const answer = await withEnv(apiEnv(), () => invoke('council_ask', 'Which is better?', { max_rounds: 1, web_search: false }));
    assert.match(answer, /^claude-api: /, 'Claude writes the final answer by default');
    assert.match(answer, /both agree with this answer/);
    const claude = requests.filter(r => r.path.startsWith('/v1/messages'));
    const codex = requests.filter(r => r.path === '/v1/responses');
    assert.ok(claude.length >= 2 && codex.length >= 2, `both APIs answered and replied (${claude.length}, ${codex.length})`);
    assert.equal(claude[0].body.model, 'claude-opus-5-5');
    assert.deepEqual(claude[0].body.thinking, { type: 'adaptive' });
    assert.deepEqual(claude[0].body.output_config, { effort: 'high' });
    assert.equal(claude[0].body.fallbacks, 'default');
    assert.match(claude[0].headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(claude[0].body.tools, undefined, 'no project and no web: no tools');
    assert.equal(codex[0].body.model, 'gpt-6-astra');
    assert.deepEqual([codex[0].body.store, codex[0].body.reasoning], [false, { effort: 'high' }]);
    // Each side's conversation goes on: its later turn carries its earlier ones.
    assert.ok(claude.at(-1).body.messages.length > claude[0].body.messages.length);
    assert.ok(codex.at(-1).body.input.length > codex[0].body.input.length);
    assert.equal(fake.calls().filter(c => !['--version'].includes(c.args[0])).length, 0, 'no CLI call at all');
  } finally {
    fake.writeConfig({});
  }
});

test('an API member reads the project through its tools, with web search when allowed, and keeps its key to itself', async () => {
  fake.writeConfig({ codex: { via: 'api' }, claude: { via: 'api', model: 'sonnet', effort: 'low' } });
  resetSessions();
  requests.length = 0;
  try {
    const env = apiEnv();
    const claude = await withEnv(env, () => invoke('ask_claude', 'LIST THE PROJECT', { workspace: project, web_search: true }));
    assert.equal(claude, 'claude-api: files: .:\nREADME.md\nsrc/');
    const [first, second] = requests;
    assert.equal(first.body.model, 'claude-sonnet-5-5');
    assert.deepEqual(first.body.tools.map(tool => tool.name), ['list_files', 'read_file', 'search', 'web_search', 'web_fetch']);
    assert.deepEqual(second.body.messages.at(-1).content, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '.:\nREADME.md\nsrc/' }]);
    assert.match(first.body.messages[0].content, /with your read-only tools: list_files, read_file and search/);
    assert.equal(first.headers.authorization, `Bearer ${env.ANTHROPIC_API_KEY}`, 'each provider gets its own key');
    requests.length = 0;
    const codex = await withEnv(env, () => invoke('ask_codex', 'READ THE README', { workspace: project, web_search: false }));
    assert.equal(codex, 'codex-api: read 4 lines');
    assert.deepEqual(requests[0].body.tools.map(tool => tool.name ?? tool.type), ['list_files', 'read_file', 'search']);
    assert.equal(requests[0].headers.authorization, `Bearer ${env.OPENAI_API_KEY}`);
    assert.ok(!JSON.stringify(requests[0].headers).includes(env.ANTHROPIC_API_KEY), 'the Anthropic key never goes to OpenAI');
  } finally {
    fake.writeConfig({});
  }
});

test('an API side without its key stops before anything is sent, and can\'t continue a CLI session', async () => {
  fake.writeConfig({ claude: { via: 'api' } });
  resetSessions();
  requests.length = 0;
  try {
    await withEnv({ ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', COUNCIL_ANTHROPIC_API_KEY: '' }, () => assert.rejects(invoke('council_ask', 'q'),
      /Claude Code: Claude runs through the Anthropic API \("via": "api"\), but it has no key: set ANTHROPIC_API_KEY, or enter the key in the Claude Desktop extension's settings/));
    assert.equal(requests.length, 0);
    await withEnv(apiEnv(), () => assert.rejects(invoke('ask_claude', 'q', { session_id: randomUUID() }), /can't continue a Claude Code session/));
    await withEnv({ COUNCIL_CODEX_VIA: 'web' }, () => assert.rejects(invoke('ask_codex', 'q'), /codex\.via must be "cli" or "api"/));
  } finally {
    fake.writeConfig({});
  }
});

test('the Claude Desktop extension\'s settings: a key switches its side to the API, an empty field changes nothing', async () => {
  const { loadConfig } = await import('../src/config.mjs');
  const { cleanEnv } = await import('../src/process.mjs');
  const key = randomUUID();
  // An optional field left empty can arrive as its placeholder (built here, so no key-like literal is in the file).
  const unfilled = ['${user_config', 'anthropic_api_key}'].join('.');
  fake.writeConfig({});
  await withEnv({ COUNCIL_OPENAI_API_KEY: key, COUNCIL_CODEX_MODEL: 'gpt-6.1-sol', COUNCIL_ANTHROPIC_API_KEY: unfilled, COUNCIL_CLAUDE_MODEL: '' }, async () => {
    const config = loadConfig();
    assert.deepEqual([config.codex.via, config.codex.model, config.claude.via, config.claude.model], ['api', 'gpt-6.1-sol', 'cli', null]);
    assert.equal(cleanEnv(config, 'codex').COUNCIL_OPENAI_API_KEY, undefined, 'the CLIs never get the extension\'s keys');
    // The key reaches OpenAI, from the settings alone.
    resetSessions();
    requests.length = 0;
    const answer = await withEnv({ OPENAI_API_KEY: '', OPENAI_BASE_URL: `${base}/v1` }, () => invoke('ask_codex', 'ping', { web_search: false }));
    assert.equal(answer, 'codex-api: ping');
    assert.equal(requests[0].headers.authorization, `Bearer ${key}`);
    assert.equal(requests[0].body.model, 'gpt-6.1-sol');
  });
  // The config file still decides when it says so.
  fake.writeConfig({ codex: { via: 'cli' } });
  try {
    await withEnv({ COUNCIL_OPENAI_API_KEY: key }, async () => assert.equal(loadConfig().codex.via, 'cli'));
  } finally {
    fake.writeConfig({});
  }
});

test('council_join with only an OpenAI key: the host is the Claude member, ChatGPT runs through the API', async () => {
  fake.writeConfig({ claude: { command: join(project, 'no-claude') }, codex: { command: join(project, 'no-codex') } });
  resetSessions();
  requests.length = 0;
  const turns = [];
  // The host (Claude Desktop) answers, agrees, and writes the final answer.
  const hostTurn = async prompt => {
    turns.push(prompt);
    if (/now agree/.test(prompt)) return 'THE JOINT ANSWER\n---NOTES---\nnone';
    return turns.length === 1 ? 'HOST ANSWER' : 'HOST VIEW\nVERDICT: AGREE';
  };
  try {
    const answer = await withEnv({ COUNCIL_OPENAI_API_KEY: randomUUID(), OPENAI_API_KEY: '', OPENAI_BASE_URL: `${base}/v1`, ANTHROPIC_API_KEY: '' },
      () => invoke('council_join', 'Which is better?', { me: 'claude', web_search: false }, { hostTurn }));
    assert.match(answer, /^THE JOINT ANSWER/);
    assert.ok(requests.length >= 2 && requests.every(r => r.path === '/v1/responses'), 'only OpenAI was called');
  } finally {
    fake.writeConfig({});
  }
});

test('neither the CLI nor an API key: the council stops before sending anything, and says both ways to fix it', async () => {
  fake.writeConfig({ codex: { command: join(project, 'no-codex') }, claude: { command: join(project, 'no-claude') } });
  resetSessions();
  requests.length = 0;
  const none = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', COUNCIL_OPENAI_API_KEY: '', COUNCIL_ANTHROPIC_API_KEY: '' };
  try {
    await withEnv(none, () => assert.rejects(invoke('council_ask', 'q'), error => {
      assert.match(error.message, /^The council needs both Codex and Claude Code signed in\. Nothing was sent to either model\./);
      assert.match(error.message, /- Codex \(ChatGPT\): codex CLI not found at .*\. Or, without the CLI, run this side through the OpenAI API: enter your OpenAI API key in the Claude Desktop extension's settings, or set OPENAI_API_KEY and "codex": \{ "via": "api" \}/);
      assert.match(error.message, /- Claude Code: claude CLI not found at .*through the Anthropic API.*ANTHROPIC_API_KEY and "claude": \{ "via": "api" \}/);
      return true;
    }));
    await withEnv(none, () => assert.rejects(invoke('ask_codex', 'q'), /codex CLI not found at .*through the OpenAI API/));
    assert.equal(requests.length, 0, 'no API was called');
    assert.equal(fake.questionCalls().length, 0, 'no CLI got the question');
  } finally {
    fake.writeConfig({});
  }
});
