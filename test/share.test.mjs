import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debateHtml } from '../src/share.mjs';

const result = {
  codex: 'Pick **SQLite**.', claude: 'PostgreSQL.',
  exchanges: [
    { round: 1, codex: 'The VERDICT: DISAGREE in your text is odd.\nStill SQLite.\nVERDICT: DISAGREE', claude: 'Fine, SQLite.\nVERDICT: AGREE', codex_agrees: false, claude_agrees: true },
    { round: 2, codex: 'Agreed.\nVERDICT: AGREE', claude: 'Agreed.\nVERDICT: AGREE', codex_agrees: true, claude_agrees: true },
  ],
  answer: 'Use `SQLite` <b>now</b>.', agreed: true, converged: true,
};

test('a debate page shows the question, both answers, every exchange with its verdict, and the final answer', () => {
  const page = debateHtml(result, 'Postgres & <SQLite>?');
  assert.match(page, /^<!doctype html>/);
  assert.ok(page.includes('Postgres &amp; &lt;SQLite&gt;?'), 'the question is escaped');
  assert.ok(page.includes('Use <code>SQLite</code> &lt;b&gt;now&lt;/b&gt;.'), 'model text is escaped; inline code is kept');
  assert.ok(page.includes('Pick <strong>SQLite</strong>.'));
  assert.equal(page.match(/⇄ Exchange \d/g).length, 2);
  assert.equal(page.match(/class="pill agree"/g).length, 3);
  assert.equal(page.match(/class="pill disagree"/g).length, 1);
  assert.ok(page.includes('The VERDICT: DISAGREE in your text is odd.'), 'only the closing verdict line is removed');
  assert.ok(!/Still SQLite\.\s*VERDICT/.test(page));
  assert.match(page, /Both agree with this answer\. They converged after 2 exchanges\./);
  assert.match(page, /Made with <a href="https:\/\/github\.com\/hamza-aziz-ai\/codex-claude-council">codex-claude-council<\/a>/);
  assert.ok(!/<script/i.test(page), 'no scripts');
});

test('a page for a council that did not agree says so', () => {
  const page = debateHtml({ ...result, agreed: false, converged: false }, 'q');
  assert.match(page, /They did not fully agree after 2 exchanges/);
});
