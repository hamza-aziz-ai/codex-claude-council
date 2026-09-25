# Changelog

## 0.8.1 (2026-09-25)

- **Sessions by name.** Wherever a session id is taken (`claude_session_id`, `codex_session_id`, `session_id`, `other_session_id`, and `--claude-session`, `--codex-session`, `--session`), the name the user gave the session with `/rename` works too, spaces included. Claude Code names are read from the session's own transcript (its latest `custom-title` entry), Codex names from `~/.codex/session_index.jsonl`. The most recently used session with that name is taken, an exact match before one that differs only in case, and it is resumed by its id in its own folder. Checked with a real Claude Code session renamed with `/rename`. Codex also resolves simple names itself, so a Codex name not found in the index is passed on.
- Session ids and names starting with `-` are refused, so none is passed to a CLI as an option. The error for an unknown name says where to find the id or how to set a name.

## 0.8.0 (2026-09-25)

- **Plan mode instead of a locked-down sandbox.** Claude Code now runs in plan mode (`--permission-mode plan`) with the user's own setup (skills, plugins, MCP servers, `CLAUDE.md`, permission rules) instead of `--restricted` with a fixed tool list. It reads, searches and runs read-only commands such as `git log` and `git diff` itself, and every edit, write or other command is refused (checked with the real CLI). A system-prompt note keeps its full answer in its reply, since plan mode otherwise steers it to a plan file and ExitPlanMode. Codex has no plan mode in `codex exec`, so it keeps its read-only sandbox, now with the user's own `config.toml` and rules; `-c sandbox_mode="read-only"` still wins over any config (checked, including a config with full access). The prompts tell both they are in plan mode and should propose changes as plans.
- The read-only git tools server (`src/git-mcp.mjs`) is gone: Claude runs git itself in plan mode.
- The plugin is switched off inside its own members (`--disallowedTools` for Claude, `plugins."codex-claude-council@codex-claude-council".enabled=false` for Codex), and its server refuses to start a council when run inside one, so a member can't start a council of its own.
- **Continue your own sessions.** Pass `claude_session_id` / `codex_session_id` (`--claude-session` / `--codex-session` in the terminal), or `session_id` on `ask_claude` / `ask_codex` (`--session`), and the council continues those sessions in place, with their memory, instead of starting new ones. Each runs in the folder it was started in (read from the session's transcript), which is also the default workspace. `debate` reports the sessions in `settings`.
- **`skill add` installs every skill in a repository**, each with its own files (references, scripts): it clones the repository and finds each `SKILL.md`, taking the main copy where a repository keeps copies for other tools. Tested with caveman (20 skills), ponytail (6), graphify (1) and llm-council (1). Without git it falls back to the repository's top-level `SKILL.md`. Skills installed natively for Claude Code or Codex (`~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`) can be named with `skill` too. The skill note tells the models where the skill's files are, and to skip steps that would write files (such as building graphify's graph) and say so.
- **Take part yourself: `council_join`.** The host (a Claude Code or Codex session) can be one of the two members itself instead of a separate session of its model: `council_join` (`me`: the model it is; `other_session_id`: optionally the user's session of the other model, continued in place) runs only the other model and hands each of the host's turns to it, the same prompts a member gets, and `council_turn` sends its reply back. So from Claude Code session `abcd`, "discuss with my Codex session efgh" makes `abcd` itself the Claude member and continues `efgh` as the Codex member. Only the other side's CLI and sign-in are checked. The host's turns wait up to the longer of `timeout_seconds` and `skill_timeout_seconds`. Checked with a real Claude Code session as the host.
- **Documentation reorganised:** the README now covers who takes part (new sessions, your sessions, or the host itself), what each member can use, the options, and a single tool reference; the plugin's skill tells the host which tool fits which request.
- Folded `description: >` blocks in a SKILL.md's frontmatter are read correctly.

## 0.7.0 (2026-09-25)

- **Skills for the council.** Install a skill (a `SKILL.md`) once with `codex-claude-council skill add <GitHub URL | SKILL.md | folder>`, for example `skill add https://github.com/aiwithremy/claude-skills-llm-council`; `skill list` and `skill remove <name>` manage them. Skills live in `~/.codex-claude-council/skills/<name>/`; none ship with the plugin.
- Every tool takes `skill` (`--skill <name>` in the terminal), passed only when the user asks for that skill. Both models get its full instructions with the question and decide at which steps it is needed (for example a real decision, trade-off or disagreement, by the skill's own guidance); other steps are answered directly. When they use it, they follow it fully, including sub-agents: Claude gets its Agent tool and Codex its multi-agent feature, with the same read-only access as the model. The discussion's rules win over the skill's: no files are written, and each step returns the format it asks for. `debate` reports the skill in `settings`.
- Calls with a skill may run up to `skill_timeout_seconds` (new, default 1800) instead of `timeout_seconds`.
- Claude's answer is now read from its `stream-json` output: the text of its final turn after its last tool call. With `--output-format json` only the last message came back, so a skill that ends with "the verdict above is your answer" lost the verdict.

## 0.6.2 (2026-09-25)

- **Councils no longer die at a host's 60-second tool limit.** Some apps end any tool call after about 60 seconds (Claude Desktop's bridge), and a council takes minutes, so `debate` and `council_ask` were cut off. Now every tool starts its work in the background and waits up to `tool_wait_seconds` (default 50). It returns the answer if it is ready, and otherwise "still working", the current step and a `job_id`. The new `council_result` tool waits again (up to the same window) and returns the answer as soon as it is ready; `council_cancel` stops a job. No single call outlasts the limit, and the council keeps running between calls. The skill and the server instructions tell the host to keep calling `council_result` and not to restart the question. Set `"tool_wait_seconds": 0` to wait for the answer in one call.

## 0.6.1 (2026-09-24)

- New `update` command: `npx -y github:hamza-aziz-ai/codex-claude-council update` refreshes the marketplace and updates the plugin in Claude Code and Codex (`--only`, `--dry-run`). If an update step fails because the plugin is not installed, it says to run `install`.
- README: installation steps brought up to date (requirements with install commands, what the installer does, passing options on Windows, an Update section, Windows "Access is denied" guidance).

## 0.6.0 (2026-09-24)

- **Both models can search the web.** Codex runs with its live web search (`-c web_search="live"`), which runs on OpenAI's side; its sandbox stays read-only, with no network for commands. Claude gets WebSearch and WebFetch. Their first prompt for each question says they can use the web for facts that change or that they are unsure of, prefer primary sources, and say where a fact came from. The critique and review prompts ask them to check claims against the web as well as the project. Checked against the real Claude Code CLI: both web tools work under `--restricted` and `dontAsk`, while the shell and Write stay unavailable.
- On by default. Turn it off with `web_search: false` on any tool, `--no-web` in the terminal, or `"web_search": false` in the config. `debate` reports it in `settings`.
- With web access and a workspace together, text in the project could in principle try to get a model to send project content to a website. See Security and privacy in the README; turn web access off for sensitive projects.

## 0.5.2 (2026-09-24)

- **Security: Claude no longer runs git in a shell.** Denying risky git options by name could be bypassed: git accepts abbreviated options (`git blame --content /etc/passwd -- README.md` still read the file), and `git diff /etc/passwd README.md` compares an outside file without any option. Claude now has no shell at all. Instead, the plugin gives it read-only git tools (`src/git-mcp.mjs`: status, log, diff, show, a file at a revision, blame) that run git with a fixed argument list. Every path must be relative and stay inside the project, also through links, and always comes after `--`. Every revision is checked and can't start with `-`, so no argument can become an option or an outside file. External diff programs and textconv filters are off. Checked against the real Claude Code CLI: the git tools work, and outside paths, option-like revisions, the shell, Read outside the project and Write are all refused.
- **A cancelled council lets go at once.** A council waiting for a session held by another call now stops waiting when it is cancelled, and releases any session it already holds, instead of holding it until the other call finishes.
- **Windows: updating the Codex plugin no longer fails while Codex is running.** Codex starts the plugin's server with the plugin folder as its working folder, and Windows cannot move a folder that is in use, so `codex plugin add` failed with "Access is denied (os error 5)". The server now leaves that folder when it starts. The installer also explains this error if it still happens: quit the Codex and Claude apps, then run it again.

## 0.5.1 (2026-09-24)

- Only a model that can read the project is asked to check claims against it. Without a workspace, the critique and review prompts no longer mention a project.
- **Security: Claude could read files outside the project through git options.** For example, `git blame --contents /etc/passwd -- README.md` was allowed and printed the file. The git options that read a file outside the project are now denied: `blame --contents`, `-S` and `--ignore-revs-file`, `ls-files -X` and `--exclude-from`, and `diff -O` and `--orderfile` (`--no-index` already was). Checked against the real Claude Code CLI: all are refused, while `blame -L`, `log -S`, `diff` and `status` still run.
- **Two councils started at once no longer mix their turns.** With the same workspace and models they share each side's session, and only single turns took turns, so their prompts could interleave (one council's answer, the other's answer, then a critique). As each prompt now carries only what a model has not seen, a model could critique the other council's question. A council now holds both sessions from start to finish; the other one waits.

## 0.5.0 (2026-09-24)

- **Both models can read your project.** New `workspace` option on all four tools (`--workspace` in the terminal, which defaults to the git repository you are in; `--no-workspace` for none). Both models then work in that folder: they can open files, search and run read-only git commands (log, diff, show, status, blame) to check facts about code, changes, fixes and logs. The skill tells the host to pass the project folder whenever it is working in one.
- **Neither can change it.** Codex runs in its read-only sandbox (enforced by the operating system), now also set with `-c sandbox_mode="read-only"` so it holds when a session is resumed, and ignores `.rules` files. Claude Code runs with `--restricted` (no user, project or local settings, so no hooks, plugins or allow rules from them) and `--permission-mode dontAsk`, with only Read, Grep, Glob and a list of read-only git commands allowed; options that would make git write a file (`--output`) or run or read something else (`--ext-diff`, `--no-index`) are denied.
- **Each model keeps one session.** Instead of a new, memoryless CLI session for every prompt, each side keeps one Codex / Claude Code session for as long as the MCP server runs, which is as long as your Claude Code or Codex session. It remembers earlier questions, the discussion and what it has already read, so it does not re-read the project for every prompt. Each prompt now carries only what that model has not seen yet (the other model's answer, critique or reply), rather than the whole discussion. A new host session starts new council sessions; in the terminal, each command is one pair of sessions.
- `debate` reports the workspace in `settings`.
- Needs a recent Claude Code (with `--restricted`) and Codex CLI (with `codex exec resume`); an "unknown option" error now says to update.

## 0.4.1 (2026-09-24)

- **Both sign-ins are checked before a council starts.** `council_ask` and `debate` (`ask` and `debate` in the terminal) first check, side by side, that the Codex CLI and the Claude Code CLI are installed and signed in. If either is not, the run stops before either model is sent anything, with one error naming each CLI that needs attention and how to sign in (`codex login`, `claude auth login`). Before, the two models started together, so the model that was signed in could already have been sent the question when the other one failed, and the error named only the first problem.

## 0.4.0 (2026-09-24)

- **Each model now replies to the critique of its answer.** After the cross-critiques, the critiques are swapped: each model sees the other's critique of its own answer, accepts what is right and explains where it still disagrees. The final answer is written from the whole discussion (both answers, both critiques, both replies), in both directions whoever the synthesizer is.
- **Both models agree on the final answer by default.** The draft/review loop now runs by default, for at most 3 rounds. Set `"max_rounds"` in the config to change the default: `0` for no limit, or `null` for the previous single pass. A per-call `max_rounds` still wins.
- Each critic sees its own answer as well as the other model's, and in the agreement loop both the drafter and the reviewer see the whole discussion. The reviewer also sees its own previous objections, so it can check that they were answered.
- `debate` includes `codex_reply` and `claude_reply`.
- A cancelled or timed-out call now finishes only once its CLI process has exited, and when one side fails the council waits for the other side's stopped call before returning. On Windows, where the kill runs asynchronously, a stopped process could briefly outlive the call.
- A run now makes six calls before the agreement loop (was four), plus two per round: eight when the models agree on the first draft. The single pass is seven calls (was five).

## 0.3.2 (2026-09-23)

- Moved the command-line entry point from `bin/` to `scripts/`: claude.ai rejects a plugin that has a top-level `bin/` directory, which made "Add marketplace" in Claude Desktop fail with "Marketplace sync failed". The command itself is unchanged.

## 0.3.1 (2026-09-22)

- Install steps for the ChatGPT desktop app, and corrected steps for Claude Desktop (Settings → Plugins → Add from a repository → Sync), in the README and the installer's closing message.

## 0.3.0 (2026-09-22)

- **Claude now writes the final answer by default** (previously Codex). Change the default with `"synthesizer"` in the config file, or per question with the new `synthesizer` option on `council_ask` / `debate` (`--synthesizer` in the terminal). `chatgpt` is accepted as another name for `codex`.
- In the agreement loop the synthesizer drafts the joint answer and the other model reviews it, so with the new default Claude drafts and Codex (ChatGPT) reviews.

## 0.2.0 (2026-09-22)

- New `max_rounds` option on `council_ask` and `debate` (`--max-rounds` in the terminal): after the critiques, the synthesizer drafts one joint answer and the other model reviews it until both agree. Omit it for the usual single pass; `N` allows at most N rounds (stopping early on agreement); `0` means no limit.
- `debate` reports every draft/review round, whether the models agreed and why a loop stopped; `council_ask` says whether both models agree with the final answer.
- If a call fails partway through the loop (for example a usage limit), the latest draft is returned with the reason instead of losing the run.
- Progress notifications for MCP clients that request them, and progress lines on stderr in the terminal.
- Codex plugin: raise the MCP tool timeout from Codex's 60-second default so long council runs are not cut off.

## 0.1.0 (2026-09-22)

First public release.

- MCP tools `council_ask`, `debate`, `ask_codex` and `ask_claude`, with optional per-call model and effort for each side.
- Plugin for Claude Code, Claude Cowork and Codex, served from this repository's marketplace.
- Installer that checks for Node.js 20+, the Claude Code CLI and the Codex CLI before changing anything; optional Claude Desktop chat registration.
- Terminal commands `ask`, `debate`, `codex`, `claude`, `doctor`, `config`, `install`, `uninstall`.
- Uses subscription sign-ins only by default; calls run isolated from user config, tools and files.
