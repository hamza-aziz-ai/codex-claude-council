import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { CLAUDE_DENIED, CLAUDE_MEMBER_NOTE, CLAUDE_WEB, MEMBER_ENV, askClaude, askCodex, claudeAnswer, resolveSession, resetSessions, sessionFolder } from '../src/adapters.mjs';
import { accessNote, invoke, prompt, verifyNote } from '../src/council.mjs';
import { ROOT, setup, withEnv } from './helpers.mjs';

let fake;
before(() => { fake = setup({ codex: { model: 'gpt-test', effort: 'xhigh' }, claude: { model: 'opus', effort: 'high' } }); });
after(() => fake.cleanup());
beforeEach(() => { fake.clearCalls(); fake.writeConfig(); resetSessions(); });

const arg = (call, flag) => call.args[call.args.indexOf(flag) + 1];
const configValues = call => call.args.flatMap((a, i) => (a === '-c' ? [call.args[i + 1]] : []));

test('codex runs in its read-only sandbox with the user\'s own config, this plugin off, model and effort as explicit flags', async () => {
  const answer = await askCodex('Question?\nこんにちは — ✓ "quoted" & <tag> 100% $HOME');
  assert.equal(answer, 'codex[gpt-test|xhigh] こんにちは — ✓ "quoted" & <tag> 100% $HOME');
  const [call] = fake.questionCalls();
  assert.equal(call.args[0], 'exec');
  for (const flag of ['--json', '--skip-git-repo-check']) assert.ok(call.args.includes(flag), flag);
  for (const flag of ['--ignore-user-config', '--ignore-rules']) assert.ok(!call.args.includes(flag), `${flag}: the user's own setup applies`);
  assert.ok(!call.args.includes('--ephemeral'), 'the session is kept so it can be resumed');
  assert.equal(arg(call, '--sandbox'), 'read-only');
  assert.deepEqual(configValues(call), ['sandbox_mode="read-only"', 'approval_policy="never"', 'plugins."codex-claude-council@codex-claude-council".enabled=false',
    'model_reasoning_effort=xhigh', 'web_search="live"']);
  assert.equal(call.env[MEMBER_ENV], '1', 'this plugin\'s server refuses to start a council inside a member');
  assert.equal(arg(call, '-m'), 'gpt-test');
  assert.equal(call.args.at(-1), '-');
  assert.match(call.input, /こんにちは/);
});

test('with network, codex runs read-only on disk with the network on: any domain, or only the configured ones', async () => {
  await askCodex('q', {}, { network: true });
  let [call] = fake.questionCalls();
  assert.ok(!call.args.includes('--sandbox'), 'a permission profile, not the read-only sandbox (they do not compose)');
  let values = configValues(call);
  assert.ok(!values.includes('sandbox_mode="read-only"'));
  for (const value of ['default_permissions="council"', 'permissions.council.filesystem={":root"="read"}', 'permissions.council.network={enabled=true}']) {
    assert.ok(values.includes(value), value);
  }
  assert.ok(!values.some(value => value.startsWith('features.network_proxy')), 'no proxy without a domain list');
  fake.clearCalls();
  fake.writeConfig({ network_domains: ['api.github.com', '*.example.com'] });
  await askCodex('q', {}, { network: true });
  [call] = fake.questionCalls();
  values = configValues(call);
  assert.ok(values.includes('permissions.council.network={enabled=true, domains={"api.github.com"="allow", "*.example.com"="allow"}}'));
  assert.ok(values.includes('features.network_proxy=true'), 'the proxy enforces the domain list');
});

test('network is off by default, validated, offered only where Codex runs, and Codex is told about it', async () => {
  await invoke('council_ask', 'q');
  assert.ok(fake.questionCalls().filter(c => c.cli === 'codex').every(c => configValues(c).includes('sandbox_mode="read-only"')), 'off by default');
  fake.clearCalls();
  fake.writeConfig({ network_domains: ['api.github.com'] });
  await invoke('council_ask', 'q', { network: true });
  const codex = fake.questionCalls().filter(c => c.cli === 'codex');
  const claude = fake.questionCalls().filter(c => c.cli === 'claude');
  assert.ok(codex.every(c => configValues(c).includes('default_permissions="council"')), 'every Codex step');
  assert.match(codex[0].input, /Your commands can also reach the network, but only to these domains: api\.github\.com/);
  assert.ok(!claude.some(c => /reach the network/.test(c.input)), 'Claude is not told: the option is about Codex');
  fake.clearCalls();
  assert.match(await invoke('ask_codex', 'q', { network: true }), /^codex/);
  assert.match(fake.questionCalls()[0].input, /reach the network/);
  await assert.rejects(invoke('ask_claude', 'q', { network: true }), /does not accept: network/);
  await assert.rejects(invoke('council_ask', 'q', { network: 'yes' }), /network must be true or false/);
  fake.writeConfig({ network: 'yes' });
  await assert.rejects(invoke('council_ask', 'q'), /config: network must be true or false/);
  fake.writeConfig({ network_domains: ['ok.com', 'bad domain"'] });
  await assert.rejects(invoke('council_ask', 'q'), /config: network_domains must be a list of domain names/);
});

test('claude runs in plan mode with the user\'s own setup, without ExitPlanMode or this plugin\'s tools', async () => {
  const answer = await askClaude('Question?\nhello', { model: 'sonnet', effort: 'max' });
  assert.equal(answer, 'claude[sonnet|max] hello');
  const [call] = fake.questionCalls();
  assert.ok(call.args.includes('-p'));
  for (const flag of ['--restricted', '--disable-slash-commands', '--strict-mcp-config', '--tools', '--mcp-config']) assert.ok(!call.args.includes(flag), `${flag}: the user's own setup applies`);
  assert.ok(!call.args.includes('--no-session-persistence'), 'the session is kept so it can be resumed');
  assert.equal(arg(call, '--permission-mode'), 'plan');
  assert.equal(arg(call, '--append-system-prompt'), CLAUDE_MEMBER_NOTE);
  assert.match(CLAUDE_MEMBER_NOTE, /always end your turn with your complete answer/);
  const listed = flag => call.args.slice(call.args.indexOf(flag) + 1).filter((a, i, rest) => !rest.slice(0, i + 1).some(x => x.startsWith('--')));
  assert.deepEqual(listed('--disallowedTools'), ['ExitPlanMode', 'mcp__plugin_codex-claude-council_council'], 'web tools stay (on by default)');
  assert.deepEqual(CLAUDE_DENIED, ['ExitPlanMode', 'mcp__plugin_codex-claude-council_council']);
  assert.equal(call.env[MEMBER_ENV], '1');
  assert.match(arg(call, '--session-id'), /^[0-9a-f-]{36}$/);
  assert.equal(arg(call, '--output-format'), 'stream-json', 'the whole event stream, so the answer is not only the last message');
  assert.ok(call.args.includes('--verbose'), 'stream-json needs --verbose in print mode');
  assert.equal(arg(call, '--model'), 'sonnet');
  assert.equal(arg(call, '--effort'), 'max');
});

test('Claude\'s answer is all its final text after its last tool use, not only its last message', () => {
  const stream = (...events) => events.map(event => JSON.stringify(event)).join('\n');
  const say = (text, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'text', text }] } });
  const use = (parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', name: 'Agent' }] } });
  const got = (parent = null) => ({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result' }] } });
  const result = text => ({ type: 'result', is_error: false, session_id: 's1', result: text });
  // A verdict, then a closing line that points back at it (seen with the llm-council skill).
  const verdict = claudeAnswer(stream({ type: 'system', subtype: 'init' }, say('Spawning advisors.'), use(), got(), say('Sub-agent notes', 'toolu_1'),
    say('## Council Verdict\nUse Postgres.'), say('Council complete. The verdict above is your answer.'), result('Council complete. The verdict above is your answer.')));
  assert.equal(verdict.text, '## Council Verdict\nUse Postgres.\n\nCouncil complete. The verdict above is your answer.');
  assert.equal(verdict.data.session_id, 's1');
  // Sub-agents in the background: an early result while waiting, then the real final turn.
  const background = claudeAnswer(stream(use(), got(), say('Agent is running in the background. Waiting for it to complete.'), result('Agent is running in the background.'),
    say('reading', 'toolu_2'), { type: 'system', subtype: 'init' }, say('VERDICT TEXT: version is 0.4.1'), say('done, see above'), result('done, see above')));
  assert.equal(background.text, 'VERDICT TEXT: version is 0.4.1\n\ndone, see above');
  // No tools: the plain answer; no text events: the result's text.
  assert.equal(claudeAnswer(stream(say('Plain answer.'), result('Plain answer.'))).text, 'Plain answer.');
  assert.equal(claudeAnswer(stream(result('Only a result.'))).text, 'Only a result.');
  assert.equal(claudeAnswer('not json').data, null);
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

test('a session can be given by the name it was given with /rename, in either CLI', async () => {
  const project = realpathSync(fake.dir);
  const [older, newer, renamed] = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003'];
  const claudeDir = `${fake.dir}/claude-home/projects/-named`;
  mkdirSync(claudeDir, { recursive: true });
  const transcript = (id, titles) => [{ type: 'user', cwd: project, sessionId: id }, ...titles.map(t => ({ type: 'custom-title', customTitle: t, sessionId: id }))]
    .map(e => JSON.stringify(e)).join('\n');
  writeFileSync(`${claudeDir}/${older}.jsonl`, transcript(older, ['auth refactor']));
  writeFileSync(`${claudeDir}/${renamed}.jsonl`, transcript(renamed, ['auth refactor', 'billing'])); // renamed since: now "billing"
  writeFileSync(`${claudeDir}/${newer}.jsonl`, transcript(newer, ['Auth Refactor']));
  // Most recently used first: the newer session also answers to "auth refactor", but only ignoring case.
  const past = new Date(Date.now() - 60_000);
  utimesSync(`${claudeDir}/${older}.jsonl`, past, past);
  const codexIds = ['019a0000-1111-7222-8333-000000000001', '019a0000-1111-7222-8333-000000000002'];
  mkdirSync(`${fake.dir}/codex-home/sessions/2026/09/25`, { recursive: true });
  for (const id of codexIds) {
    writeFileSync(`${fake.dir}/codex-home/sessions/2026/09/25/rollout-2026-09-25T10-00-00-${id}.jsonl`, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd: project } })}\n`);
  }
  writeFileSync(`${fake.dir}/codex-home/session_index.jsonl`, [
    { id: codexIds[0], thread_name: 'auth refactor', updated_at: '2026-09-24T10:00:00Z' },
    { id: codexIds[1], thread_name: 'auth refactor', updated_at: '2026-09-25T10:00:00Z' },
    { id: codexIds[0], thread_name: 'old work', updated_at: '2026-09-25T11:00:00Z' },
  ].map(e => JSON.stringify(e)).join('\n'));
  assert.equal(await resolveSession('claude', older), older, 'an id is used as it is');
  assert.equal(await resolveSession('claude', 'auth refactor'), older, 'an exact match wins over a newer one that only matches ignoring case');
  assert.equal(await resolveSession('claude', 'AUTH REFACTOR'), newer, 'ignoring case: the most recently used');
  assert.equal(await resolveSession('claude', 'billing'), renamed, 'the latest name counts');
  await assert.rejects(resolveSession('claude', 'nothing like it'), /no Claude Code session named "nothing like it"/);
  // Transcripts only grow: a later lookup reads just what was added, and sees a rename made since.
  writeFileSync(`${claudeDir}/${renamed}.jsonl`, `${transcript(renamed, ['auth refactor', 'billing'])}\n${JSON.stringify({ type: 'custom-title', customTitle: 'payments', sessionId: renamed })}\n`);
  assert.equal(await resolveSession('claude', 'payments'), renamed);
  await assert.rejects(resolveSession('claude', 'billing'), /no Claude Code session named "billing"/, 'renamed away');
  // With a workspace, its own project's sessions come first, even older ones.
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'council-ws-')));
  const local = 'aaaaaaaa-0000-4000-8000-000000000004';
  const localDir = `${fake.dir}/claude-home/projects/${workspace.replace(/[^A-Za-z0-9]/g, '-')}`;
  mkdirSync(localDir, { recursive: true });
  writeFileSync(`${localDir}/${local}.jsonl`, transcript(local, ['auth refactor']));
  const older2 = new Date(Date.now() - 120_000);
  utimesSync(`${localDir}/${local}.jsonl`, older2, older2);
  assert.equal(await resolveSession('claude', 'auth refactor', { workspace }), local, 'this project\'s session first');
  rmSync(localDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  assert.equal(await resolveSession('codex', 'auth refactor'), codexIds[1], 'the session most recently given that name');
  assert.equal(await resolveSession('codex', 'old work'), codexIds[0]);
  assert.equal(await resolveSession('codex', 'unlisted-thread'), 'unlisted-thread', 'Codex resolves other names itself');
  // By name, the session is resumed by its id, in its own folder.
  const result = JSON.parse(await invoke('debate', 'q', { claude_session_id: 'payments', codex_session_id: 'auth refactor', max_rounds: 1 }));
  assert.deepEqual(result.settings.sessions, { codex: codexIds[1], claude: renamed });
  assert.equal(result.settings.workspace, project);
  for (const call of fake.questionCalls()) {
    assert.equal(call.cwd, project);
    if (call.cli === 'claude') assert.equal(arg(call, '--resume'), renamed);
    else assert.equal(call.args.at(-2), codexIds[1]);
  }
});

test('with a workspace, both models run in the project folder: Codex read-only, Claude in plan mode', async () => {
  const workspace = realpathSync(fake.dir); // what the council passes (on macOS, /var is a link to /private/var)
  await askCodex('a', {}, { workspace });
  await askClaude('b', {}, { workspace });
  await askCodex('c', {}, { workspace });
  const [codex1, claude, codex2] = fake.questionCalls();
  for (const call of [codex1, claude, codex2]) assert.equal(call.cwd, workspace);
  assert.equal(arg(codex1, '-C'), workspace);
  assert.equal(arg(codex1, '--sandbox'), 'read-only');
  assert.ok(configValues(codex2).includes('sandbox_mode="read-only"'));
  assert.equal(arg(claude, '--permission-mode'), 'plan');
});

test('a session the user passes is continued in place, in the folder it was started in', async () => {
  const project = realpathSync(fake.dir);
  const claudeId = '11111111-2222-4333-8444-555555555555';
  const codexId = '019a0000-1111-7222-8333-444444444444';
  // Where the CLIs keep their transcripts, with the folder each session started in.
  mkdirSync(`${fake.dir}/claude-home/projects/-some-project`, { recursive: true });
  writeFileSync(`${fake.dir}/claude-home/projects/-some-project/${claudeId}.jsonl`, `${JSON.stringify({ type: 'summary' })}\n${JSON.stringify({ type: 'user', cwd: project })}\n`);
  mkdirSync(`${fake.dir}/codex-home/sessions/2026/09/25`, { recursive: true });
  writeFileSync(`${fake.dir}/codex-home/sessions/2026/09/25/rollout-2026-09-25T10-00-00-${codexId}.jsonl`, `${JSON.stringify({ type: 'session_meta', payload: { id: codexId, cwd: project } })}\n`);
  await withEnv({ CLAUDE_CONFIG_DIR: `${fake.dir}/claude-home`, CODEX_HOME: `${fake.dir}/codex-home` }, async () => {
    assert.equal(sessionFolder('claude', claudeId), project);
    assert.equal(sessionFolder('codex', codexId), project);
    assert.equal(sessionFolder('claude', '99999999-2222-4333-8444-555555555555'), null);
    const result = JSON.parse(await invoke('debate', 'q', { claude_session_id: claudeId, codex_session_id: codexId, max_rounds: 1 }));
    assert.equal(result.settings.workspace, project, 'the sessions\' folder is the workspace');
    assert.deepEqual(result.settings.sessions, { codex: codexId, claude: claudeId });
    for (const call of fake.questionCalls()) {
      assert.equal(call.cwd, project);
      if (call.cli === 'claude') assert.equal(arg(call, '--resume'), claudeId, 'every turn continues the user\'s session');
      else assert.deepEqual([call.args[1], call.args.at(-2)], ['resume', codexId]);
    }
    assert.ok(!fake.questionCalls().some(call => call.args.includes('--session-id') || call.args.includes('--fork-session')));
    fake.clearCalls();
    await invoke('ask_claude', 'q', { session_id: claudeId });
    assert.equal(arg(fake.questionCalls()[0], '--resume'), claudeId);
    // An explicit workspace wins over the session's own folder, so the CLI reads the project the prompt names.
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'council-other-')));
    fake.clearCalls();
    await invoke('ask_claude', 'q', { session_id: claudeId, workspace: other });
    assert.equal(fake.questionCalls()[0].cwd, other);
    assert.match(fake.questionCalls()[0].input, new RegExp(`working in the project at ${other.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
    rmSync(other, { recursive: true, force: true });
  });
  await assert.rejects(invoke('ask_claude', 'q', { session_id: 'not-a-uuid' }), /no Claude Code session named "not-a-uuid": pass its id \(from \/status\) or the name you gave it with \/rename/);
  await assert.rejects(invoke('council_ask', 'q', { codex_session_id: '../x' }), /no Codex session named "\.\.\/x"/);
  await assert.rejects(invoke('council_ask', 'q', { codex_session_id: '--last' }), /not a Codex session id or name/, 'never passed on as an option');
  await assert.rejects(invoke('ask_claude', 'q', { session_id: 'a\nb' }), /not a Claude Code session id or name/);
  await assert.rejects(invoke('ask_codex', 'q', { codex_session_id: 'x' }), /does not accept: codex_session_id/);
});

test('council_ask: by default both models sign the final answer; overrides reach every call on their side only', async () => {
  const answer = await invoke('council_ask', 'Which is better?', { codex_effort: 'low', claude_model: 'sonnet' });
  assert.match(answer, /^claude\[sonnet\|high\]/, 'Claude writes the final answer by default');
  assert.match(answer, /Codex \(ChatGPT\) and Claude both agree with this answer \(they converged after 1 exchange\)\.$/);
  const calls = fake.questionCalls();
  const codexCalls = calls.filter(c => c.cli === 'codex');
  const claudeCalls = calls.filter(c => c.cli === 'claude');
  assert.equal(codexCalls.length, 3, 'answer, exchange, check of the final answer');
  assert.equal(claudeCalls.length, 3, 'answer, exchange, final answer');
  for (const c of codexCalls) assert.ok(configValues(c).includes('model_reasoning_effort=low'));
  for (const c of claudeCalls) {
    assert.equal(c.args[c.args.indexOf('--model') + 1], 'sonnet');
    assert.equal(c.args[c.args.indexOf('--effort') + 1], 'high');
  }
});

test('debate returns both answers, every exchange, the final check and the settings used', async () => {
  const result = JSON.parse(await invoke('debate', 'Pick one', { claude_effort: 'max' }));
  assert.deepEqual(Object.keys(result).sort(), ['agreed', 'answer', 'claude', 'codex', 'converged', 'exchanges', 'rounds', 'settings']);
  assert.deepEqual(result.settings, {
    codex: { model: 'gpt-test', effort: 'xhigh' }, claude: { model: 'opus', effort: 'max' }, synthesizer: 'claude', max_rounds: 5, workspace: null, web_search: true, network: false, skill: null, sessions: { codex: null, claude: null },
  });
  assert.equal(result.agreed, true);
  assert.equal(result.converged, true);
  assert.match(result.answer, /^claude\[opus\|max\]/);
  assert.deepEqual(Object.keys(result.exchanges[0]), ['round', 'codex', 'claude', 'codex_agrees', 'claude_agrees']);
  assert.match(result.exchanges[0].codex, /^codex\[/);
  assert.equal(fake.questionCalls().filter(c => c.cli === 'claude').length, 3);
});

const NAME = { codex: 'Codex', claude: 'Claude' };
const OWN = ' Your own answer is earlier in this conversation: judge theirs on its merits, not on whether it matches yours.';
const callsOf = cli => fake.questionCalls().filter(c => c.cli === cli);

for (const synthesizer of ['claude', 'codex']) {
  test(`each model replies to the other's latest message in every exchange until both agree (${synthesizer} writes the final answer)`, () => withEnv(loopEnv({ FAKE_AGREE_AT: '3' }), async () => {
    const r = JSON.parse(await invoke('debate', 'q', { synthesizer }));
    assert.deepEqual(r.exchanges.map(e => [e.codex_agrees, e.claude_agrees]), [[false, false], [true, true]], 'no agreement in the first exchange, both in the second');
    // Each text came from the model it is filed under.
    for (const side of ['codex', 'claude']) {
      for (const text of [r[side], ...r.exchanges.map(e => e[side])]) assert.match(text, new RegExp(`^${side}\\[`));
    }
    // Each model works in one session, so every prompt carries only what it has not seen yet: the other's latest message.
    const verify = verifyNote(undefined, true);
    for (const [me, them] of [['codex', 'claude'], ['claude', 'codex']]) {
      const [answer, first, second, ...rest] = callsOf(me);
      assert.equal(answer.input, prompt('answer', { question: 'q', access: accessNote(undefined, true), self: NAME[me], other: NAME[them] }));
      assert.equal(first.input, prompt('exchange', { other: NAME[them], what: 'answer', other_text: r[them], verify, own: OWN }), `${me} replies to ${them}'s answer`);
      assert.equal(second.input, prompt('exchange', { other: NAME[them], what: 'reply to your last message', other_text: r.exchanges[0][them], verify, own: '' }),
        `${me} replies to ${them}'s reply`);
      assert.deepEqual(rest.map(c => c.input), me === synthesizer
        ? [prompt('draft', { other: NAME[them], other_text: r.exchanges[1][them] })]
        : [prompt('review', { other: NAME[them], context: `${NAME[them]}'s last message, which agreed with you:\n${r.exchanges[1][them]}\n`, draft: r.rounds[0].draft, notes: 'none', verify })]);
    }
    for (const call of fake.questionCalls().slice(2)) {
      assert.ok(call.cli === 'codex' ? call.args[1] === 'resume' : call.args.includes('--resume'), 'every step after the answers resumes its session');
    }
  }));
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
  const steps = [[], []];
  const [first, second] = await Promise.all([invoke('debate', 'first question', {}, { onProgress: m => steps[0].push(m) }),
    invoke('debate', 'second question', {}, { onProgress: m => steps[1].push(m) })]);
  assert.equal(JSON.parse(first).agreed, true);
  assert.equal(JSON.parse(second).agreed, true);
  assert.ok(!steps[0].some(m => m.startsWith('Waiting for')), 'the first council takes the sessions at once');
  assert.match(steps[1][0], /^Waiting for the (Claude|Codex \(ChatGPT\)) session: another council or question is using it/, 'the second says why it waits');
  for (const cli of ['codex', 'claude']) {
    // Each council's three turns in a session are consecutive: answer, exchange, then the final answer or its check.
    const turns = callsOf(cli).map(c => (c.input.startsWith('You are ') ? 'answer' : 'turn'));
    assert.deepEqual(turns, ['answer', 'turn', 'turn', 'answer', 'turn', 'turn'], cli);
  }
}));

test('a single question reports that the model is answering, or that it waits for the session first', () => withEnv({ FAKE_SLEEP_MS: '300' }, async () => {
  const steps = [[], []];
  await Promise.all([invoke('ask_claude', 'one', {}, { onProgress: m => steps[0].push(m) }), invoke('ask_claude', 'two', {}, { onProgress: m => steps[1].push(m) })]);
  assert.deepEqual(steps[0], ['Claude is answering']);
  assert.deepEqual(steps[1], ['Claude is answering', 'Waiting for the Claude session: another council or question is using it, and this one starts when it is free',
    'Claude is answering']);
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
  assert.equal(calls.length, 6);
  for (const call of calls) assert.equal(call.cwd, workspace);
  for (const cli of ['codex', 'claude']) {
    assert.ok(callsOf(cli)[0].input.includes(accessNote(workspace, true)));
    assert.match(accessNote(workspace, true), /working in the project at .*You are in plan mode: you cannot change anything/);
  }
  // Only a model that can read the project is asked to check claims against it.
  const checked = calls.filter(c => c.input.includes('VERDICT: AGREE or VERDICT: DISAGREE'));
  assert.equal(checked.length, 3, 'two exchange replies and one check of the final answer');
  for (const call of checked) assert.ok(call.input.includes(verifyNote(workspace, true)), call.input.slice(0, 60));
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
  assert.ok(!lastOf('claude').args.some(a => CLAUDE_WEB.includes(a)), 'Claude\'s web tools are not denied');
  assert.match(fake.questionCalls().find(c => c.input.startsWith('You are ')).input, /You can also search the web/);
  for (const turnOff of [() => invoke('council_ask', 'q', { web_search: false }), () => { fake.writeConfig({ web_search: false }); return invoke('council_ask', 'q'); }]) {
    fake.clearCalls();
    resetSessions();
    await turnOff();
    for (const call of fake.questionCalls().filter(c => c.cli === 'codex')) assert.ok(configValues(call).includes('web_search="disabled"'));
    for (const call of fake.questionCalls().filter(c => c.cli === 'claude')) {
      const denied = call.args.slice(call.args.indexOf('--disallowedTools') + 1);
      for (const tool of CLAUDE_WEB) assert.ok(denied.includes(tool), `${tool} is denied`);
    }
    assert.match(fake.questionCalls().find(c => c.input.startsWith('You are ')).input, /You have no internet access/);
  }
  fake.writeConfig();
  assert.equal(JSON.parse(await invoke('debate', 'q', { web_search: false })).settings.web_search, false);
  fake.clearCalls();
  await invoke('ask_claude', 'q', { web_search: false });
  assert.ok(fake.questionCalls()[0].args.includes('WebSearch'));
  await assert.rejects(invoke('council_ask', 'q', { web_search: 'yes' }), /web_search must be true or false/);
});

test('with a skill, both models get its instructions first, use it where a step needs it, and may use sub-agents', async () => {
  mkdirSync(`${fake.dir}/skills/test-skill`, { recursive: true });
  writeFileSync(`${fake.dir}/skills/test-skill/SKILL.md`, '---\nname: test-skill\ndescription: "A test skill."\n---\n\n# Test skill\nConsult five advisors.\n');
  const result = JSON.parse(await invoke('debate', 'q', { skill: 'test-skill', max_rounds: 1 }));
  assert.deepEqual(result.settings.skill, ['test-skill']);
  for (const cli of ['codex', 'claude']) {
    const [first, ...later] = callsOf(cli);
    assert.match(first.input, /^For this question, the "test-skill" skill is available; its instructions are below\. The user asked for this skill, so use it at the steps where it fits/);
    assert.match(first.input, /<skill name="test-skill">\n# Test skill\nConsult five advisors\.\n<\/skill>\n\nYou are /, 'the skill comes before the step prompt');
    assert.equal(later.length, 2, 'an exchange, then the final answer or its check');
    for (const call of later) assert.match(call.input, /^The "test-skill" skill is still available .*; use it for this step only if the step needs it\./);
    for (const call of later) assert.doesNotMatch(call.input, /Consult five advisors/, 'later steps do not resend the instructions');
  }
  assert.match(callsOf('codex').at(-1).input, /VERDICT: AGREE or VERDICT: DISAGREE/, 'the review keeps its verdict line');
  for (const call of callsOf('claude')) assert.ok(!call.args.includes('Agent'), 'Claude\'s own sub-agent tool is not denied');
  for (const call of callsOf('codex')) assert.equal(arg(call, '--enable'), 'multi_agent');
  fake.clearCalls();
  resetSessions();
  await invoke('council_ask', 'q');
  for (const call of callsOf('codex')) assert.ok(!call.args.includes('--enable'));
  assert.ok(!fake.questionCalls().some(c => c.input.includes('skill')), 'no skill text without a skill');
  fake.clearCalls();
  await invoke('ask_claude', 'q', { skill: 'test-skill' });
  assert.match(fake.questionCalls()[0].input, /^For this question, the "test-skill" skill is available[\s\S]*Consult five advisors[\s\S]*Answer this question concisely/);
  fake.clearCalls();
  await assert.rejects(invoke('council_ask', 'q', { skill: 'no-such-skill' }), /skill "no-such-skill" is not installed \(installed: test-skill\)/);
  assert.equal(fake.calls().length, 0, 'an unknown skill is rejected before any CLI runs');

  // Several skills: names separated by commas, or a list; each once, in the order given.
  mkdirSync(`${fake.dir}/skills/second-skill`, { recursive: true });
  writeFileSync(`${fake.dir}/skills/second-skill/SKILL.md`, '---\nname: second-skill\ndescription: "Another."\n---\n\nAnswer tersely.\n');
  resetSessions();
  const both = JSON.parse(await invoke('debate', 'q', { skill: 'test-skill, Second-Skill,test-skill', max_rounds: 1 }));
  assert.deepEqual(both.settings.skill, ['test-skill', 'second-skill']);
  for (const cli of ['codex', 'claude']) {
    const [first, ...later] = callsOf(cli);
    assert.match(first.input, /^For this question, the "test-skill" and "second-skill" skills are available; their instructions are below\./);
    assert.match(first.input, /<skill name="test-skill">[\s\S]*Consult five advisors[\s\S]*<skill name="second-skill">\nAnswer tersely\.\n<\/skill>\n\nYou are /);
    for (const call of later) assert.match(call.input, /^The "test-skill" and "second-skill" skills are still available .*; use them for this step only if the step needs them\./);
  }
  fake.clearCalls();
  await invoke('ask_codex', 'q', { skill: ['second-skill', 'test-skill'] });
  assert.match(fake.questionCalls()[0].input, /^For this question, the "second-skill" and "test-skill" skills are available/);
  fake.clearCalls();
  await assert.rejects(invoke('council_ask', 'q', { skill: ['test-skill', 'no-such-skill'] }), /skill "no-such-skill" is not installed/);
  await assert.rejects(invoke('council_ask', 'q', { skill: 5 }), /skill must be a skill name/);
  assert.equal(fake.calls().length, 0);

  // A skill installed for a member's own CLI is named, not sent: test-skill is Claude Code's own here, second-skill
  // the project's own for Codex (.agents/skills). The host of a council_join still gets every skill's instructions.
  const project = mkdtempSync(join(tmpdir(), 'council-project-'));
  mkdirSync(`${fake.dir}/claude-home/skills/test-skill`, { recursive: true });
  writeFileSync(`${fake.dir}/claude-home/skills/test-skill/SKILL.md`, '---\nname: test-skill\ndescription: "A test skill."\n---\n\nConsult five advisors.\n');
  mkdirSync(`${project}/.agents/skills/second-skill`, { recursive: true });
  writeFileSync(`${project}/.agents/skills/second-skill/SKILL.md`, '---\nname: second-skill\ndescription: "Another."\n---\n\nAnswer tersely.\n');
  try {
    resetSessions();
    await invoke('debate', 'q', { skill: 'test-skill, second-skill', max_rounds: 1, workspace: project });
    const [claudeFirst, ...claudeLater] = callsOf('claude');
    assert.match(claudeFirst.input, /^For this question, the "test-skill" and "second-skill" skills are available; "test-skill" is installed for you, so load it by name, as you load any of your skills; the instructions of "second-skill" are below\./);
    assert.ok(!claudeFirst.input.includes('Consult five advisors') && claudeFirst.input.includes('Answer tersely'));
    for (const call of claudeLater) assert.match(call.input, /^The "test-skill" and "second-skill" skills are still available \(as set out earlier in this conversation\)/);
    const codexFirst = callsOf('codex')[0];
    assert.match(codexFirst.input, /"second-skill" is installed for you[\s\S]*<skill name="test-skill">\n# Test skill\nConsult five advisors/);
    assert.ok(!codexFirst.input.includes('Answer tersely'));
    fake.clearCalls();
    await invoke('ask_claude', 'q', { skill: 'test-skill', workspace: project });
    assert.match(fake.questionCalls()[0].input, /^For this question, the "test-skill" skill is available; it is installed for you, so load it by name/);
    fake.clearCalls();
    resetSessions();
    const asked = [];
    const hostTurn = async message => {
      asked.push(message);
      return message.includes('---NOTES---') ? 'HOST DRAFT\n---NOTES---\nnone' : 'HOST TEXT';
    };
    await invoke('council_join', 'q', { me: 'claude', skill: 'test-skill', max_rounds: 1, workspace: project }, { hostTurn });
    assert.ok(asked[0].includes('<skill name="test-skill">\n# Test skill\nConsult five advisors'), 'the host gets the instructions');
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(`${fake.dir}/claude-home/skills`, { recursive: true, force: true });
  }
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

test('a Codex session that is open elsewhere or not saved yet is reported with the fix', async () => {
  const id = '019a0000-1111-7222-8333-444444444444';
  const failWith = error => ({ FAKE_FAIL: 'codex', FAKE_CODEX_ERROR: `Error: thread/resume: thread/resume failed: ${error} (code -32600)` });
  await withEnv(failWith(`thread ${id} already has an active writer`), async () => {
    await assert.rejects(askCodex('q', {}, { resume: id }), new RegExp(`Codex session ${id} is open in another Codex process.*Close that session`));
    await assert.rejects(askCodex('q'), /codex failed: .*active writer/, 'without a session id of the user\'s, the error is passed on');
  });
  await withEnv(failWith(`no rollout found for thread id ${id}`), () =>
    assert.rejects(askCodex('q', {}, { resume: id }), new RegExp(`Codex has not saved session ${id}.*codex resume`)));
});

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
import { councilText, readVerdict, splitDraft } from '../src/council.mjs';

const loopEnv = extra => ({ FAKE_STATE: joinPath(mkTemp(joinPath(tmp(), 'council-state-')), 'reviews'), ...extra });
const kinds = calls => calls.map(c => (c.input.startsWith('You are ') ? `answer:${c.cli}`
  : c.input.includes('Read it with an open mind') ? `exchange:${c.cli}`
    : c.input.includes('reviewed your draft and did not agree') ? `redraft:${c.cli}`
      : c.input.includes('has drafted a final answer') ? `review:${c.cli}`
        : c.input.includes(' now agree: in your last exchange') ? `draft:${c.cli}`
          : c.input.includes('ended without full agreement') ? `synthesize:${c.cli}` : `other:${c.cli}`));
// The steps after the exchanges, in order (the two replies of an exchange run at once, so their order varies).
const afterExchanges = calls => kinds(calls).filter(k => !k.startsWith('answer') && !k.startsWith('exchange'));

test('verdict and notes parsing', () => {
  assert.equal(readVerdict('fine\nVERDICT: AGREE'), true);
  assert.equal(readVerdict('**VERDICT:** DISAGREE'), false);
  assert.equal(readVerdict('verdict: agree\n...\nVERDICT - DISAGREE'), false, 'the last verdict wins');
  assert.equal(readVerdict('I agree with everything'), false, 'no verdict line means no agreement');
  assert.deepEqual(splitDraft('The answer.\n---NOTES---\nDropped X.'), { answer: 'The answer.', notes: 'Dropped X.' });
  assert.deepEqual(splitDraft('Only an answer'), { answer: 'Only an answer', notes: 'none' });
});

test('by default the exchange goes on until both agree, up to 5 exchanges; the config can change the limit', async () => {
  const agreed = JSON.parse(await invoke('debate', 'q'));
  assert.equal(agreed.agreed, true);
  assert.equal(agreed.settings.max_rounds, 5);
  assert.deepEqual(kinds(fake.questionCalls()).filter(k => k.startsWith('exchange')).sort(), ['exchange:claude', 'exchange:codex']);
  assert.deepEqual(afterExchanges(fake.questionCalls()), ['draft:claude', 'review:codex']);
  fake.writeConfig({ max_rounds: null });
  assert.equal(JSON.parse(await invoke('debate', 'q')).settings.max_rounds, null, 'null: one exchange');
  fake.writeConfig({ max_rounds: 2 });
  assert.equal(JSON.parse(await invoke('debate', 'q')).settings.max_rounds, 2);
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

test('max_rounds N stops the exchange as soon as both agree in the same exchange', () => withEnv(loopEnv({ FAKE_AGREE_AT: '5' }), async () => {
  const steps = [];
  const result = JSON.parse(await invoke('debate', 'q', { max_rounds: 5 }, { onProgress: m => steps.push(m) }));
  assert.equal(result.agreed, true);
  assert.deepEqual(result.exchanges.map(e => e.round), [1, 2, 3], 'they agree in the third exchange');
  assert.ok(steps.includes('Exchange 2 of 5: each model is replying to the other\'s latest reply'), JSON.stringify(steps));
  assert.ok(steps.includes('Exchange 3 of 5: Codex (ChatGPT) agrees, Claude agrees'), JSON.stringify(steps));
  assert.deepEqual(afterExchanges(fake.questionCalls()), ['draft:claude', 'review:codex']);
  assert.match(councilText(result), /they converged after 3 exchanges\)\.$/);
}));

// Codex replies fast and agrees at once; Claude takes longer and objects in the first exchange. Codex's agreement is not
// the end: the council waits for Claude, sends Codex the objection, and writes the final answer only after both agree.
test('one model agreeing does not end the exchange: the council waits for the slower one, which may still object', () => withEnv(loopEnv({
  FAKE_AGREE_AT_CODEX: '1', FAKE_AGREE_AT_CLAUDE: '3', FAKE_SLEEP_MS_CLAUDE: '400',
}), async () => {
  const steps = [];
  const result = JSON.parse(await invoke('debate', 'q', { max_rounds: 5 }, { onProgress: m => steps.push(m) }));
  assert.deepEqual(result.exchanges.map(e => [e.codex_agrees, e.claude_agrees]), [[true, false], [true, true]]);
  assert.ok(steps.includes('Exchange 1 of 5: Codex (ChatGPT) agrees, Claude does not agree yet'), JSON.stringify(steps));
  assert.equal(result.agreed, true);
  const calls = fake.questionCalls();
  const ends = new Map(readFileSync(`${fake.env.FAKE_LOG}.ends`, 'utf8').trim().split('\n').map(line => { const [id, at] = line.split(' '); return [id, Number(at)]; }));
  const exchanges = calls.filter(c => kinds([c])[0].startsWith('exchange'));
  const [first, second] = [exchanges.slice(0, 2), exchanges.slice(2)];
  // Exchange 2 starts only after Claude's slower reply in exchange 1 has ended, and Codex's prompt in it is Claude's objection.
  for (const call of second) for (const earlier of first) assert.ok(call.at >= ends.get(earlier.id), 'exchange 2 waits for both replies of exchange 1');
  assert.ok(second.find(c => c.cli === 'codex').input.includes(result.exchanges[0].claude), 'Codex is sent Claude\'s objection');
  // The final answer is drafted only after both replies of the agreeing exchange.
  const draft = calls.find(c => kinds([c])[0].startsWith('draft'));
  for (const call of second) assert.ok(draft.at >= ends.get(call.id), 'the final answer waits for both replies of the last exchange');
}));

test('max_rounds N stops at the limit without agreement, and the final answer sets out the points in dispute', () => withEnv(loopEnv({ FAKE_AGREE_AT: '0' }), async () => {
  const result = JSON.parse(await invoke('debate', 'q', { max_rounds: '3' }));
  assert.equal(result.exchanges.length, 3);
  assert.equal(result.converged, false);
  assert.equal(result.agreed, false);
  const calls = fake.questionCalls();
  assert.deepEqual(afterExchanges(calls), ['synthesize:claude'], 'no check: there is nothing agreed to check against');
  assert.equal(calls.at(-1).input, prompt('synthesize', { other: 'Codex', other_text: result.exchanges[2].codex, why: 'after 3 exchanges' }));
  assert.match(councilText(result), /did not fully agree after 3 exchanges \(the limit of 3 exchanges was reached\); the answer above sets out the points still in dispute\.$/);
}));

test('max_rounds 0 keeps the exchange going until both agree', () => withEnv(loopEnv({ FAKE_AGREE_AT: '13' }), async () => {
  const text = await invoke('council_ask', 'q', { max_rounds: 0 });
  assert.match(text, /both agree with this answer \(they converged after 7 exchanges\)/);
  assert.equal(kinds(fake.questionCalls()).filter(k => k.startsWith('exchange')).length, 14);
}));

test('a final answer the other model rejects is revised once, then reported with the objections', () => withEnv(loopEnv({ FAKE_FINAL: 'disagree' }), async () => {
  const result = JSON.parse(await invoke('debate', 'q'));
  assert.equal(result.converged, true);
  assert.equal(result.agreed, false);
  const calls = fake.questionCalls();
  assert.deepEqual(afterExchanges(calls), ['draft:claude', 'review:codex', 'redraft:claude', 'review:codex']);
  const [, , redraft, review2] = calls.slice(-4).map(c => c.input);
  assert.equal(redraft, prompt('redraft', { other: 'Codex', objections: result.rounds[0].review }), 'the redraft gets the objections');
  assert.equal(review2, prompt('review', { other: 'Claude', context: '', draft: result.rounds[1].draft, notes: 'none', verify: verifyNote(undefined, true) }),
    'a later check gets only the new draft: the checker\'s earlier objections are in its session');
  const text = councilText(result);
  assert.match(text, /converged after 1 exchange, but the final answer was not confirmed \(Codex \(ChatGPT\) did not accept the final text\)\.\n\nCodex \(ChatGPT\)'s remaining objections:\n.*final objection/);
  assert.ok(!/VERDICT/.test(text.split('remaining objections:')[1]), 'the verdict line is stripped from the objections');
}));

test('with council_join, the host takes part in every exchange and writes the final answer unless the caller names another synthesizer', () => withEnv(loopEnv({ FAKE_AGREE_AT: '1' }), async () => {
  const run = async options => {
    const asked = [];
    const hostTurn = async message => {
      asked.push(message.includes('Read it with an open mind') ? 'exchange' : message.includes('has drafted a final answer') ? 'review' : message.includes('---NOTES---') ? 'draft' : 'other');
      return { exchange: 'HOST VIEW\nVERDICT: AGREE', review: 'fine\nVERDICT: AGREE', draft: 'HOST DRAFT\n---NOTES---\nnone' }[asked.at(-1)] ?? 'HOST TEXT';
    };
    return { text: await invoke('council_join', 'q', { me: 'codex', ...options }, { hostTurn }), asked };
  };
  const hosted = await run({}); // the config's synthesizer is Claude, the other model here
  assert.match(hosted.text, /^HOST DRAFT/);
  assert.deepEqual(hosted.asked, ['other', 'exchange', 'draft'], 'the host answers, exchanges and writes; Claude checks');
  const named = await run({ synthesizer: 'claude' });
  assert.deepEqual(named.asked, ['other', 'exchange', 'review'], 'a named synthesizer wins: Claude writes, the host checks');
}));

test('the checker is the non-synthesizer', () => withEnv(loopEnv({ FAKE_AGREE_AT: '1' }), async () => {
  const result = JSON.parse(await invoke('debate', 'q', { max_rounds: 1, synthesizer: 'codex' }));
  assert.deepEqual([result.rounds[0].drafter, result.rounds[0].reviewer], ['codex', 'claude']);
  assert.equal(result.agreed, true);
}));

test('a failure in a later exchange ends the discussion with what was said; one in the check keeps the final answer', async () => {
  await withEnv(loopEnv({ FAKE_AGREE_AT: '0', FAKE_FAIL_REVIEW_AT: '3' }), async () => {
    const result = JSON.parse(await invoke('debate', 'q', { max_rounds: 0 }));
    assert.equal(result.exchanges.length, 1, 'the second exchange failed');
    assert.equal(result.agreed, false);
    assert.match(result.stopped_reason, /failed/);
    assert.match(result.answer, /^claude/, 'Claude still writes the final answer with the points in dispute');
    assert.match(councilText(result), /did not fully agree after 1 exchange \(stopped early: /);
  });
  fake.clearCalls();
  resetSessions();
  await withEnv(loopEnv({ FAKE_AGREE_AT: '1', FAKE_FAIL_REVIEW_AT: '3' }), async () => {
    const result = JSON.parse(await invoke('debate', 'q'));
    assert.equal(result.converged, true);
    assert.equal(result.agreed, false);
    assert.match(result.stopped_reason, /codex failed/);
    assert.match(result.answer, /^claude/, 'the final answer written before the check failed');
  });
  fake.clearCalls();
  resetSessions();
  await withEnv(loopEnv({ FAKE_FAIL_REVIEW_AT: '1' }), async () => {
    await assert.rejects(invoke('debate', 'q'), /failed/, 'a failure in the first exchange fails the council');
  });
});

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

// A session on another machine (user@host:session): the member runs there, through ssh, as this plugin's own command.
function fakeSsh() {
  const script = new URL('./fixtures/fake-ssh.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const path = join(fake.dir, process.platform === 'win32' ? 'ssh.cmd' : 'ssh');
  writeFileSync(path, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  fake.writeConfig({ ssh: { command: path } });
}
const sshCalls = () => fake.calls().filter(c => c.cli === 'ssh');

test('a session on another machine runs there through ssh: this plugin\'s command, the session as given, the prompt on stdin', async () => {
  fakeSsh();
  const answer = await invoke('ask_claude', 'Why does the order dialog close?', { session_id: "hamza@10.0.0.5:fix order's bugs", effort: 'low', web_search: false });
  assert.equal(answer, 'remote Why does the order dialog close?');
  const [call] = sshCalls();
  assert.deepEqual(call.args.slice(0, 3), ['-o', 'BatchMode=yes', 'hamza@10.0.0.5'], 'no password prompt, then the host');
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(call.args[3], `bash -lc '${[`'npx'`, `'-y'`, `'codex-claude-council@${version}'`, `'claude'`, `'--session'`, `'fix order'\\''s bugs'`, `'--effort'`, `'low'`, `'--no-web'`]
    .map(word => word.replace(/'/g, `'\\''`)).join(' ')}'`, 'every word quoted for the remote shell, a quote inside too');
  assert.match(call.input, /Why does the order dialog close\?/);
  assert.deepEqual(fake.questionCalls().filter(c => c.cli !== 'ssh'), [], 'no local CLI is run for it');
});

test('in a council, a remote member is checked on its own machine: only the local member\'s sign-in is checked here', () => withEnv({ FAKE_AGREE_AT: '1' }, async () => {
  fakeSsh();
  const result = JSON.parse(await invoke('debate', 'q', { claude_session_id: 'hamza@10.0.0.5:fix-order-dialog-bugs', max_rounds: 2 }));
  assert.equal(result.agreed, true);
  assert.ok(sshCalls().length >= 2, 'Claude\'s turns go through ssh');
  assert.ok(sshCalls().every(c => c.args[3].includes(`'\\''fix-order-dialog-bugs'\\''`)), 'every turn continues the same remote session');
  const local = fake.calls().filter(c => c.cli !== 'ssh');
  assert.ok(local.some(c => c.cli === 'codex' && c.args[0] === 'login'), 'Codex (local) is checked here');
  assert.ok(!local.some(c => c.cli === 'claude'), 'the local Claude CLI is not used at all');
}));

test('a remote member that cannot log in says how to set up ssh', async () => {
  fakeSsh();
  await withEnv({ FAKE_SSH_FAIL: 'hamza@10.0.0.5: Permission denied (publickey).' }, () => assert.rejects(
    invoke('ask_codex', 'q', { session_id: 'hamza@10.0.0.5:abc' }),
    /codex on hamza@10\.0\.0\.5 failed: .*Permission denied \(publickey\)\..*Set up key-based ssh to hamza@10\.0\.0\.5 first \(test: ssh -o BatchMode=yes hamza@10\.0\.0\.5 true\)/s,
  ));
});
