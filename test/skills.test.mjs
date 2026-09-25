import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { addSkill, findSkills, listSkills, loadSkill, nativeSkills, parseGitHubUrl, parseSkill, rawSkillUrl, removeSkill, resolveRef, skillNote, skillsDir } from '../src/skills.mjs';

let dir;
let saved;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'council-skills-'));
  saved = process.env.COUNCIL_CONFIG;
  process.env.COUNCIL_CONFIG = join(dir, 'config.json');
});
after(() => {
  if (saved === undefined) delete process.env.COUNCIL_CONFIG; else process.env.COUNCIL_CONFIG = saved;
  rmSync(dir, { recursive: true, force: true });
});

// Frontmatter in the style of the llm-council skill: blank lines inside, a quoted description.
const SKILL = '---\n\nname: llm-council\n\n\ndescription: "Run any question through a council of 5 AI advisors: they debate."\n\n---\n\n\n# LLM Council\n\nFive advisors.\n';

test('a SKILL.md is read for its name, description and instructions', () => {
  assert.deepEqual(parseSkill(SKILL), {
    name: 'llm-council', description: 'Run any question through a council of 5 AI advisors: they debate.', body: '# LLM Council\n\nFive advisors.',
  });
  assert.throws(() => parseSkill('# no frontmatter'), /no frontmatter/);
  assert.throws(() => parseSkill('---\nname: ../evil\n---\nx'), /name must be/);
});

test('GitHub URLs: clone URL, branch and path; the raw SKILL.md when git is missing', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/JuliusBrussee/caveman.git'),
    { owner: 'JuliusBrussee', repo: 'caveman', cloneUrl: 'https://github.com/JuliusBrussee/caveman.git', ref: null, path: '', rest: [] });
  const tree = parseGitHubUrl('https://github.com/o/r/tree/feature/foo/skills/x/');
  assert.deepEqual([tree.ref, tree.path], ['feature', 'foo/skills/x'], 'from the URL alone, the first segment is taken as the branch');
  // A branch name with "/" in it is resolved against the repository's branches and tags; the longest match wins.
  assert.deepEqual(['ref', 'path'].map(k => resolveRef(tree, ['main', 'feature', 'feature/foo'])[k]), ['feature/foo', 'skills/x']);
  assert.deepEqual(['ref', 'path'].map(k => resolveRef(tree, ['main'])[k]), ['feature', 'foo/skills/x'], 'no match: the first segment');
  assert.deepEqual(['ref', 'path'].map(k => resolveRef(parseGitHubUrl('https://github.com/o/r/tree/v1.0'), ['v1.0'])[k]), ['v1.0', '']);
  assert.equal(parseGitHubUrl('https://example.com/x'), null);
  assert.equal(rawSkillUrl('https://github.com/aiwithremy/claude-skills-llm-council.git'),
    'https://raw.githubusercontent.com/aiwithremy/claude-skills-llm-council/HEAD/SKILL.md');
  assert.equal(rawSkillUrl('https://github.com/o/r/tree/main/skills/x'), 'https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md');
  assert.equal(rawSkillUrl('https://github.com/o/r/blob/v1/a/SKILL.md'), 'https://raw.githubusercontent.com/o/r/v1/a/SKILL.md');
  assert.throws(() => rawSkillUrl('https://example.com/x'), /not a GitHub repository URL/);
});

const skillText = (name, extra = '') => `---\nname: ${name}\ndescription: >\n  The ${name} skill,\n  on two lines.\n${extra}---\n\n# ${name}\nDo ${name} things.\n`;
const put = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

test('a repository installs all its skills, each with its own files, once per name', async () => {
  // Laid out like caveman / ponytail / graphify: skills/<name>/SKILL.md, copies for other tools, a lowercase skill.md.
  const repo = join(dir, 'repo');
  put(join(repo, 'skills', 'alpha', 'SKILL.md'), skillText('alpha'));
  put(join(repo, 'skills', 'alpha', 'references', 'guide.md'), 'guide');
  put(join(repo, 'skills', 'alpha', 'scripts', 'run.py'), 'print(1)');
  put(join(repo, 'skills', 'alpha', 'nested', 'SKILL.md'), skillText('nested'));
  put(join(repo, 'skills', 'alpha', 'node_modules', 'x.js'), 'x');
  put(join(repo, 'skills', 'beta', 'SKILL.md'), skillText('beta'));
  put(join(repo, '.other-tool', 'skills', 'beta', 'SKILL.md'), skillText('beta', 'extra: copy\n'));
  put(join(repo, 'plugins', 'p', 'skills', 'alpha', 'SKILL.md'), skillText('alpha', 'extra: copy\n'));
  put(join(repo, 'pkg', 'skill.md'), skillText('gamma'));
  put(join(repo, 'pkg', 'big.py'), 'code');
  put(join(repo, 'docs', 'SKILL.md'), '# not a skill: no frontmatter');
  assert.deepEqual(findSkills(repo).map(s => [s.name, s.file.slice(repo.length + 1).split(/[\\/]/).join('/')]), [
    ['alpha', 'skills/alpha/SKILL.md'], ['beta', 'skills/beta/SKILL.md'], ['gamma', 'pkg/skill.md'], ['nested', 'skills/alpha/nested/SKILL.md'],
  ]);
  const cloned = [];
  const clone = async (url, ref, to) => { cloned.push([url, ref]); cpSync(repo, to, { recursive: true }); };
  const installed = await addSkill('https://github.com/o/repo.git', { clone });
  assert.deepEqual(cloned, [['https://github.com/o/repo.git', null]]);
  assert.deepEqual(installed.map(s => s.name), ['alpha', 'beta', 'gamma', 'nested']);
  const alpha = join(skillsDir(), 'alpha');
  assert.equal(readFileSync(join(alpha, 'references', 'guide.md'), 'utf8'), 'guide', 'the skill\'s own files come along');
  assert.ok(existsSync(join(alpha, 'scripts', 'run.py')));
  assert.ok(!existsSync(join(alpha, 'nested')), 'a nested skill is installed on its own, not inside this one');
  assert.ok(!existsSync(join(alpha, 'node_modules')));
  assert.deepEqual(readdirSync(join(skillsDir(), 'gamma')).sort(), ['SKILL.md', 'source.json'], 'a lowercase skill.md comes alone, not its package');
  assert.equal(loadSkill('beta').description, 'The beta skill, on two lines.');
  assert.doesNotMatch(readFileSync(join(skillsDir(), 'beta', 'SKILL.md'), 'utf8'), /extra: copy/, 'the copy outside hidden folders wins');
  assert.equal(JSON.parse(readFileSync(join(alpha, 'source.json'), 'utf8')).file, 'skills/alpha/SKILL.md');
  // One folder of a repository, on a branch whose name has a "/" in it.
  cloned.length = 0;
  const listRefs = async url => { assert.equal(url, 'https://github.com/o/repo.git'); return ['main', 'dev', 'dev/next', 'v1']; };
  assert.deepEqual((await addSkill('https://github.com/o/repo/tree/dev/next/skills/beta', { clone, listRefs })).map(s => s.name), ['beta']);
  assert.deepEqual(cloned, [['https://github.com/o/repo.git', 'dev/next']]);
  // No git: the repository's SKILL.md alone, from GitHub's raw files.
  const noGit = async () => { throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }); };
  const fetched = [];
  const [council] = await addSkill('https://github.com/aiwithremy/claude-skills-llm-council', { clone: noGit, fetchText: async url => { fetched.push(url); return SKILL; } });
  assert.deepEqual(fetched, ['https://raw.githubusercontent.com/aiwithremy/claude-skills-llm-council/HEAD/SKILL.md']);
  assert.equal(council.name, 'llm-council');
  await assert.rejects(addSkill('https://github.com/o/missing', { clone: async () => { throw new Error('Repository not found'); } }), /could not download .*Repository not found/);
  await assert.rejects(addSkill(join(repo, 'docs')), /no SKILL\.md with a name and description found/);
  for (const name of ['alpha', 'beta', 'gamma', 'nested', 'llm-council']) removeSkill(name);
});

test('skills install from a file or a folder, into the user\'s own folder, and can be listed and removed', async () => {
  assert.equal(skillsDir(), join(dir, 'skills'));
  const folder = join(dir, 'from-folder');
  mkdirSync(folder);
  writeFileSync(join(folder, 'SKILL.md'), SKILL);
  const [skill] = await addSkill(folder);
  assert.equal(skill.path, join(dir, 'skills', 'llm-council', 'SKILL.md'));
  assert.equal(readFileSync(skill.path, 'utf8'), SKILL);
  assert.equal(JSON.parse(readFileSync(join(dir, 'skills', 'llm-council', 'source.json'), 'utf8')).source, folder);
  writeFileSync(join(dir, 'second.md'), SKILL.replace('llm-council', 'second'));
  assert.equal((await addSkill(join(dir, 'second.md')))[0].name, 'second');
  writeFileSync(join(dir, 'third.md'), SKILL.replace('llm-council', 'third'));
  assert.equal((await addSkill(join(dir, 'third.md')))[0].name, 'third');
  assert.deepEqual(listSkills().map(s => s.name), ['llm-council', 'second', 'third']);
  assert.equal(loadSkill('LLM-Council').name, 'llm-council', 'names are matched case-insensitively');
  assert.equal(removeSkill('second').name, 'second');
  assert.deepEqual(listSkills().map(s => s.name), ['llm-council', 'third']);
  assert.throws(() => loadSkill('second'), /not installed \(installed: llm-council, third/);
});

test('skills installed natively for Claude Code or Codex can be used by name, but not removed from here', async () => {
  const claudeHome = join(dir, 'claude-home');
  put(join(claudeHome, 'skills', 'native-one', 'SKILL.md'), skillText('native-one'));
  put(join(claudeHome, 'skills', 'third', 'SKILL.md'), skillText('third')); // the council's own "third" wins
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  try {
    assert.deepEqual(nativeSkills().map(s => s.name), ['native-one']);
    assert.equal(loadSkill('native-one').dir, join(claudeHome, 'skills', 'native-one'));
    assert.throws(() => removeSkill('native-one'), /not installed/);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('the skill note: full instructions first, a reminder afterwards, used where needed, the discussion\'s rules first', () => {
  const skill = parseSkill(SKILL);
  assert.equal(skillNote(null, true), '');
  const first = skillNote(skill, true);
  assert.match(first, /including any sub-agents it calls for/);
  assert.match(first, /use it at the steps where it fits/);
  assert.match(first, /answer directly without it/);
  assert.doesNotMatch(first, /every step/);
  assert.match(first, /the rules win: you cannot write or change files/);
  assert.doesNotMatch(first, /its folder/, 'no folder to mention for a skill read from text');
  assert.match(skillNote({ ...skill, dir: '/skills/llm-council' }, true), /are in its folder, \/skills\/llm-council; read them from there/);
  assert.ok(first.includes('<skill name="llm-council">\n# LLM Council\n\nFive advisors.\n</skill>'));
  const again = skillNote(skill, false);
  assert.match(again, /^The "llm-council" skill is still available .*only if the step needs it/);
  assert.ok(!again.includes('Five advisors'));
});
