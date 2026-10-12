#!/usr/bin/env node
// Builds the MCPB bundles in mcpb/dist/: the MCP server packed for one-click install in Claude Desktop and for Smithery.
// The server has no dependencies, so a bundle is the source, the logos the shareable pages use, package.json, the
// license, the README, the manifest and the icon.
//   node mcpb/build.mjs
//
// - codex-claude-council-<version>.mcpb: the standard bundle (packed and validated by the official mcpb tool), for
//   Claude Desktop and the GitHub release.
// - codex-claude-council-<version>-smithery.mcpb: the same files, but each tool in the manifest also carries its
//   inputSchema, which Smithery requires and the MCPB manifest spec does not allow. Publish it with:
//   npx -y @smithery/cli mcp publish mcpb/dist/codex-claude-council-<version>-smithery.mcpb -n <namespace>/codex-claude-council
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

// The tool schemas come from the server's own TOOLS, whose skill field lists the skills installed where it runs. Load
// them as on a clean machine (empty homes and config), so nothing from the machine that builds the bundle is published.
const clean = mkdtempSync(join(tmpdir(), 'council-mcpb-'));
Object.assign(process.env, {
  HOME: clean, USERPROFILE: clean, COUNCIL_CONFIG: join(clean, 'config.json'),
  CLAUDE_CONFIG_DIR: join(clean, '.claude'), CODEX_HOME: join(clean, '.codex'),
});
const { TOOLS } = await import('../src/mcp.mjs');
rmSync(clean, { recursive: true, force: true });

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

// The Smithery bundle: the same files; the manifest's tools gain the input schemas the server itself declares.
const schemas = new Map(TOOLS.map(tool => [tool.name, tool.inputSchema]));
const smithery = {
  ...manifest,
  tools: manifest.tools.map(tool => {
    if (!schemas.has(tool.name)) throw new Error(`mcpb/manifest.json lists ${tool.name}, which the server does not have`);
    return { ...tool, inputSchema: schemas.get(tool.name) };
  }),
};
const files = listFiles(stage).map(path => {
  const name = relative(stage, path).split(sep).join('/');
  return [name, name === 'manifest.json' ? Buffer.from(`${JSON.stringify(smithery, null, 2)}\n`) : readFileSync(path)];
});
const smitheryOut = join(HERE, 'dist', `codex-claude-council-${version}-smithery.mcpb`);
writeFileSync(smitheryOut, zip(files));
console.log(`Built ${smitheryOut} (${files.length} files)`);

function listFiles(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

// A zip archive (deflate) of [name, bytes] entries: local headers and data, then the central directory and its end record.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8); // version, UTF-8 names, deflate
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(header, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += header.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
