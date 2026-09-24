#!/usr/bin/env node
// Read-only git for the council's Claude, as MCP tools: `node git-mcp.mjs <workspace>`.
// Claude gets no shell. Each tool runs git with a fixed argument list and no shell. Paths must be
// relative and stay inside the workspace (also after resolving links), and always follow "--", so git
// reads them as paths in the project. Revisions cannot start with "-" and always come before "--", so git
// reads them only as revisions, never as options or outside files. External diff programs and textconv
// filters are off. This replaces allowing `git ...` commands, where abbreviated options such as
// `blame --content <file>` and outside paths such as `git diff /etc/passwd x` could read other files.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './mcp.mjs';

const MAX_OUTPUT = 100_000;

const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** A path relative to the workspace that stays inside it, also after resolving links; returned in git's form. */
export function checkPath(value, workspace) {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path) throw new Error('path must be a non-empty string');
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || /^[~\\]/.test(path)) throw new Error(`path must be relative to the project: ${path}`);
  const full = join(workspace, normalize(path));
  let real = full;
  try { real = realpathSync(full); } catch { /* not on disk now, e.g. a file deleted in history */ }
  if (!inside(workspace, full) || !inside(workspace, real)) throw new Error(`path is outside the project: ${path}`);
  return relative(workspace, full).split(sep).join('/') || '.';
}

/** A revision (commit, branch, tag, HEAD~2, a..b): no leading "-" or "/", no spaces. */
export function checkRevision(value) {
  const rev = typeof value === 'string' ? value.trim() : '';
  if (!/^[^-/\s~\\][^\s]{0,199}$/.test(rev) || /^[A-Za-z]:[\\/]/.test(rev)) throw new Error(`not a revision: ${JSON.stringify(value)}`);
  return rev;
}

const count = (value, fallback, max) => {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`must be a whole number from 1 to ${max}`);
  return number;
};

const NO_PROGRAMS = ['--no-color', '--no-ext-diff', '--no-textconv'];
const optional = (value, check) => (value === undefined || value === null || value === '' ? [] : [check(value)]);

/** The git arguments for a tool call. */
export function gitArgs(tool, args, workspace) {
  const path = optional(args.path, value => checkPath(value, workspace));
  const rev = name => optional(args[name], checkRevision);
  switch (tool) {
    case 'git_status':
      return ['status', '--short', '--branch'];
    case 'git_log': {
      const shape = args.patch ? ['--patch', '--stat'] : ['--date=short', '--pretty=format:%h %ad %an  %s'];
      return ['log', ...NO_PROGRAMS, `--max-count=${count(args.max_count, 30, 200)}`, ...shape, ...rev('revision'), '--', ...path];
    }
    case 'git_diff':
      return ['diff', ...NO_PROGRAMS, ...(args.staged ? ['--cached'] : []), ...(args.stat_only ? ['--stat'] : []),
        ...rev('from'), ...rev('to'), '--', ...path];
    case 'git_show':
      return ['show', ...NO_PROGRAMS, '--stat', '--patch', checkRevision(args.revision), '--', ...path];
    case 'git_file_at':
      return ['show', '--no-textconv', `${checkRevision(args.revision)}:./${checkPath(args.path, workspace)}`];
    case 'git_blame': {
      const lines = args.start_line === undefined && args.end_line === undefined ? []
        : ['-L', `${count(args.start_line, 1, 1e7)},${count(args.end_line, 1e7, 1e7)}`];
      return ['blame', '--no-textconv', ...lines, ...rev('revision'), '--', checkPath(args.path, workspace)];
    }
    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}

const str = description => ({ type: 'string', description });
const tool = (name, description, properties = {}, required = []) => ({
  name, description, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
});
const PATH = str('File or folder, relative to the project root.');
export const GIT_TOOLS = [
  tool('git_status', 'Branch and changed files (git status --short --branch).'),
  tool('git_log', 'Commit history, optionally for one path or revision range; patch: true adds each commit\'s diff.', {
    revision: str('Commit, branch, tag or range such as main..HEAD. Default: the current branch.'), path: PATH,
    max_count: { type: 'integer', minimum: 1, maximum: 200, description: 'Commits to show (default 30).' },
    patch: { type: 'boolean', description: 'Include each commit\'s diff.' },
  }),
  tool('git_diff', 'Uncommitted changes (default), staged changes, or the difference between revisions.', {
    from: str('Compare from this revision.'), to: str('Compare to this revision (needs from).'), path: PATH,
    staged: { type: 'boolean', description: 'Staged changes only.' }, stat_only: { type: 'boolean', description: 'Only a summary of changed files.' },
  }),
  tool('git_show', 'One commit: message, changed files and diff.', { revision: str('The commit.'), path: PATH }, ['revision']),
  tool('git_file_at', 'A file\'s content at a revision.', { revision: str('Commit, branch or tag.'), path: PATH }, ['revision', 'path']),
  tool('git_blame', 'Who last changed each line of a file, and in which commit.', {
    path: PATH, revision: str('Blame as of this revision (default: working tree).'),
    start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 },
  }, ['path']),
];

// git sees none of the caller's GIT_* settings (such as GIT_DIR or GIT_EXTERNAL_DIFF).
function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
}

export async function runGit(tool, args, workspace, { signal } = {}) {
  const argv = gitArgs(tool, args || {}, workspace);
  return new Promise((resolve, reject) => {
    execFile('git', argv, { cwd: workspace, env: gitEnv(), maxBuffer: 32 * 1024 * 1024, timeout: 60_000, signal, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(String(stderr || error.message).trim()));
        const text = stdout.length > MAX_OUTPUT ? `${stdout.slice(0, MAX_OUTPUT)}\n[… output cut at ${MAX_OUTPUT} characters; narrow the path or range]` : stdout;
        resolve(text || '(no output)');
      });
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const workspace = realpathSync(process.argv[2]);
  serve({ server: {
    name: 'council-git', title: 'Read-only git for the council', tools: GIT_TOOLS,
    instructions: `Read-only git for the project at ${workspace}. Paths are relative to it.`,
    call: (name, args, { signal }) => runGit(name, args, workspace, { signal }),
  } });
}
