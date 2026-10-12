#!/usr/bin/env node
// The benchmark: every question to Codex alone, Claude alone and the council, graded against the answer key.
// It runs your own Codex and Claude Code CLIs, so it uses both plans: a council is several calls per question.
//
//   node bench/run.mjs --verify                   check the answer key by running every program (no models)
//   node bench/run.mjs [--effort low] [--only id,id] [--max-rounds 5]
//
// Each call starts fresh sessions (no member remembers another call) in an empty folder (no member can read the
// answer key), without web search. Results: a table on stdout and bench/results/<date>-<effort>.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resetSessions } from '../src/adapters.mjs';
import { invoke } from '../src/council.mjs';
import { QUESTIONS } from './questions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { effort: { type: 'string' }, only: { type: 'string' }, 'max-rounds': { type: 'string' }, verify: { type: 'boolean' } } });
const only = values.only ? new Set(values.only.split(',')) : null;
const questions = QUESTIONS.filter(q => !only || only.has(q.id));

/** What a program prints, its lines joined with single spaces. */
function runProgram(q) {
  const dir = mkdtempSync(join(tmpdir(), 'council-bench-'));
  try {
    const file = join(dir, q.lang === 'js' ? 'main.js' : 'main.py');
    writeFileSync(file, q.code);
    return execFileSync(q.lang === 'js' ? process.execPath : 'python', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const prompt = q => `What exactly does this ${q.lang === 'js' ? 'JavaScript program print when run with Node.js 24' : 'Python program print when run with Python 3.14'}? `
  + 'Reason it through without running any code. End your answer with exactly one line: '
  + 'FINAL: <everything it prints, its lines joined with single spaces>\n\n'
  + `\`\`\`${q.lang === 'js' ? 'js' : 'python'}\n${q.code}\n\`\`\``;

/** The answer after the last FINAL:, without Markdown around it, its whitespace collapsed. */
export function finalAnswer(text) {
  const matches = [...String(text).matchAll(/FINAL\s*:\s*(.*)$/gim)];
  if (!matches.length) return null;
  return matches.at(-1)[1].replace(/^[\s`*"]+|[\s`*"]+$/g, '').replace(/\s+/g, ' ');
}

if (values.verify) {
  let wrong = 0;
  for (const q of questions) {
    const printed = runProgram(q);
    if (printed !== q.answer) wrong += 1;
    console.log(`${printed === q.answer ? 'ok   ' : 'WRONG'} ${q.id}${printed === q.answer ? '' : `: prints ${JSON.stringify(printed)}, key says ${JSON.stringify(q.answer)}`}`);
  }
  console.log(`${questions.length - wrong}/${questions.length} answers in the key match what the programs print`);
  process.exit(wrong ? 1 : 0);
}

const effort = values.effort;
const ENTRANTS = [
  ['codex', 'ask_codex', { ...(effort ? { effort } : {}), web_search: false }],
  ['claude', 'ask_claude', { ...(effort ? { effort } : {}), web_search: false }],
  ['council', 'council_ask', { ...(effort ? { codex_effort: effort, claude_effort: effort } : {}), ...(values['max-rounds'] ? { max_rounds: values['max-rounds'] } : {}), web_search: false }],
];
const results = [];
for (const [n, q] of questions.entries()) {
  const row = { id: q.id, expected: q.answer };
  for (const [who, tool, options] of ENTRANTS) {
    resetSessions();
    const started = Date.now();
    process.stderr.write(`[${n + 1}/${questions.length}] ${q.id}: ${who}… `);
    try {
      const text = await invoke(tool, prompt(q), options);
      const got = finalAnswer(text);
      row[who] = { ok: got === q.answer, got, seconds: Math.round((Date.now() - started) / 1000), ...(who === 'council' ? { agreed: /both agree with this answer/.test(text) } : {}) };
    } catch (error) {
      row[who] = { ok: false, error: error.message.split('\n')[0], seconds: Math.round((Date.now() - started) / 1000) };
    }
    process.stderr.write(`${row[who].ok ? 'right' : 'wrong'} (${row[who].seconds} s)\n`);
  }
  results.push(row);
}

const score = who => results.filter(r => r[who].ok).length;
const rescued = results.filter(r => r.council.ok && (!r.codex.ok || !r.claude.ok));
const lost = results.filter(r => !r.council.ok && (r.codex.ok || r.claude.ok));
const cell = entry => (entry.ok ? '✅' : `❌ ${entry.error ? `(error)` : `\`${entry.got ?? 'no FINAL line'}\``}`);
const lines = [
  `| Question | Expected | Codex alone | Claude alone | Council |`,
  `|---|---|---|---|---|`,
  ...results.map(r => `| ${r.id} | \`${r.expected}\` | ${cell(r.codex)} | ${cell(r.claude)} | ${cell(r.council)} |`),
  '',
  `**Right answers** (${questions.length} questions${effort ? `, effort ${effort}` : ''}): Codex alone ${score('codex')}, Claude alone ${score('claude')}, council ${score('council')}.`,
  `The council was right where at least one model alone was wrong: ${rescued.length} (${rescued.map(r => r.id).join(', ') || 'none'}).`,
  `The council was wrong where at least one model alone was right: ${lost.length} (${lost.map(r => r.id).join(', ') || 'none'}).`,
];
console.log(lines.join('\n'));
mkdirSync(join(HERE, 'results'), { recursive: true });
const file = join(HERE, 'results', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${effort ?? 'default'}.json`);
writeFileSync(file, `${JSON.stringify({ date: new Date().toISOString(), effort: effort ?? null, results }, null, 2)}\n`);
process.stderr.write(`Saved ${file}\n`);
