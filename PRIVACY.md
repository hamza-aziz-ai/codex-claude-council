# Privacy policy

*Codex–Claude Council, effective October 27, 2026.*

Codex–Claude Council is an open-source plugin and MCP server that runs on your computer. It has no servers, no accounts and no telemetry: its maintainer receives none of your data.

## What is sent, and to whom

- **Your questions, the discussion, and what the models read go to OpenAI and Anthropic.** The plugin runs your own Codex CLI (signed in with ChatGPT) and Claude Code CLI (signed in with your Claude subscription). Each question, every exchange between the two models, and any files or web pages they choose to read are sent to those companies by their CLIs, exactly as in your normal sessions, under your accounts and their policies:
  - OpenAI: <https://openai.com/policies/privacy-policy/>
  - Anthropic: <https://www.anthropic.com/legal/privacy>
- **A side set to `"via": "api"`** (optional, off by default) sends the same to its provider directly, through the provider's API under your API key, instead of through its CLI: the prompts, the discussion, and the project files that model reads with the plugin's read-only tools. OpenAI's side is sent with `store: false`, so OpenAI doesn't keep the conversation on its servers; Anthropic's API terms apply to Claude's side.
- **Web search**, when it is on (the default), is done by the models through their CLIs and providers, as in your normal sessions. Turn it off with `web_search: false`.
- **GitHub, only when you install a skill** with `codex-claude-council skill add <URL>`: the plugin downloads the skill from the URL you give (GitHub or raw.githubusercontent.com) or clones its repository with `git`.
- **npm and GitHub when you install or update** the plugin (`npx codex-claude-council …`, the plugin marketplaces), as with any package, and npm when you run `codex-claude-council api-setup`.

Nothing else leaves your computer: the plugin makes no other network requests, has no analytics or crash reporting, and does not send your data to its maintainer or any third party.

## What is stored on your computer

- **Settings and installed skills:** `~/.codex-claude-council/` (`config.json`, `skills/`, and `api-sdks/` after `api-setup`).
- **A conversation through an API** is kept in the plugin server's memory while it runs, and is gone when it stops.
- **The models' sessions:** saved by the Codex and Claude Code CLIs in their own folders (`~/.codex`, `~/.claude`), like your other sessions; a council without a project folder runs them in temporary folders.
- **Claude Desktop's settings,** only if you run the installer with `--claude-desktop`: it adds the server to `claude_desktop_config.json` and keeps a backup of the previous file next to it.
- **Discussion pages,** only where you ask for one (`--html <file>`).

Deleting `~/.codex-claude-council/` and uninstalling the plugin removes everything the plugin itself stored; sessions are removed with the CLIs' own tools.

## Your project files

The two models can read your project when you pass a folder (`workspace`), and what they read is sent to OpenAI or Anthropic as above. They cannot change your files: Codex runs in its read-only sandbox and Claude Code in plan mode (see [Security and privacy](README.md#security-and-privacy)).

## Changes and contact

Changes to this policy are made in this file, and its history is public. Questions: open an issue at <https://github.com/hamza-aziz-ai/codex-claude-council/issues>.
