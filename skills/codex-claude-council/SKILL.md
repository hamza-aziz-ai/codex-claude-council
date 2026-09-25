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
- `council_join`: you take part yourself, as one member, in this conversation; the plugin runs only the other model. Use it when the user wants you to discuss with the other model, or gives the id of their session of the other model (for example, in Claude Code: "discuss with my Codex session 019a…"). Set `me` to the model you are (`claude` or `codex`) and `other_session_id` to the id they gave.

## Let them read the project: `workspace`

When you are working in a project, always pass `workspace`: the absolute path of the project folder (your working directory). Both models then work in it in plan mode, with the user's own Claude Code / Codex setup: they open files, search and run read-only commands (git log, diff, show, status, blame). Neither can change anything; they propose changes as plans. So in `question`, point them at what matters (files, functions, the failing test, the error or log excerpt, the change you made) instead of pasting whole files. They cannot see this conversation, so state the task and any context that is not in the project, such as an error message or a log you saw.

Both models can also search the web and read web pages (on by default), so they can check current versions, APIs and docs. Pass `web_search: false` only when the user asks for no internet access.

Omit `workspace` only for questions unrelated to any project; the models then start in an empty folder, so quote everything they need in `question`.

Each model keeps one session for as long as this session runs: it remembers earlier council questions and what it has already read, so a follow-up question can refer to the earlier discussion.

## Taking part yourself: `council_join` and `council_turn`

`council_join` (and later `council_turn` / `council_result`) returns "Your turn in the council" with a `council_id` and a `<council_message>`: the same prompt the other member would get for that step (answer, critique, reply, draft, review). For each turn:

- Write the reply yourself, in this conversation, as a council member: use what you already know from this session and your own tools to read and search the project, but do not change any files while the council runs, and do not hand the turn to another agent or tool.
- Follow the message's format exactly (a draft ends with a `---NOTES---` line and notes; a review ends with `VERDICT: AGREE` or `VERDICT: DISAGREE`).
- Send it with `council_turn` (`council_id`, `text`: your complete reply; only that text reaches the other model). The result is your next turn, the final answer, or "still working" (then call `council_result` with the id).
- Keep going until the final answer arrives, then give it to the user. Don't show every turn unless the user asks.

## Continue the user's own sessions

If the user gives the id of a Claude Code or Codex session they already have (for example "continue my Claude session 3f2a… and my Codex session 019a…") and wants those two sessions to discuss, pass it: `claude_session_id` / `codex_session_id` on `council_ask` / `debate`, or `session_id` on `ask_claude` / `ask_codex`. That session is continued in place, with everything it already knows, in plan mode; its own folder is the workspace unless you pass one. Never pass the id of your own current session, and never guess an id. Remind the user not to type in those sessions while the council runs.

## Model and effort

Leave model and effort out unless the user asks for them; the defaults come from the user's config file (`codex-claude-council config`).

- `ask_codex` / `ask_claude`: `model`, `effort` (and `workspace`, as above)
- `council_ask` / `debate`: `codex_model`, `codex_effort`, `claude_model`, `claude_effort` (each side can be set on its own)
- Codex effort: none, minimal, low, medium, high, xhigh. Claude effort: low, medium, high, xhigh, max. Claude models accept aliases such as opus, sonnet or fable.
- "ChatGPT" means the Codex side.
- `synthesizer` on `council_ask` / `debate`: who drafts the final answer, `claude` (the default) or `codex`; the other model reviews it. Pass it only when the user names who should write it, e.g. "let ChatGPT write the final answer".

## Agreement

By default the synthesizer drafts one joint answer and the other model reviews it, for at most 3 rounds, stopping as soon as both agree. `council_ask` and `debate` take an optional `max_rounds` to change that:

- `max_rounds: N` (1 or more): at most N rounds. Use it when the user names a number of rounds.
- `max_rounds: 0`: keep going until both agree, with no limit. Use it when the user asks for agreement without a limit ("until they agree", "keep going until both are happy").

Report whether they agreed (the tool says so at the end of its answer). If they did not, give the final draft and summarise the remaining objections. Mention that no-limit runs can take a long time.

## Installed skills: `skill`

Every tool takes an optional `skill`: the name of a skill the user installed for the council or natively for Claude Code / Codex (the tool descriptions list them), for example `llm-council`, `caveman`, `ponytail` or `graphify`. Pass it only when the user asks to use that skill, by name or by a phrase the skill says triggers it (for example "use the llm-council skill", "council this with llm-council"). Never add it on your own. Both models then get the skill's instructions and use it, including its sub-agents, at the steps where they judge it is needed; other steps are answered directly. Such runs take longer and use more of both plans, so expect several "still working" results. If the tool says the skill is not installed, tell the user the install command it gives.

## Long runs: `job_id` and `council_result`

A council usually takes longer than a single tool call may last in some apps (Claude Desktop ends tool calls after about 60 seconds). So every tool returns within about 50 seconds: with the answer if it is ready, or with "still working", the current step and a `job_id`. When that happens:

- Call `council_result` with that `job_id`. It waits up to about 50 seconds and returns the answer as soon as it is ready. If it says "still working" again, call it again; keep going until the answer arrives. The council keeps running between calls.
- Do not start the same question again, and do not tell the user it failed: "still working" is normal.
- You may briefly tell the user the council is still working and at which step (for example "Round 2: Codex is reviewing the draft").
- `council_cancel` stops a job, for example if the user asks to stop.

## Expectations

- With a `workspace`, the models may take longer on their first question in a session while they read the project; later questions reuse what they read.
- A council run makes six CLI calls (answers, critiques, replies) plus two per agreement round: eight when the models agree on the first draft. At high effort it can take several minutes, and it counts against the user's ChatGPT and Claude plan limits.
- Show the answer, not the mechanics. For `debate`, summarise the agreement and disagreements before quoting details.
- `council_ask` and `debate` check that both CLIs are signed in before sending anything. If either is not, the tool fails with a message naming which one and its login command (`codex login` and choose "Sign in with ChatGPT", or `claude auth login`); relay those steps to the user and ask them to sign in, then try again.
- If a tool reports a missing CLI, a sign-in problem or a usage limit, tell the user plainly and suggest `codex-claude-council doctor` (or `npx -y github:hamza-aziz-ai/codex-claude-council doctor`). Do not retry in a loop.
- The server runs on the user's own computer. It does not work from cloud-only sessions without their machine.
