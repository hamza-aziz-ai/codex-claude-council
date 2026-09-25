// Configuration: packaged defaults <- user config file <- per-call overrides.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NAME = 'codex-claude-council';
export const SIDES = Object.freeze(['codex', 'claude']);
export const EFFORTS = Object.freeze({
  codex: Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']),
  claude: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
});
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
const SIDE_ALIASES = { codex: 'codex', chatgpt: 'codex', openai: 'codex', gpt: 'codex', claude: 'claude', anthropic: 'claude' };

/** "codex" or "claude" from a side name or alias (ChatGPT means the Codex side); null if unrecognised. */
export function sideName(value) {
  return typeof value === 'string' ? SIDE_ALIASES[value.trim().toLowerCase()] ?? null : null;
}

export function packageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
}

export function userConfigPath() {
  return process.env.COUNCIL_CONFIG || join(homedir(), `.${NAME}`, 'config.json');
}

function readJson(path, optional) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (optional && error.code === 'ENOENT') return {};
    throw new Error(`could not read ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

/** Re-read on every call, so edits to the user config apply without restarting anything. */
export function loadConfig() {
  const defaults = readJson(join(PACKAGE_ROOT, 'src', 'defaults.json'), false);
  const user = readJson(userConfigPath(), true);
  const config = { ...defaults, ...user };
  for (const side of SIDES) config[side] = { ...defaults[side], ...(user[side] || {}) };
  if (!(Number(config.timeout_seconds) > 0)) throw new Error('config: timeout_seconds must be a positive number');
  config.synthesizer = sideName(config.synthesizer);
  if (!config.synthesizer) throw new Error('config: synthesizer must be "claude" or "codex" (ChatGPT)');
  if (!(Number(config.tool_wait_seconds) >= 0)) throw new Error('config: tool_wait_seconds must be a number of seconds (0 = wait until finished)');
  if (typeof config.web_search !== 'boolean') throw new Error('config: web_search must be true or false');
  config.max_rounds ??= null;
  if (config.max_rounds !== null && !(Number.isInteger(config.max_rounds) && config.max_rounds >= 0)) {
    throw new Error('config: max_rounds must be a whole number (0 = until both agree), or null for a single pass');
  }
  return config;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Resolve model and effort for one side: per-call override first, then config. */
export function resolveSide(side, overrides = {}, config = loadConfig()) {
  const base = config[side] || {};
  const model = text(overrides.model) ?? text(base.model);
  const effort = (text(overrides.effort) ?? text(base.effort))?.toLowerCase() ?? null;
  if (model && !MODEL_NAME.test(model)) throw new Error(`invalid ${side} model name: ${JSON.stringify(model)}`);
  if (effort && !EFFORTS[side].includes(effort)) {
    throw new Error(`${side} effort must be one of: ${EFFORTS[side].join(', ')} (got ${JSON.stringify(effort)})`);
  }
  return { model, effort };
}
