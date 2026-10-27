// Members through the APIs instead of the CLIs ("via": "api"): Claude through Anthropic's Messages API, Codex's side
// through OpenAI's Responses API, with the official SDKs. No CLI is needed for such a side. A member reads the project
// only through three read-only tools run here (list_files, read_file, search), confined to the workspace; it runs no
// commands and changes nothing. Web search is the providers' own server tool. Its conversation is kept in memory, per
// session (side, workspace, model), so it remembers earlier questions like a CLI session.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DESKTOP_KEY, NAME, PACKAGE_ROOT, settingValue, userConfigPath } from './config.mjs';
import { failureDetail, findExecutable, run } from './process.mjs';

// The SDKs load only when a side runs through its API, so the CLI mode never needs them. A copy of the plugin made
// by Claude Code, Codex or Claude Desktop has no node_modules: there they come from SDK_DIR, which
// `codex-claude-council api-setup` fills (npm and Docker installs have them already).
export const SDK_DIR = () => join(dirname(userConfigPath()), 'api-sdks');
const SDK_PACKAGES = ['@anthropic-ai/sdk', 'openai'];
async function load(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  try {
    return await import(pathToFileURL(createRequire(join(SDK_DIR(), 'package.json')).resolve(specifier)).href);
  } catch {
    throw new Error(`the API mode needs the providers' SDKs, which this copy of ${NAME} doesn't include. Run \`npx -y ${NAME} api-setup\` once, then try again.`);
  }
}
const exported = (module, name) => module[name] ?? module.default?.[name] ?? module.default?.default ?? module.default;

/** null when side's SDK loads, otherwise what to do. */
export async function sdkProblem(side) {
  try {
    await load(side === 'claude' ? '@anthropic-ai/sdk' : 'openai');
    return null;
  } catch (error) {
    return error.message;
  }
}

/** Install the SDKs, at the versions this package depends on, into SDK_DIR (for copies of the plugin without them). */
export async function apiSetup() {
  const wanted = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).dependencies;
  const specs = SDK_PACKAGES.map(name => `${name}@${wanted[name]}`);
  mkdirSync(SDK_DIR(), { recursive: true });
  const manifest = join(SDK_DIR(), 'package.json');
  if (!existsSync(manifest)) writeFileSync(manifest, '{ "private": true }\n');
  const result = await run(findExecutable('npm'), ['install', '--no-audit', '--no-fund', '--prefix', SDK_DIR(), ...specs], { timeoutMs: 600_000 });
  if (result.code !== 0) throw new Error(`npm install failed: ${failureDetail(result.stderr || result.stdout)}`);
  return { specs, dir: SDK_DIR() };
}

/** The model a side uses through the API when none is set: each provider's starting point for complex work. */
export const API_DEFAULT_MODEL = { claude: 'claude-opus-5-5', codex: 'gpt-6-astra' };
const CLAUDE_ALIASES = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-1' };
// Server-side refusal fallback (beta): on a policy decline the API re-runs the request on a fallback model it picks.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const MAX_TOOL_ROUNDS = 60;
const MAX_TOKENS = 16000;
const KEY_ENV = { claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], codex: ['OPENAI_API_KEY'] };
const PROVIDER = { claude: 'Anthropic', codex: 'OpenAI' };

export const apiModel = (side, model) => (side === 'claude' ? CLAUDE_ALIASES[model] ?? model : model) || API_DEFAULT_MODEL[side];

/** null when side's API key is set, otherwise what to do. */
export function apiKeyProblem(side) {
  if (KEY_ENV[side].some(name => process.env[name]?.trim()) || settingValue(DESKTOP_KEY[side])) return null;
  return `${side === 'claude' ? 'Claude' : 'Codex (ChatGPT)'} runs through the ${PROVIDER[side]} API ("via": "api"), but it has no key: set ${KEY_ENV[side][0]}, or enter the key in the Claude Desktop extension's settings. `
    + `Set it to your ${PROVIDER[side]} API key, or set "${side}": { "via": "cli" } to use the ${side === 'claude' ? 'Claude Code' : 'Codex'} CLI.`;
}

// --- The read-only workspace tools -------------------------------------------------------------------------------

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target']);
const LIMITS = { entries: 500, lines: 400, maxLines: 2000, bytes: 512 * 1024, matches: 200, files: 5000, fileBytes: 1024 * 1024 };

/** path (relative to root, or absolute inside it) resolved to a real path inside root; throws if it leaves it. */
function inside(root, path = '.') {
  // Both real paths: the project folder can itself sit behind a link (on macOS, /var is /private/var).
  const base = realpathSync(root);
  const target = resolve(base, String(path || '.'));
  let real;
  try { real = realpathSync(target); } catch { throw new Error(`no such file or folder: ${path}`); }
  const rel = relative(base, real);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${path} is outside the project, which is all you can read`);
  return real;
}

const display = (root, path) => relative(root, path).split(sep).join('/') || '.';

function readText(path, maxBytes) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(statSync(path).size, maxBytes));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, read);
    if (bytes.includes(0)) return null; // binary
    return bytes.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) yield* walk(path); } else if (entry.isFile()) yield path;
  }
}

const TOOL_SPECS = [
  {
    name: 'list_files',
    description: 'List the files and folders in a folder of the project (read-only). Folders end with "/".',
    properties: { path: { type: 'string', description: 'Folder, relative to the project root; "." for the root' } },
    required: ['path'],
  },
  {
    name: 'read_file',
    description: `Read a text file of the project (read-only), as numbered lines: ${LIMITS.lines} lines from offset by default.`,
    properties: {
      path: { type: 'string', description: 'File, relative to the project root' },
      offset: { type: 'integer', description: 'First line to read, from 1 (default 1)' },
      limit: { type: 'integer', description: `How many lines (default ${LIMITS.lines}, at most ${LIMITS.maxLines})` },
    },
    required: ['path'],
  },
  {
    name: 'search',
    description: 'Search the text files of a folder of the project (recursively, read-only) for a regular expression; returns path:line: text per match.',
    properties: {
      pattern: { type: 'string', description: 'JavaScript regular expression, matched per line' },
      path: { type: 'string', description: 'Folder or file to search, relative to the project root (default ".")' },
      ignore_case: { type: 'boolean', description: 'Match regardless of case' },
    },
    required: ['pattern'],
  },
];

/** Run one workspace tool; its result as text. Errors come back as text too, for the model to correct. */
export function runTool(project, name, input = {}) {
  const root = realpathSync(project);
  if (name === 'list_files') {
    const dir = inside(root, input.path);
    if (!statSync(dir).isDirectory()) throw new Error(`${input.path} is a file; read it with read_file`);
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const shown = entries.slice(0, LIMITS.entries).map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
    return `${display(root, dir)}:\n${shown.join('\n') || '(empty)'}${entries.length > LIMITS.entries ? `\n… ${entries.length - LIMITS.entries} more` : ''}`;
  }
  if (name === 'read_file') {
    const file = inside(root, input.path);
    if (statSync(file).isDirectory()) throw new Error(`${input.path} is a folder; list it with list_files`);
    const text = readText(file, LIMITS.bytes);
    if (text === null) throw new Error(`${input.path} is a binary file`);
    const lines = text.split(/\r?\n/);
    const offset = Math.max(1, Number.parseInt(input.offset, 10) || 1);
    const limit = Math.min(LIMITS.maxLines, Math.max(1, Number.parseInt(input.limit, 10) || LIMITS.lines));
    const part = lines.slice(offset - 1, offset - 1 + limit).map((line, i) => `${offset + i}\t${line}`).join('\n');
    const rest = lines.length - (offset - 1 + limit);
    return `${part}${rest > 0 ? `\n… ${rest} more lines (read on with offset ${offset + limit})` : ''}${statSync(file).size > LIMITS.bytes ? '\n… the file is longer than this tool reads' : ''}`;
  }
  if (name === 'search') {
    let regex;
    try { regex = new RegExp(String(input.pattern), input.ignore_case ? 'i' : ''); } catch (error) { throw new Error(`invalid pattern: ${error.message}`); }
    const start = inside(root, input.path);
    const files = statSync(start).isDirectory() ? walk(start) : [start];
    const matches = [];
    let scanned = 0;
    for (const file of files) {
      if (++scanned > LIMITS.files || matches.length >= LIMITS.matches) break;
      if (statSync(file).size > LIMITS.fileBytes) continue;
      const text = readText(file, LIMITS.fileBytes);
      if (text === null) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        if (matches.length < LIMITS.matches && regex.test(line)) matches.push(`${display(root, file)}:${i + 1}: ${line.slice(0, 300)}`);
      });
    }
    return matches.length ? `${matches.join('\n')}${matches.length >= LIMITS.matches ? `\n… stopped at ${LIMITS.matches} matches` : ''}` : 'no matches';
  }
  throw new Error(`unknown tool: ${name}`);
}

const toolResult = (root, name, input) => {
  try {
    return { text: runTool(root, name, input), isError: false };
  } catch (error) {
    return { text: error.message, isError: true };
  }
};

// --- The members --------------------------------------------------------------------------------------------------

function memberNote(side, workspace, web) {
  return `You are ${side === 'claude' ? 'Claude' : 'ChatGPT'}, a member of a council of two AI models, reached through the ${PROVIDER[side]} API. `
    + (workspace
      ? `You can read the project at ${workspace} only with the tools list_files, read_file and search, which are read-only: you cannot run commands (no git) or change anything, so describe any change you propose instead of making it. `
      : 'You have no project files: work from the text you are given. ')
    + (web ? 'You can search the web for facts that change or that you are unsure of; prefer primary sources and say where a fact came from. ' : 'You have no internet access. ')
    + 'Your final reply is your deliverable and is all that is passed on: always end your turn with your complete answer to the prompt.';
}

const requestOptions = (signal, timeoutMs) => ({ signal, timeout: timeoutMs });

async function askClaudeApi(prompt, { model, effort, session, workspace, web, signal, timeoutMs }) {
  const Anthropic = exported(await load('@anthropic-ai/sdk'), 'Anthropic');
  // The provider's own variables first (the SDK reads them); else the key from the Claude Desktop extension's settings.
  const setting = KEY_ENV.claude.some(name => process.env[name]?.trim()) ? null : settingValue(DESKTOP_KEY.claude);
  const client = new Anthropic({ maxRetries: 2, ...(setting ? { apiKey: setting } : {}) });
  const tools = [
    ...(workspace ? TOOL_SPECS.map(spec => ({ name: spec.name, description: spec.description, input_schema: { type: 'object', properties: spec.properties, required: spec.required } })) : []),
    ...(web ? [{ type: 'web_search_20260209', name: 'web_search' }, { type: 'web_fetch_20260209', name: 'web_fetch' }] : []),
  ];
  const fallback = FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
  const messages = session.messages;
  messages.push({ role: 'user', content: prompt });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model, max_tokens: MAX_TOKENS, system: memberNote('claude', workspace, web), messages,
      thinking: { type: 'adaptive' }, ...(effort ? { output_config: { effort } } : {}), ...(tools.length ? { tools } : {}), ...fallback,
    }, requestOptions(signal, timeoutMs));
    // The whole content goes back each time (thinking blocks included, unchanged), as the API requires.
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'refusal') throw new Error(`Claude declined to answer${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
    if (response.stop_reason === 'pause_turn') continue;
    const calls = response.content.filter(block => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      if (response.stop_reason === 'max_tokens') throw new Error(`Claude's answer was cut off at ${MAX_TOKENS} tokens`);
      const text = response.content.filter(block => block.type === 'text').map(block => block.text.trim()).filter(Boolean).join('\n\n');
      if (!text) throw new Error('Claude returned an empty answer');
      return text;
    }
    messages.push({
      role: 'user',
      content: calls.map(call => {
        const { text, isError } = toolResult(workspace, call.name, call.input);
        return { type: 'tool_result', tool_use_id: call.id, content: text, ...(isError ? { is_error: true } : {}) };
      }),
    });
  }
  throw new Error(`Claude used more than ${MAX_TOOL_ROUNDS} rounds of tools without answering`);
}

async function askOpenAiApi(prompt, { model, effort, session, workspace, web, signal, timeoutMs }) {
  const OpenAI = exported(await load('openai'), 'OpenAI');
  const toResponseInputItems = exported(await load('openai/lib/responses/ResponseInputItems'), 'toResponseInputItems');
  const setting = process.env.OPENAI_API_KEY?.trim() ? null : settingValue(DESKTOP_KEY.codex);
  const client = new OpenAI({ maxRetries: 2, ...(setting ? { apiKey: setting } : {}) });
  const tools = [
    ...(workspace ? TOOL_SPECS.map(spec => ({ type: 'function', name: spec.name, description: spec.description, parameters: { type: 'object', properties: spec.properties, required: spec.required }, strict: false })) : []),
    ...(web ? [{ type: 'web_search' }] : []),
  ];
  const input = session.messages;
  input.push({ role: 'user', content: prompt });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // store: false keeps the conversation off OpenAI's servers; it is replayed from here, reasoning included.
    const response = await client.responses.create({
      model, instructions: memberNote('codex', workspace, web), input, store: false, include: ['reasoning.encrypted_content'],
      ...(effort ? { reasoning: { effort } } : {}), ...(tools.length ? { tools } : {}),
    }, requestOptions(signal, timeoutMs));
    if (response.status !== 'completed') {
      throw new Error(`ChatGPT's answer ended ${response.status}${response.incomplete_details?.reason ? ` (${response.incomplete_details.reason})` : ''}${response.error?.message ? `: ${response.error.message}` : ''}`);
    }
    input.push(...toResponseInputItems(response.output));
    const calls = response.output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      const refusal = response.output.flatMap(item => (item.type === 'message' ? item.content : [])).find(part => part.type === 'refusal');
      if (refusal) throw new Error(`ChatGPT declined to answer: ${refusal.refusal}`);
      const text = (response.output_text || '').trim();
      if (!text) throw new Error('ChatGPT returned an empty answer');
      return text;
    }
    for (const call of calls) {
      let args;
      try { args = JSON.parse(call.arguments || '{}'); } catch { args = null; }
      const { text } = args ? toolResult(workspace, call.name, args) : { text: 'the arguments were not valid JSON' };
      input.push({ type: 'function_call_output', call_id: call.call_id, output: text });
    }
  }
  throw new Error(`ChatGPT used more than ${MAX_TOOL_ROUNDS} rounds of tools without answering`);
}

/**
 * Ask side's model through its API, continuing session's conversation (session.messages). A turn that fails leaves
 * the conversation as it was, so the next one starts clean.
 */
export async function askApi(side, prompt, { model, effort, session, workspace, web, signal, timeoutMs }) {
  const problem = apiKeyProblem(side);
  if (problem) throw new Error(problem);
  session.messages ??= [];
  const before = session.messages.length;
  const root = workspace ? realpathSync(workspace) : null;
  const ask = side === 'claude' ? askClaudeApi : askOpenAiApi;
  try {
    return await ask(prompt, { model: apiModel(side, model), effort, session, workspace: root, web, signal, timeoutMs });
  } catch (error) {
    session.messages.length = before;
    if (signal?.aborted) throw new Error('cancelled');
    const status = typeof error?.status === 'number' ? ` (HTTP ${error.status})` : '';
    throw new Error(`${side === 'claude' ? 'claude' : 'codex'} (${PROVIDER[side]} API) failed${status}: ${error.message}`);
  }
}
