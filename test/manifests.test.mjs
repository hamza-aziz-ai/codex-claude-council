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
  const lock = json('package-lock.json');
  assert.deepEqual([lock.version, lock.packages[''].version], [pkg.version, pkg.version], 'run npm install --package-lock-only');
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

test('the banner\'s sixel icon is a complete image', () => {
  const image = readFileSync(join(ROOT, 'src', 'logos', 'icon.six'), 'utf8').trimEnd();
  assert.match(image, /^\x1bP[0-9;]*q"1;1;440;440/, 'a 440x440 sixel image');
  assert.ok(image.endsWith('\x1b\\'), 'ends the image');
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

test('the MCPB bundle manifest matches the package and declares every tool', async () => {
  const pkg = json('package.json');
  const manifest = json('mcpb/manifest.json');
  assert.deepEqual([manifest.name, manifest.version], [pkg.name, pkg.version], 'mcpb/build.mjs refuses a version mismatch, this catches it earlier');
  assert.equal(manifest.server.entry_point, 'src/mcp-server.mjs');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/src/mcp-server.mjs']);
  const { PROMPTS, TOOLS } = await import('../src/mcp.mjs');
  assert.deepEqual(manifest.tools.map(tool => tool.name), TOOLS.map(tool => tool.name));
  assert.deepEqual(manifest.prompts.map(prompt => prompt.name), PROMPTS.map(prompt => prompt.name));
  assert.ok(existsSync(join(ROOT, 'mcpb', manifest.icon)), 'the icon is in mcpb/');
});

test('every manifest points at the one icon, mcpb/icon.png', () => {
  const { interface: card } = json('.codex-plugin/plugin.json');
  assert.deepEqual([card.logo, card.composerIcon], ['./mcpb/icon.png', './mcpb/icon.png']);
  assert.ok(json('package.json').files.includes('mcpb/icon.png'), 'the npm package ships the icon the Codex card uses');
  assert.match(json('server.json').icons[0].src, /^https:\/\/raw\.githubusercontent\.com\/hamza-aziz-ai\/codex-claude-council\/main\/mcpb\/icon\.png$/);
});
