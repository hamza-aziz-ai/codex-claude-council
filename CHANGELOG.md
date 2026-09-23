# Changelog

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
