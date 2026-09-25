---
name: codex-claude-council
description: Ask OpenAI Codex (ChatGPT) and Claude the same question through the user's own signed-in CLIs; they critique each other, reply to the critiques and return one answer both agree with. Use when the user asks for both models, a council or debate, a second opinion from ChatGPT/Codex or Claude, a cross-check of an answer, plan or decision, or to discuss something with their Codex or Claude Code session.
---

# Codex–Claude Council

This plugin's `council` MCP server runs the user's local Codex CLI (ChatGPT sign-in) and Claude Code CLI (Claude subscription sign-in). No API keys are used. The two members answer independently, critique each other, reply to the critiques, then draft and review one answer until both agree.

## Pick the tool

| The user wants | Tool |
|---|---|
| A cross-checked answer from both models (decisions, reviews, plans) | `council_ask` |
| To see where the models agree or disagree: every answer, critique, reply and round | `debate` (JSON; summarise the agreement and disagreements before quoting details) |
| A quick second opinion from one model | `ask_codex` or `ask_claude` |
| **You** to discuss with the other model, or gives only the id of **their session of the other model** (in Claude Code: "discuss with my Codex session 019a…") | `council_join` (see below) |
| Their existing Claude Code **and** Codex sessions to discuss with each other | `council_ask` / `debate` with `claude_session_id` and `codex_session_id` |

## Always pass `workspace` in a project

Pass `workspace`: the absolute path of the project folder you are working in. The members work there in plan mode (Claude) or Codex's read-only sandbox, with the user's own skills, plugins and MCP servers: they read files, search and run read-only commands such as `git log`, `diff` and `blame`. Neither can change anything; they propose changes as plans. In `question`, point them at what matters (files, functions, the failing test, the error or log excerpt, the change you made) instead of pasting whole files. They cannot see this conversation, so state the task and any context that is not in the project. Omit `workspace` only for questions unrelated to any project, and then quote everything they need.

Each member keeps its session for as long as this session runs, so follow-up questions can refer to the earlier discussion.

## Take part yourself: `council_join` and `council_turn`

With `council_join`, you are one of the two members, in this conversation, and the plugin runs only the other model. Set `me` to the model you are (`claude` if you are Claude, `codex` if you are Codex or ChatGPT). If the user gave the id of their session of the other model, pass it as `other_session_id`; otherwise leave it out and the other model starts a new session.

`council_join` (and later `council_turn` or `council_result`) returns "Your turn in the council" with a `council_id` and a `<council_message>`: the same prompt a member gets for that step (answer, critique, reply, draft, review). For each turn:

- Write the reply yourself, as a council member: use what you already know from this session and your own tools to read and search, but do not change any files while the council runs, and do not hand the turn to another agent or tool.
- Follow the message's format exactly: a draft ends with a `---NOTES---` line and notes; a review ends with `VERDICT: AGREE` or `VERDICT: DISAGREE`.
- Send it with `council_turn` (`council_id`, and `text`: your complete reply; only that text reaches the other model). The result is your next turn, the final answer, or "still working" (then call `council_result` with the id).
- Keep going until the final answer arrives, then give it to the user. Do not show every turn unless the user asks.

## Continue the user's own sessions

If the user gives ids of Claude Code or Codex sessions they already have and wants those sessions to discuss, pass `claude_session_id` / `codex_session_id` on `council_ask` / `debate`, or `session_id` on `ask_claude` / `ask_codex`. Each is continued in place, with everything it already knows, in plan mode / read-only; its own folder is the workspace unless you pass one. Never pass the id of your own current session (use `council_join` instead), and never guess an id. Remind the user not to type in those sessions while the council runs.

## Options

Pass options only when the user asks for them; the defaults come from the user's config (`codex-claude-council config`).

- **Model and effort:** `model` / `effort` on `ask_codex` / `ask_claude`; `codex_model`, `codex_effort`, `claude_model`, `claude_effort` on `council_ask` / `debate`; `other_model` / `other_effort` on `council_join`. Codex effort: none, minimal, low, medium, high, xhigh. Claude effort: low, medium, high, xhigh, max. Claude models accept aliases such as opus, sonnet or fable. "ChatGPT" means the Codex side.
- **`synthesizer`:** who drafts the final answer, `claude` (default) or `codex`; the other reviews it. Pass it only when the user names who should write it ("let ChatGPT write the final answer").
- **`max_rounds`:** by default at most 3 draft/review rounds, stopping as soon as both agree. `N` when the user names a number of rounds; `0` when they want agreement without a limit ("until they agree"), which can take a long time.
- **`web_search`:** on by default, so the members can check current versions, APIs and docs. Pass `false` only when the user asks for no internet access.
- **`skill`:** the name of a skill installed for the council or natively for Claude Code / Codex (the tool descriptions list them), for example `llm-council`, `caveman`, `ponytail` or `graphify`. Pass it only when the user asks for that skill, by name or by a phrase the skill says triggers it; never add it on your own. The members then use it, including its sub-agents, at the steps where they judge it is needed. If the tool says the skill is not installed, give the user the install command it names.

Report whether the models agreed (the tool says so at the end). If they did not, give the final draft and summarise the remaining objections.

## Long runs: `job_id` and `council_result`

A council takes minutes, and some apps end tool calls after about 60 seconds. So every tool returns within about 50 seconds: with the answer, with your turn (`council_join`), or with "still working", the current step and a `job_id`. On "still working":

- Call `council_result` with that `job_id`; it waits up to about 50 seconds and returns the answer (or your next turn) as soon as it is ready. Repeat until it does. The council keeps running between calls.
- Do not start the same question again, and do not tell the user it failed: "still working" is normal. You may briefly say which step it is at.
- `council_cancel` stops a job, for example if the user asks to stop.

## Problems

- Before a council, the CLIs it runs are checked for a sign-in, and nothing is sent until they are signed in. If one is not, the tool names it and its login command (`codex login` and choose "Sign in with ChatGPT", or `claude auth login`): relay that to the user, then try again.
- For a missing CLI, a sign-in problem or a usage limit, tell the user plainly and suggest `npx -y github:hamza-aziz-ai/codex-claude-council doctor`. Do not retry in a loop.
- The server runs on the user's own computer; it does not work from cloud-only sessions without their machine.
