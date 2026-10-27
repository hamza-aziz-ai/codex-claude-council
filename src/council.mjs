// The council: two independent answers, then an exchange in which each model replies to the other's latest message,
// round after round, until both agree; then one writes the final answer and the other checks it.
// Each model keeps one session (see adapters.mjs), so every prompt carries only what it has not seen yet.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { askClaude, askCodex, checkSessionRef, holdSessions, remoteInstalledSkills, remoteSession, requireBothSignedIn, resolveSession, sessionFolder } from './adapters.mjs';
import { PACKAGE_ROOT, loadConfig, resolveSide, sideName } from './config.mjs';
import { installedFor, loadSkills, skillNote } from './skills.mjs';

const COUNCIL_OPTIONS = ['codex_model', 'codex_effort', 'claude_model', 'claude_effort', 'synthesizer', 'max_rounds', 'workspace', 'web_search', 'network', 'skill',
  'codex_session_id', 'claude_session_id'];
export const TOOL_OPTIONS = Object.freeze({
  ask_codex: ['model', 'effort', 'workspace', 'web_search', 'network', 'skill', 'session_id'],
  ask_claude: ['model', 'effort', 'workspace', 'web_search', 'skill', 'session_id'],
  council_join: ['me', 'other_model', 'other_effort', 'other_session_id', 'synthesizer', 'max_rounds', 'workspace', 'web_search', 'network', 'skill'],
  council_ask: COUNCIL_OPTIONS,
  debate: COUNCIL_OPTIONS,
});
export const MAX_QUESTION_LENGTH = 12_000;
const LABEL = { codex: 'Codex (ChatGPT)', claude: 'Claude' };

/** Progress while a session is in use by another council or question (see holdSessions), which can take minutes. */
export const WAITING = 'Waiting for the ';
const waitingFor = (side, session) => `${WAITING}${LABEL[side]} session${session ? ` ${session}` : ''}: another council or question is using it, and this one starts when it is free`;
const SPEAKER = { codex: 'Codex', claude: 'Claude' }; // names used inside prompts
const OTHER = { codex: 'claude', claude: 'codex' };
const SIDES_ORDER = ['codex', 'claude'];
// After the models agree, how many times the final answer may be written before the other model accepts it.
const FINAL_ROUNDS = 2;

export function prompt(name, values) {
  const template = readFileSync(join(PACKAGE_ROOT, 'src', 'prompts', `${name}.txt`), 'utf8');
  return template.replace(/\$([a-z_]+)/g, (match, key) => (key in values ? String(values[key]) : match));
}

function checkQuestion(question) {
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_LENGTH) {
    throw new Error(`question must be 1 to ${MAX_QUESTION_LENGTH} characters`);
  }
  return question.trim();
}

/** undefined = not given (use the config); 0 = until both agree (no limit); N = at most N exchanges. */
export function parseMaxRounds(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number < 0) {
    throw new Error('max_rounds must be a whole number: 0 = until both agree, N = at most N exchanges (omit for the configured default)');
  }
  return number;
}

/** The project folder both models may read: an existing folder, given as an absolute path. */
export function checkWorkspace(value) {
  if (!isAbsolute(value)) throw new Error(`workspace must be an absolute path to the project folder (got ${JSON.stringify(value)})`);
  let real;
  try { real = realpathSync(value); } catch { throw new Error(`workspace not found: ${value}`); }
  if (!statSync(real).isDirectory()) throw new Error(`workspace is not a folder: ${value}`);
  return real;
}

/**
 * What the host is told about its access when it takes part itself (council_join): it works with its own
 * tools, so nothing blocks its writes; it is asked not to change anything while the discussion runs.
 */
export function hostAccessNote(workspace, web = false) {
  const files = workspace
    ? `You are working in the project at ${workspace}. Read it to check facts before relying on them. Do not change any files while this discussion runs: describe any change you propose instead of making it.`
    : 'Work from what you know and the text you are given. Do not change any files while this discussion runs.';
  return files + (web ? ' Where you can search the web, use it for facts that change or that you are unsure of, and say where a fact came from.' : '');
}

/**
 * What a member is told of the skills: those installed for its own CLI are named (it loads them itself), the others'
 * instructions are sent. A member on another machine is asked what is installed there, and is not pointed at this
 * machine's skill folders, which it cannot read.
 */
async function skillsFor(side, skills, workspace, session, { config, signal }) {
  if (!skills.length) return { skills, own: new Set() };
  // A member through the API has no skill folders of its own and can read only the project: it gets every skill's text.
  if (config[side]?.via === 'api') return { skills: skills.map(({ dir, ...skill }) => skill), own: new Set() };
  if (!remoteSession(session)) return { skills, own: installedFor(side, skills, workspace) };
  return { skills: skills.map(({ dir, ...skill }) => skill), own: await remoteInstalledSkills(side, session, skills.map(skill => skill.name), { config, signal }) };
}

/**
 * The workspace: the one given, else the folder of a session the user passed (the first found of those
 * given), else none.
 */
function workspaceFor(workspace, sessions) {
  if (workspace) return workspace;
  for (const side of ['claude', 'codex']) {
    const folder = sessions[side] && sessionFolder(side, sessions[side]);
    if (folder) {
      try { return checkWorkspace(folder); } catch { /* the folder is gone */ }
    }
  }
  return undefined;
}

/**
 * What Codex is told when its commands may reach the network (network: true). On Windows the sandbox
 * account has no credentials for Windows' own TLS, so HTTPS from curl.exe, Invoke-WebRequest and git
 * fails there, while Python and Node work (checked with the real CLI).
 */
export function networkNote(domains = []) {
  const where = domains.length ? `, but only to these domains: ${domains.join(', ')}` : '';
  const windows = process.platform === 'win32'
    ? ' On this Windows machine, HTTPS from curl.exe, Invoke-WebRequest and git fails in your sandbox; use Python or Node for HTTPS.'
    : '';
  return ` Your commands can also reach the network${where}: use it to fetch live data the question needs, such as an API response or a page. You still cannot change any files.${windows}`;
}

/** What a model is told about its access, in its first prompt for each question. */
export function accessNote(workspace, web = false, api = false) {
  const files = api
    ? (workspace
      ? `You are working in the project at ${workspace}. Read it to check facts before relying on them, with your read-only tools: list_files, read_file and search. You cannot run commands or change anything, so describe any change you propose instead of making it. Reuse what you already read earlier in this conversation, but re-read files that matter, since the user may have changed them since.`
      : 'No folder was given for this question: work from the text you are given. You cannot change anything.')
    : workspace
    ? `You are working in the project at ${workspace}. Read it to check facts before relying on them: open files, search, and run read-only commands such as git log, diff, show and blame. You are in plan mode: you cannot change anything (edits and writes are blocked), so describe any change you propose instead of making it. Reuse what you already read earlier in this conversation, but re-read files that matter, since the user may have changed them since.`
    : 'No folder was given for this question: work from the text you are given. You are in plan mode: you cannot change anything.';
  const internet = web
    ? ' You can also search the web and read web pages: use them for facts that change or that you are unsure of (versions, APIs, docs, error messages), prefer primary sources such as official documentation, and say where a fact came from.'
    : ' You have no internet access.';
  return files + internet;
}

/** A sentence asking a model to check claims against what it can reach: the project and/or the web. */
export function verifyNote(workspace, web = false) {
  const sources = [workspace && 'the project', web && 'reliable sources on the web'].filter(Boolean).join(' or ');
  return sources ? ` Where it matters, check claims against ${sources} rather than assuming.` : '';
}

function checkOptions(tool, options) {
  const allowed = TOOL_OPTIONS[tool];
  const unknown = Object.keys(options).filter(key => !allowed.includes(key)).sort();
  if (unknown.length) throw new Error(`${tool} does not accept: ${unknown.join(', ')} (allowed: ${allowed.join(', ')})`);
  const clean = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === 'max_rounds') {
      const rounds = parseMaxRounds(value);
      if (rounds !== undefined) clean.max_rounds = rounds;
      continue;
    }
    if (key === 'web_search' || key === 'network') {
      if (value === undefined || value === null) continue;
      if (typeof value !== 'boolean') throw new Error(`${key} must be true or false`);
      clean[key] = value;
      continue;
    }
    if (value === undefined || value === null) continue;
    if (key === 'skill') {
      const names = loadSkills(value).map(skill => skill.name);
      if (names.length) clean.skill = names;
      continue;
    }
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (!value.trim()) continue;
    if (key === 'workspace') {
      clean.workspace = checkWorkspace(value.trim());
      continue;
    }
    if (key.endsWith('session_id')) {
      const side = key === 'session_id' ? tool.slice(4) : key === 'other_session_id' ? OTHER[sideName(options.me)] : key.split('_')[0];
      if (!side) throw new Error('me must be "claude" or "codex": the model you are');
      clean[key] = checkSessionRef(side, value);
      continue;
    }
    if (key === 'me') {
      clean.me = sideName(value);
      if (!clean.me) throw new Error('me must be "claude" or "codex": the model you are');
      continue;
    }
    if (key === 'synthesizer') {
      clean.synthesizer = sideName(value);
      if (!clean.synthesizer) throw new Error('synthesizer must be "claude" or "codex" (ChatGPT)');
      continue;
    }
    clean[key] = value.trim();
  }
  return clean;
}

// Run tasks together; if one fails, stop the others instead of waiting for their answers.
async function together(signal, tasks) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  const running = tasks.map(task => task(controller.signal));
  try {
    return await Promise.all(running);
  } catch (error) {
    controller.abort();
    await Promise.allSettled(running); // let the stopped calls finish exiting, so no process outlives the council
    throw error;
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

/** The reviewer's verdict: the last "VERDICT: AGREE|DISAGREE" line. A missing verdict counts as disagreement. */
export function readVerdict(text) {
  const verdicts = [...String(text).matchAll(/VERDICT\s*[:-]\s*\**\s*(AGREE|DISAGREE)\b/gi)];
  return verdicts.length > 0 && verdicts.at(-1)[1].toUpperCase() === 'AGREE';
}

const withoutVerdict = text => String(text).replace(/^.*VERDICT\s*[:-]\s*\**\s*(AGREE|DISAGREE)\b.*$/gim, '').trim();

/** Split a draft into the answer and the drafter's notes to the reviewer. */
export function splitDraft(text) {
  const [answer, ...rest] = String(text).split(/^[ \t]*-{3,}[ \t]*NOTES[ \t]*-{3,}[ \t]*$/im);
  return { answer: answer.trim() || String(text).trim(), notes: rest.join('\n').trim() || 'none' };
}

/**
 * codex / claude: optional { model, effort } overrides for that side.
 * maxRounds: 0 for no limit, N for at most N exchanges; default from config (null there = one exchange).
 * synthesizer: "claude" or "codex" writes the final answer, which the other checks; default from config.
 * workspace: the project folder both models work in and may read (never write); default: the folder of a
 * session passed in sessions, else none.
 * webSearch: whether both models may search the web; default from config.
 * network: whether Codex's commands may reach the network (still read-only on disk); default from config.
 * skill: installed skills both models may use at the steps that need them: a name, names separated by commas, a list
 * of names, or undefined for none.
 * sessions: { codex, claude }, ids of sessions the user started, continued in place instead of new ones.
 * host: { side, turn(prompt, signal) -> text } when the caller takes part itself as that side (council_join):
 * its turns are handed to it instead of to a CLI, and only the other side runs a CLI session.
 */
export async function debate(question, { codex = {}, claude = {}, maxRounds, synthesizer, workspace, webSearch, network, skill: skillName, sessions = {}, host } = {}, { signal, onProgress } = {}) {
  question = checkQuestion(question);
  workspace = workspace === undefined || workspace === null ? undefined : checkWorkspace(workspace);
  sessions = {
    codex: sessions.codex && await resolveSession('codex', sessions.codex, { workspace }),
    claude: sessions.claude && await resolveSession('claude', sessions.claude, { workspace }),
  };
  workspace = workspaceFor(workspace, sessions);
  const config = loadConfig();
  maxRounds = parseMaxRounds(maxRounds) ?? config.max_rounds ?? undefined;
  const writer = synthesizer === undefined ? config.synthesizer : sideName(synthesizer);
  if (!writer) throw new Error('synthesizer must be "claude" or "codex" (ChatGPT)');
  const settings = { codex: resolveSide('codex', codex, config), claude: resolveSide('claude', claude, config) };
  if (host) settings[host.side] = { host: true };
  const cliSides = SIDES_ORDER.filter(side => side !== host?.side);
  const web = webSearch ?? config.web_search;
  const net = network ?? config.network;
  const skills = loadSkills(skillName);
  const skill = skills.length > 0;
  // With skills, the first prompt of the question carries their instructions and each later step says they are still available.
  // A skill installed for a member's own CLI is named instead, and the member loads it itself. The host gets every skill's
  // instructions: a desktop app may not load the skills installed for the CLI.
  const told = Object.fromEntries(await Promise.all(SIDES_ORDER.map(async side => [side, side === host?.side ? { skills, own: new Set() }
    : await skillsFor(side, skills, workspace, sessions[side], { config, signal })])));
  const withSkill = (side, text, first = false) => skillNote(told[side].skills, first, told[side].own) + text;
  const task = {
    codex: text => s => askCodex(text, settings.codex, { config, signal: s, workspace, web, network: net, skill, resume: sessions.codex, held: true }),
    claude: text => s => askClaude(text, settings.claude, { config, signal: s, workspace, web, skill, resume: sessions.claude, held: true }),
  };
  if (host) task[host.side] = text => s => host.turn(text, s);
  // The council holds the CLI sessions from start to finish (see holdSessions).
  const held = cliSides.map(side => ({ side, workspace, model: settings[side].model, resume: sessions[side] }));
  return holdSessions(held, async () => {
    const ask = async (side, text) => (await together(signal, [task[side](text)]))[0];
    const progress = message => onProgress?.(message);

    // Both models at once; build(me, them) writes each side's prompt. Results come back by side.
    const bothSides = async build => {
      const [codexText, claudeText] = await together(signal, [task.codex(build('codex', 'claude')), task.claude(build('claude', 'codex'))]);
      return { codex: codexText, claude: claudeText };
    };

    progress(host ? `Checking that ${LABEL[cliSides[0]]} is signed in` : 'Checking that Codex and Claude Code are both signed in');
    // A member on another machine is checked there, on each of its turns.
    const localSides = cliSides.filter(side => !remoteSession(sessions[side]));
    if (localSides.length) await requireBothSignedIn(config, { signal, sides: localSides });

    // Each step sends a model only what it has not seen: its own earlier turns are in its session.
    progress('Codex (ChatGPT) and Claude are answering independently');
    const viaApi = side => config[side]?.via === 'api';
    const access = side => (side === host?.side ? hostAccessNote(workspace, web)
      : accessNote(workspace, web, viaApi(side)) + (side === 'codex' && net && !viaApi(side) ? networkNote(config.network_domains) : ''));
    const answers = await bothSides((me, them) => withSkill(me, prompt('answer', { question, access: access(me), self: SPEAKER[me], other: SPEAKER[them] }), true));
    const verify = verifyNote(workspace, web);

    // The exchange: each model gets the other's latest message (first its answer, then its replies) and replies to it,
    // with its current position and a verdict. They go on until both agree in the same exchange, or up to the limit.
    const limit = maxRounds ?? 1;
    const of = limit === 0 ? '' : ` of ${limit}`;
    const exchanges = [];
    let latest = answers;
    let stoppedReason = null;
    for (let round = 1; limit === 0 || round <= limit; round += 1) {
      progress(`Exchange ${round}${of}: each model is replying to the other's ${round === 1 ? 'answer' : 'latest reply'}`);
      let said;
      try {
        said = await bothSides((me, them) => withSkill(me, prompt('exchange', {
          other: SPEAKER[them], what: round === 1 ? 'answer' : 'reply to your last message', other_text: latest[them], verify,
          own: round === 1 ? ' Your own answer is earlier in this conversation: judge theirs on its merits, not on whether it matches yours.' : '',
        })));
      } catch (error) {
        // After a first exchange, a failure (for example a usage limit) ends the discussion with what was said so far.
        if (signal?.aborted || round === 1) throw error;
        stoppedReason = error.message;
        break;
      }
      const agrees = { codex: readVerdict(said.codex), claude: readVerdict(said.claude) };
      exchanges.push({ round, codex: said.codex, claude: said.claude, codex_agrees: agrees.codex, claude_agrees: agrees.claude });
      latest = said;
      const stance = side => `${LABEL[side]} ${agrees[side] ? 'agrees' : 'does not agree yet'}`;
      progress(`Exchange ${round}${of}: ${stance('codex')}, ${stance('claude')}`);
      if (agrees.codex && agrees.claude) break;
    }
    const converged = !stoppedReason && exchanges.at(-1).codex_agrees && exchanges.at(-1).claude_agrees;
    const base = {
      codex: answers.codex, claude: answers.claude, exchanges, converged,
      settings: { ...settings, synthesizer: writer, max_rounds: maxRounds ?? null, workspace: workspace ?? null, web_search: web, network: net, skill: skill ? skills.map(s => s.name) : null,
        sessions: { codex: sessions.codex ?? null, claude: sessions.claude ?? null }, ...(host ? { host: host.side } : {}) },
    };
    const other = OTHER[writer];
    // Both latest positions: the answer when no final answer could be written.
    const positions = () => SIDES_ORDER.map(side => `${LABEL[side]}'s latest position:\n${withoutVerdict(latest[side])}`).join('\n\n');

    if (!converged) {
      progress(`${LABEL[writer]} is writing the final answer, with the points still in dispute`);
      const why = stoppedReason ? `stopped early: ${stoppedReason}` : `after ${exchanges.length} exchange${exchanges.length === 1 ? '' : 's'}`;
      try {
        const answer = await ask(writer, withSkill(writer, prompt('synthesize', { other: SPEAKER[other], other_text: latest[other], why })));
        return { answer, agreed: false, stopped_reason: stoppedReason, ...base };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { answer: positions(), agreed: false, stopped_reason: stoppedReason ?? error.message, ...base };
      }
    }

    // They agree: the synthesizer writes the final answer and the other checks that it matches what they agreed.
    const rounds = [];
    let draft = null;
    let notes = 'none';
    let objections = '';
    for (let round = 1; round <= FINAL_ROUNDS; round += 1) {
      try {
        progress(round === 1 ? `They agree: ${LABEL[writer]} is writing the final answer` : `${LABEL[writer]} is revising the final answer`);
        const text = await ask(writer, withSkill(writer, round === 1
          ? prompt('draft', { other: SPEAKER[other], other_text: latest[other] })
          : prompt('redraft', { other: SPEAKER[other], objections })));
        ({ answer: draft, notes } = splitDraft(text));
        progress(`${LABEL[other]} is checking the final answer`);
        // The checker has not seen the writer's last message yet; its own earlier objections are in its session.
        const context = round === 1 ? `${SPEAKER[writer]}'s last message, which agreed with you:\n${latest[writer]}\n` : '';
        const review = await ask(other, withSkill(other, prompt('review', { other: SPEAKER[writer], context, draft, notes, verify })));
        const agreed = readVerdict(review);
        rounds.push({ round, drafter: writer, reviewer: other, draft, notes, review, verdict: agreed ? 'agree' : 'disagree' });
        if (agreed) return { answer: draft, agreed: true, rounds, ...base };
        objections = review;
      } catch (error) {
        // Keep what was reached if a later call fails (for example a usage limit); cancelling still aborts.
        if (signal?.aborted) throw error;
        stoppedReason = error.message;
        break;
      }
    }
    return { answer: draft ?? positions(), agreed: false, rounds, stopped_reason: stoppedReason, ...base };
  }, { signal, onWait: (side, waiting) => waiting && onProgress?.(waitingFor(side, sessions[side])) });
}

/** Plain-text answer for council_ask and the terminal. */
export function councilText(result) {
  const exchanges = `${result.exchanges.length} exchange${result.exchanges.length === 1 ? '' : 's'}`;
  if (result.agreed) return `${result.answer}\n\n---\nCodex (ChatGPT) and Claude both agree with this answer (they converged after ${exchanges}).`;
  if (!result.converged) {
    const why = result.stopped_reason ? `stopped early: ${result.stopped_reason}` : `the limit of ${result.settings.max_rounds ?? 1} exchange${result.settings.max_rounds === 1 || result.settings.max_rounds === null ? '' : 's'} was reached`;
    return `${result.answer}\n\n---\nCodex (ChatGPT) and Claude did not fully agree after ${exchanges} (${why}); the answer above sets out the points still in dispute.`;
  }
  const checker = LABEL[OTHER[result.settings.synthesizer]];
  const last = result.rounds.at(-1);
  const why = result.stopped_reason ? `stopped early: ${result.stopped_reason}` : `${checker} did not accept the final text`;
  const objections = last && last.verdict === 'disagree' ? `\n\n${checker}'s remaining objections:\n${withoutVerdict(last.review)}` : '';
  return `${result.answer}\n\n---\nCodex (ChatGPT) and Claude converged after ${exchanges}, but the final answer was not confirmed (${why}).${objections}`;
}

/**
 * Entry point shared by the MCP server and the command line. Returns text.
 * hostTurn(prompt, signal) -> text: for council_join, how to hand the caller its turns.
 */
export async function invoke(tool, question, options = {}, { signal, onProgress, hostTurn } = {}) {
  if (!Object.hasOwn(TOOL_OPTIONS, tool)) throw new Error(`unknown tool: ${tool}`);
  question = checkQuestion(question);
  const clean = checkOptions(tool, options || {});
  // Sessions given by name are looked up once, here, so every later step has the id.
  for (const key of Object.keys(clean).filter(k => k.endsWith('session_id'))) {
    const side = key === 'session_id' ? tool.slice(4) : key === 'other_session_id' ? OTHER[clean.me] : key.split('_')[0];
    clean[key] = await resolveSession(side, clean[key], { workspace: clean.workspace });
  }
  if (tool === 'council_join') {
    if (!clean.me) throw new Error('council_join needs me: "claude" or "codex", the model you are');
    if (!hostTurn) throw new Error('council_join needs a host that takes turns (use it from Claude Code, Codex or a desktop app)');
    const other = OTHER[clean.me];
    // The host, which has the whole context, writes the final answer unless the caller names another synthesizer.
    const result = await debate(question, {
      [other]: { model: clean.other_model, effort: clean.other_effort }, maxRounds: clean.max_rounds, synthesizer: clean.synthesizer ?? clean.me,
      workspace: workspaceFor(clean.workspace, { [other]: clean.other_session_id }), webSearch: clean.web_search, network: clean.network, skill: clean.skill,
      sessions: { [other]: clean.other_session_id }, host: { side: clean.me, turn: hostTurn },
    }, { signal, onProgress });
    return councilText(result);
  }
  const own = tool.startsWith('ask_') ? { [tool.slice(4)]: clean.session_id } : { codex: clean.codex_session_id, claude: clean.claude_session_id };
  const workspace = workspaceFor(clean.workspace, own);
  const config = loadConfig();
  const web = clean.web_search ?? config.web_search;
  const net = tool === 'ask_codex' && (clean.network ?? config.network);
  const skills = loadSkills(clean.skill);
  if (tool === 'ask_codex' || tool === 'ask_claude') {
    const one = tool.slice(4);
    const told = await skillsFor(one, skills, workspace, clean.session_id, { config, signal });
    const api = config[one]?.via === 'api';
    const single = skillNote(told.skills, true, told.own) + prompt('ask', { question, access: accessNote(workspace, web, api) + (net && !api ? networkNote(config.network_domains) : '') });
    const answering = () => onProgress?.(`${LABEL[one]} is answering`);
    const singleOptions = { signal, workspace, web, network: net, skill: skills.length > 0, resume: clean.session_id,
      onWait: waiting => (waiting ? onProgress?.(waitingFor(one, clean.session_id)) : answering()) };
    answering();
    const ask = one === 'codex' ? askCodex : askClaude;
    return ask(single, { model: clean.model, effort: clean.effort }, singleOptions);
  }
  const side = name => ({ model: clean[`${name}_model`], effort: clean[`${name}_effort`] });
  const result = await debate(question,
    { codex: side('codex'), claude: side('claude'), maxRounds: clean.max_rounds, synthesizer: clean.synthesizer, workspace, webSearch: clean.web_search, network: clean.network, skill: clean.skill, sessions: own },
    { signal, onProgress });
  return tool === 'council_ask' ? councilText(result) : JSON.stringify(result, null, 2);
}
