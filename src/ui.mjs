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
 * The banner: the plugin's icon over COUNCIL shaded from Codex green to Claude orange. A narrow terminal gets a
 * smaller one.
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

// The icon (mcpb/icon.png) as a sixel image (real pixels), 220x220 px, about 22 columns by 11 rows, made with
//   chafa --format sixels --size 22x22 --polite on --animate off mcpb/icon.png > src/logos/icon.six
// Shown only in terminals known to draw sixel images (Windows Terminal 1.22+, WezTerm, iTerm2, Konsole, foot,
// mlterm); the others show the banner without it. COUNCIL_BANNER=text turns the image off.
const SIXEL_COLS = 22;
const SIXEL_ROWS = 11;
function iconImage() {
  const env = process.env;
  if (!tty || env.COUNCIL_BANNER === 'text' || env.TERM_PROGRAM === 'vscode') return null;
  if (!(env.WT_SESSION || env.KONSOLE_VERSION || ['WezTerm', 'iTerm.app'].includes(env.TERM_PROGRAM) || /^(foot|mlterm)/.test(env.TERM ?? ''))) return null;
  try { return readFileSync(new URL('./logos/icon.six', import.meta.url), 'utf8').trimEnd(); } catch { return null; }
}

// The icon centered on a column, as lines to print (none where the terminal does not draw it): reserve its rows
// first (so drawing never scrolls the screen under a saved cursor), draw it from the saved top-left corner, then
// move below it, and leave a blank line.
function icon(center) {
  const image = iconImage();
  if (!image) return [];
  const col = Math.max(0, center - SIXEL_COLS / 2);
  return [`${'\n'.repeat(SIXEL_ROWS)}\x1b[${SIXEL_ROWS}A\x1b7${col > 0 ? `\x1b[${col}C` : ''}${image}\x1b8\x1b[${SIXEL_ROWS - 1}B`, ''];
}

function bigBanner(version) {
  const title = [...'COUNCIL'].reduce((rows, letter) => rows.map((row, i) => row + LETTERS[letter][i]), Array(6).fill(''));
  const span = title[0].length;
  const [X, L, G] = [c.codex, c.claude, c.gold];
  const shaded = title.map(row => `  ${[...row].map((ch, i) => (ch === ' ' ? ch : shade(i / (span - 1))(ch))).join('')}`);
  const tagline = `${c.bold(X('ChatGPT'))}  ${G('×')}  ${c.bold(L('Claude'))}`;
  const words = 'they discuss with each other until they agree';
  const motto = [...words].map((ch, i) => (ch === ' ' ? ch : shade(i / (words.length - 1))(ch))).join('') + (version ? c.dim(`  ·  v${version}`) : '');
  const pad = text => ' '.repeat(Math.max(2, 2 + Math.floor((span - visible(text)) / 2))) + text;
  return [...icon(2 + Math.floor(span / 2)), ...shaded, '', pad(tagline), pad(motto)];
}

function smallBanner(version) {
  return [
    ...icon(2 + SIXEL_COLS / 2),
    `  ${c.bold('codex-claude-council')}${version ? c.dim(`  v${version}`) : ''}`,
    `  ${c.bold(c.codex('ChatGPT'))} ${c.gold('×')} ${c.bold(c.claude('Claude'))}  ${c.dim('they discuss with each other until they agree')}`,
  ];
}

/** Text shaded from Codex green to Claude orange, letter by letter. */
export function blend(text) {
  return [...text].map((ch, i, all) => (ch === ' ' ? ch : shade(i / Math.max(1, all.length - 1))(ch))).join('');
}
