import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { npmReadme } from '../scripts/npm-readme.mjs';

test('the npm README has no GitHub-only syntax and no relative paths', () => {
  const out = npmReadme(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), '1.2.3');
  assert.doesNotMatch(out, /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/, 'alerts are converted');
  assert.doesNotMatch(out, /```mermaid/, 'diagrams are images');
  assert.match(out, /> \*\*💡 Tip:\*\* Already in a session/);
  assert.match(out, /\(https:\/\/mermaid\.ink\/img\/[A-Za-z0-9_-]+\)/);
  for (const [, target] of out.matchAll(/\b(?:src|srcset|href)="([^"]+)"/g)) assert.match(target, /^(https?:|#)/, target);
  for (const [, target] of out.matchAll(/\]\(([^)\s]+)\)/g)) assert.match(target, /^(https?:|mailto:|#)/, target);
  assert.match(out, /raw\.githubusercontent\.com\/hamza-aziz-ai\/codex-claude-council\/v1\.2\.3\/assets\/demo\.gif/);
  assert.match(out, /github\.com\/hamza-aziz-ai\/codex-claude-council\/blob\/v1\.2\.3\/PRIVACY\.md/);
  assert.match(out, /github\.com\/hamza-aziz-ai\/codex-claude-council\/tree\/v1\.2\.3\/bench\)/, 'a folder links to its tree');
});

test('a diagram image decodes back to the diagram', () => {
  const out = npmReadme('```mermaid\nflowchart LR\n  A --> B\n```\n', '1.0.0');
  const code = out.match(/mermaid\.ink\/img\/([A-Za-z0-9_-]+)/)[1];
  assert.equal(Buffer.from(code, 'base64url').toString(), 'flowchart LR\n  A --> B\n');
});
