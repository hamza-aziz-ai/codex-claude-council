// Dependency-free MCP server (JSON-RPC 2.0 over stdio, newline-delimited).
import { createInterface } from 'node:readline';
import { EFFORTS, NAME, packageVersion } from './config.mjs';
import { invoke } from './council.mjs';

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
const councilFields = {
  codex_model: modelField('codex'), codex_effort: effortField('codex'),
  claude_model: modelField('claude'), claude_effort: effortField('claude'),
  synthesizer: synthesizerField, max_rounds: roundsField,
};
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export const TOOLS = [
  {
    name: 'council_ask', title: 'Ask the Codex–Claude council',
    description: 'Ask Codex (ChatGPT) and Claude independently; each critiques the other\'s answer, then replies to the critique of its own. They then draft and review one final answer until both agree with it. Takes minutes at high effort. Optional per-side model/effort overrides.',
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
    inputSchema: schema({ model: modelField('codex'), effort: effortField('codex') }), annotations,
  },
  {
    name: 'ask_claude', title: 'Ask Claude only',
    description: 'Ask Claude alone through Claude Code signed in with a Claude subscription. Optional model/effort overrides.',
    inputSchema: schema({ model: modelField('claude'), effort: effortField('claude') }), annotations,
  },
];

const INSTRUCTIONS = 'Use council_ask for a cross-checked two-model answer, debate for the full transcript, or ask_codex / ask_claude for one model. '
  + 'Model and effort come from the user\'s config; pass overrides only when the user asks for a specific model or effort. '
  + 'Pass max_rounds only when the user asks for a number of rounds (0 = until they agree, with no limit). '
  + 'Calls run the user\'s local Codex and Claude Code CLIs under their own subscriptions and can take several minutes.';

export function serve({ input = process.stdin, output = process.stdout } = {}) {
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
      const { question, ...options } = params.arguments || {};
      const text = await invoke(params.name, question, options, { signal: controller.signal, onProgress });
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
          serverInfo: { name: NAME, title: 'Codex–Claude Council', version: packageVersion() },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
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
  const abortAll = () => { for (const controller of inFlight.values()) controller.abort(); };
  lines.on('close', abortAll);
  return { abortAll };
}
