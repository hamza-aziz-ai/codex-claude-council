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

test('the banner logos are 7 lines of 14 columns each, with color codes only', () => {
  for (const name of ['openai', 'claude', 'openai-256', 'claude-256']) {
    const text = readFileSync(join(ROOT, 'src', 'logos', `${name}.ans`), 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 7, name);
    for (const line of lines) assert.equal(line.replace(/\x1b\[[0-9;]*m/g, '').length, 14, name);
    assert.doesNotMatch(text, /\x1b\[[0-9;?]*[a-ln-zA-Z]/, `${name}: no escape codes other than colors`);
  }
});

test('the banner\'s sixel logos are complete images', () => {
  for (const name of ['openai', 'claude']) {
    const image = readFileSync(join(ROOT, 'src', 'logos', `${name}.six`), 'utf8').trimEnd();
    assert.match(image, /^\x1bP[0-9;]*q"1;1;120;120/, `${name}: a 120x120 sixel image`);
    assert.ok(image.endsWith('\x1b\\'), `${name}: ends the image`);
  }
});

test('the MCP Registry entry (server.json) matches the npm package', () => {
  const pkg = json('package.json');
  const server = json('server.json');
  assert.equal(server.name, pkg.mcpName, 'the registry checks mcpName in the published package.json');
  assert.equal(server.version, pkg.version);
  const [npm] = server.packages;
  assert.deepEqual([npm.registryType, npm.identifier, npm.version], ['npm', pkg.name, pkg.version]);
  assert.deepEqual(npm.packageArguments, [{ type: 'positional', value: 'mcp' }], 'the CLI starts the MCP server with "mcp"');
  assert.ok(server.description.length <= 100, 'the registry limits descriptions to 100 characters');
});
