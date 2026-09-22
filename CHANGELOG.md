# Changelog

## 0.1.0 (2026-09-22)

First public release.

- MCP tools `council_ask`, `debate`, `ask_codex` and `ask_claude`, with optional per-call model and effort for each side.
- Plugin for Claude Code, Claude Cowork and Codex, served from this repository's marketplace.
- Installer that checks for Node.js 20+, the Claude Code CLI and the Codex CLI before changing anything; optional Claude Desktop chat registration.
- Terminal commands `ask`, `debate`, `codex`, `claude`, `doctor`, `config`, `install`, `uninstall`.
- Uses subscription sign-ins only by default; calls run isolated from user config, tools and files.
