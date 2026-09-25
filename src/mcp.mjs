// Dependency-free MCP server (JSON-RPC 2.0 over stdio, newline-delimited).
import { createInterface } from 'node:readline';
import { EFFORTS, NAME, loadConfig, packageVersion } from './config.mjs';
import { MEMBER_ENV } from './adapters.mjs';
import { invoke } from './council.mjs';
import { listSkills, nativeSkills } from './skills.mjs';

const DEFAULTS_NOTE = 'Omit to use the configured default; set only when the user asks for a specific one.';
const MODEL_HINT = {
  codex: 'Codex (ChatGPT) model override, e.g. gpt-5.6-sol',
  claude: 'Claude model override: an alias such as opus, sonnet or fable, or a full model name',
};
const EFFORT_HINT = { codex: 'Codex reasoning effort override', claude: 'Claude effort level override' };
const modelField = side => ({ type: 'string', description: `Optional ${MODEL_HINT[side]}. ${DEFAULTS_NOTE}` });
const effortField = side => ({ type: 'string', enum: [...EFFORTS[side]], description: `Optional ${EFFORT_HINT[side]}. ${DEFAULTS_NOTE}` });
const schema = extra => ({
  type: 'object',
  properties: { question: { type: 'string', description: 'The question, with any context the models need.' }, ...extra },
  required: ['question'],
  additionalProperties: false,
});
const roundsField = {
  type: 'integer',
  minimum: 0,
  description: 'Optional limit on the agreement loop. After the answers, critiques and replies, the synthesizer drafts one joint answer '
    + 'and the other model reviews it, until both agree. N (1 or more): at most N rounds. 0: no round limit '
    + '(can take a long time and use a lot of both plans\' usage). Omit to use the configured default (3 rounds unless the user changed it). '
    + 'Set only when the user asks for a number of rounds or for agreement without a limit.',
};
const synthesizerField = {
  type: 'string',
  enum: ['claude', 'codex'],
  description: 'Optional: which model writes the final answer ("codex" is ChatGPT). With max_rounds it drafts the joint answer '
    + 'and the other model reviews it. Omit to use the configured default (Claude unless the user changed it).',
};
const workspaceField = {
  type: 'string',
  description: 'Absolute path of the project folder you are working in. Both models then work in it in plan mode: they read it (files, search, '
    + 'read-only commands such as git log and diff) but never change it. Pass it whenever the question is '
    + 'about the code, a change, a fix, an error or logs in this project. Omit only for questions unrelated to any project '
    + '(or when passing a session id: the session\'s own folder is used).',
};
const sessionHint = {
  codex: 'a Codex session (its id, as shown by `codex resume` or in the session\'s file name)',
  claude: 'a Claude Code session (its UUID, as shown by `/status` or `claude --resume`)',
};
const sessionField = side => ({
  type: 'string',
  description: `Optional: the id of ${sessionHint[side]} the user already has, to continue in place instead of a new session, so the model keeps that session's memory. `
    + 'Pass it only when the user gives an id. The council\'s turns are added to that session, in plan mode (nothing is changed).',
});
const webField = {
  type: 'boolean',
  description: 'Optional: whether the models may search the web and read web pages. Omit to use the configured default (on unless the user changed it). '
    + 'Pass false only when the user asks for no internet access.',
};
// Installed skills are listed when the server starts; a skill installed later is available after a restart.
const installedSkills = [...listSkills(), ...nativeSkills()].map(skill => skill.name);
const skillField = {
  type: 'string',
  description: 'Optional: the name of an installed skill both models may use for this question, at the steps where they judge it is needed, including any sub-agents it calls for. '
    + 'Pass it only when the user asks to use that skill (by name, or by a phrase the skill says triggers it). '
    + `Installed: ${installedSkills.length ? installedSkills.join(', ') : 'none (install with `codex-claude-council skill add <GitHub URL>`)'}. `
    + 'A step that uses it takes much longer and uses much more of both plans.',
};
const councilFields = {
  codex_model: modelField('codex'), codex_effort: effortField('codex'),
  claude_model: modelField('claude'), claude_effort: effortField('claude'),
  synthesizer: synthesizerField, max_rounds: roundsField, workspace: workspaceField, web_search: webField, skill: skillField,
  codex_session_id: sessionField('codex'), claude_session_id: sessionField('claude'),
};
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export const TOOLS = [
  {
    name: 'council_ask', title: 'Ask the Codex–Claude council',
    description: 'Ask Codex (ChatGPT) and Claude independently; each critiques the other\'s answer, then replies to the critique of its own. They then draft and review one final answer until both agree with it. With workspace, both can read the project (never change it). Each model keeps its session between calls. Takes minutes at high effort. Optional per-side model/effort overrides.',
    inputSchema: schema(councilFields), annotations,
  },
  {
    name: 'debate', title: 'Codex–Claude debate transcript',
    description: 'Run the council and return JSON with the final answer, whether both models agree with it, both answers, both critiques, both replies, every draft/review round and the settings used. Optional per-side model/effort overrides.',
    inputSchema: schema(councilFields), annotations,
  },
  {
    name: 'ask_codex', title: 'Ask Codex (ChatGPT) only',
    description: 'Ask Codex alone through the Codex CLI signed in with ChatGPT. Optional model/effort overrides.',
    inputSchema: schema({ model: modelField('codex'), effort: effortField('codex'), workspace: workspaceField, web_search: webField, skill: skillField, session_id: sessionField('codex') }), annotations,
  },
  {
    name: 'ask_claude', title: 'Ask Claude only',
    description: 'Ask Claude alone through Claude Code signed in with a Claude subscription. Optional model/effort overrides.',
    inputSchema: schema({ model: modelField('claude'), effort: effortField('claude'), workspace: workspaceField, web_search: webField, skill: skillField, session_id: sessionField('claude') }), annotations,
  },
];

const jobField = {
  type: 'string',
  description: 'The job_id a council tool returned while still working. Omit to use the most recent job.',
};
TOOLS.push(
  {
    name: 'council_result', title: 'Get a running council\'s answer',
    description: 'Wait for the answer of a council_ask, debate, ask_codex or ask_claude call that returned a job_id because it was still working. '
      + 'Waits up to about a minute; returns the answer as soon as it is ready, or says it is still working (then call this again).',
    inputSchema: { type: 'object', properties: { job_id: jobField }, additionalProperties: false }, annotations,
  },
  {
    name: 'council_cancel', title: 'Stop a running council',
    description: 'Stop a council_ask, debate, ask_codex or ask_claude call that is still working in the background.',
    inputSchema: { type: 'object', properties: { job_id: jobField }, additionalProperties: false },
    annotations: { ...annotations, readOnlyHint: false },
  },
);

const INSTRUCTIONS = 'Use council_ask for a cross-checked two-model answer, debate for the full transcript, or ask_codex / ask_claude for one model. '
  + 'Model and effort come from the user\'s config; pass overrides only when the user asks for a specific model or effort. '
  + 'Pass max_rounds only when the user asks for a number of rounds (0 = until they agree, with no limit). '
  + 'When working in a project, always pass workspace (its absolute path) so both models can read it; they run in plan mode and cannot change it. '
  + 'Each model keeps its session for as long as this server runs, so it remembers earlier questions and what it has read. '
  + 'If the user gives the id of their own Claude Code or Codex session, pass it (claude_session_id / codex_session_id, or session_id on ask_claude / ask_codex) to continue that session. '
  + 'Calls run the user\'s local Codex and Claude Code CLIs under their own subscriptions and can take several minutes. '
  + 'Pass skill (an installed skill\'s name) only when the user asks to use that skill; each model then uses it at the steps that need it. '
  + 'If a call returns a job_id because it is still working, call council_result (again, until it returns the answer); do not start the same question again.';

const callCouncil = (name, { question, ...options }, context) => invoke(name, question, options, context);

// Background jobs. Some hosts end any tool call after about 60 seconds (Claude Desktop's bridge), and a
// council takes minutes. So each tool starts a job and waits up to tool_wait_seconds (0 = until done). A job
// still running then is answered with its id, and council_result waits again: no single call outlasts the
// host's limit, and the council keeps running in between.
const jobs = new Map();
let jobCount = 0;

function startJob(name, args) {
  for (const [id, old] of jobs) if (old.done && Date.now() - old.started > 3_600_000) jobs.delete(id);
  const job = { id: `job-${++jobCount}`, name, started: Date.now(), step: 'starting', done: false, listeners: new Set(), controller: new AbortController() };
  const onProgress = message => { job.step = message; for (const listener of job.listeners) listener(message); };
  job.promise = callCouncil(name, args, { signal: job.controller.signal, onProgress })
    .then(text => ({ text }), error => ({ text: error.message, isError: true }))
    .then(outcome => Object.assign(job, { done: true, outcome }).outcome);
  jobs.set(job.id, job);
  return job;
}

function stillWorking(job) {
  const seconds = Math.round((Date.now() - job.started) / 1000);
  const who = job.name === 'ask_codex' ? 'Codex is' : job.name === 'ask_claude' ? 'Claude is' : 'The council is';
  return `${who} still working (${seconds} s so far; now: ${job.step}). This can take several minutes.\n`
    + `job_id: ${job.id}\n`
    + `To get the answer, call council_result with {"job_id": "${job.id}"}. It waits up to about a minute and returns the answer as soon as it is ready; `
    + 'if it says the job is still working, call it again. Do not start the same question again. To stop it, call council_cancel.';
}

// Wait for a job until it finishes, the wait window ends, or this call is cancelled.
async function waitForJob(job, { signal, onProgress }) {
  const seconds = Number(loadConfig().tool_wait_seconds);
  if (onProgress) job.listeners.add(onProgress);
  const timers = [];
  try {
    const outcome = await Promise.race([
      job.promise,
      ...(seconds > 0 ? [new Promise(resolve => timers.push(setTimeout(resolve, seconds * 1000, null)))] : []),
      new Promise(resolve => signal?.addEventListener('abort', () => resolve(null), { once: true })),
    ]);
    if (!outcome) return stillWorking(job);
    jobs.delete(job.id);
    if (outcome.isError) throw new Error(outcome.text);
    return outcome.text;
  } finally {
    timers.forEach(clearTimeout);
    job.listeners.delete(onProgress);
  }
}

function findJob(id) {
  const job = id ? jobs.get(id) : [...jobs.values()].at(-1);
  if (!job) throw new Error(id ? `No job ${id}: it has already returned its answer, was cancelled, or belongs to an earlier session.` : 'No council is running.');
  return job;
}

async function callCouncilTool(name, args, { signal, onProgress }) {
  if (process.env[MEMBER_ENV]) throw new Error('This is a council member\'s own session: it cannot start another council. Answer the question yourself.');
  if (name === 'council_result') return waitForJob(findJob(args.job_id), { signal, onProgress });
  if (name === 'council_cancel') {
    const job = findJob(args.job_id);
    job.controller.abort();
    jobs.delete(job.id);
    return `Stopped ${job.id}.`;
  }
  const job = startJob(name, args);
  // Cancelling the call that started a job stops the job; cancelling a council_result call only stops waiting.
  signal?.addEventListener('abort', () => { job.controller.abort(); jobs.delete(job.id); }, { once: true });
  return waitForJob(job, { signal, onProgress });
}

const COUNCIL = {
  name: NAME, title: 'Codex–Claude Council', tools: TOOLS, call: callCouncilTool, instructions: INSTRUCTIONS,
  close: () => { for (const job of jobs.values()) job.controller.abort(); },
};

/**
 * Serve tools over stdio. server: { name, title, tools, call(name, args, { signal, onProgress }) -> text,
 * instructions }; the council's tools by default.
 */
export function serve({ input = process.stdin, output = process.stdout, server = COUNCIL } = {}) {
  const inFlight = new Map();
  const send = message => output.write(`${JSON.stringify(message)}\n`);
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function callTool(id, params = {}) {
    const controller = new AbortController();
    inFlight.set(id, controller);
    const token = params._meta?.progressToken;
    let step = 0;
    const onProgress = token === undefined ? undefined : message => {
      if (!controller.signal.aborted) send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: ++step, message } });
    };
    try {
      const text = await server.call(params.name, params.arguments || {}, { signal: controller.signal, onProgress });
      if (!controller.signal.aborted) reply(id, { content: [{ type: 'text', text }] });
    } catch (error) {
      if (!controller.signal.aborted) reply(id, { content: [{ type: 'text', text: error.message }], isError: true });
    } finally {
      inFlight.delete(id);
    }
  }

  function handle(message) {
    const { id, method, params } = message;
    if (id === undefined || id === null) {
      if (method === 'notifications/cancelled') inFlight.get(params?.requestId)?.abort();
      return; // other notifications need no reply
    }
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: server.title, version: packageVersion() },
          instructions: server.instructions,
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: server.tools });
      case 'tools/call':
        return void callTool(id, params);
      default:
        return fail(id, -32601, `method not found: ${method}`);
    }
  }

  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', line => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      return fail(null, -32700, `parse error: ${error.message}`);
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return fail(null, -32600, 'invalid request');
    if (typeof message.method !== 'string') return; // a response to a server request; none are sent
    try {
      handle(message);
    } catch (error) {
      if (message.id !== undefined && message.id !== null) fail(message.id, -32603, error.message);
    }
  });
  const abortAll = () => { for (const controller of inFlight.values()) controller.abort(); server.close?.(); };
  lines.on('close', abortAll);
  return { abortAll };
}
