// The council: two independent answers, two cross-critiques, then either one synthesis
// (single pass) or a draft/review loop that runs until both models agree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askClaude, askCodex } from './adapters.mjs';
import { PACKAGE_ROOT, loadConfig, resolveSide } from './config.mjs';

const COUNCIL_OPTIONS = ['codex_model', 'codex_effort', 'claude_model', 'claude_effort', 'max_rounds'];
export const TOOL_OPTIONS = Object.freeze({
  ask_codex: ['model', 'effort'],
  ask_claude: ['model', 'effort'],
  council_ask: COUNCIL_OPTIONS,
  debate: COUNCIL_OPTIONS,
});
export const MAX_QUESTION_LENGTH = 12_000;
const LABEL = { codex: 'Codex (ChatGPT)', claude: 'Claude' };
const OTHER = { codex: 'claude', claude: 'codex' };

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

/** undefined = single pass; 0 = until both agree (no limit); N = at most N draft/review rounds. */
export function parseMaxRounds(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number < 0) {
    throw new Error('max_rounds must be a whole number: 0 = until both agree, N = at most N rounds (omit for a single pass)');
  }
  return number;
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
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (value.trim()) clean[key] = value.trim();
  }
  return clean;
}

// Run tasks together; if one fails, stop the others instead of waiting for them.
async function together(signal, tasks) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  try {
    return await Promise.all(tasks.map(task => task(controller.signal)));
  } catch (error) {
    controller.abort();
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
 * maxRounds: undefined for a single pass, 0 for no limit, N for at most N draft/review rounds.
 */
export async function debate(question, { codex = {}, claude = {}, maxRounds } = {}, { signal, onProgress } = {}) {
  question = checkQuestion(question);
  maxRounds = parseMaxRounds(maxRounds);
  const config = loadConfig();
  const settings = { codex: resolveSide('codex', codex, config), claude: resolveSide('claude', claude, config) };
  const task = {
    codex: text => s => askCodex(text, settings.codex, { config, signal: s }),
    claude: text => s => askClaude(text, settings.claude, { config, signal: s }),
  };
  const ask = async (side, text) => (await together(signal, [task[side](text)]))[0];
  const progress = message => onProgress?.(message);

  progress('Codex (ChatGPT) and Claude are answering independently');
  const first = prompt('answer', { question });
  const [codexAnswer, claudeAnswer] = await together(signal, [task.codex(first), task.claude(first)]);
  progress('Each model is critiquing the other');
  const [codexCritique, claudeCritique] = await together(signal, [
    task.codex(prompt('critique', { question, other_answer: claudeAnswer })),
    task.claude(prompt('critique', { question, other_answer: codexAnswer })),
  ]);
  const base = {
    codex: codexAnswer, claude: claudeAnswer, codex_critique: codexCritique, claude_critique: claudeCritique,
    settings: { ...settings, synthesizer: config.synthesizer, max_rounds: maxRounds ?? null },
  };
  const material = {
    question, codex_answer: codexAnswer, claude_answer: claudeAnswer,
    codex_critique: codexCritique, claude_critique: claudeCritique,
  };

  if (maxRounds === undefined) {
    progress(`${LABEL[config.synthesizer]} is writing the final answer`);
    return { answer: await ask(config.synthesizer, prompt('synthesize', material)), ...base };
  }

  // Agreement loop: the synthesizer drafts one joint answer, the other model reviews it.
  // The drafter endorses its own draft, so the reviewer's AGREE means both agree.
  const drafter = config.synthesizer;
  const reviewer = OTHER[drafter];
  const rounds = [];
  let draft = null;
  let notes = 'none';
  let objections = '';
  let stoppedReason = null;
  for (let round = 1; maxRounds === 0 || round <= maxRounds; round += 1) {
    const limit = maxRounds === 0 ? '' : ` of ${maxRounds}`;
    try {
      progress(`Round ${round}${limit}: ${LABEL[drafter]} is drafting the joint answer`);
      const text = await ask(drafter, round === 1 ? prompt('draft', material) : prompt('redraft', { question, draft, notes, objections }));
      ({ answer: draft, notes } = splitDraft(text));
      progress(`Round ${round}${limit}: ${LABEL[reviewer]} is reviewing the draft`);
      const review = await ask(reviewer, prompt('review', { question, draft, notes }));
      const agreed = readVerdict(review);
      rounds.push({ round, drafter, reviewer, draft, notes, review, verdict: agreed ? 'agree' : 'disagree' });
      progress(`Round ${round}${limit}: ${LABEL[reviewer]} ${agreed ? 'agrees' : 'disagrees'}`);
      if (agreed) return { answer: draft, agreed: true, rounds_run: rounds.length, rounds, ...base };
      objections = review;
    } catch (error) {
      // Keep the latest draft if a later call fails (for example a usage limit); cancelling still aborts.
      if (signal?.aborted || draft === null) throw error;
      stoppedReason = error.message;
      break;
    }
  }
  return { answer: draft, agreed: false, rounds_run: rounds.length, rounds, stopped_reason: stoppedReason, ...base };
}

/** Plain-text answer for council_ask and the terminal. */
export function councilText(result) {
  if (result.agreed === undefined) return result.answer;
  const reviewer = LABEL[OTHER[result.settings.synthesizer]];
  const rounds = `${result.rounds_run} round${result.rounds_run === 1 ? '' : 's'}`;
  if (result.agreed) return `${result.answer}\n\n---\nCodex (ChatGPT) and Claude both agree with this answer (${rounds}).`;
  const why = result.stopped_reason ? `stopped early: ${result.stopped_reason}` : `round limit of ${result.settings.max_rounds} reached`;
  const last = result.rounds.at(-1);
  const objections = last ? `\n\n${reviewer}'s remaining objections:\n${withoutVerdict(last.review)}` : '';
  return `${result.answer}\n\n---\nNot agreed after ${rounds} (${why}).${objections}`;
}

/** Entry point shared by the MCP server and the command line. Returns text. */
export async function invoke(tool, question, options = {}, { signal, onProgress } = {}) {
  if (!Object.hasOwn(TOOL_OPTIONS, tool)) throw new Error(`unknown tool: ${tool}`);
  question = checkQuestion(question);
  const clean = checkOptions(tool, options || {});
  if (tool === 'ask_codex') return askCodex(prompt('answer', { question }), clean, { signal });
  if (tool === 'ask_claude') return askClaude(prompt('answer', { question }), clean, { signal });
  const side = name => ({ model: clean[`${name}_model`], effort: clean[`${name}_effort`] });
  const result = await debate(question, { codex: side('codex'), claude: side('claude'), maxRounds: clean.max_rounds },
    { signal, onProgress });
  return tool === 'council_ask' ? councilText(result) : JSON.stringify(result, null, 2);
}
