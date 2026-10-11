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
 * The banner. Codex's prompt (>_) and Claude's spark each send out a line; the lines cross, cross again and meet
 * in one answer (◆), over COUNCIL shaded from Codex green to Claude orange. A narrow terminal gets a smaller one.
 */
export function banner(version) {
  const width = process.stdout.columns || 100;
  out('');
  for (const line of width >= 60 ? bigBanner(version) : smallBanner(version)) out(line);
  out('');
}

const CODEX_RGB = [16, 163, 127];
const CLAUDE_RGB = [217, 119, 87];
// The nearest of the 256 terminal colors (its 6x6x6 cube), which every color terminal shows.
const to256 = ([r, g, b]) => 16 + 36 * Math.round(r / 51) + 6 * Math.round(g / 51) + Math.round(b / 51);
const shade = t => paint(`38;5;${to256(CODEX_RGB.map((from, i) => from + (CLAUDE_RGB[i] - from) * t))}`);

// "COUNCIL" in the ANSI Shadow figlet font, letter by letter.
const LETTERS = {
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
};

function bigBanner(version) {
  const title = [...'COUNCIL'].reduce((rows, letter) => rows.map((row, i) => row + LETTERS[letter][i]), Array(6).fill(''));
  const span = title[0].length;
  // The emblem on a grid of [char, color] cells; its answer (◆, column 14) sits over the middle of the title.
  const grid = Array.from({ length: 13 }, () => Array.from({ length: 28 }, () => [' ', null]));
  const put = (row, col, text, color) => [...text].forEach((ch, i) => { grid[row][col + i] = [ch, color]; });
  const [X, L, W] = [c.codex, c.claude, c.bold];
  put(0, 1, 'Codex', X);
  put(0, 19, 'Claude', L);
  put(1, 0, '╭───────╮', X); put(2, 0, '│ >_    │', X); put(3, 0, '╰───────╯', X);
  put(1, 20, '╲ │ ╱', L); put(2, 20, '─ ● ─', L); put(3, 20, '╱ │ ╲', L);
  for (let k = 0; k < 5; k += 1) { put(4 + k, 9 + k, '╲', X); put(4 + k, 19 - k, '╱', L); }
  put(9, 14, '╳', W);
  put(10, 13, '╱', L); put(10, 15, '╲', X);
  put(11, 13, '╲', L); put(11, 15, '╱', X);
  put(12, 14, '◆', W); put(12, 17, 'one answer', c.dim);
  const indent = ' '.repeat(Math.floor(span / 2) - 14 + 2);
  const emblem = grid.map(row => `${indent}${row.map(([ch, color]) => (color ? color(ch) : ch)).join('')}`.trimEnd());
  const shaded = title.map(row => `  ${[...row].map((ch, i) => (ch === ' ' ? ch : shade(i / (span - 1))(ch))).join('')}`);
  const tagline = `${X('Codex (ChatGPT)')}  ${c.dim('×')}  ${L('Claude')}`;
  const motto = c.dim(`they reply to each other until they agree${version ? `  ·  v${version}` : ''}`);
  const pad = text => ' '.repeat(Math.max(2, 2 + Math.floor((span - visible(text)) / 2))) + text;
  return [...emblem, '', ...shaded, '', pad(tagline), pad(motto)];
}

function smallBanner(version) {
  const [X, L] = [c.codex, c.claude];
  return [
    `  ${X('>_')}  ${X('╲')} ${L('╱')}  ${L('●')}   ${c.bold('codex-claude-council')}${version ? c.dim(`  v${version}`) : ''}`,
    `       ${c.bold('╳')}       ${X('Codex (ChatGPT)')} ${c.dim('×')} ${L('Claude')}`,
    `      ${L('╱')} ${X('╲')}`,
    `      ${L('╲')} ${X('╱')}      ${c.dim('reply to each other until they agree')}`,
    `       ${c.bold('◆')}`,
  ];
}
