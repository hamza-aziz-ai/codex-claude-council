import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from './helpers.mjs';

const json = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

test('names and versions agree across package and plugin manifests', () => {
  const pkg = json('package.json');
  for (const manifest of [json('.claude-plugin/plugin.json'), json('.codex-plugin/plugin.json')]) {
    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.version, pkg.version);
  }
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].name, pkg.name);
  assert.equal(json('.agents/plugins/marketplace.json').plugins[0].name, pkg.name);
});

// Each host gets its own inline MCP config: Claude expands ${CLAUDE_PLUGIN_ROOT}; Codex does not
// expand variables in MCP args but resolves "cwd" against the plugin root. A root .mcp.json would be
// auto-discovered by both hosts, so there must not be one.
test('each host has a working MCP server path and there is no shared .mcp.json', () => {
  assert.ok(!existsSync(join(ROOT, '.mcp.json')));
  const claude = json('.claude-plugin/plugin.json').mcpServers.council;
  assert.equal(claude.command, 'node');
  assert.ok(existsSync(claude.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)));
  const codex = json('.codex-plugin/plugin.json').mcpServers.council;
  assert.equal(codex.command, 'node');
  assert.equal(codex.cwd, '.');
  assert.ok(existsSync(join(ROOT, codex.cwd, codex.args[0])));
});

test('the skill frontmatter names the skill', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'codex-claude-council', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: codex-claude-council\ndescription: .{50,1024}\n---\n/);
});
