import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { GIT_TOOLS, checkPath, checkRevision, gitArgs, runGit } from '../src/git-mcp.mjs';
import { ROOT } from './helpers.mjs';

let repo;
let outside;
before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'council-git-repo-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'council-git-outside-')));
  writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE\n');
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'README.md'), 'line one\nline two\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  writeFileSync(join(repo, 'README.md'), 'line one\nline 2\n');
  git('commit', '-qam', 'second');
  writeFileSync(join(repo, 'README.md'), 'line one\nline 2\nuncommitted\n');
  try { symlinkSync(outside, join(repo, 'escape'), 'dir'); } catch { /* symlinks may need privileges on Windows */ }
});
after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

test('paths must be relative and stay inside the project, also through links', () => {
  assert.equal(checkPath('README.md', repo), 'README.md');
  assert.equal(checkPath('./src/../README.md', repo), 'README.md');
  for (const bad of [join(outside, 'secret.txt'), '/etc/passwd', '../x', 'src/../../x', '~/x', 'C:\\x', 'C:/x', '\\\\server\\x', '', '  ']) {
    assert.throws(() => checkPath(bad, repo), /path/, bad);
  }
  try {
    realpathSync(join(repo, 'escape'));
    assert.throws(() => checkPath('escape/secret.txt', repo), /outside the project/);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error; // no symlink on this machine
  }
});

test('revisions cannot be options, files or several arguments', () => {
  for (const good of ['HEAD', 'HEAD~2', 'main..HEAD', 'v1.0', 'origin/main', 'abc123', '@{u}']) assert.equal(checkRevision(good), good);
  for (const bad of ['--output=x', '-S/etc/passwd', '/etc/passwd', '~/x', 'C:\\x', 'C:/x', 'HEAD --output=x', '', 5]) {
    assert.throws(() => checkRevision(bad), /not a revision/, String(bad));
  }
});

test('every tool puts paths after "--" and turns off external programs', () => {
  const calls = {
    git_log: { revision: 'HEAD', path: 'README.md' }, git_diff: { from: 'HEAD~1', to: 'HEAD', path: 'README.md' },
    git_show: { revision: 'HEAD', path: 'README.md' }, git_blame: { path: 'README.md', start_line: 1, end_line: 2 },
  };
  for (const [tool, args] of Object.entries(calls)) {
    const argv = gitArgs(tool, args, repo);
    assert.equal(argv.at(-1), 'README.md', tool);
    assert.equal(argv.at(-2), '--', tool);
    assert.ok(argv.includes('--no-textconv'), tool);
  }
  for (const tool of ['git_log', 'git_diff', 'git_show']) assert.ok(gitArgs(tool, { revision: 'HEAD' }, repo).includes('--no-ext-diff'), tool);
  assert.deepEqual(gitArgs('git_file_at', { revision: 'HEAD', path: 'README.md' }, repo), ['show', '--no-textconv', 'HEAD:./README.md']);
  assert.deepEqual(GIT_TOOLS.map(t => t.name).sort(), ['git_blame', 'git_diff', 'git_file_at', 'git_log', 'git_show', 'git_status']);
  assert.throws(() => gitArgs('git_push', {}, repo), /unknown tool/);
  assert.throws(() => gitArgs('git_log', { max_count: 1000 }, repo), /1 to 200/);
});

test('the tools read the project history', async () => {
  assert.match(await runGit('git_log', {}, repo), /second\n.*first|second[\s\S]*first/);
  assert.match(await runGit('git_diff', {}, repo), /\+uncommitted/);
  assert.match(await runGit('git_diff', { from: 'HEAD~1', to: 'HEAD' }, repo), /-line two\n\+line 2/);
  assert.match(await runGit('git_show', { revision: 'HEAD' }, repo), /second/);
  assert.equal(await runGit('git_file_at', { revision: 'HEAD~1', path: 'README.md' }, repo), 'line one\nline two\n');
  assert.match(await runGit('git_blame', { path: 'README.md', start_line: 2, end_line: 2 }, repo), /line 2/);
  assert.match(await runGit('git_status', {}, repo), /M README\.md/);
});

test('no call reads a file outside the project', async () => {
  const secret = join(outside, 'secret.txt');
  const attempts = [
    ['git_blame', { path: secret }], ['git_blame', { path: 'README.md', revision: `--contents=${secret}` }],
    ['git_blame', { path: 'escape/secret.txt' }], ['git_diff', { from: secret, to: 'README.md' }],
    ['git_diff', { from: `--no-index` }], ['git_file_at', { revision: 'HEAD', path: '../secret.txt' }],
    ['git_log', { revision: `--output=${join(repo, 'written.txt')}` }],
  ];
  for (const [tool, args] of attempts) {
    const outcome = await runGit(tool, args, repo).then(text => text, error => error.message);
    assert.doesNotMatch(outcome, /TOP-SECRET-OUTSIDE/, `${tool} ${JSON.stringify(args)}`);
  }
  assert.throws(() => execFileSync('git', ['ls-files', '--error-unmatch', 'written.txt'], { cwd: repo, stdio: 'pipe' }));
});

test('the git tools server answers over stdio', async () => {
  const server = spawn(process.execPath, [join(ROOT, 'src', 'git-mcp.mjs'), repo], { stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = [];
  let buffer = '';
  server.stdout.on('data', chunk => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(i + 1)) replies.push(JSON.parse(buffer.slice(0, i)));
  });
  const request = (id, method, params) => server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  request(1, 'initialize', { protocolVersion: '2025-06-18' });
  request(2, 'tools/list', {});
  request(3, 'tools/call', { name: 'git_file_at', arguments: { revision: 'HEAD', path: 'README.md' } });
  request(4, 'tools/call', { name: 'git_blame', arguments: { path: '/etc/passwd' } });
  for (let waited = 0; replies.length < 4 && waited < 10_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
  server.kill();
  const byId = Object.fromEntries(replies.map(reply => [reply.id, reply]));
  assert.equal(byId[1].result.serverInfo.name, 'council-git');
  assert.equal(byId[2].result.tools.length, 6);
  assert.equal(byId[3].result.content[0].text, 'line one\nline 2\n');
  assert.equal(byId[4].result.isError, true);
  assert.match(byId[4].result.content[0].text, /relative to the project/);
});
