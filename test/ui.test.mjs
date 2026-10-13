import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { sixelTerminal } from '../src/ui.mjs';

// A terminal that answers ESC [ c (DA1) with reply (or not at all), and records what is sent to it.
function terminal(reply) {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true, raw: false, setRawMode(on) { this.raw = on; }, setEncoding() {}, resume() {}, pause() {},
  });
  const stdout = { sent: '', write(text) { this.sent += text; if (reply) setImmediate(() => stdin.emit('data', reply)); } };
  return { stdin, stdout };
}
const env = { TERM: 'xterm-256color' }; // nothing that names a sixel terminal, as over ssh

test('the banner image: a terminal is asked whether it draws sixel images when its environment does not say', async () => {
  const sixel = terminal('\x1b[?62;4;22c');
  assert.equal(await sixelTerminal({ env, ...sixel, isTty: true }), true, '4 in the DA1 reply: sixel');
  assert.equal(sixel.stdout.sent, '\x1b[c');
  assert.equal(sixel.stdin.raw, false, 'the terminal is left as it was');
  assert.equal(await sixelTerminal({ env, ...terminal('\x1b[?62;22c'), isTty: true }), false, 'no 4: no image');
  const silent = terminal(null);
  const started = Date.now();
  assert.equal(await sixelTerminal({ env, ...silent, isTty: true }), false, 'no answer: no image');
  assert.ok(Date.now() - started < 1000, 'a silent terminal is not waited for long');
  assert.equal(silent.stdin.raw, false);
});

test('the banner image: known terminals and COUNCIL_BANNER decide without asking', async () => {
  const asked = terminal('\x1b[?62;4c');
  assert.equal(await sixelTerminal({ env: { WT_SESSION: 'x' }, ...asked, isTty: true }), true);
  assert.equal(await sixelTerminal({ env: { ...env, COUNCIL_BANNER: 'image' }, ...asked, isTty: true }), true);
  assert.equal(await sixelTerminal({ env: { WT_SESSION: 'x', COUNCIL_BANNER: 'text' }, ...asked, isTty: true }), false);
  assert.equal(await sixelTerminal({ env: { TERM_PROGRAM: 'vscode' }, ...asked, isTty: true }), false);
  assert.equal(await sixelTerminal({ env: { WT_SESSION: 'x' }, ...asked, isTty: false }), false, 'not a terminal: no image');
  assert.equal(asked.stdout.sent, '', 'none of these asked the terminal');
});
