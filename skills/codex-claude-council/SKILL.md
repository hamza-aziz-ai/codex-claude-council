---
name: codex-claude-council
description: Ask OpenAI Codex (ChatGPT) and Claude the same question through the user's own signed-in CLIs; they critique each other, reply to the critiques and return one answer both agree with. Use when the user asks for both models, a council or debate, a second opinion from ChatGPT/Codex or Claude, or a cross-check of an answer, plan or decision.
---

# Codex–Claude Council

This plugin's `council` MCP server runs the user's local Codex CLI (ChatGPT sign-in) and Claude Code CLI (Claude subscription sign-in). No API keys are used.

## Pick the tool

- `council_ask`: both models answer independently, each critiques the other's answer, each replies to the critique of its own answer, then they draft and review one final answer until both agree with it. Use for decisions, reviews and anything worth cross-checking.
- `debate`: the same run, returned as JSON with both answers, both critiques, both replies, every draft/review round and the model/effort settings used. Use when the user wants to see where the models agree or disagree.
- `ask_codex` / `ask_claude`: one model only, for a quick second opinion.

Put everything the models need into `question`: they run in an empty folder with no tools and cannot see this conversation, the user's files or earlier messages. Quote the relevant code, text or numbers.

## Model and effort

Leave model and effort out unless the user asks for them; the defaults come from the user's config file (`codex-claude-council config`).

- `ask_codex` / `ask_claude`: `model`, `effort`
- `council_ask` / `debate`: `codex_model`, `codex_effort`, `claude_model`, `claude_effort` (each side can be set on its own)
- Codex effort: none, minimal, low, medium, high, xhigh. Claude effort: low, medium, high, xhigh, max. Claude models accept aliases such as opus, sonnet or fable.
- "ChatGPT" means the Codex side.
- `synthesizer` on `council_ask` / `debate`: who drafts the final answer, `claude` (the default) or `codex`; the other model reviews it. Pass it only when the user names who should write it, e.g. "let ChatGPT write the final answer".

## Agreement

By default the synthesizer drafts one joint answer and the other model reviews it, for at most 3 rounds, stopping as soon as both agree. `council_ask` and `debate` take an optional `max_rounds` to change that:

- `max_rounds: N` (1 or more): at most N rounds. Use it when the user names a number of rounds.
- `max_rounds: 0`: keep going until both agree, with no limit. Use it when the user asks for agreement without a limit ("until they agree", "keep going until both are happy").

Report whether they agreed (the tool says so at the end of its answer). If they did not, give the final draft and summarise the remaining objections. Mention that no-limit runs can take a long time.

## Expectations

- A council run makes six CLI calls (answers, critiques, replies) plus two per agreement round: eight when the models agree on the first draft. At high effort it can take several minutes, and it counts against the user's ChatGPT and Claude plan limits.
- Show the answer, not the mechanics. For `debate`, summarise the agreement and disagreements before quoting details.
- `council_ask` and `debate` check that both CLIs are signed in before sending anything. If either is not, the tool fails with a message naming which one and its login command (`codex login` and choose "Sign in with ChatGPT", or `claude auth login`); relay those steps to the user and ask them to sign in, then try again.
- If a tool reports a missing CLI, a sign-in problem or a usage limit, tell the user plainly and suggest `codex-claude-council doctor` (or `npx -y github:hamza-aziz-ai/codex-claude-council doctor`). Do not retry in a loop.
- The server runs on the user's own computer. It does not work from cloud-only sessions without their machine.
