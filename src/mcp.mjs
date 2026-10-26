// Dependency-free MCP server: JSON-RPC 2.0 over stdio (newline-delimited) or Streamable HTTP.
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { EFFORTS, NAME, loadConfig, packageVersion } from './config.mjs';
import { MEMBER_ENV } from './adapters.mjs';
import { WAITING, invoke } from './council.mjs';
import { listSkills, nativeSkills } from './skills.mjs';

// The plugin's icon, served from the repository (MCP icons must be HTTPS URLs); clients that show server icons use it.
const ICON_URL = 'https://raw.githubusercontent.com/hamza-aziz-ai/codex-claude-council/main/mcpb/icon.png';
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
  description: 'Optional limit on the exchange. After the two independent answers, each model replies to the other\'s latest message, '
    + 'round after round, until both agree; then the synthesizer writes the final answer and the other checks it. N (1 or more): at most N exchanges. '
    + '0: no limit (can take a long time and use a lot of both plans\' usage). Omit to use the configured default (5 unless the user changed it). '
    + 'Set only when the user asks for a number of rounds or for agreement without a limit.',
};
const synthesizerField = {
  type: 'string',
  enum: ['claude', 'codex'],
  description: 'Optional: which model writes the final answer ("codex" is ChatGPT); the other checks it. '
    + 'Omit to use the configured default (Claude unless the user changed it).',
};
const workspaceField = {
  type: 'string',
  description: 'Absolute path of the project folder you are working in. Both models then work in it in plan mode: they read it (files, search, '
    + 'read-only commands such as git log and diff) but never change it. Pass it whenever the question is '
    + 'about the code, a change, a fix, an error or logs in this project. Omit only for questions unrelated to any project '
    + '(or when passing a session id: the session\'s own folder is used).',
};
const sessionHint = {
  codex: 'a Codex session the user already has: its id (as shown by `/status`) or the name they gave it with `/rename`; on another machine, user@host:<id or name> (runs there through ssh)',
  claude: 'a Claude Code session the user already has: its UUID (as shown by `/status`) or the name they gave it with `/rename`; on another machine, user@host:<id or name> (runs there through ssh)',
};
const sessionField = side => ({
  type: 'string',
  description: `Optional: ${sessionHint[side]}, to continue in place instead of a new session, so the model keeps that session's memory. `
    + 'Pass it exactly as the user gives it, only when they give one. The council\'s turns are added to that session, in plan mode (nothing is changed).',
});
const networkField = {
  type: 'boolean',
  description: 'Optional: whether Codex\'s shell commands may reach the network (for example to call an API or fetch live data), still read-only on disk. '
    + 'Omit to use the configured default (off unless the user changed it). Pass true only when the user asks for it.',
};
const webField = {
  type: 'boolean',
  description: 'Optional: whether the models may search the web and read web pages. Omit to use the configured default (on unless the user changed it). '
    + 'Pass false only when the user asks for no internet access.',
};
// Installed skills are listed when the server starts; a skill installed later is available after a restart.
// Skills of the CLIs' plugins can be named too, but are not listed: there can be hundreds.
const installedSkills = [...listSkills(), ...nativeSkills({ plugins: false })].map(skill => skill.name);
const skillField = {
  type: 'string',
  description: 'Optional: the name of an installed skill both models may use for this question, at the steps where they judge it is needed, including any sub-agents it calls for; '
    + 'for several skills, their names separated by commas ("llm-council, caveman"). '
    + 'Pass only skills the user asks to use (by name, or by a phrase the skill says triggers it). '
    + 'Skills of Claude Code\'s and Codex\'s enabled plugins can be named too. '
    + `Installed: ${installedSkills.length ? installedSkills.join(', ') : 'none (install with `codex-claude-council skill add <GitHub URL>`)'}. `
    + 'A step that uses it takes much longer and uses much more of both plans.',
};
const councilFields = {
  codex_model: modelField('codex'), codex_effort: effortField('codex'),
  claude_model: modelField('claude'), claude_effort: effortField('claude'),
  synthesizer: synthesizerField, max_rounds: roundsField, workspace: workspaceField, web_search: webField, network: networkField, skill: skillField,
  codex_session_id: sessionField('codex'), claude_session_id: sessionField('claude'),
};
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };

// Every tool returns the same structured result beside its text: what happened, and the id to use next.
const outputSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string', enum: ['done', 'working', 'your_turn', 'stopped'],
      description: 'done: text is the answer. working: still running; call council_result with job_id. '
        + 'your_turn (council_join): text is the council\'s message; reply with council_turn and council_id. stopped: council_cancel stopped job_id.',
    },
    text: { type: 'string', description: 'The answer (council_debate: its JSON), or the message to act on; the same as the text content.' },
    job_id: { type: 'string', description: 'With working or stopped: the job to wait for, or the one stopped.' },
    council_id: { type: 'string', description: 'With your_turn: the council to reply to with council_turn.' },
  },
  required: ['status', 'text'],
  additionalProperties: false,
};
// The published tool names share the council_ prefix; the old names of the three renamed in 0.11.7 still work.
const INTERNAL_NAME = { council_debate: 'debate', council_ask_codex: 'ask_codex', council_ask_claude: 'ask_claude' };

const joinFields = {
  me: { type: 'string', enum: ['claude', 'codex'], description: 'Which model you are: "claude" if you are Claude (Claude Code, Claude Desktop), "codex" if you are Codex or ChatGPT. The other model is the one the plugin runs.' },
  other_session_id: {
    type: 'string',
    description: 'Optional: the id or /rename name of the user\'s own session of the other model (a Codex session if you are Claude, a Claude Code session if you are Codex), '
      + 'or user@host:<id or name> for one on another machine (it runs there through ssh), to continue in place with its memory. Pass it exactly as the user gives it, only when they give one; never your own session.',
  },
  other_model: { type: 'string', description: `Optional model override for the other model. ${DEFAULTS_NOTE}` },
  other_effort: { type: 'string', description: `Optional effort override for the other model (Codex: ${EFFORTS.codex.join(', ')}; Claude: ${EFFORTS.claude.join(', ')}). ${DEFAULTS_NOTE}` },
  synthesizer: { ...synthesizerField, description: 'Optional: which model writes the final answer, "claude" or "codex" (you or the other model); the other checks it. Omit to write it yourself (the host); pass it only when the user names who should write it.' },
  max_rounds: roundsField, workspace: workspaceField, web_search: webField, network: networkField, skill: skillField,
};

const jobField = {
  type: 'string',
  description: 'The job_id a council tool returned while still working. Omit to use the most recent job.',
};

export const TOOLS = [
  {
    name: 'council_ask', title: 'Ask the Codex–Claude council',
    description: 'Get one cross-checked answer from Codex (ChatGPT) and Claude: each answers on its own, then they reply to each other until both agree, and one writes the final answer that the other checks. '
      + 'Use it for decisions, reviews and questions where a second model\'s check is worth minutes of waiting; for a quick single opinion use council_ask_codex or council_ask_claude, and for the whole discussion use council_debate. '
      + 'It runs the user\'s local Codex and Claude Code CLIs on their own subscriptions, so it uses both plans\' quota, and takes minutes; a call still running after about 50 s returns a job_id for council_result. '
      + 'With workspace, both models read the project but never change it. Each model keeps its session between calls, so it remembers earlier questions.',
    inputSchema: schema(councilFields), annotations, outputSchema,
  },
  {
    name: 'council_debate', title: 'Codex–Claude debate transcript',
    description: 'Run the same council as council_ask but return the whole discussion as JSON: both opening answers, every exchange with each model\'s reply and verdict, the check of the final answer, and the settings used. '
      + 'Use it when the user wants to see where the models disagreed or how they converged; use council_ask when only the answer matters, since the transcript is long. '
      + 'Same cost and timing as council_ask: both plans\' quota, minutes, and a job_id for council_result if it is still running after about 50 s.',
    inputSchema: schema(councilFields), annotations, outputSchema,
  },
  {
    name: 'council_ask_codex', title: 'Ask Codex (ChatGPT) only',
    description: 'Ask Codex (ChatGPT) alone, through the user\'s Codex CLI signed in with ChatGPT, and return its answer. '
      + 'Use it for a quick second opinion from ChatGPT; use council_ask when the answer should also be cross-checked by Claude, or council_ask_claude for Claude alone. '
      + 'It uses the user\'s ChatGPT plan and usually answers within a minute (longer at high effort, when it returns a job_id for council_result). '
      + 'With workspace it reads the project but never changes it; its session carries over between calls.',
    inputSchema: schema({ model: modelField('codex'), effort: effortField('codex'), workspace: workspaceField, web_search: webField, network: networkField, skill: skillField, session_id: sessionField('codex') }), annotations, outputSchema,
  },
  {
    name: 'council_ask_claude', title: 'Ask Claude only',
    description: 'Ask Claude alone, through the user\'s Claude Code CLI signed in with a Claude subscription, and return its answer. '
      + 'Use it for a quick second opinion from Claude, for example from Codex or ChatGPT; use council_ask when the answer should also be cross-checked by Codex, or council_ask_codex for Codex alone. '
      + 'It uses the user\'s Claude plan and usually answers within a minute (longer at high effort, when it returns a job_id for council_result). '
      + 'With workspace it reads the project in plan mode and never changes it; its session carries over between calls.',
    inputSchema: schema({ model: modelField('claude'), effort: effortField('claude'), workspace: workspaceField, web_search: webField, skill: skillField, session_id: sessionField('claude') }), annotations, outputSchema,
  },
  {
    name: 'council_join', title: 'Discuss with the other model yourself',
    description: 'Take part in the council yourself, in this conversation, with everything you already know, instead of a separate session of your model: '
      + 'you are one member and the plugin runs the other model (Codex if you are Claude, Claude if you are Codex), optionally continuing the user\'s own session of it. '
      + 'The steps are the same as council_ask (answer independently, then reply to each other\'s latest message until both agree, then write and check the final answer). '
      + 'Whenever it is your turn, this tool (or council_turn / council_result) returns the council\'s message to you: write your reply yourself and send it with council_turn. '
      + 'Use this when the user wants you to discuss with the other model, or gives the id of their session of the other model; '
      + 'use council_ask instead when the user wants a council of two separate sessions. Only the other model runs a CLI session; your turns are written here, in this conversation.',
    inputSchema: schema(joinFields), annotations, outputSchema,
  },
  {
    name: 'council_turn', title: 'Send your turn to the council',
    description: 'Send your reply to the council\'s latest message, after council_join, council_turn or council_result returned your turn, and wait for the next step. '
      + 'Only for councils started with council_join; the text is passed to the other model as written, so write the complete reply yourself. '
      + 'If the council is not waiting for you, it says so and you call council_result instead; if the next step takes longer than about 50 s, call council_result with the council_id.',
    inputSchema: {
      type: 'object',
      properties: {
        council_id: { type: 'string', description: 'The council_id from the message you are replying to.' },
        text: { type: 'string', description: 'Your complete reply to that message, written by you.' },
      },
      required: ['council_id', 'text'],
      additionalProperties: false,
    },
    // Sending a reply moves the council on: it changes the council's state (never files).
    annotations: { ...annotations, readOnlyHint: false }, outputSchema,
  },
  {
    name: 'council_result', title: 'Get a running council\'s answer',
    description: 'Wait for a job that returned status working with a job_id (from council_ask, council_debate, council_ask_codex, council_ask_claude or council_join), and return its answer, or with council_join your next turn. '
      + 'Waits up to about 50 s and returns as soon as something is ready; if the job is still working, call it again. '
      + 'Use it instead of asking the same question again, which would start a second job and use the plans twice. Waiting uses no model quota.',
    inputSchema: { type: 'object', properties: { job_id: jobField }, additionalProperties: false }, annotations, outputSchema,
  },
  {
    name: 'council_cancel', title: 'Stop a running council',
    description: 'Stop a running job (a council_ask, council_debate, council_ask_codex, council_ask_claude or council_join): its Codex and Claude CLI processes are ended and its progress is discarded, so its answer can no longer be retrieved. '
      + 'Use it when the user asks to stop, or a council is no longer needed; to check on a job instead, use council_result.',
    inputSchema: { type: 'object', properties: { job_id: jobField }, additionalProperties: false },
    // It ends the job's CLI processes and discards its progress.
    annotations: { ...annotations, readOnlyHint: false, destructiveHint: true }, outputSchema,
  },
];

const INSTRUCTIONS = 'Use council_ask for a cross-checked two-model answer, council_debate for the full transcript, or council_ask_codex / council_ask_claude for one model. '
  + 'Model and effort come from the user\'s config; pass overrides only when the user asks for a specific model or effort. '
  + 'Pass max_rounds only when the user asks for a number of rounds (exchanges; 0 = until they agree, with no limit). '
  + 'When working in a project, always pass workspace (its absolute path) so both models can read it; they run in plan mode and cannot change it. '
  + 'Each model keeps its session for as long as this server runs, so it remembers earlier questions and what it has read. '
  + 'If the user gives the id or name of their own Claude Code or Codex session, pass it (claude_session_id / codex_session_id, or session_id on council_ask_claude / council_ask_codex) to continue that session. '
  + 'Calls run the user\'s local Codex and Claude Code CLIs under their own subscriptions and can take several minutes. '
  + 'Pass skill (an installed skill\'s name, or several separated by commas) only when the user asks to use those skills; each model then uses them at the steps that need them. '
  + 'If a call returns a job_id because it is still working, call council_result (again, until it returns the answer); do not start the same question again. '
  + 'To take part yourself instead of a separate session of your model (for example when the user gives the id of their session of the other model), use council_join; '
  + 'whenever a result says it is your turn, write that reply yourself and send it with council_turn.';

const callCouncil = (name, { question, ...options }, context) => invoke(name, question, options, context);
const SIDE_LABEL = { claude: 'Claude', codex: 'Codex (ChatGPT)' };
const MAX_TURN_LENGTH = 200_000;

// Background jobs. Some hosts end any tool call after about 60 seconds (Claude Desktop's bridge), and a
// council takes minutes. So each tool starts a job and waits up to tool_wait_seconds (0 = until done). A job
// still running then is answered with its id, and council_result waits again: no single call outlasts the
// host's limit, and the council keeps running in between.
const jobs = new Map();
let jobCount = 0;

function startJob(name, args) {
  for (const [id, old] of jobs) if (old.done && Date.now() - old.started > 3_600_000) jobs.delete(id);
  const job = { id: `job-${++jobCount}`, name, started: Date.now(), step: 'starting', done: false, listeners: new Set(), controller: new AbortController(),
    turn: null, wakers: new Set(), me: args.me };
  const onProgress = message => { job.step = message; for (const listener of job.listeners) listener(message); };
  job.promise = callCouncil(name, args, { signal: job.controller.signal, onProgress, hostTurn: (prompt, signal) => hostTurn(job, prompt, signal) })
    .then(text => ({ text }), error => ({ text: error.message, isError: true }))
    .then(outcome => Object.assign(job, { done: true, outcome }).outcome);
  jobs.set(job.id, job);
  return job;
}

// council_join: the caller's own turn. The council waits (up to the longer of timeout_seconds and
// skill_timeout_seconds) until council_turn brings the reply; waiting tool calls return the message at once.
function hostTurn(job, prompt, signal) {
  return new Promise((resolve, reject) => {
    const config = loadConfig();
    const seconds = Math.max(Number(config.timeout_seconds), Number(config.skill_timeout_seconds));
    const finish = () => { clearTimeout(timer); job.turn = null; };
    const timer = setTimeout(() => { finish(); reject(new Error(`no reply to the council's message within ${seconds} s (send it with council_turn)`)); }, seconds * 1000);
    signal?.addEventListener('abort', () => { finish(); reject(new Error('cancelled')); }, { once: true });
    job.turn = { prompt, step: job.step, since: Date.now(), reply: text => { finish(); resolve(text); } };
    for (const wake of job.wakers) wake();
    job.wakers.clear();
  });
}

function yourTurn(job) {
  const me = SIDE_LABEL[job.me] || 'you';
  const other = SIDE_LABEL[job.me === 'claude' ? 'codex' : 'claude'] || 'the other model';
  return `Your turn in the council (council_id: ${job.id}; now: ${job.turn.step}). You are ${me}, discussing with ${other}. `
    + 'Write your reply to the message below yourself, in this conversation, with what you already know and your own tools for reading and searching. '
    + `Do not change any files, and do not hand this to another tool or agent. Then call council_turn with {"council_id": "${job.id}", "text": "<your complete reply>"}. `
    + `Only that text is passed on to ${other}.\n\n<council_message>\n${job.turn.prompt.trim()}\n</council_message>`;
}

// A council_join waiting for the caller's reply keeps its sessions until the reply comes (or its time runs out,
// up to skill_timeout_seconds), so a job waiting for a session names those: the caller may have lost track of one.
function heldBy(job) {
  if (!job.step.startsWith(WAITING)) return '';
  return [...jobs.values()].filter(other => other !== job && !other.done && other.turn)
    .map(other => ` ${other.id} has been waiting ${Math.round((Date.now() - other.turn.since) / 1000)} s for your reply to its turn, and keeps its sessions until then: `
      + `reply with council_turn {"council_id": "${other.id}", "text": ...}, or stop it with council_cancel {"job_id": "${other.id}"}.`).join('');
}

function stillWorking(job) {
  const seconds = Math.round((Date.now() - job.started) / 1000);
  const who = job.name === 'ask_codex' ? 'Codex is' : job.name === 'ask_claude' ? 'Claude is'
    : job.name === 'council_join' ? `${SIDE_LABEL[job.me === 'claude' ? 'codex' : 'claude']} is` : 'The council is';
  return `${who} still working (${seconds} s so far; now: ${job.step}).${heldBy(job)} This can take several minutes.\n`
    + `job_id: ${job.id}\n`
    + `To get the answer, call council_result with {"job_id": "${job.id}"}. It waits up to about a minute and returns the answer as soon as it is ready; `
    + 'if it says the job is still working, call it again. Do not start the same question again. To stop it, call council_cancel.';
}

// Wait for a job until it finishes, needs the caller's turn (council_join), the wait window ends, or this
// call is cancelled.
async function waitForJob(job, { signal, onProgress }) {
  const seconds = Number(loadConfig().tool_wait_seconds);
  if (onProgress) job.listeners.add(onProgress);
  const timers = [];
  let waker;
  try {
    const outcome = await Promise.race([
      job.promise,
      new Promise(resolve => { if (job.turn) resolve('turn'); else job.wakers.add(waker = () => resolve('turn')); }),
      ...(seconds > 0 ? [new Promise(resolve => timers.push(setTimeout(resolve, seconds * 1000, null)))] : []),
      new Promise(resolve => signal?.addEventListener('abort', () => resolve(null), { once: true })),
    ]);
    if (outcome === 'turn') return { status: 'your_turn', text: yourTurn(job), council_id: job.id };
    if (!outcome) return { status: 'working', text: stillWorking(job), job_id: job.id };
    jobs.delete(job.id);
    if (outcome.isError) throw new Error(outcome.text);
    return { status: 'done', text: outcome.text };
  } finally {
    timers.forEach(clearTimeout);
    job.listeners.delete(onProgress);
    job.wakers.delete(waker);
  }
}

function findJob(id) {
  const job = id ? jobs.get(id) : [...jobs.values()].at(-1);
  if (!job) throw new Error(id ? `No job ${id}: it has already returned its answer, was cancelled, or belongs to an earlier session.` : 'No council is running.');
  return job;
}

async function callCouncilTool(published, args, { signal, onProgress }) {
  const name = INTERNAL_NAME[published] ?? published;
  if (process.env[MEMBER_ENV]) throw new Error('This is a council member\'s own session: it cannot start another council. Answer the question yourself.');
  if (name === 'council_result') return waitForJob(findJob(args.job_id), { signal, onProgress });
  if (name === 'council_turn') {
    const job = findJob(args.council_id);
    if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > MAX_TURN_LENGTH) {
      throw new Error(`text must be your reply: 1 to ${MAX_TURN_LENGTH} characters`);
    }
    if (!job.turn) throw new Error(`The council ${job.id} is not waiting for your reply now (now: ${job.step}). Call council_result with {"job_id": "${job.id}"} to wait for your next turn or the answer.`);
    job.turn.reply(args.text.trim());
    return waitForJob(job, { signal, onProgress });
  }
  if (name === 'council_cancel') {
    const job = findJob(args.job_id);
    job.controller.abort();
    jobs.delete(job.id);
    return { status: 'stopped', text: `Stopped ${job.id}.`, job_id: job.id };
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
 * One client's connection: handle(message, send) answers a JSON-RPC request through send, with any progress
 * notifications before the reply. server: { name, title, tools, call(name, args, { signal, onProgress }) -> text or
 * { text, ...structured fields }, instructions }; the council's tools by default. An object is also sent as the
 * result's structuredContent.
 */
function connection(server) {
  const inFlight = new Map();

  async function callTool(id, params, send) {
    const reply = result => send({ jsonrpc: '2.0', id, result });
    const controller = new AbortController();
    inFlight.set(id, controller);
    const token = params._meta?.progressToken;
    let step = 0;
    const onProgress = token === undefined ? undefined : message => {
      if (!controller.signal.aborted) send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: ++step, message } });
    };
    try {
      const result = await server.call(params.name, params.arguments || {}, { signal: controller.signal, onProgress });
      const text = typeof result === 'string' ? result : result.text;
      if (!controller.signal.aborted) reply({ content: [{ type: 'text', text }], ...(typeof result === 'string' ? {} : { structuredContent: result }) });
    } catch (error) {
      if (!controller.signal.aborted) reply({ content: [{ type: 'text', text: error.message }], isError: true });
    } finally {
      inFlight.delete(id);
    }
  }

  function handle(message, send) {
    const { id, method, params } = message;
    const reply = result => send({ jsonrpc: '2.0', id, result });
    if (id === undefined || id === null) {
      if (method === 'notifications/cancelled') inFlight.get(params?.requestId)?.abort();
      return; // other notifications need no reply
    }
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: server.title, version: packageVersion(), icons: [{ src: ICON_URL, mimeType: 'image/png', sizes: ['1254x1254'] }] },
          instructions: server.instructions,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: server.tools });
      case 'tools/call':
        return void callTool(id, params || {}, send);
      default:
        return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  }

  // A message as received: answered through send, including parse errors. Responses to server requests are
  // ignored (none are sent).
  function receive(text, send) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `parse error: ${error.message}` } });
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } });
    if (typeof message.method !== 'string') return;
    try {
      handle(message, send);
    } catch (error) {
      if (message.id !== undefined && message.id !== null) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } });
    }
  }

  const abortAll = () => { for (const controller of inFlight.values()) controller.abort(); server.close?.(); };
  return { receive, abortAll };
}

/** Serve tools over stdio, one JSON-RPC message per line. server: see connection(). */
export function serve({ input = process.stdin, output = process.stdout, server = COUNCIL } = {}) {
  const { receive, abortAll } = connection(server);
  const send = message => output.write(`${JSON.stringify(message)}\n`);
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', line => { if (line.trim()) receive(line, send); });
  lines.on('close', abortAll);
  return { abortAll };
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Serve tools over MCP's Streamable HTTP transport at /mcp/<token>. The secret token in the path is the only key,
 * so the URL also works in clients that take nothing but a URL (claude.ai and ChatGPT connectors). Each POST
 * carries one message and gets one JSON response: no event stream, so no progress notifications (a tool call
 * still returns within tool_wait_seconds). Resolves to { url, close } once listening.
 */
export function serveHttp({ token, port = 8000, host = '127.0.0.1', server = COUNCIL }) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,}$/.test(token)) throw new Error('the token must be at least 16 letters, digits, - or _');
  const path = `/mcp/${token}`;
  const expected = Buffer.from(path);
  // ponytail: one connection for every client, no Mcp-Session-Id. Fine for one person's clients; per-session
  // connections if two clients ever cancel calls with the same request id.
  const { receive, abortAll } = connection(server);
  const answer = (res, status, body) => {
    if (res.headersSent) return;
    res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const http = createServer((req, res) => {
    const requested = Buffer.from(req.url.split('?')[0].replace(/\/$/, ''));
    if (requested.length !== expected.length || !timingSafeEqual(requested, expected)) return answer(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end();
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
      else { answer(res, 413, { error: 'request too large' }); req.destroy(); }
    });
    req.on('end', () => {
      if (res.headersSent) return;
      const text = Buffer.concat(chunks).toString('utf8');
      let message;
      try { message = JSON.parse(text); } catch { /* receive answers it */ }
      const request = typeof message?.method === 'string' && message.id !== undefined && message.id !== null;
      // A request gets its reply (progress notifications are dropped); a notification or response is just
      // accepted; a message that is not JSON-RPC gets its error.
      receive(text, reply => {
        if (reply.id === null) answer(res, 400, reply);
        else if (request && reply.id === message.id) answer(res, 200, reply);
      });
      if (!request) answer(res, 202);
    });
  });
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => {
      const { address, family, port: actual } = http.address();
      resolve({ url: `http://${family === 'IPv6' ? `[${address}]` : address}:${actual}${path}`, close: () => { abortAll(); http.close(); } });
    });
  });
}
