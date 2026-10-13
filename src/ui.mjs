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
export async function banner(version) {
  const width = process.stdout.columns || 100;
  const image = (await sixelTerminal()) ? iconImage() : null;
  out('');
  for (const line of width >= 60 ? bigBanner(version, image) : smallBanner(version, image)) out(line);
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

// The icon (mcpb/icon.png) as a sixel image (real pixels), 440x440 px, about 44 columns wide, made with
//   chafa --format sixels --size 44x44 --polite on --animate off mcpb/icon.png > src/logos/icon.six
// Shown in terminals that draw sixel images; the others show the banner without it.
const SIXEL_COLS = 44;
function iconImage() {
  try { return readFileSync(new URL('./logos/icon.six', import.meta.url), 'utf8').trimEnd(); } catch { return null; }
}

/**
 * Does the terminal draw sixel images? Known terminals by their environment (Windows Terminal 1.22+, WezTerm, iTerm2,
 * Konsole, foot, mlterm). Otherwise the terminal is asked, which also works over ssh, where those variables don't
 * arrive: one that draws sixel images lists 4 in its reply to ESC [ c (DA1). COUNCIL_BANNER=image forces the image,
 * COUNCIL_BANNER=text turns it off.
 */
export async function sixelTerminal({ env = process.env, stdin = process.stdin, stdout = process.stdout, isTty = tty } = {}) {
  if (!isTty || env.COUNCIL_BANNER === 'text') return false;
  if (env.COUNCIL_BANNER === 'image') return true;
  if (env.TERM_PROGRAM === 'vscode') return false;
  if (env.WT_SESSION || env.KONSOLE_VERSION || ['WezTerm', 'iTerm.app'].includes(env.TERM_PROGRAM) || /^(foot|mlterm)/.test(env.TERM ?? '')) return true;
  return askSixel(stdin, stdout);
}

// ponytail: a terminal that never answers DA1 costs this wait once, at the start of the installer.
const DA1_WAIT_MS = 300;
function askSixel(stdin, stdout) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return Promise.resolve(false);
  return new Promise(resolve => {
    let reply = '';
    const done = result => {
      clearTimeout(timer);
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      resolve(result);
    };
    const onData = chunk => {
      reply += chunk;
      const answer = reply.match(/\x1b\[\?([\d;]*)c/);
      if (answer) done(answer[1].split(';').includes('4'));
    };
    const timer = setTimeout(() => done(false), DA1_WAIT_MS);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
    stdout.write('\x1b[c');
  });
}

// The icon centered on a column, as lines to print (none where the terminal does not draw it). The terminal moves
// the cursor below the image as it draws it, however many rows that takes at its font size; \r returns to the
// left edge, so the next line starts right under the image. Not in a terminal too narrow for it.
function icon(center, image) {
  if (!image || (process.stdout.columns || 100) < SIXEL_COLS + 2) return [];
  const col = Math.max(0, center - SIXEL_COLS / 2);
  return [`${col > 0 ? `\x1b[${col}C` : ''}${image}\r`];
}

function bigBanner(version, image) {
  const title = [...'COUNCIL'].reduce((rows, letter) => rows.map((row, i) => row + LETTERS[letter][i]), Array(6).fill(''));
  const span = title[0].length;
  const [X, L, G] = [c.codex, c.claude, c.gold];
  const shaded = title.map(row => `  ${[...row].map((ch, i) => (ch === ' ' ? ch : shade(i / (span - 1))(ch))).join('')}`);
  const tagline = `${c.bold(X('ChatGPT'))}  ${G('×')}  ${c.bold(L('Claude'))}`;
  const words = 'they discuss with each other until they agree';
  const motto = [...words].map((ch, i) => (ch === ' ' ? ch : shade(i / (words.length - 1))(ch))).join('') + (version ? c.dim(`  ·  v${version}`) : '');
  const pad = text => ' '.repeat(Math.max(2, 2 + Math.floor((span - visible(text)) / 2))) + text;
  return [...icon(2 + Math.floor(span / 2), image), ...shaded, '', pad(tagline), pad(motto)];
}

function smallBanner(version, image) {
  return [
    ...icon(2 + SIXEL_COLS / 2, image),
    `  ${c.bold('codex-claude-council')}${version ? c.dim(`  v${version}`) : ''}`,
    `  ${c.bold(c.codex('ChatGPT'))} ${c.gold('×')} ${c.bold(c.claude('Claude'))}  ${c.dim('they discuss with each other until they agree')}`,
  ];
}

/** Text shaded from Codex green to Claude orange, letter by letter. */
export function blend(text) {
  return [...text].map((ch, i, all) => (ch === ' ' ? ch : shade(i / Math.max(1, all.length - 1))(ch))).join('');
}
