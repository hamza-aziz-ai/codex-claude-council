// Skills the council can use on request: SKILL.md files the user installs into their own folder
// (~/.codex-claude-council/skills/<name>/SKILL.md). Nothing third-party ships with the plugin.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { userConfigPath } from './config.mjs';

const MAX_SKILL_BYTES = 200_000;
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function skillsDir() {
  return join(dirname(userConfigPath()), 'skills');
}

/** name and description from a SKILL.md's frontmatter, and the instructions after it. */
export function parseSkill(text) {
  const match = String(text).replace(/^﻿/, '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error('not a SKILL.md: it has no frontmatter (a block between --- lines at the top)');
  const field = key => {
    const line = match[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return line ? line[1].trim().replace(/^(["'])([\s\S]*)\1$/, '$2') : '';
  };
  const name = field('name').toLowerCase();
  if (!NAME_PATTERN.test(name)) throw new Error(`the skill's name must be lowercase letters, digits, ".", "_" or "-" (got ${JSON.stringify(name)})`);
  return { name, description: field('description'), body: match[2].trim() };
}

export function listSkills() {
  let names = [];
  try { names = readdirSync(skillsDir()); } catch { return []; }
  return names.sort().flatMap(name => {
    try {
      const skill = parseSkill(readFileSync(join(skillsDir(), name, 'SKILL.md'), 'utf8'));
      return [{ ...skill, path: join(skillsDir(), name, 'SKILL.md') }];
    } catch {
      return [];
    }
  });
}

export function loadSkill(name) {
  const wanted = String(name || '').trim().toLowerCase();
  const skill = listSkills().find(s => s.name === wanted);
  if (!skill) {
    const installed = listSkills().map(s => s.name);
    throw new Error(`skill "${wanted}" is not installed${installed.length ? ` (installed: ${installed.join(', ')})` : ''}. `
      + 'Install one with: npx -y github:hamza-aziz-ai/codex-claude-council skill add <GitHub URL or SKILL.md path>');
  }
  return skill;
}

/** The raw URL of SKILL.md for a GitHub repository or file URL. */
export function rawSkillUrl(url) {
  const match = String(url).trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(\/.*)?)?\/?$/);
  if (!match) throw new Error(`not a GitHub repository URL: ${url}`);
  const [, owner, repo, ref = 'HEAD', path = ''] = match;
  const file = path.endsWith('.md') ? path : `${path.replace(/\/$/, '')}/SKILL.md`;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}${file.startsWith('/') ? '' : '/'}${file}`;
}

/** Install a skill from a GitHub URL, a SKILL.md file or a folder containing one. Returns the skill. */
export async function addSkill(source, { fetchText = defaultFetch } = {}) {
  let text;
  if (/^https?:\/\//i.test(source)) {
    text = await fetchText(/raw\.githubusercontent\.com/.test(source) ? source : rawSkillUrl(source));
  } else {
    const path = resolve(source);
    text = readFileSync(statSync(path).isDirectory() ? join(path, 'SKILL.md') : path, 'utf8');
  }
  if (Buffer.byteLength(text) > MAX_SKILL_BYTES) throw new Error(`SKILL.md is larger than ${MAX_SKILL_BYTES / 1000} kB`);
  const skill = parseSkill(text);
  const dir = join(skillsDir(), skill.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), text);
  writeFileSync(join(dir, 'source.json'), `${JSON.stringify({ source, installed_at: new Date().toISOString() }, null, 2)}\n`);
  return { ...skill, path: join(dir, 'SKILL.md') };
}

export function removeSkill(name) {
  const skill = loadSkill(name);
  rmSync(dirname(skill.path), { recursive: true, force: true });
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
  const rules = 'Where the skill conflicts with this discussion\'s rules, the rules win: you cannot write or change files (skip any step that saves a transcript or report), '
    + 'and give your result in your reply, in the format this step asks for. Only your final message is passed on, so put your complete result in it '
    + '(for example the full verdict), not a reference to an earlier message.';
  return first
    ? `For this question, the "${skill.name}" skill is available; its instructions are below. ${when} ${rules}\n\n<skill name="${skill.name}">\n${skill.body}\n</skill>\n\n`
    : `The "${skill.name}" skill is still available (its instructions are earlier in this conversation); use it for this step only if the step needs it. ${rules}\n\n`;
}
