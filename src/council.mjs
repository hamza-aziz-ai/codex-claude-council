// The council: two independent answers, two cross-critiques, one synthesis.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askClaude, askCodex } from './adapters.mjs';
import { PACKAGE_ROOT, loadConfig, resolveSide } from './config.mjs';

const COUNCIL_OPTIONS = ['codex_model', 'codex_effort', 'claude_model', 'claude_effort'];
export const TOOL_OPTIONS = Object.freeze({
  ask_codex: ['model', 'effort'],
  ask_claude: ['model', 'effort'],
  council_ask: COUNCIL_OPTIONS,
  debate: COUNCIL_OPTIONS,
});
export const MAX_QUESTION_LENGTH = 12_000;

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

function checkOptions(tool, options) {
  const allowed = TOOL_OPTIONS[tool];
  const unknown = Object.keys(options).filter(key => !allowed.includes(key)).sort();
  if (unknown.length) throw new Error(`${tool} does not accept: ${unknown.join(', ')} (allowed: ${allowed.join(', ')})`);
  const clean = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (value.trim()) clean[key] = value.trim();
  }
  return clean;
}

// Run both sides together; if one fails, stop the other instead of waiting for it.
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

/** codex / claude: optional { model, effort } overrides for that side. */
export async function debate(question, { codex = {}, claude = {} } = {}, { signal } = {}) {
  question = checkQuestion(question);
  const config = loadConfig();
  const settings = { codex: resolveSide('codex', codex, config), claude: resolveSide('claude', claude, config) };
  const askX = text => s => askCodex(text, settings.codex, { config, signal: s });
  const askC = text => s => askClaude(text, settings.claude, { config, signal: s });

  const first = prompt('answer', { question });
  const [codexAnswer, claudeAnswer] = await together(signal, [askX(first), askC(first)]);
  const [codexCritique, claudeCritique] = await together(signal, [
    askX(prompt('critique', { question, other_answer: claudeAnswer })),
    askC(prompt('critique', { question, other_answer: codexAnswer })),
  ]);
  const synthesis = prompt('synthesize', {
    question, codex_answer: codexAnswer, claude_answer: claudeAnswer,
    codex_critique: codexCritique, claude_critique: claudeCritique,
  });
  const [answer] = await together(signal, [(config.synthesizer === 'claude' ? askC : askX)(synthesis)]);
  return {
    answer, codex: codexAnswer, claude: claudeAnswer, codex_critique: codexCritique,
    claude_critique: claudeCritique, settings: { ...settings, synthesizer: config.synthesizer },
  };
}

/** Entry point shared by the MCP server and the command line. Returns text. */
export async function invoke(tool, question, options = {}, { signal } = {}) {
  if (!Object.hasOwn(TOOL_OPTIONS, tool)) throw new Error(`unknown tool: ${tool}`);
  question = checkQuestion(question);
  const clean = checkOptions(tool, options || {});
  if (tool === 'ask_codex') return askCodex(prompt('answer', { question }), clean, { signal });
  if (tool === 'ask_claude') return askClaude(prompt('answer', { question }), clean, { signal });
  const side = name => ({ model: clean[`${name}_model`], effort: clean[`${name}_effort`] });
  const result = await debate(question, { codex: side('codex'), claude: side('claude') }, { signal });
  return tool === 'council_ask' ? result.answer : JSON.stringify(result, null, 2);
}
