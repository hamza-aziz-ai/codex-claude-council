import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { addSkill, listSkills, loadSkill, parseSkill, rawSkillUrl, removeSkill, skillNote, skillsDir } from '../src/skills.mjs';

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

test('GitHub repository and file URLs map to the raw SKILL.md', () => {
  assert.equal(rawSkillUrl('https://github.com/aiwithremy/claude-skills-llm-council.git'),
    'https://raw.githubusercontent.com/aiwithremy/claude-skills-llm-council/HEAD/SKILL.md');
  assert.equal(rawSkillUrl('https://github.com/o/r/tree/main/skills/x'), 'https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md');
  assert.equal(rawSkillUrl('https://github.com/o/r/blob/v1/a/SKILL.md'), 'https://raw.githubusercontent.com/o/r/v1/a/SKILL.md');
  assert.throws(() => rawSkillUrl('https://example.com/x'), /not a GitHub repository URL/);
});

test('skills install from a GitHub URL, a file or a folder, into the user\'s own folder, and can be listed and removed', async () => {
  assert.equal(skillsDir(), join(dir, 'skills'));
  const fetched = [];
  const skill = await addSkill('https://github.com/aiwithremy/claude-skills-llm-council', { fetchText: async url => { fetched.push(url); return SKILL; } });
  assert.deepEqual(fetched, ['https://raw.githubusercontent.com/aiwithremy/claude-skills-llm-council/HEAD/SKILL.md']);
  assert.equal(skill.path, join(dir, 'skills', 'llm-council', 'SKILL.md'));
  assert.equal(readFileSync(skill.path, 'utf8'), SKILL);
  assert.equal(JSON.parse(readFileSync(join(dir, 'skills', 'llm-council', 'source.json'), 'utf8')).source, 'https://github.com/aiwithremy/claude-skills-llm-council');
  const folder = join(dir, 'from-folder');
  mkdirSync(folder);
  writeFileSync(join(folder, 'SKILL.md'), SKILL.replace('llm-council', 'second'));
  assert.equal((await addSkill(folder)).name, 'second');
  writeFileSync(join(dir, 'third.md'), SKILL.replace('llm-council', 'third'));
  assert.equal((await addSkill(join(dir, 'third.md'))).name, 'third');
  assert.deepEqual(listSkills().map(s => s.name), ['llm-council', 'second', 'third']);
  assert.equal(loadSkill('LLM-Council').name, 'llm-council', 'names are matched case-insensitively');
  assert.equal(removeSkill('second').name, 'second');
  assert.deepEqual(listSkills().map(s => s.name), ['llm-council', 'third']);
  assert.throws(() => loadSkill('second'), /not installed \(installed: llm-council, third\)/);
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
  assert.ok(first.includes('<skill name="llm-council">\n# LLM Council\n\nFive advisors.\n</skill>'));
  const again = skillNote(skill, false);
  assert.match(again, /^The "llm-council" skill is still available .*only if the step needs it/);
  assert.ok(!again.includes('Five advisors'));
});
