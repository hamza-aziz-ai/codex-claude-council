import { readFileSync } from 'node:fs';

// Terminal output for the installer, in the style of @clack/prompts: a rail of steps, boxed notes and a
// spinner, with no dependencies. Colors and the spinner only on a terminal (not when piped, or with NO_COLOR).
const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const paint = code => text => (tty ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const c = {
  dim: paint('2'), bold: paint('1'), green: paint('32'), yellow: paint('33'), red: paint('31'), cyan: paint('36'),
  codex: paint('38;5;36'), claude: paint('38;5;173'), gold: paint('1;38;5;220'), link: paint('38;5;110'),
};
const out = line => process.stdout.write(`${line}\n`);
const visible = text => text.replace(/\x1b\[[0-9;]*m/g, '').length;
const RAIL = c.dim('│');

export const ui = {
  intro: text => out(`${c.dim('┌')}  ${c.bold(text)}`),
  gap: () => out(RAIL),
  ok: text => out(`${c.green('◇')}  ${text}`),
  info: text => out(`${c.cyan('●')}  ${text}`),
  // A section heading in a host's color (c.codex, c.claude).
  section: (text, color = c.cyan) => out(`${color('●')}  ${c.bold(color(text))}`),
  warn: text => out(`${c.yellow('▲')}  ${text}`),
  fail: text => out(`${c.red('■')}  ${text}`),
  line: text => out(`${RAIL}  ${text}`),
  outro: text => out(`${c.dim('└')}  ${text}`),

  /** A boxed note: a title on the rail and lines in a frame, wrapped to the terminal's width. */
  note(title, lines) {
    const max = Math.max(40, (process.stdout.columns || 100) - 6);
    const body = lines.flatMap(line => wrap(line, max));
    const width = Math.max(visible(title) + 2, ...body.map(visible)) + 2;
    out(`${c.green('◇')}  ${c.gold(title)} ${c.dim(`${'─'.repeat(width - visible(title) - 1)}╮`)}`);
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
  const all = [...lines, current];
  // A color still open at the end of a line is closed there and reopened on the next, so it does not leak into the
  // frame and is not lost on the continuation.
  for (let i = 0; i < all.length - 1; i += 1) {
    const open = (all[i].match(/\x1b\[[0-9;]*m/g) ?? []).at(-1);
    if (open && open !== '\x1b[0m') { all[i] += '\x1b[0m'; all[i + 1] = all[i + 1].replace(/^( *)/, `$1${open}`); }
  }
  return all;
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

// The OpenAI and Claude logos as terminal text, made once with chafa from assets/logos/*.png (icons from
// @lobehub/icons, MIT), in full color and, for macOS Terminal (which has only 256 colors), in 256 colors:
//   chafa --format symbols --size 14x7 --symbols half+quad+space --dither none --color-extractor median -t 0.5
//     --work 9 --polite on --animate off --colors full assets/logos/openai.png > src/logos/openai.ans
//   (--colors 256 > openai-256.ans; the same for claude.png)
// Each is 7 lines of 14 columns. null when missing, and the text marks are drawn instead.
function logo(name) {
  const file = process.env.TERM_PROGRAM === 'Apple_Terminal' ? `${name}-256` : name;
  try {
    const lines = readFileSync(new URL(`./logos/${file}.ans`, import.meta.url), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.map(line => `${line}\x1b[0m${' '.repeat(Math.max(0, 14 - visible(line)))}`);
  } catch { return null; }
}

// The logos as sixel images (real pixels), 120x120 px, about 12 columns by 6 rows, made with
//   chafa --format sixels --size 12x12 --polite on --animate off assets/logos/openai.png > src/logos/openai.six
// Shown only in terminals known to draw sixel images (Windows Terminal 1.22+, WezTerm, iTerm2, Konsole, foot,
// mlterm); the others get the text logos. COUNCIL_BANNER=text turns the images off.
const SIXEL_ROWS = 6;
function sixelTerminal() {
  const env = process.env;
  if (!tty || env.COUNCIL_BANNER === 'text' || env.TERM_PROGRAM === 'vscode') return false;
  return Boolean(env.WT_SESSION || env.KONSOLE_VERSION || ['WezTerm', 'iTerm.app'].includes(env.TERM_PROGRAM) || /^(foot|mlterm)/.test(env.TERM ?? ''));
}
function sixel(name) {
  try { return readFileSync(new URL(`./logos/${name}.six`, import.meta.url), 'utf8').trimEnd(); } catch { return null; }
}
// Two images side by side, at columns left and right: reserve their rows first (so drawing never scrolls the
// screen under a saved cursor), draw each from the saved top-left corner, then move below them.
function imagesRow(left, right, [a, b]) {
  const at = col => (col > 0 ? `\x1b[${col}C` : '');
  return `${'\n'.repeat(SIXEL_ROWS)}\x1b[${SIXEL_ROWS}A\x1b7${at(left)}${a}\x1b8${at(right)}${b}\x1b8\x1b[${SIXEL_ROWS - 1}B`;
}

function bigBanner(version) {
  const title = [...'COUNCIL'].reduce((rows, letter) => rows.map((row, i) => row + LETTERS[letter][i]), Array(6).fill(''));
  const span = title[0].length;
  const [X, L, G] = [c.codex, c.claude, c.gold];
  // The middle of the emblem (column 21) sits over the middle of the title.
  const indent = 2 + Math.floor(span / 2) - 21;
  // The marks: Codex's on the left (centered on column 9), Claude's on the right (column 33): sixel images where
  // the terminal draws them, else the logos as text (which need colors), else a prompt box and a spark.
  const images = sixelTerminal() ? [sixel('openai'), sixel('claude')] : [];
  const [openai, claude] = tty ? [logo('openai'), logo('claude')] : [null, null];
  const label = (text, center) => ' '.repeat(center - Math.floor(text.length / 2)) + text;
  const labels = c.bold(X(label('ChatGPT', 9))) + c.bold(L(label('Claude', 33).slice(label('ChatGPT', 9).length)));
  const marks = images.length && images.every(Boolean) ? [imagesRow(indent + 3, indent + 27, images)]
    : openai && claude ? openai.map((line, i) => `  ${line}          ${claude[i]}`)
      : [`     ${X('╭───────╮')}                 ${L('╲ │ ╱')}`, `     ${X('│  >_   │')}                 ${L('─ ● ─')}`, `     ${X('╰───────╯')}                 ${L('╱ │ ╲')}`];
  // Below them, a line from each runs to the middle (column 21), and the two cross three times, each loop
  // narrower, before they meet in one answer. Each crossing is an exchange: where each takes in the other's reply.
  const grid = Array.from({ length: 15 }, () => Array.from({ length: 42 }, () => [' ', null]));
  const put = (row, col, text, color) => [...text].forEach((ch, i) => { grid[row][col + i] = [ch, color]; });
  put(0, 9, '╰──────╮', X); put(0, 26, '╭──────╯', L);
  for (let k = 0; k < 4; k += 1) { put(1 + k, 17 + k, '╲', X); put(1 + k, 25 - k, '╱', L); }
  const exchange = (row, n) => { put(row, 21, '╳', G); put(row, 26, '⇄', G); put(row, 28, `exchange ${n}`, c.dim); };
  exchange(5, 1);
  put(6, 22, '╲', X); put(6, 20, '╱', L);
  put(7, 23, '╲', X); put(7, 19, '╱', L);
  put(8, 23, '╱', X); put(8, 19, '╲', L);
  put(9, 22, '╱', X); put(9, 20, '╲', L);
  exchange(10, 2);
  put(11, 20, '╱', X); put(11, 22, '╲', L);
  put(12, 20, '╲', X); put(12, 22, '╱', L);
  exchange(13, 3);
  put(14, 21, '◆', G); put(14, 26, 'one answer', G);
  const emblem = [labels, ...marks, ...grid.map(row => row.map(([ch, color]) => (color ? color(ch) : ch)).join(''))]
    .map(line => `${' '.repeat(indent)}${line}`.trimEnd());
  const shaded = title.map(row => `  ${[...row].map((ch, i) => (ch === ' ' ? ch : shade(i / (span - 1))(ch))).join('')}`);
  const tagline = `${c.bold(X('ChatGPT'))}  ${G('×')}  ${c.bold(L('Claude'))}`;
  const words = 'they discuss with each other until they agree';
  const motto = [...words].map((ch, i) => (ch === ' ' ? ch : shade(i / (words.length - 1))(ch))).join('') + (version ? c.dim(`  ·  v${version}`) : '');
  const pad = text => ' '.repeat(Math.max(2, 2 + Math.floor((span - visible(text)) / 2))) + text;
  return [...emblem, '', ...shaded, '', pad(tagline), pad(motto)];
}

function smallBanner(version) {
  const [X, L] = [c.codex, c.claude];
  return [
    `  ${X('>_')}  ${X('╲')} ${L('╱')}  ${L('●')}   ${c.bold('codex-claude-council')}${version ? c.dim(`  v${version}`) : ''}`,
    `       ${c.gold('╳')}       ${c.bold(c.codex('ChatGPT'))} ${c.gold('×')} ${c.bold(c.claude('Claude'))}`,
    `      ${L('╱')} ${X('╲')}`,
    `      ${L('╲')} ${X('╱')}      ${c.dim('they discuss with each other until they agree')}`,
    `       ${c.gold('◆')}`,
  ];
}

/** Text shaded from Codex green to Claude orange, letter by letter. */
export function blend(text) {
  return [...text].map((ch, i, all) => (ch === ' ' ? ch : shade(i / Math.max(1, all.length - 1))(ch))).join('');
}
