import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareRuns } from '../bench/compare.mjs';
import { CANARY, HARD } from '../bench/hard.mjs';
import { ROOT } from './helpers.mjs';

const row = (id, codex, claude, council) => ({ id, expected: 'x', codex, claude, council });
const BEFORE = {
  date: 'before', setup: { plugin: '0.14.0', codex_cli: 'codex-cli 0.164.0' },
  results: [
    row('a', { ok: true, seconds: 10 }, { ok: false, got: 'y', seconds: 4 }, { ok: true, seconds: 60, agreed: true, rounds: 1 }),
    row('b', { ok: true, seconds: 20 }, { ok: true, seconds: 6 }, { ok: true, seconds: 80, agreed: true, rounds: 2 }),
  ],
};
const AFTER = {
  date: 'after', setup: { plugin: '0.15.0', codex_cli: 'codex-cli 0.164.0' },
  results: [
    row('a', { ok: true, seconds: 12 }, { ok: true, seconds: 5 }, { ok: true, seconds: 50, agreed: true, rounds: 1 }),
    row('b', { ok: true, seconds: 18 }, { ok: true, seconds: 7 }, { ok: false, got: 'z', seconds: 90, agreed: false }),
    row('c', { ok: false, seconds: 1 }, { ok: false, seconds: 1 }, { ok: false, seconds: 1 }),
  ],
};

test('comparing two benchmark runs: regressions, fixes, scores, time, agreement and setup, on the questions both asked', () => {
  const { regressions, fixes, lines } = compareRuns(BEFORE, AFTER);
  assert.deepEqual(regressions, [{ id: 'b', who: 'council', got: 'z' }]);
  assert.deepEqual(fixes, [{ id: 'a', who: 'claude' }]);
  const text = lines.join('\n');
  assert.match(text, /^Compared on the 2 questions both runs asked/);
  assert.match(text, /\| Council: right answers \| 2 \| 1 \|/);
  assert.match(text, /\| Claude alone: right answers \| 1 \| 2 \|/);
  assert.match(text, /\| Codex alone: median seconds \| 15 \| 15 \|/);
  assert.match(text, /\| Council: agreed \| 2\/2 \| 1\/2 \|/);
  assert.match(text, /\| Council: median exchanges to agree \| 1\.5 \| 1 \|/);
  assert.match(text, /Setup changed: plugin: 0\.14\.0 → 0\.15\.0\./);
  assert.match(text, /\*\*Regressions\*\* \(right before, wrong now\): b \(Council: `z`\)\./);
  assert.equal(compareRuns(BEFORE, BEFORE).regressions.length, 0);
});

test('bench/run.mjs --compare compares two saved runs without models, and fails on a regression', () => {
  const dir = mkdtempSync(join(tmpdir(), 'council-bench-test-'));
  try {
    const [before, after] = ['before.json', 'after.json'].map(name => join(dir, name));
    writeFileSync(before, JSON.stringify(BEFORE));
    writeFileSync(after, JSON.stringify(AFTER));
    const compare = (a, b) => spawnSync(process.execPath, [join(ROOT, 'bench', 'run.mjs'), '--compare', a, b], { encoding: 'utf8' });
    const regressed = compare(before, after);
    assert.equal(regressed.status, 1);
    assert.match(regressed.stdout, /\*\*Regressions\*\*/);
    assert.equal(compare(before, before).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the canary set is six questions of the hard set', () => {
  assert.equal(new Set(CANARY).size, 6);
  for (const id of CANARY) assert.ok(HARD.some(q => q.id === id), id);
});
