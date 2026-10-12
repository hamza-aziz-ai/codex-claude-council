#!/usr/bin/env node
// Builds the MCPB bundle (mcpb/dist/codex-claude-council-<version>.mcpb): the MCP server packed for one-click install in
// Claude Desktop and for publishing to Smithery. The server has no dependencies, so the bundle is the source, the
// logos the shareable pages use, package.json, the license, the README, the manifest and the icon.
//   node mcpb/build.mjs
// Then: smithery mcp publish mcpb/dist/codex-claude-council-<version>.mcpb -n hamza-aziz-ai/codex-claude-council
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const MCPB = '@anthropic-ai/mcpb@2.1.2';
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
if (manifest.version !== version) throw new Error(`mcpb/manifest.json is version ${manifest.version}, package.json ${version}`);

const stage = join(HERE, 'dist', 'stage');
rmSync(join(HERE, 'dist'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const item of ['src', 'assets/logos', 'package.json', 'LICENSE', 'README.md']) cpSync(join(ROOT, item), join(stage, item), { recursive: true });
for (const item of ['manifest.json', 'icon.png']) cpSync(join(HERE, item), join(stage, item));

const out = join(HERE, 'dist', `codex-claude-council-${version}.mcpb`);
// One command string (npx is a .cmd script on Windows, which needs a shell); the paths are quoted.
execSync(`npx -y ${MCPB} validate "${join(stage, 'manifest.json')}"`, { stdio: 'inherit' });
execSync(`npx -y ${MCPB} pack "${stage}" "${out}"`, { stdio: 'inherit' });
console.log(`\nBuilt ${out}`);
