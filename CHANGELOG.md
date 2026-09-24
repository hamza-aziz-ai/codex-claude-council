# Changelog

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
