import assert from 'node:assert/strict';
import { readFileSync as readFile, realpathSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { CLAUDE_ALLOWED, CLAUDE_DENIED, CLAUDE_TOOLS, CLAUDE_WEB, askClaude, askCodex, resetSessions } from '../src/adapters.mjs';
import { accessNote, invoke, prompt, verifyNote } from '../src/council.mjs';
import { setup, withEnv } from './helpers.mjs';

let fake;
before(() => { fake = setup({ codex: { model: 'gpt-test', effort: 'xhigh' }, claude: { model: 'opus', effort: 'high' } }); });
after(() => fake.cleanup());
beforeEach(() => { fake.clearCalls(); fake.writeConfig(); resetSessions(); });

const arg = (call, flag) => call.args[call.args.indexOf(flag) + 1];
const configValues = call => call.args.flatMap((a, i) => (a === '-c' ? [call.args[i + 1]] : []));

test('codex runs read-only, isolated from user config and rules, with model and effort as explicit flags', async () => {
  const answer = await askCodex('Question?\nこんにちは — ✓ "quoted" & <tag> 100% $HOME');
  assert.equal(answer, 'codex[gpt-test|xhigh] こんにちは — ✓ "quoted" & <tag> 100% $HOME');
  const [call] = fake.questionCalls();
  assert.equal(call.args[0], 'exec');
  for (const flag of ['--json', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check']) assert.ok(call.args.includes(flag), flag);
  assert.ok(!call.args.includes('--ephemeral'), 'the session is kept so it can be resumed');
  assert.equal(arg(call, '--sandbox'), 'read-only');
  assert.deepEqual(configValues(call), ['sandbox_mode="read-only"', 'approval_policy="never"', 'model_reasoning_effort=xhigh', 'web_search="live"']);
  assert.equal(arg(call, '-m'), 'gpt-test');
  assert.equal(call.args.at(-1), '-');
  assert.match(call.input, /こんにちは/);
});

test('claude runs restricted: no settings files, no MCP servers, nothing allowed beyond what is listed', async () => {
  const answer = await askClaude('Question?\nhello', { model: 'sonnet', effort: 'max' });
  assert.equal(answer, 'claude[sonnet|max] hello');
  const [call] = fake.questionCalls();
  assert.equal(arg(call, '--tools'), 'WebSearch,WebFetch', 'without a workspace, only the web tools (on by default)');
  for (const flag of ['-p', '--restricted', '--disable-slash-commands', '--strict-mcp-config']) assert.ok(call.args.includes(flag), flag);
  assert.ok(!call.args.includes('--no-session-persistence'), 'the session is kept so it can be resumed');
  assert.equal(arg(call, '--permission-mode'), 'dontAsk');
  assert.match(arg(call, '--session-id'), /^[0-9a-f-]{36}$/);
  assert.equal(arg(call, '--model'), 'sonnet');
  assert.equal(arg(call, '--effort'), 'max');
});

test('each side keeps one session: later calls resume it in the same folder', async () => {
  await askCodex('a');
  await askClaude('b');
  await askCodex('c');
  await askClaude('d');
  const [codex1, claude1, codex2, claude2] = fake.questionCalls();
  assert.notEqual(codex1.cwd, claude1.cwd);
  assert.match(codex1.cwd, /council-codex-/);
  assert.match(claude1.cwd, /council-claude-/);
  assert.equal(codex2.cwd, codex1.cwd, 'the same folder, so the session can be found again');
  assert.equal(claude2.cwd, claude1.cwd);
  assert.deepEqual(codex2.args.slice(0, 2), ['exec', 'resume']);
  assert.match(codex2.args.at(-2), /^[0-9a-f-]{36}$/, 'resumes the thread codex reported');
  assert.ok(configValues(codex2).includes('sandbox_mode="read-only"'), 'resume has no --sandbox flag, so the -c setting keeps it read-only');
  assert.equal(arg(claude2, '--resume'), arg(claude1, '--session-id'));
  assert.ok(!claude2.args.includes('--session-id'));
  await askClaude('e', { model: 'haiku' });
  assert.ok(fake.questionCalls().at(-1).args.includes('--session-id'), 'another model gets a session of its own');
  resetSessions();
  await askCodex('f');
  assert.notEqual(fake.questionCalls().at(-1).args[1], 'resume', 'after a reset, a new session starts');
});

test('with a workspace, both models run in the project folder and can read but not write it', async () => {
  const workspace = realpathSync(fake.dir); // what the council passes (on macOS, /var is a link to /private/var)
  await askCodex('a', {}, { workspace });
  await askClaude('b', {}, { workspace });
  await askCodex('c', {}, { workspace });
  const [codex1, claude, codex2] = fake.questionCalls();
  for (const call of [codex1, claude, codex2]) assert.equal(call.cwd, workspace);
  assert.equal(arg(codex1, '-C'), workspace);
  assert.equal(arg(codex1, '--sandbox'), 'read-only');
  assert.ok(configValues(codex2).includes('sandbox_mode="read-only"'));
  // Claude has its file tools, the read-only git tools and the web tools, and no shell.
  assert.equal(arg(claude, '--tools'), `${CLAUDE_TOOLS},WebSearch,WebFetch`);
  assert.equal(CLAUDE_TOOLS, 'Read,Grep,Glob');
  const listed = flag => claude.args.slice(claude.args.indexOf(flag) + 1).filter((a, i, rest) => !rest.slice(0, i + 1).some(x => x.startsWith('--')));
  assert.deepEqual(listed('--allowedTools'), ['mcp__council-git', 'WebSearch', 'WebFetch']);
  assert.deepEqual(listed('--disallowedTools'), CLAUDE_DENIED);
  for (const tool of ['Bash', 'Edit', 'Write', 'NotebookEdit']) assert.ok(CLAUDE_DENIED.includes(tool), tool);
  assert.deepEqual(CLAUDE_ALLOWED, ['mcp__council-git']);
  const config = JSON.parse(readFile(arg(claude, '--mcp-config'), 'utf8'));
  assert.deepEqual(Object.keys(config.mcpServers), ['council-git']);
  assert.equal(config.mcpServers['council-git'].command, process.execPath);
  assert.match(config.mcpServers['council-git'].args[0], /git-mcp\.mjs$/);
  assert.equal(config.mcpServers['council-git'].args[1], workspace, 'the git tools are bound to this workspace');
});

test('council_ask: by default both models sign the final answer; overrides reach every call on their side only', async () => {
  const answer = await invoke('council_ask', 'Which is better?', { codex_effort: 'low', claude_model: 'sonnet' });
  assert.match(answer, /^claude\[sonnet\|high\]/, 'Claude writes the final answer by default');
  assert.match(answer, /Codex \(ChatGPT\) and Claude both agree with this answer \(1 round\)\.$/);
  const calls = fake.questionCalls();
  const codexCalls = calls.filter(c => c.cli === 'codex');
  const claudeCalls = calls.filter(c => c.cli === 'claude');
  assert.equal(codexCalls.length, 4, 'answer, critique, reply, review');
  assert.equal(claudeCalls.length, 4, 'answer, critique, reply, draft');
  for (const c of codexCalls) assert.ok(configValues(c).includes('model_reasoning_effort=low'));
  for (const c of claudeCalls) {
    assert.equal(c.args[c.args.indexOf('--model') + 1], 'sonnet');
    assert.equal(c.args[c.args.indexOf('--effort') + 1], 'high');
  }
});

test('debate returns answers, critiques, replies, rounds and the settings used', async () => {
  const result = JSON.parse(await invoke('debate', 'Pick one', { claude_effort: 'max' }));
  assert.deepEqual(Object.keys(result).sort(), ['agreed', 'answer', 'claude', 'claude_critique', 'claude_reply',
    'codex', 'codex_critique', 'codex_reply', 'rounds', 'rounds_run', 'settings']);
  assert.deepEqual(result.settings, {
    codex: { model: 'gpt-test', effort: 'xhigh' }, claude: { model: 'opus', effort: 'max' }, synthesizer: 'claude', max_rounds: 3, workspace: null, web_search: true,
  });
  assert.equal(result.agreed, true);
  assert.match(result.answer, /^claude\[opus\|max\]/);
  assert.match(result.codex_critique, /^codex.*claude\[opus\|max\] Pick one$/, 'codex critiques claude\'s answer');
  assert.equal(fake.questionCalls().filter(c => c.cli === 'claude').length, 4);
});

const NAME = { codex: 'Codex', claude: 'Claude' };
const callsOf = cli => fake.questionCalls().filter(c => c.cli === cli);

for (const synthesizer of ['claude', 'codex']) {
  test(`critiques are swapped and each model replies to the critique of its answer (single pass, ${synthesizer} synthesizes)`, async () => {
    fake.writeConfig({ max_rounds: null });
    const r = JSON.parse(await invoke('debate', 'q', { synthesizer }));
    // Each text came from the model it is filed under.
    for (const key of ['codex', 'codex_critique', 'codex_reply']) assert.match(r[key], /^codex\[/, key);
    for (const key of ['claude', 'claude_critique', 'claude_reply']) assert.match(r[key], /^claude\[/, key);
    // Each model works in one session, so every prompt carries only what it has not seen yet.
    for (const [me, them] of [['codex', 'claude'], ['claude', 'codex']]) {
      const [answer, critique, reply, ...rest] = callsOf(me);
      assert.equal(answer.input, prompt('answer', { question: 'q', access: accessNote(undefined, true), self: NAME[me], other: NAME[them] }));
      assert.equal(critique.input, prompt('critique', { other: NAME[them], other_answer: r[them], verify: verifyNote(undefined, true) }), `${me} critiques ${them}'s answer`);
      assert.equal(reply.input, prompt('reply', { other: NAME[them], other_critique: r[`${them}_critique`] }), `${me} replies to ${them}'s critique`);
      assert.deepEqual(rest.map(c => c.input), me === synthesizer ? [prompt('synthesize', { other: NAME[them], other_reply: r[`${them}_reply`] })] : []);
    }
    for (const call of fake.questionCalls().slice(2)) {
      assert.ok(call.cli === 'codex' ? call.args[1] === 'resume' : call.args.includes('--resume'), 'every step after the answers resumes its session');
    }
  });
}

test('the next question continues the same sessions', async () => {
  await invoke('council_ask', 'first question');
  const firstCodex = callsOf('codex')[0].args;
  fake.clearCalls();
  await invoke('council_ask', 'second question');
  const [codexAnswer] = callsOf('codex');
  const [claudeAnswer] = callsOf('claude');
  assert.deepEqual(codexAnswer.args.slice(0, 2), ['exec', 'resume'], 'Codex answers the new question in its existing session');
  assert.ok(claudeAnswer.args.includes('--resume'), 'so does Claude');
  assert.ok(!firstCodex.includes('resume'));
  assert.match(codexAnswer.input, /second question/);
});

test('two councils at once in the same sessions take turns instead of interleaving', () => withEnv({ FAKE_SLEEP_MS: '100' }, async () => {
  const [first, second] = await Promise.all([invoke('debate', 'first question'), invoke('debate', 'second question')]);
  assert.equal(JSON.parse(first).agreed, true);
  assert.equal(JSON.parse(second).agreed, true);
  for (const cli of ['codex', 'claude']) {
    // Each council's four turns in a session are consecutive: answer, critique, reply, then draft or review.
    const turns = callsOf(cli).map(c => (c.input.startsWith('You are ') ? 'answer' : 'turn'));
    assert.deepEqual(turns, ['answer', 'turn', 'turn', 'turn', 'answer', 'turn', 'turn', 'turn'], cli);
  }
}));

test('a council cancelled while it waits for a session lets go of the sessions it holds', () => withEnv({ FAKE_SLEEP_MS_CODEX: '3000' }, async () => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const slowCodex = askCodex('slow'); // holds the Codex session for about 3 s
  await pause(300);
  const controller = new AbortController();
  // The council takes the Claude session, then waits for Codex.
  const council = invoke('council_ask', 'q', {}, { signal: controller.signal });
  await pause(300);
  const cancelledAt = Date.now();
  controller.abort();
  await assert.rejects(council, /cancelled/);
  assert.ok(Date.now() - cancelledAt < 1000, 'the council stops waiting at once');
  assert.match(await askClaude('next'), /^claude/);
  assert.ok(Date.now() - cancelledAt < 2000, 'the Claude session is free without waiting for the slow Codex call');
  assert.match(await slowCodex, /^codex/);
  assert.equal(fake.questionCalls().filter(c => c.input.startsWith('You are ')).length, 0, 'the council never sent a question');
}));

test('a council with a workspace tells both models they can read the project, and runs every call there', async () => {
  const workspace = realpathSync(fake.dir); // the council resolves links in the path it is given
  const text = await invoke('council_ask', 'Is src/ tidy?', { workspace: fake.dir });
  assert.match(text, /both agree/);
  const calls = fake.questionCalls();
  assert.equal(calls.length, 8);
  for (const call of calls) assert.equal(call.cwd, workspace);
  for (const cli of ['codex', 'claude']) {
    assert.ok(callsOf(cli)[0].input.includes(accessNote(workspace, true)));
    assert.match(accessNote(workspace, true), /can read the project at .*You cannot change anything/);
  }
  // Only a model that can read the project is asked to check claims against it.
  const kindOf = c => (c.input.includes('VERDICT: AGREE or VERDICT: DISAGREE') ? 'review' : c.input.includes('answered the same question independently') ? 'critique' : 'other');
  const checked = calls.filter(c => kindOf(c) !== 'other');
  assert.equal(checked.length, 3, 'two critiques and one review');
  for (const call of checked) assert.ok(call.input.includes(verifyNote(workspace, true)), kindOf(call));
  fake.clearCalls();
  await invoke('council_ask', 'q');
  for (const call of fake.questionCalls()) assert.doesNotMatch(call.input, /project/, 'no workspace, so no mention of a project');
  assert.equal(verifyNote(), '');
  assert.equal(verifyNote(undefined, true), ' Where it matters, check claims against reliable sources on the web rather than assuming.');
  const result = JSON.parse(await invoke('debate', 'q', { workspace: fake.dir }));
  assert.equal(result.settings.workspace, workspace);
});

test('web access: on by default for both models, off per call or in the config', async () => {
  const lastOf = cli => fake.questionCalls().filter(c => c.cli === cli).at(-1);
  await invoke('council_ask', 'q');
  assert.ok(configValues(lastOf('codex')).includes('web_search="live"'), 'Codex searches the web live');
  assert.equal(arg(lastOf('claude'), '--tools'), 'WebSearch,WebFetch');
  assert.match(fake.questionCalls().find(c => c.input.startsWith('You are ')).input, /You can also search the web/);
  for (const turnOff of [() => invoke('council_ask', 'q', { web_search: false }), () => { fake.writeConfig({ web_search: false }); return invoke('council_ask', 'q'); }]) {
    fake.clearCalls();
    resetSessions();
    await turnOff();
    for (const call of fake.questionCalls().filter(c => c.cli === 'codex')) assert.ok(configValues(call).includes('web_search="disabled"'));
    for (const call of fake.questionCalls().filter(c => c.cli === 'claude')) {
      assert.equal(arg(call, '--tools'), '', 'no tools at all: the empty value must survive quoting');
      assert.ok(!call.args.includes('--allowedTools'));
      assert.ok(!call.args.some(a => CLAUDE_WEB.includes(a)));
    }
    assert.match(fake.questionCalls().find(c => c.input.startsWith('You are ')).input, /You have no internet access/);
  }
  fake.writeConfig();
  assert.equal(JSON.parse(await invoke('debate', 'q', { web_search: false })).settings.web_search, false);
  fake.clearCalls();
  await invoke('ask_claude', 'q', { web_search: false });
  assert.equal(arg(fake.questionCalls()[0], '--tools'), '');
  await assert.rejects(invoke('council_ask', 'q', { web_search: 'yes' }), /web_search must be true or false/);
});

test('an invalid workspace is rejected before any CLI runs', async () => {
  await assert.rejects(invoke('council_ask', 'q', { workspace: 'relative/path' }), /workspace must be an absolute path/);
  await assert.rejects(invoke('ask_codex', 'q', { workspace: `${fake.dir}/missing` }), /workspace not found/);
  await assert.rejects(invoke('ask_claude', 'q', { workspace: `${fake.dir}/calls.jsonl` }), /workspace is not a folder/);
  assert.equal(fake.calls().length, 0);
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
  for (const { cli, pid } of fake.questionCalls()) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `the stopped ${cli} process is gone when the council returns`);
  }
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

test('a council checks that both CLIs are signed in before sending anything', async () => {
  const header = /needs both Codex and Claude Code signed in\. Nothing was sent to either model\./;
  const cases = [
    [{ FAKE_CODEX_AUTH: 'Not logged in' }, [/- Codex \(ChatGPT\): Codex is not signed in\. Run `codex login`/], /Claude Code:/],
    [{ FAKE_CLAUDE_AUTH: '{"loggedIn":false}' }, [/- Claude Code: Claude Code is not signed in\. Run `claude auth login`/], /Codex \(ChatGPT\):/],
    [{ FAKE_CODEX_AUTH: 'Not logged in', FAKE_CLAUDE_AUTH: '{"loggedIn":false}' }, [/codex login/, /claude auth login/], null],
    [{ FAKE_CODEX_AUTH: 'Logged in using an API key - sk-proj-***' }, [/- Codex \(ChatGPT\): Codex is signed in with an API key/], /Claude Code:/],
  ];
  for (const [env, expected, absent] of cases) {
    fake.clearCalls();
    await withEnv(env, () => assert.rejects(invoke('debate', 'q', { max_rounds: 2 }), error => {
      assert.match(error.message, header);
      for (const pattern of expected) assert.match(error.message, pattern);
      if (absent) assert.doesNotMatch(error.message, absent, 'only the side with a problem is named');
      return true;
    }));
    assert.equal(fake.questionCalls().length, 0, `no model received the question (${JSON.stringify(env)})`);
  }
  fake.clearCalls();
  fake.writeConfig({ claude: { command: `${fake.dir}/does-not-exist/claude` } });
  await assert.rejects(invoke('council_ask', 'q'), /- Claude Code: claude CLI not found at/);
  assert.equal(fake.questionCalls().length, 0, 'a missing CLI also stops the council before it starts');
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

// ---- Agreement loop (max_rounds) ----
import { mkdtempSync as mkTemp, readFileSync } from 'node:fs';
import { tmpdir as tmp } from 'node:os';
import { join as joinPath } from 'node:path';
import { readVerdict, splitDraft } from '../src/council.mjs';

const loopEnv = extra => ({ FAKE_STATE: joinPath(mkTemp(joinPath(tmp(), 'council-state-')), 'reviews'), ...extra });
const kinds = calls => calls.map(c => (c.input.includes('VERDICT: AGREE or VERDICT: DISAGREE') ? `review:${c.cli}`
  : c.input.includes('reviewed your draft and did not agree') ? `redraft:${c.cli}`
    : c.input.includes('Write one final answer that both of you could sign') ? `draft:${c.cli}`
      : c.input.startsWith('Give the user a final answer') ? `synthesize:${c.cli}` : `other:${c.cli}`));

test('verdict and notes parsing', () => {
  assert.equal(readVerdict('fine\nVERDICT: AGREE'), true);
  assert.equal(readVerdict('**VERDICT:** DISAGREE'), false);
  assert.equal(readVerdict('verdict: agree\n...\nVERDICT - DISAGREE'), false, 'the last verdict wins');
  assert.equal(readVerdict('I agree with everything'), false, 'no verdict line means no agreement');
  assert.deepEqual(splitDraft('The answer.\n---NOTES---\nDropped X.'), { answer: 'The answer.', notes: 'Dropped X.' });
  assert.deepEqual(splitDraft('Only an answer'), { answer: 'Only an answer', notes: 'none' });
});

test('both models must agree by default; the config can change the rounds or ask for a single pass', async () => {
  const agreed = JSON.parse(await invoke('debate', 'q'));
  assert.equal(agreed.agreed, true);
  assert.equal(agreed.settings.max_rounds, 3);
  assert.deepEqual(kinds(fake.questionCalls()).filter(k => !k.startsWith('other')), ['draft:claude', 'review:codex']);
  fake.clearCalls();
  fake.writeConfig({ max_rounds: null });
  const single = JSON.parse(await invoke('debate', 'q'));
  assert.equal(single.agreed, undefined);
  assert.equal(single.settings.max_rounds, null);
  assert.deepEqual(kinds(fake.questionCalls()).filter(k => !k.startsWith('other')), ['synthesize:claude']);
  fake.writeConfig({ max_rounds: 5 });
  assert.equal(JSON.parse(await invoke('debate', 'q')).settings.max_rounds, 5);
  assert.equal(JSON.parse(await invoke('debate', 'q', { max_rounds: 1 })).settings.max_rounds, 1, 'a per-call value wins');
});

test('who writes the final answer: config default, then per-call override (ChatGPT = codex)', async () => {
  fake.writeConfig({ synthesizer: 'codex' });
  assert.match(await invoke('council_ask', 'q'), /^codex/);
  assert.match(await invoke('council_ask', 'q', { synthesizer: 'claude' }), /^claude/);
  fake.writeConfig();
  assert.match(await invoke('council_ask', 'q', { synthesizer: 'ChatGPT' }), /^codex/);
  const result = JSON.parse(await invoke('debate', 'q', { synthesizer: 'codex' }));
  assert.equal(result.settings.synthesizer, 'codex');
  await assert.rejects(invoke('council_ask', 'q', { synthesizer: 'gemini' }), /synthesizer must be "claude" or "codex"/);
  await assert.rejects(invoke('ask_claude', 'q', { synthesizer: 'codex' }), /does not accept: synthesizer/);
});

test('max_rounds N stops as soon as both agree', () => withEnv(loopEnv({ FAKE_AGREE_AT: '2' }), async () => {
  const result = JSON.parse(await invoke('debate', 'q', { max_rounds: 5 }));
  assert.equal(result.agreed, true);
  assert.equal(result.rounds_run, 2);
  assert.deepEqual(result.rounds.map(r => r.verdict), ['disagree', 'agree']);
  assert.deepEqual(result.rounds.map(r => [r.drafter, r.reviewer]), [['claude', 'codex'], ['claude', 'codex']]);
  const calls = fake.questionCalls();
  assert.deepEqual(kinds(calls).slice(6), ['draft:claude', 'review:codex', 'redraft:claude', 'review:codex']);
  const [draft, review1, redraft, review2] = calls.slice(6).map(c => c.input);
  assert.equal(draft, prompt('draft', { other: 'Codex', other_reply: result.codex_reply }), 'the drafter gets the reply it has not seen');
  assert.equal(review1, prompt('review', { other: 'Claude', context: `Claude's reply to your critique:\n${result.claude_reply}\n`, draft: result.rounds[0].draft, notes: 'none', verify: verifyNote(undefined, true) }),
    'the reviewer gets the drafter\'s reply it has not seen, then the draft');
  assert.equal(redraft, prompt('redraft', { other: 'Codex', objections: result.rounds[0].review }), 'the redraft gets the objections');
  assert.equal(review2, prompt('review', { other: 'Claude', context: '', draft: result.rounds[1].draft, notes: 'none', verify: verifyNote(undefined, true) }),
    'a later review gets only the new draft: the reviewer\'s earlier objections are in its session');
  assert.equal(result.settings.max_rounds, 5);
}));

test('max_rounds N stops at the limit without agreement and says so', () => withEnv(loopEnv({ FAKE_AGREE_AT: '0' }), async () => {
  const text = await invoke('council_ask', 'q', { max_rounds: '3' });
  assert.equal(kinds(fake.questionCalls()).filter(k => k.startsWith('review')).length, 3);
  assert.match(text, /Not agreed after 3 rounds \(round limit of 3 reached\)/);
  assert.match(text, /Codex \(ChatGPT\)'s remaining objections:\n.*objection 3/);
  assert.ok(!/VERDICT/.test(text.split('remaining objections:')[1]), 'verdict line is stripped from the objections');
}));

test('max_rounds 0 keeps going until both agree', () => withEnv(loopEnv({ FAKE_AGREE_AT: '7' }), async () => {
  const text = await invoke('council_ask', 'q', { max_rounds: 0 });
  assert.match(text, /both agree with this answer \(7 rounds\)/);
  assert.equal(kinds(fake.questionCalls()).filter(k => k.startsWith('review')).length, 7);
}));

test('the reviewer is the non-synthesizer', () => withEnv(loopEnv({ FAKE_AGREE_AT: '1' }), async () => {
  const result = JSON.parse(await invoke('debate', 'q', { max_rounds: 1, synthesizer: 'codex' }));
  assert.deepEqual([result.rounds[0].drafter, result.rounds[0].reviewer], ['codex', 'claude']);
  assert.equal(result.agreed, true);
}));

test('a failure mid-loop returns the latest draft with the reason', () => withEnv(loopEnv({ FAKE_AGREE_AT: '0', FAKE_FAIL_REVIEW_AT: '2' }), async () => {
  const result = JSON.parse(await invoke('debate', 'q', { max_rounds: 0 }));
  assert.equal(result.agreed, false);
  assert.equal(result.rounds_run, 1);
  assert.match(result.stopped_reason, /codex failed/);
  assert.match(result.answer, /^claude/);
}));

test('max_rounds is validated and only offered on council tools', async () => {
  for (const bad of [-1, 1.5, 'two', true]) await assert.rejects(invoke('council_ask', 'q', { max_rounds: bad }), /max_rounds must be a whole number/);
  await assert.rejects(invoke('ask_codex', 'q', { max_rounds: 2 }), /does not accept: max_rounds/);
  assert.equal(fake.calls().length, 0);
});

test('a cancelled call settles only once its process has exited', async () => {
  const { run } = await import('../src/process.mjs');
  const dir = mkTemp(joinPath(tmp(), 'council-kill-'));
  const pidFile = joinPath(dir, 'pid');
  const controller = new AbortController();
  const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const running = run(process.execPath, ['-e', script], { signal: controller.signal });
  let pid;
  while (!pid) { await new Promise(resolve => setTimeout(resolve, 20)); try { pid = Number(readFileSync(pidFile, 'utf8')); } catch { /* not yet */ } }
  controller.abort();
  await assert.rejects(running, /cancelled/);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'the process is gone when the call settles');
});
