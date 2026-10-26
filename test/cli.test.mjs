import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { ROOT, setup } from './helpers.mjs';

let fake;
before(() => { fake = setup({ codex: { effort: 'high' }, claude: { effort: 'high' } }); });
after(() => fake.cleanup());

const cli = (args, input = '') => spawnSync(process.execPath, [join(ROOT, 'scripts', 'cli.mjs'), ...args], {
  input, encoding: 'utf8', env: { ...process.env, ...fake.env },
});

test('single-model and council commands with overrides', () => {
  assert.equal(cli(['codex', 'hello', 'there', '--effort', 'low']).stdout.trim(), 'codex[-|low] hello there');
  assert.equal(cli(['claude', '--model', 'opus'], 'from stdin\n').stdout.trim(), 'claude[opus|high] from stdin');
  const ask = cli(['ask', 'Which?', '--codex-model', 'gpt-x', '--claude-effort', 'max']);
  assert.equal(ask.status, 0, ask.stderr);
  assert.match(ask.stdout, /^claude\[-\|max\]/, 'Claude writes the final answer by default');
  assert.match(cli(['ask', 'Which?', '--codex-model', 'gpt-x', '--synthesizer', 'chatgpt']).stdout, /^codex\[gpt-x\|high\]/);
});

test('ask stops with a sign-in error when a CLI is signed out', () => {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'cli.mjs'), 'ask', 'Which?'], {
    encoding: 'utf8', env: { ...process.env, ...fake.env, FAKE_CLAUDE_AUTH: '{"loggedIn":false}' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs both Codex and Claude Code signed in[\s\S]*- Claude Code: .*claude auth login/);
  assert.equal(result.stdout, '');
});

test('the terminal lets both models read the git repository you are in, unless told otherwise', () => {
  const cwdOfLastCall = args => { fake.clearCalls(); assert.equal(cli(args).status, 0); return fake.questionCalls().at(-1).cwd; };
  assert.equal(cwdOfLastCall(['codex', 'q']), realpathSync(ROOT), 'this test runs inside the repository');
  assert.equal(cwdOfLastCall(['claude', 'q', '--workspace', fake.dir]), realpathSync(fake.dir));
  assert.match(cwdOfLastCall(['codex', 'q', '--no-workspace']), /council-codex-/);
  assert.match(cli(['codex', 'q', '--workspace', fake.dir, '--no-workspace']).stderr, /not both/);
  fake.clearCalls();
  assert.equal(cli(['claude', 'q', '--no-web', '--no-workspace']).status, 0);
  const call = fake.questionCalls().at(-1);
  assert.deepEqual(call.args.slice(call.args.indexOf('--disallowedTools') + 1).filter(a => a.startsWith('Web')), ['WebSearch', 'WebFetch'], '--no-web denies the web tools');
});

test('update refreshes the marketplace and the plugin in both apps', () => {
  const result = cli(['update', '--dry-run']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /┌  Updating codex-claude-council  \(dry run: nothing is changed\)/);
  const commands = result.stdout.split('\n').filter(line => line.startsWith('◇  $ ')).map(line => line.slice(5));
  assert.deepEqual(commands, [
    'claude plugin marketplace update codex-claude-council',
    'claude plugin update codex-claude-council@codex-claude-council',
    'codex plugin marketplace upgrade codex-claude-council',
    'codex plugin add codex-claude-council@codex-claude-council',
  ]);
  assert.match(result.stdout, /Fully quit and reopen Claude Code and Codex/);
  const codexOnly = cli(['update', '--dry-run', '--only', 'codex']).stdout;
  assert.ok(codexOnly.includes('codex plugin add') && !codexOnly.includes('claude plugin'), codexOnly);
});

test('an install step that fails because files are in use says what to do', async () => {
  const { failureHint } = await import('../src/install.mjs');
  const codexOnWindows = 'Error: failed to back up plugin cache entry: Access is denied. (os error 5)';
  assert.match(failureHint(codexOnWindows), /still in use.*Quit them all, then run this again/);
  assert.match(failureHint('EBUSY: resource busy or locked'), /still in use/);
  assert.equal(failureHint('error: unknown plugin'), '');
});

test('skills from the terminal: add, list, use with --skill, remove', () => {
  const file = join(fake.dir, 'my-skill.md');
  writeFileSync(file, '---\nname: my-skill\ndescription: "Mine."\n---\nDo it well.\n');
  const added = cli(['skill', 'add', file]);
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /Installed skill "my-skill" at .*SKILL\.md\nUse it with: --skill <name> .*e\.g\. --skill my-skill/);
  assert.match(cli(['skill', 'list']).stdout, /^my-skill\n  Mine\.$/m);
  fake.clearCalls();
  assert.equal(cli(['claude', 'q', '--skill', 'my-skill', '--no-workspace']).status, 0);
  assert.equal(cli(['claude', 'q', '--skill', 'my-skill', '--skill', 'my-skill,my-skill', '--no-workspace']).status, 0, 'repeated and comma-separated');
  const call = fake.questionCalls().at(-1);
  assert.ok(call.input.includes('<skill name="my-skill">\nDo it well.\n</skill>'));
  assert.match(call.input, /^For this question, the "my-skill" skill is available/, 'each skill once');
  assert.ok(!call.args.includes('Agent'), 'Claude keeps its sub-agent tool');
  assert.match(cli(['skill', 'remove', 'my-skill']).stdout, /Removed skill "my-skill"/);
  assert.match(cli(['claude', 'q', '--skill', 'my-skill']).stderr, /skill "my-skill" is not installed/);
  assert.match(cli(['skill', 'frobnicate']).stderr, /usage: skill add/);
});

test('wrong flags for a command are rejected', () => {
  const result = cli(['codex', 'q', '--codex-effort', 'low']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not take --codex-effort/);
});

test('install checks for both CLIs first, then shows the plugin commands', () => {
  const result = cli(['install', '--dry-run', '--source', 'someone/fork']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /◇  Claude Code CLI: 0\.0\.0 \(Claude Code fake\)/);
  assert.match(result.stdout, /◇  Codex CLI: codex-cli 0\.0\.0-fake/);
  assert.match(result.stdout, /╚██████╗/, 'the banner');
  assert.match(result.stdout, /◇  Dry run complete ─+╮\n│ +│\n│  Version: +\d+\.\d+\.\d+ +│/, 'the summary box');
  assert.match(result.stdout, /└  Try it: "Ask the council: <your question>"\n$/);
  assert.ok(!/\x1b\[/.test(result.stdout), 'no colors when the output is not a terminal');
  for (const line of [
    'claude plugin marketplace add someone/fork',
    'claude plugin install codex-claude-council@codex-claude-council --scope user',
    'codex plugin marketplace add someone/fork',
    'codex plugin add codex-claude-council@codex-claude-council',
  ]) assert.ok(result.stdout.includes(line), line);
});

test('install stops before changing anything when a CLI is missing', () => {
  fake.writeConfig({ codex: { command: join(fake.dir, 'missing', 'codex') } });
  try {
    const result = cli(['install', '--dry-run']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /■  Codex CLI: not found/);
    assert.match(result.stdout, /└  Nothing was changed\.\n$/);
    assert.match(result.stdout, /needs both the Claude Code CLI and the Codex CLI/);
    assert.match(result.stdout, /npm install -g @openai\/codex/);
    assert.ok(!result.stdout.includes('plugin marketplace add'));
  } finally {
    fake.writeConfig();
  }
});

test('config and doctor', () => {
  assert.match(cli(['config']).stdout, /"effort": "high"/);
  const doctor = cli(['doctor']);
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.match(doctor.stdout, /codex: model=\(CLI default\) effort=high/);
});

test('--max-rounds limits the exchange, and progress goes to stderr', () => {
  const state = join(fake.dir, 'cli-reviews');
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'cli.mjs'), 'ask', 'Which?', '--max-rounds', '0'], {
    encoding: 'utf8', env: { ...process.env, ...fake.env, FAKE_STATE: state, FAKE_AGREE_AT: '3' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /both agree with this answer \(they converged after 2 exchanges\)/);
  assert.match(result.stderr, /\[council\] Exchange 2: Codex \(ChatGPT\) agrees, Claude agrees/);
  const wrong = cli(['claude', 'q', '--max-rounds', '2']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /does not take --max-rounds/);
});

test('--html saves the whole discussion as a page, and the usual answer is still printed', () => {
  const page = join(fake.dir, 'debate.html');
  const result = cli(['ask', 'Which one?', '--no-workspace', '--html', page]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /both agree with this answer/);
  assert.match(result.stderr, /saved the discussion to .*debate\.html/);
  const html = readFileSync(page, 'utf8');
  assert.ok(html.includes('Which one?') && html.includes('⇄ Exchange 1') && html.includes('One answer'));
  assert.match(cli(['claude', 'q', '--html', page]).stderr, /does not take --html/);
});

test('a remote member\'s commands: --raw sends the prompt as it is, skill installed lists that CLI\'s skills as JSON', () => {
  fake.clearCalls();
  const raw = cli(['claude', '--raw', '--session', '11111111-2222-4333-8444-555555555555', '--no-web'], 'You are Claude, in an exchange.\nVERDICT line please');
  assert.equal(raw.status, 0, raw.stderr);
  const [call] = fake.questionCalls();
  assert.equal(call.input, 'You are Claude, in an exchange.\nVERDICT line please', 'not wrapped as a new question');
  assert.ok(call.args.includes('--resume') && call.args.includes('WebSearch'), 'the session resumed, the web off');
  assert.match(cli(['codex', '--raw'], 'x').stderr, /--raw is for the codex and claude commands with --session/);
  mkdirSync(join(fake.env.CLAUDE_CONFIG_DIR, 'skills', 'mine'), { recursive: true });
  writeFileSync(join(fake.env.CLAUDE_CONFIG_DIR, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\ndescription: "x"\n---\nx\n');
  const listed = cli(['skill', 'installed', 'claude', 'mine', 'other', '../evil']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), ['mine']);
});

test('serve: the MCP server over HTTP answers only at its secret URL, with a generated token saved next to the config', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'cli.mjs'), 'serve', '--port', '0'], { env: { ...process.env, ...fake.env } });
  try {
    const [line] = await once(createInterface({ input: child.stdout }), 'line');
    const url = line.trim();
    const token = readFileSync(join(dirname(fake.env.COUNCIL_CONFIG), 'serve-token'), 'utf8').trim();
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(new URL(url).pathname, `/mcp/${token}`);
    const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body });
    const rpc = async (method, params, id = 1) => (await post(JSON.stringify({ jsonrpc: '2.0', id, method, params }))).json();

    assert.equal((await fetch(url.replace(token, 'x'.repeat(32)), { method: 'POST', body: '{}' })).status, 404, 'another token');
    assert.equal((await fetch(`${new URL(url).origin}/mcp`, { method: 'POST', body: '{}' })).status, 404, 'no token');
    // Without the token, only the icon (apps show the connector with its site's favicon) and a page naming it.
    const icon = await fetch(`${new URL(url).origin}/favicon.ico`);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), readFileSync(join(ROOT, 'mcpb', 'icon.png')));
    assert.match(await (await fetch(new URL(url).origin)).text(), /<link rel="icon" type="image\/png" href="\/favicon.ico">/);
    assert.equal((await fetch(url)).status, 405, 'no event stream');
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'codex-claude-council');
    assert.equal((await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
    assert.equal((await rpc('tools/list', {}, 'two')).result.tools.length, 8);
    const asked = await rpc('tools/call', { name: 'council_ask_codex', arguments: { question: 'over http' } }, 3);
    assert.deepEqual(asked.result.structuredContent, { status: 'done', text: 'codex[-|high] over http' });
    const bad = await post('{');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, -32700);
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});

test('serve --tunnel: starts a Cloudflare quick tunnel to the server and prints the HTTPS URL', async () => {
  const bin = join(dirname(fake.env.COUNCIL_CONFIG), 'tunnel-bin');
  mkdirSync(bin, { recursive: true });
  const script = join(ROOT, 'test', 'fixtures', 'fake-cloudflared.mjs');
  if (process.platform === 'win32') writeFileSync(join(bin, 'cloudflared.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  else writeFileSync(join(bin, 'cloudflared'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const log = join(bin, 'calls.jsonl');
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'cli.mjs'), 'serve', '--port', '0', '--tunnel', '--token', 'tunnel-test-token-0123456789'], {
    env: { ...process.env, ...fake.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_CLOUDFLARED_LOG: log },
  });
  try {
    const [line] = await once(createInterface({ input: child.stdout }), 'line');
    assert.equal(line.trim(), 'https://quiet-test-words-here.trycloudflare.com/mcp/tunnel-test-token-0123456789');
    const [args] = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(args.slice(0, 3), ['tunnel', '--no-autoupdate', '--url']);
    assert.match(args[3], /^http:\/\/127\.0\.0\.1:\d+$/);
    // The tunnel's target is the server.
    const reply = await fetch(`${args[3]}/mcp/tunnel-test-token-0123456789`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    assert.deepEqual(await reply.json(), { jsonrpc: '2.0', id: 1, result: {} });
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});
