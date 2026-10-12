// A council run as one shareable HTML page: the question, both opening answers, every exchange (each side's reply
// and verdict, the crossings in between) and the final answer. Self-contained: no scripts, no external files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './config.mjs';

const REPO = 'https://github.com/hamza-aziz-ai/codex-claude-council';
const escape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// The verdict a reply ends with; it is shown as a badge instead. Earlier mentions of a verdict stay.
const VERDICT_LINE = /\n?[^\n]*VERDICT\s*[:-]\s*\**\s*(AGREE|DISAGREE)\b[^\n]*\s*$/i;

// The models write Markdown; this keeps it readable without a renderer: code blocks, inline code and bold.
function prose(text) {
  return escape(String(text ?? '').replace(VERDICT_LINE, '').trim())
    .replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => `<pre><code>${code.replace(/\n$/, '')}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

function logo(name) {
  try { return `data:image/png;base64,${readFileSync(join(PACKAGE_ROOT, 'assets', 'logos', `${name}.png`)).toString('base64')}`; } catch { return ''; }
}

const card = (side, title, text, agrees) => `
      <article class="card ${side}">
        <header><span class="who">${title}</span>${agrees === undefined ? '' : `<span class="pill ${agrees ? 'agree' : 'disagree'}">${agrees ? 'agrees' : 'not yet'}</span>`}</header>
        <div class="text">${prose(text)}</div>
      </article>`;

/** The page for a debate result (the JSON of the debate tool) and its question. */
export function debateHtml(result, question) {
  const exchanges = result.exchanges ?? [];
  const outcome = result.agreed
    ? `Both agree with this answer. They converged after ${exchanges.length} exchange${exchanges.length === 1 ? '' : 's'}.`
    : result.converged ? 'They converged, but the final text was not confirmed.' : `They did not fully agree after ${exchanges.length} exchange${exchanges.length === 1 ? '' : 's'}; the answer sets out the points in dispute.`;
  const icon = (name, alt) => (logo(name) ? `<img src="${logo(name)}" alt="${alt}" class="logo ${name}">` : '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChatGPT × Claude: ${escape(String(question).slice(0, 80))}</title>
<style>
  :root { --bg: #0d1117; --panel: #161b22; --line: #30363d; --text: #e6edf3; --muted: #9198a1; --green: #10a37f; --orange: #d97757; --gold: #f5b800; }
  @media (prefers-color-scheme: light) { :root { --bg: #ffffff; --panel: #f6f8fa; --line: #d1d9e0; --text: #1f2328; --muted: #59636e; --gold: #b88a00; } .logo.openai { filter: invert(1); } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 32px 16px 48px; }
  .hero { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 8px; }
  .logo { width: 44px; height: 44px; }
  .hero .x { color: var(--gold); font-size: 22px; font-weight: 700; }
  h1 { text-align: center; font-size: 15px; letter-spacing: .14em; text-transform: uppercase; margin: 0 0 24px; background: linear-gradient(90deg, var(--green), var(--orange)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .question { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin-bottom: 28px; font-size: 17px; white-space: pre-wrap; }
  .question b { display: block; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .step { text-align: center; color: var(--gold); font-weight: 700; margin: 18px 0 12px; }
  .step span { color: var(--muted); font-weight: 400; }
  .card { background: var(--panel); border: 1px solid var(--line); border-top: 3px solid; border-radius: 12px; padding: 14px 18px; min-width: 0; }
  .card.codex { border-top-color: var(--green); } .card.claude { border-top-color: var(--orange); }
  .card header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .who { font-weight: 700; } .codex .who { color: var(--green); } .claude .who { color: var(--orange); }
  .pill { font-size: 12px; border-radius: 999px; padding: 1px 10px; border: 1px solid var(--line); color: var(--muted); }
  .pill.agree { color: var(--green); border-color: var(--green); }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow-x: auto; white-space: pre; }
  code { font: 13px/1.5 ui-monospace, 'Cascadia Mono', Consolas, monospace; }
  .final { margin-top: 28px; border: 2px solid var(--gold); border-radius: 14px; padding: 18px 22px; background: var(--panel); }
  .final h2 { margin: 0 0 4px; font-size: 18px; color: var(--gold); }
  .final .outcome { color: var(--muted); margin: 0 0 12px; }
  footer { margin-top: 36px; text-align: center; color: var(--muted); font-size: 13px; }
  footer a { color: var(--text); }
  footer code { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; }
  @media (max-width: 720px) { .row { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <div class="hero">${icon('openai', 'ChatGPT')}<span class="x">×</span>${icon('claude', 'Claude')}</div>
  <h1>ChatGPT and Claude, in council</h1>
  <div class="question"><b>The question</b>${escape(question)}</div>

  <div class="step">Opening answers <span>· each on its own</span></div>
  <div class="row">${card('codex', 'ChatGPT', result.codex)}${card('claude', 'Claude', result.claude)}
  </div>
${exchanges.map(e => `
  <div class="step">⇄ Exchange ${e.round} <span>· each replies to the other's latest message</span></div>
  <div class="row">${card('codex', 'ChatGPT', e.codex, e.codex_agrees)}${card('claude', 'Claude', e.claude, e.claude_agrees)}
  </div>`).join('')}

  <section class="final">
    <h2>◆ One answer</h2>
    <p class="outcome">${escape(outcome)}</p>
    <div class="text">${prose(result.answer)}</div>
  </section>

  <footer>
    Made with <a href="${REPO}">codex-claude-council</a>: ChatGPT and Claude discuss with each other until they agree.<br><br>
    <code>npx -y codex-claude-council install</code>
  </footer>
</main>
</body>
</html>
`;
}
