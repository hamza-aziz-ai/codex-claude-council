#!/usr/bin/env node
// The README for npm: npmjs.com does not render GitHub's alerts (> [!NOTE]) or Mermaid diagrams, and resolves relative
// paths poorly. This rewrites a copy for the package, leaving the GitHub README as it is:
//   - alerts become a blockquote that starts with a bold label ("> **💡 Tip:** …");
//   - each ```mermaid block becomes an image rendered by mermaid.ink (a raster: its SVGs clip labels in other fonts), linked to the diagram on GitHub;
//   - relative images and links point to the repository at this version's tag.
// The publish workflow runs it on its fresh checkout just before `npm publish`:
//   node scripts/npm-readme.mjs            (rewrites README.md in place)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'hamza-aziz-ai/codex-claude-council';
const LABELS = { NOTE: 'ℹ️ Note', TIP: '💡 Tip', IMPORTANT: '❗ Important', WARNING: '⚠️ Warning', CAUTION: '🛑 Caution' };

export function npmReadme(markdown, version) {
  const ref = `v${version}`;
  const raw = path => `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;
  const page = path => `https://github.com/${REPO}/${/\.[a-z0-9]+$/i.test(path) ? 'blob' : 'tree'}/${ref}/${path}`;
  const local = target => !/^(https?:|mailto:|#)/.test(target);
  let diagram = 0;
  return markdown
    .replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\r?\n> ?/gm, (_, kind) => `> **${LABELS[kind]}:** `)
    .replace(/^```mermaid\r?\n([\s\S]*?)^```[ \t]*$/gm, (_, code) => {
      diagram += 1;
      return `[![Diagram ${diagram}](https://mermaid.ink/img/${Buffer.from(code).toString('base64url')})](https://github.com/${REPO}/blob/${ref}/README.md)`;
    })
    .replace(/\b(src|srcset)="([^"]+)"/g, (all, attr, target) => (local(target) ? `${attr}="${raw(target)}"` : all))
    .replace(/\bhref="([^"]+)"/g, (all, target) => (local(target) ? `href="${page(target)}"` : all))
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (all, bang, text, target) => (local(target) ? `${bang}[${text}](${bang ? raw(target) : page(target)})` : all));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const file = join(root, 'README.md');
  writeFileSync(file, npmReadme(readFileSync(file, 'utf8'), version));
  console.log(`README.md rewritten for npm (v${version})`);
}
