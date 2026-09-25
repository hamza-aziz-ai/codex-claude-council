// Skills the council can use on request: skill folders the user installs into their own folder
// (~/.codex-claude-council/skills/<name>/SKILL.md, with any files the skill comes with). Nothing
// third-party ships with the plugin. Skills installed natively for Claude Code or Codex can be named too.
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { userConfigPath } from './config.mjs';

const MAX_SKILL_BYTES = 200_000; // one SKILL.md
const MAX_FOLDER_BYTES = 5_000_000; // a skill's folder; a larger one is installed as its SKILL.md alone
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SKILL_FILE = /^skill\.md$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build']);

export function skillsDir() {
  return join(dirname(userConfigPath()), 'skills');
}

/** name and description from a SKILL.md's frontmatter, and the instructions after it. */
export function parseSkill(text) {
  const match = String(text).replace(/^\uFEFF/, '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error('not a SKILL.md: it has no frontmatter (a block between --- lines at the top)');
  const field = key => {
    const line = match[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
    if (!line) return '';
    let value = line[1].trim();
    // A folded or literal block (description: >): the indented lines after it.
    if (/^[>|][+-]?$/.test(value)) {
      const rest = match[1].slice(match[1].indexOf(line[0]) + line[0].length).split('\n').slice(1);
      const block = [];
      for (const next of rest) { if (next.trim() && !/^\s/.test(next)) break; block.push(next.trim()); }
      value = block.join(' ').replace(/\s+/g, ' ').trim();
    }
    return value.replace(/^(["'])([\s\S]*)\1$/, '$2');
  };
  const name = field('name').toLowerCase();
  if (!NAME_PATTERN.test(name)) throw new Error(`the skill's name must be lowercase letters, digits, ".", "_" or "-" (got ${JSON.stringify(name)})`);
  return { name, description: field('description'), body: match[2].trim() };
}

function readSkillAt(path, origin) {
  const skill = parseSkill(readFileSync(path, 'utf8'));
  return { ...skill, path, dir: dirname(path), origin };
}

function skillsIn(root, origin) {
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  return names.sort().flatMap(name => {
    try { return [readSkillAt(join(root, name, 'SKILL.md'), origin)]; } catch { return []; }
  });
}

/** Skills installed for the council, by name. */
export function listSkills() {
  return skillsIn(skillsDir(), 'council');
}

/** Skills installed natively for Claude Code (~/.claude/skills) or Codex (~/.codex/skills, ~/.agents/skills). */
export function nativeSkills() {
  const roots = [
    join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills'),
    join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'),
    join(homedir(), '.agents', 'skills'),
  ];
  const seen = new Set(listSkills().map(skill => skill.name));
  return roots.flatMap(root => skillsIn(root, root)).filter(skill => !seen.has(skill.name) && seen.add(skill.name));
}

/** An installed skill by name: the council's own first, then a native one. */
export function loadSkill(name, { native = true } = {}) {
  const wanted = String(name || '').trim().toLowerCase();
  const all = [...listSkills(), ...(native ? nativeSkills() : [])];
  const skill = all.find(s => s.name === wanted);
  if (!skill) {
    const installed = all.map(s => s.name);
    throw new Error(`skill "${wanted}" is not installed${installed.length ? ` (installed: ${installed.join(', ')})` : ''}. `
      + 'Install one with: npx -y github:hamza-aziz-ai/codex-claude-council skill add <GitHub URL or SKILL.md path>');
  }
  return skill;
}

/** A GitHub repository URL's parts: clone URL, branch or tag (if any) and path inside the repository. */
export function parseGitHubUrl(url) {
  const match = String(url).trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(\/.*)?)?\/?$/);
  if (!match) return null;
  const [, owner, repo, ref = null, path = ''] = match;
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git`, ref, path: path.replace(/^\/+|\/+$/g, '') };
}

/** The raw URL of SKILL.md for a GitHub repository or file URL (used when git is not available). */
export function rawSkillUrl(url) {
  const parts = parseGitHubUrl(url);
  if (!parts) throw new Error(`not a GitHub repository URL: ${url}`);
  const file = parts.path.endsWith('.md') ? parts.path : [parts.path, 'SKILL.md'].filter(Boolean).join('/');
  return `https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${parts.ref || 'HEAD'}/${file}`;
}

/**
 * Every skill in a folder tree: each SKILL.md (any case) with valid frontmatter. A name found more than
 * once (a repository often keeps copies for other tools) is taken from the shallowest place outside
 * hidden folders.
 */
export function findSkills(root) {
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && SKILL_FILE.test(entry.name)) {
        try { found.push({ ...parseSkill(readFileSync(path, 'utf8')), file: path }); } catch { /* not a skill */ }
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && depth < 6) {
        walk(path, depth + 1);
      }
    }
  };
  walk(root, 0);
  const rank = skill => {
    const parts = relative(root, skill.file).split(sep);
    return [parts.some(part => part.startsWith('.')) ? 1 : 0, parts.length, skill.file];
  };
  const order = (a, b) => { const [x, y] = [rank(a), rank(b)]; return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : 1); };
  const byName = new Map();
  for (const skill of found.sort(order)) if (!byName.has(skill.name)) byName.set(skill.name, skill);
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

// The files of a skill's folder, without other skills' folders nested in it; null if over the size limit.
function folderFiles(dir) {
  const files = [];
  let total = 0;
  const walk = (current, top) => {
    const entries = readdirSync(current, { withFileTypes: true });
    if (!top && entries.some(entry => entry.isFile() && SKILL_FILE.test(entry.name))) return true; // another skill
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) { if (!walk(path, false)) return false; } else if (entry.isFile()) {
        total += statSync(path).size;
        if (total > MAX_FOLDER_BYTES) return false;
        files.push(path);
      }
    }
    return true;
  };
  return walk(dir, true) ? files : null;
}

// Install one skill found at file: its whole folder when the file is a SKILL.md, else the file alone.
function installFrom(skill, source, root) {
  const text = readFileSync(skill.file, 'utf8');
  if (Buffer.byteLength(text) > MAX_SKILL_BYTES) throw new Error(`${skill.name}: SKILL.md is larger than ${MAX_SKILL_BYTES / 1000} kB`);
  const dest = join(skillsDir(), skill.name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const folder = basename(skill.file) === 'SKILL.md' ? folderFiles(dirname(skill.file)) : null;
  for (const file of folder || []) {
    const target = join(dest, relative(dirname(skill.file), file));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  writeFileSync(join(dest, 'SKILL.md'), text);
  const from = root ? relative(root, skill.file).split(sep).join('/') : basename(skill.file);
  writeFileSync(join(dest, 'source.json'), `${JSON.stringify({ source, file: from, installed_at: new Date().toISOString() }, null, 2)}\n`);
  return { ...readSkillAt(join(dest, 'SKILL.md'), 'council'), files: folder ? folder.length : 1 };
}

function defaultClone(url, ref, dir) {
  return new Promise((resolve, reject) => {
    const args = ['clone', '--quiet', '--depth', '1', ...(ref ? ['--branch', ref] : []), url, dir];
    execFile('git', args, { timeout: 300_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(new Error(String(stderr || error.message).trim()), { code: error.code }));
      resolve();
    });
  });
}

/**
 * Install every skill in a GitHub repository (or one folder or file of it), a local folder, or a SKILL.md
 * file or raw URL. Each goes to its own folder, with the files it comes with. Returns the skills installed.
 */
export async function addSkill(source, { fetchText = defaultFetch, clone = defaultClone } = {}) {
  const github = /^https?:\/\//i.test(source) ? parseGitHubUrl(source) : null;
  if (/^https?:\/\//i.test(source) && !github) {
    return [installText(await fetchText(source), source)];
  }
  if (github) {
    const tmp = mkdtempSync(join(tmpdir(), 'council-skill-'));
    try {
      try {
        await clone(github.cloneUrl, github.ref, join(tmp, 'repo'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`could not download ${github.cloneUrl}: ${error.message}`);
        return [installText(await fetchText(rawSkillUrl(source)), source)]; // no git: the repository's SKILL.md only
      }
      return installAll(join(tmp, 'repo', ...github.path.split('/').filter(Boolean)), source, join(tmp, 'repo'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return installAll(resolve(source), source, null);
}

function installAll(path, source, root) {
  let stat;
  try { stat = statSync(path); } catch { throw new Error(`not found: ${source}`); }
  const skills = stat.isDirectory() ? findSkills(path) : [{ ...parseSkill(readFileSync(path, 'utf8')), file: path }];
  if (!skills.length) throw new Error(`no SKILL.md with a name and description found in ${source}`);
  return skills.map(skill => installFrom(skill, source, root ?? (stat.isDirectory() ? path : dirname(path))));
}

function installText(text, source) {
  if (Buffer.byteLength(text) > MAX_SKILL_BYTES) throw new Error(`SKILL.md is larger than ${MAX_SKILL_BYTES / 1000} kB`);
  const tmp = mkdtempSync(join(tmpdir(), 'council-skill-'));
  try {
    writeFileSync(join(tmp, 'skill.md'), text); // lowercase: install this file alone, not the temp folder
    return installFrom({ ...parseSkill(text), file: join(tmp, 'skill.md') }, source, null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function removeSkill(name) {
  const skill = loadSkill(name, { native: false });
  rmSync(skill.dir, { recursive: true, force: true });
  return skill;
}

async function defaultFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not download ${url}: HTTP ${response.status}`);
  return response.text();
}

/**
 * What a model is told when a skill is in use. first: the first prompt of a question, which carries the
 * skill's full instructions; later steps say it is still there to use (the session remembers it). The model
 * decides at which steps the skill is needed, rather than running it at every step.
 */
export function skillNote(skill, first) {
  if (!skill) return '';
  const when = 'The user asked for this skill, so use it at the steps where it fits, judged by the skill\'s own guidance on when to use it: '
    + 'for example a decision, trade-off or disagreement that its method is made for, even if you already lean one way. At steps that do not need it, '
    + 'such as checking a fact, accepting a point or a small correction, answer directly without it. When you use it, follow it fully, '
    + 'including any sub-agents it calls for (spawn them with your sub-agent tool), and adapt it to the step.';
  const files = skill.dir ? ` Files the skill mentions (such as references or scripts) are in its folder, ${skill.dir}; read them from there when you need them.` : '';
  const rules = 'Where the skill conflicts with this discussion\'s rules, the rules win: you cannot write or change files (skip any step that would, '
    + 'such as saving a transcript or report or building an index, and say so), '
    + 'and give your result in your reply, in the format this step asks for. Only your final message is passed on, so put your complete result in it '
    + '(for example the full verdict), not a reference to an earlier message.';
  return first
    ? `For this question, the "${skill.name}" skill is available; its instructions are below. ${when}${files} ${rules}\n\n<skill name="${skill.name}">\n${skill.body}\n</skill>\n\n`
    : `The "${skill.name}" skill is still available (its instructions are earlier in this conversation); use it for this step only if the step needs it. ${rules}\n\n`;
}
