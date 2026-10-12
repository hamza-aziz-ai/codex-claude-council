import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  assert.match(result.stdout, /╳/, 'the banner');
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
