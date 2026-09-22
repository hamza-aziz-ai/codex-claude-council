import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { askClaude, askCodex } from '../src/adapters.mjs';
import { invoke } from '../src/council.mjs';
import { setup, withEnv } from './helpers.mjs';

let fake;
before(() => { fake = setup({ codex: { model: 'gpt-test', effort: 'xhigh' }, claude: { model: 'opus', effort: 'high' } }); });
after(() => fake.cleanup());
beforeEach(() => { fake.clearCalls(); fake.writeConfig(); });

test('codex gets model and effort as explicit flags, isolated from user config', async () => {
  const answer = await askCodex('Question?\nこんにちは — ✓ "quoted" & <tag> 100% $HOME');
  assert.equal(answer, 'codex[gpt-test|xhigh] こんにちは — ✓ "quoted" & <tag> 100% $HOME');
  const [call] = fake.questionCalls();
  assert.deepEqual(call.args.slice(0, 6), ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only']);
  assert.ok(call.args.includes('-m') && call.args[call.args.indexOf('-m') + 1] === 'gpt-test');
  assert.equal(call.args[call.args.indexOf('-c') + 1], 'model_reasoning_effort=xhigh');
  assert.equal(call.args.at(-1), '-');
  assert.match(call.input, /こんにちは/);
});

test('claude gets no tools, no settings sources beyond project, and model/effort flags', async () => {
  const answer = await askClaude('Question?\nhello', { model: 'sonnet', effort: 'max' });
  assert.equal(answer, 'claude[sonnet|max] hello');
  const [call] = fake.questionCalls();
  assert.equal(call.args[call.args.indexOf('--tools') + 1], '', 'empty --tools value must survive quoting');
  for (const flag of ['-p', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config']) assert.ok(call.args.includes(flag), flag);
  assert.equal(call.args[call.args.indexOf('--setting-sources') + 1], 'project');
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'sonnet');
  assert.equal(call.args[call.args.indexOf('--effort') + 1], 'max');
});

test('each call runs in its own empty temporary folder', async () => {
  await askCodex('a');
  await askClaude('b');
  const [codexCall, claudeCall] = fake.questionCalls();
  assert.notEqual(codexCall.cwd, claudeCall.cwd);
  assert.match(codexCall.cwd, /council-codex-/);
  assert.match(claudeCall.cwd, /council-claude-/);
});

test('council_ask: five calls, overrides reach every call on their side only', async () => {
  const answer = await invoke('council_ask', 'Which is better?', { codex_effort: 'low', claude_model: 'sonnet' });
  assert.match(answer, /^codex\[gpt-test\|low\]/, 'codex synthesizes by default');
  const calls = fake.questionCalls();
  const codexCalls = calls.filter(c => c.cli === 'codex');
  const claudeCalls = calls.filter(c => c.cli === 'claude');
  assert.equal(codexCalls.length, 3);
  assert.equal(claudeCalls.length, 2);
  for (const c of codexCalls) assert.equal(c.args[c.args.indexOf('-c') + 1], 'model_reasoning_effort=low');
  for (const c of claudeCalls) {
    assert.equal(c.args[c.args.indexOf('--model') + 1], 'sonnet');
    assert.equal(c.args[c.args.indexOf('--effort') + 1], 'high');
  }
});

test('debate returns answers, critiques and the settings used', async () => {
  fake.writeConfig({ synthesizer: 'claude' });
  const result = JSON.parse(await invoke('debate', 'Pick one', { claude_effort: 'max' }));
  assert.deepEqual(Object.keys(result).sort(), ['answer', 'claude', 'claude_critique', 'codex', 'codex_critique', 'settings']);
  assert.deepEqual(result.settings, {
    codex: { model: 'gpt-test', effort: 'xhigh' }, claude: { model: 'opus', effort: 'max' }, synthesizer: 'claude',
  });
  assert.match(result.answer, /^claude\[opus\|max\]/);
  assert.match(result.codex_critique, /^codex.*claude\[opus\|max\] Pick one$/, 'codex critiques claude\'s answer');
  assert.equal(fake.questionCalls().filter(c => c.cli === 'claude').length, 3);
});

test('bad input is rejected before any CLI runs', async () => {
  await assert.rejects(invoke('ask_codex', 'q', { effort: 'max' }), /codex effort must be one of/);
  await assert.rejects(invoke('ask_codex', 'q', { codex_effort: 'low' }), /does not accept: codex_effort/);
  await assert.rejects(invoke('council_ask', 'q', { effort: 'low' }), /does not accept: effort/);
  await assert.rejects(invoke('council_ask', 'q', { claude_model: 5 }), /must be a string/);
  await assert.rejects(invoke('council_ask', '   '), /question must be/);
  await assert.rejects(invoke('council_ask', 'x'.repeat(12_001)), /question must be/);
  await assert.rejects(invoke('nope', 'q'), /unknown tool/);
  assert.equal(fake.calls().length, 0);
});

test('a failing side stops the council with that side\'s error', () => withEnv({ FAKE_FAIL: 'codex' }, async () => {
  await assert.rejects(invoke('council_ask', 'q'), /codex failed: ERROR: You've hit your usage limit\./);
}));

test('sign-in problems are reported with the fix', async () => {
  await withEnv({ FAKE_CODEX_AUTH: 'Not logged in' }, () => assert.rejects(askCodex('q'), /Codex is not signed in.*codex login/));
  await withEnv({ FAKE_CODEX_AUTH: 'Logged in using an API key - sk-proj-***' }, () => assert.rejects(askCodex('q'), /API key/));
  await withEnv({ FAKE_CLAUDE_AUTH: '{"loggedIn":false}' }, () => assert.rejects(askClaude('q'), /claude auth login/));
  await withEnv({ FAKE_CLAUDE_AUTH: '{"loggedIn":true,"authMethod":"api_key"}' }, () => assert.rejects(askClaude('q'), /API key/));
  fake.writeConfig({ allow_api_key_auth: true });
  await withEnv({ FAKE_CLAUDE_AUTH: '{"loggedIn":true,"authMethod":"api_key"}' }, async () => {
    assert.match(await askClaude('q'), /^claude/);
  });
  assert.equal(fake.questionCalls().length, 1, 'only the allowed call reached the model');
});

test('API keys are removed from the CLI environment unless allowed', async () => {
  await withEnv({ OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant', CLAUDECODE: '1' }, async () => {
    const { cleanEnv } = await import('../src/process.mjs');
    const env = cleanEnv({});
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(cleanEnv({ allow_api_key_auth: true }).OPENAI_API_KEY, 'sk-test');
  });
});

test('slow calls time out and are killed', () => withEnv({ FAKE_SLEEP_MS: '20000' }, async () => {
  fake.writeConfig({ timeout_seconds: 1 });
  const started = Date.now();
  await assert.rejects(askCodex('q'), /timed out after 1s/);
  assert.ok(Date.now() - started < 10_000);
}));

test('a missing CLI gives install guidance', async () => {
  fake.writeConfig({ codex: { command: `${fake.dir}/does-not-exist/codex` } });
  await assert.rejects(askCodex('q'), /codex CLI not found at/);
});
