// Compares two benchmark runs (result files from run.mjs): which answers went from right to wrong (regressions) or
// from wrong to right, and how scores, time, agreement and rounds moved, over the questions both runs asked.
const ENTRANTS = ['codex', 'claude', 'council'];
const LABEL = { codex: 'Codex alone', claude: 'Claude alone', council: 'Council' };

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const shown = value => (value === null || value === undefined ? '–' : String(value));

/** { regressions: [{ id, who, got }], fixes, lines }: the comparison of run `after` with the earlier run `before`. */
export function compareRuns(before, after) {
  const earlier = new Map(before.results.map(row => [row.id, row]));
  const pairs = after.results.filter(row => earlier.has(row.id)).map(row => [earlier.get(row.id), row]);
  const regressions = [];
  const fixes = [];
  for (const [old, now] of pairs) {
    for (const who of ENTRANTS) {
      if (old[who]?.ok && !now[who]?.ok) regressions.push({ id: now.id, who, got: now[who]?.error ? `error: ${now[who].error}` : now[who]?.got ?? null });
      if (!old[who]?.ok && now[who]?.ok) fixes.push({ id: now.id, who });
    }
  }
  const column = (rows, pick) => rows.map(pick);
  const olds = pairs.map(([old]) => old);
  const nows = pairs.map(([, now]) => now);
  const rate = rows => {
    const agreed = rows.filter(row => typeof row.council?.agreed === 'boolean');
    return agreed.length ? `${agreed.filter(row => row.council.agreed).length}/${agreed.length}` : null;
  };
  const lines = [
    `Compared on the ${pairs.length} questions both runs asked (${before.date ?? 'earlier run'} → ${after.date ?? 'this run'}).`,
    '',
    '| | Before | After |',
    '|---|---|---|',
    ...ENTRANTS.map(who => `| ${LABEL[who]}: right answers | ${column(olds, row => row[who]?.ok).filter(Boolean).length} | ${column(nows, row => row[who]?.ok).filter(Boolean).length} |`),
    ...ENTRANTS.map(who => `| ${LABEL[who]}: median seconds | ${shown(median(column(olds, row => row[who]?.seconds)))} | ${shown(median(column(nows, row => row[who]?.seconds)))} |`),
    `| Council: agreed | ${shown(rate(olds))} | ${shown(rate(nows))} |`,
    `| Council: median exchanges to agree | ${shown(median(column(olds, row => row.council?.rounds)))} | ${shown(median(column(nows, row => row.council?.rounds)))} |`,
  ];
  const changed = Object.keys({ ...before.setup, ...after.setup })
    .filter(key => JSON.stringify(before.setup?.[key]) !== JSON.stringify(after.setup?.[key]))
    .map(key => `${key}: ${shown(before.setup?.[key])} → ${shown(after.setup?.[key])}`);
  if (before.setup && after.setup) lines.push('', `Setup changed: ${changed.length ? changed.join('; ') : 'nothing'}.`);
  lines.push('', regressions.length
    ? `**Regressions** (right before, wrong now): ${regressions.map(r => `${r.id} (${LABEL[r.who]}: \`${r.got ?? 'no FINAL line'}\`)`).join(', ')}.`
    : 'No regressions: nothing right before is wrong now.');
  if (fixes.length) lines.push(`Now right, wrong before: ${fixes.map(f => `${f.id} (${LABEL[f.who]})`).join(', ')}.`);
  return { regressions, fixes, lines };
}
