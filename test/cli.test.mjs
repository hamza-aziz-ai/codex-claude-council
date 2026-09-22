import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ROOT, setup } from './helpers.mjs';

let fake;
before(() => { fake = setup({ codex: { effort: 'high' }, claude: { effort: 'high' } }); });
after(() => fake.cleanup());

const cli = (args, input = '') => spawnSync(process.execPath, [join(ROOT, 'bin', 'cli.mjs'), ...args], {
  input, encoding: 'utf8', env: { ...process.env, ...fake.env },
});

test('single-model and council commands with overrides', () => {
  assert.equal(cli(['codex', 'hello', 'there', '--effort', 'low']).stdout.trim(), 'codex[-|low] hello there');
  assert.equal(cli(['claude', '--model', 'opus'], 'from stdin\n').stdout.trim(), 'claude[opus|high] from stdin');
  const ask = cli(['ask', 'Which?', '--codex-model', 'gpt-x', '--claude-effort', 'max']);
  assert.equal(ask.status, 0, ask.stderr);
  assert.match(ask.stdout, /^codex\[gpt-x\|high\]/);
});

test('wrong flags for a command are rejected', () => {
  const result = cli(['codex', 'q', '--codex-effort', 'low']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not take --codex-effort/);
});

test('install checks for both CLIs first, then shows the plugin commands', () => {
  const result = cli(['install', '--dry-run', '--source', 'someone/fork']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[ok\] Claude Code CLI: 0\.0\.0 \(Claude Code fake\)/);
  assert.match(result.stdout, /\[ok\] Codex CLI: codex-cli 0\.0\.0-fake/);
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
    assert.match(result.stdout, /\[x\]  Codex CLI: not found/);
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

test('--max-rounds runs the agreement loop and reports progress on stderr', () => {
  const state = join(fake.dir, 'cli-reviews');
  const result = spawnSync(process.execPath, [join(ROOT, 'bin', 'cli.mjs'), 'ask', 'Which?', '--max-rounds', '0'], {
    encoding: 'utf8', env: { ...process.env, ...fake.env, FAKE_STATE: state, FAKE_AGREE_AT: '2' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /both agree with this answer \(2 rounds\)/);
  assert.match(result.stderr, /\[council\] Round 2: Claude agrees/);
  const wrong = cli(['claude', 'q', '--max-rounds', '2']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /does not take --max-rounds/);
});
