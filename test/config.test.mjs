import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EFFORTS, loadConfig, resolveSide } from '../src/config.mjs';
import { withEnv } from './helpers.mjs';

function withUserConfig(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'council-config-'));
  const path = join(dir, 'config.json');
  if (content !== undefined) writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  try { return withEnv({ COUNCIL_CONFIG: path }, fn); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('packaged defaults apply when there is no user config', () => withUserConfig(undefined, () => {
  const config = loadConfig();
  assert.equal(config.timeout_seconds, 600);
  assert.equal(config.synthesizer, 'codex');
  assert.deepEqual(resolveSide('codex', {}, config), { model: null, effort: 'high' });
  assert.deepEqual(resolveSide('claude', {}, config), { model: null, effort: 'high' });
}));

test('user config merges per side and per-call overrides win', () => withUserConfig(
  '﻿{"codex": {"model": "gpt-5.6-sol", "effort": "xhigh"}, "claude": {"model": "opus"}}',
  () => {
    const config = loadConfig();
    assert.deepEqual(resolveSide('codex', {}, config), { model: 'gpt-5.6-sol', effort: 'xhigh' });
    assert.deepEqual(resolveSide('claude', {}, config), { model: 'opus', effort: 'high' });
    assert.deepEqual(resolveSide('codex', { effort: 'LOW' }, config), { model: 'gpt-5.6-sol', effort: 'low' });
    assert.deepEqual(resolveSide('claude', { model: ' sonnet ', effort: '' }, config), { model: 'sonnet', effort: 'high' });
  },
));

test('effort levels are validated per side', () => withUserConfig(undefined, () => {
  for (const effort of EFFORTS.codex) assert.equal(resolveSide('codex', { effort }).effort, effort);
  for (const effort of EFFORTS.claude) assert.equal(resolveSide('claude', { effort }).effort, effort);
  assert.throws(() => resolveSide('codex', { effort: 'max' }), /codex effort must be one of/);
  assert.throws(() => resolveSide('claude', { effort: 'none' }), /claude effort must be one of/);
}));

test('model names cannot smuggle in flags or shell syntax', () => withUserConfig(undefined, () => {
  for (const model of ['--dangerously', 'a b', 'x;rm', 'x&y', '"q"']) {
    assert.throws(() => resolveSide('codex', { model }), /invalid codex model name/);
  }
  assert.equal(resolveSide('claude', { model: 'claude-opus-5[1m]' }).model, 'claude-opus-5[1m]');
}));

test('broken config files give a clear error', () => {
  withUserConfig('{not json', () => assert.throws(() => loadConfig(), /not valid JSON/));
  withUserConfig({ synthesizer: 'gemini' }, () => assert.throws(() => loadConfig(), /synthesizer/));
  withUserConfig({ timeout_seconds: 0 }, () => assert.throws(() => loadConfig(), /timeout_seconds/));
});
