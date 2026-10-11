// Terminal output for the installer, in the style of @clack/prompts: a rail of steps, boxed notes and a
// spinner, with no dependencies. Colors and the spinner only on a terminal (not when piped, or with NO_COLOR).
const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const paint = code => text => (tty ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const c = {
  dim: paint('2'), bold: paint('1'), green: paint('32'), yellow: paint('33'), red: paint('31'), cyan: paint('36'),
  codex: paint('38;5;36'), claude: paint('38;5;173'),
};
const out = line => process.stdout.write(`${line}\n`);
const visible = text => text.replace(/\x1b\[[0-9;]*m/g, '').length;
const RAIL = c.dim('│');

export const ui = {
  intro: text => out(`${c.dim('┌')}  ${c.bold(text)}`),
  gap: () => out(RAIL),
  ok: text => out(`${c.green('◇')}  ${text}`),
  info: text => out(`${c.cyan('●')}  ${text}`),
  warn: text => out(`${c.yellow('▲')}  ${text}`),
  fail: text => out(`${c.red('■')}  ${text}`),
  line: text => out(`${RAIL}  ${text}`),
  outro: text => out(`${c.dim('└')}  ${text}`),

  /** A boxed note: a title on the rail and lines in a frame, wrapped to the terminal's width. */
  note(title, lines) {
    const max = Math.max(40, (process.stdout.columns || 100) - 6);
    const body = lines.flatMap(line => wrap(line, max));
    const width = Math.max(visible(title) + 2, ...body.map(visible)) + 2;
    out(`${c.green('◇')}  ${c.bold(title)} ${c.dim(`${'─'.repeat(width - visible(title) - 1)}╮`)}`);
    out(`${RAIL}${' '.repeat(width + 2)}${RAIL}`);
    for (const line of body) out(`${RAIL}  ${line}${' '.repeat(width - visible(line))}${RAIL}`);
    out(`${RAIL}${' '.repeat(width + 2)}${RAIL}`);
    out(c.dim(`├${'─'.repeat(width + 2)}╯`));
  },

  /** Run work() with a spinner on the rail (on a terminal); the caller prints the outcome. */
  async spin(label, work) {
    if (!tty) return work();
    const frames = ['◒', '◐', '◓', '◑'];
    let i = 0;
    const draw = () => process.stdout.write(`\r\x1b[2K${c.cyan(frames[i++ % frames.length])}  ${label}`);
    draw();
    const timer = setInterval(draw, 120);
    try { return await work(); } finally { clearInterval(timer); process.stdout.write('\r\x1b[2K'); }
  },
};

// Greedy word wrap; a word longer than the width stays whole.
function wrap(line, max) {
  if (visible(line) <= max) return [line];
  const lines = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && visible(`${current} ${word}`) > max) { lines.push(current); current = `   ${word}`; } else current = current ? `${current} ${word}` : word;
  }
  return [...lines, current];
}

/**
 * The banner: Codex's line and Claude's line cross, cross again and meet in one answer, like a council.
 * Each row is [color, text] pieces: Codex in green, Claude in orange.
 */
export function banner(version) {
  const X = c.codex;
  const L = c.claude;
  const art = [
    [[X, '●'], [null, '           '], [L, '●']],
    [[null, ' '], [X, '╲'], [null, '         '], [L, '╱']],
    [[null, '  '], [X, '╲'], [null, '       '], [L, '╱']],
    [[null, '   '], [X, '╲'], [null, '     '], [L, '╱']],
    [[null, '    '], [X, '╲'], [null, '   '], [L, '╱']],
    [[null, '     '], [X, '╲'], [null, ' '], [L, '╱']],
    [[null, '      '], [c.bold, '╳']],
    [[null, '     '], [L, '╱'], [null, ' '], [X, '╲']],
    [[null, '     '], [L, '╲'], [null, ' '], [X, '╱']],
    [[null, '      '], [c.bold, '●']],
  ];
  const side = {
    2: c.bold('codex-claude-council') + (version ? c.dim(`  v${version}`) : ''),
    3: `${X('●')} Codex (ChatGPT)   ${L('●')} Claude`,
    5: c.dim('Both answer, then reply to each other'),
    6: c.dim('until they agree on one answer.'),
  };
  out('');
  art.forEach((pieces, row) => {
    const text = pieces.map(([color, piece]) => (color ? color(piece) : piece)).join('');
    out(`  ${text}${side[row] ? `${' '.repeat(16 - visible(text))}${side[row]}` : ''}`);
  });
  out('');
}
