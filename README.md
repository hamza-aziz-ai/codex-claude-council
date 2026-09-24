# Codex–Claude Council

[![CI](https://github.com/hamza-aziz-ai/codex-claude-council/actions/workflows/ci.yml/badge.svg)](https://github.com/hamza-aziz-ai/codex-claude-council/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-20%2B-brightgreen)

Ask **ChatGPT (through Codex)** and **Claude** the same question. Each gives its own answer, hears the other's critique of it and replies, and together they settle on one answer that both agree with, using the subscriptions you already have. No API keys.

Works inside **Claude Code**, **Claude Desktop** (Cowork), **Codex**, the **ChatGPT desktop app** and your **terminal**, on Windows, macOS and Linux. You can pick the model and effort for each side, per question.

```mermaid
flowchart LR
    Q[Your question] --> CA[Codex answers]
    Q --> LA[Claude answers]
    LA --> CC[Codex critiques Claude's answer]
    CA --> LC[Claude critiques Codex's answer]
    CC --> LRe[Claude replies to Codex's critique]
    LC --> CRe[Codex replies to Claude's critique]
    CRe & LRe --> D[Draft one joint answer]
    D --> R{Other model reviews}
    R -- disagrees --> D
    R -- agrees --> A[Answer both agree with]
```

1. **Answer**: both models answer on their own, without seeing each other.
2. **Critique**: each reviews the other's answer.
3. **Reply**: the critiques are swapped. Each model reads what the other said about its answer and replies: it accepts the points that are right and explains where it still disagrees.
4. **Agree**: one model drafts a joint answer from the whole discussion and the other reviews it. They repeat until both agree (at most 3 rounds by default).

The conversation goes both ways whoever writes the final answer, and from step 2 on each model sees the whole discussion so far.

**Both models can read your project.** In a coding session, both models work in your project folder (the `workspace`). They can open files, search, and look at git history, changes and blame (`log`, `diff`, `show`, `status`, `blame`) to check facts about the code, a change, a fix or a log before relying on it. **Neither can change anything:** Codex runs in its read-only sandbox, enforced by the operating system, and Claude Code has only read tools and a read-only git tool, with no shell; everything else is refused.

**Both models can search the web.** Codex uses its built-in live web search and Claude uses WebSearch and WebFetch, so they can check current versions, APIs, docs and error messages instead of relying on memory. It is on by default; pass `web_search: false` for one question, `--no-web` in the terminal, or set `"web_search": false` in your config to turn it off.

**Each model keeps one session.** Each side keeps a single Codex / Claude Code session for as long as your host session runs, so it remembers earlier questions, the discussion and what it has already read, instead of reading the project again for every prompt. Each prompt carries only what that model has not seen yet. When you start a new Claude Code or Codex session, the council starts new sessions too.

## Requirements

| | |
|---|---|
| [Node.js](https://nodejs.org) 20 or newer | runs the small MCP server (no dependencies) |
| [Claude Code CLI](https://code.claude.com/docs/en/setup), signed in with a Claude Pro, Max, Team or Enterprise plan | `claude auth login` |
| [Codex CLI](https://developers.openai.com/codex/cli), signed in with ChatGPT | `codex login` → *Sign in with ChatGPT* |

Both CLIs are required. The installer checks for them first and stops, with install instructions, if either is missing. Every council run also checks that both are signed in before it starts, and stops with the sign-in steps if either is not.

## Install

**macOS / Linux / WSL**

```bash
curl -fsSL https://raw.githubusercontent.com/hamza-aziz-ai/codex-claude-council/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/hamza-aziz-ai/codex-claude-council/main/install.ps1 | iex
```

**Any OS with Node.js**

```bash
npx -y github:hamza-aziz-ai/codex-claude-council install
```

The installer:

1. checks Node.js 20+, the Claude Code CLI and the Codex CLI, and reports whether each CLI is signed in;
2. adds the plugin to Claude Code and to Codex from this repository's marketplace;
3. with `--claude-desktop`, also registers the MCP server with Claude Desktop chat.

Options: `--only claude|codex`, `--claude-desktop`, `--dry-run`. With the `curl` installer, put options after `bash -s --`, for example `... | bash -s -- --claude-desktop`.

Restart Claude Code / Codex afterwards.

### Or install per app

**Claude Code**

```bash
claude plugin marketplace add hamza-aziz-ai/codex-claude-council
claude plugin install codex-claude-council@codex-claude-council
```

**Codex** (CLI and IDE extension)

```bash
codex plugin marketplace add hamza-aziz-ai/codex-claude-council
codex plugin add codex-claude-council@codex-claude-council
```

**Claude Desktop** (Cowork and Code)

1. Open **Settings**, and under **Customize** click **Plugins**.
2. Click **+ Add ˅ → Add marketplace → Add from a repository**.
3. Enter `hamza-aziz-ai/codex-claude-council` in the **URL** field.
4. Turn **Sync automatically** on and click **Sync**.
5. Install **codex-claude-council** from the new marketplace.

**ChatGPT desktop app**

1. Open **Settings → Plugins**.
2. Click **Add ˅ → + Add a marketplace**.
3. Enter `https://github.com/hamza-aziz-ai/codex-claude-council.git` in **Source**.
4. Click **Add marketplace**.
5. Install **codex-claude-council** from the new marketplace.

Keep the desktop app open while you use it: the council runs on your computer through your local CLIs, so both still need to be installed and signed in (see [Requirements](#requirements)).

**Claude Desktop, Chat tab** (plugins only load in Cowork and Code): `npx -y github:hamza-aziz-ai/codex-claude-council install --claude-desktop --only claude`, then fully quit and reopen Claude Desktop.

## Use it

Just ask in plain language:

| You say | What runs |
|---|---|
| "Ask the council: should I use Postgres or MongoDB for this?" | `council_ask`: both answer, critique, reply, then agree on one final answer |
| "Run a council **debate** on this migration plan." | `debate`: final answer plus both answers, critiques and replies, every draft/review round and the settings used |
| "Get **Codex's** second opinion on this function." | `ask_codex` |
| "Ask **Claude** only, with **sonnet** at **low** effort: …" | `ask_claude` with overrides |
| "Council this with **ChatGPT on gpt-5.6-sol at xhigh** and **Claude on opus at max**: …" | `council_ask` with per-side overrides |
| "Ask the council and **keep going until they agree**: …" | `council_ask` with `max_rounds: 0` |
| "Council debate, **at most 3 rounds** to reach agreement: …" | `debate` with `max_rounds: 3` |
| "Ask the council, and let **ChatGPT write the final answer**: …" | `council_ask` with `synthesizer: "codex"` |

With a `workspace`, the models read what they need from the project themselves; without one, they have no file access, so include the code or text you want reviewed in the question. A council run is six CLI calls (answers, critiques, replies) plus two per agreement round, so eight when the models agree on the first draft. At high effort that can take several minutes, and it counts against both plans' usage limits.

### Who writes the final answer: `synthesizer`

**Claude** drafts the final answer by default and Codex (ChatGPT) reviews it. Pass `synthesizer: "codex"` or `"claude"` for one question, or change the default in your config. Either way both models answer, critique and reply to each other first.

### Until they agree: `max_rounds`

| `max_rounds` | What happens |
|---|---|
| omitted | the configured default: **at most 3 rounds** unless you changed it |
| `N` (1 or more) | the synthesizer drafts one joint answer and the other model reviews it; repeat for **at most N rounds**, stopping as soon as both agree (6 + 2 per round calls) |
| `0` | the same loop with **no round limit**: it runs until both agree |

The drafter endorses its own draft, so the reviewer's `AGREE` means both models agree with the exact final text. The reviewer sees the whole discussion and its own previous objections, so it can check that its points were answered. `council_ask` ends with a line saying whether they agreed; `debate` includes every draft and review. If the limit is reached, you get the latest draft and the reviewer's remaining objections. If a call fails partway through (for example a usage limit), you get the latest draft and the reason.

For the old single pass (the synthesizer writes the final answer alone after the replies, 7 calls, no sign-off from the other model), set `"max_rounds": null` in your config.

`max_rounds: 0` can run for a long time and use a lot of both plans on questions where reasonable people disagree. You can stop it at any time (Esc / cancel in the app, Ctrl+C in the terminal).

### Model and effort

| Tool | Optional inputs |
|---|---|
| `ask_codex`, `ask_claude` | `model`, `effort`, `workspace`, `web_search` |
| `council_ask`, `debate` | `codex_model`, `codex_effort`, `claude_model`, `claude_effort`, `synthesizer`, `max_rounds`, `workspace`, `web_search` |

`workspace` is the absolute path of the project folder both models may read. In Claude Code and Codex the plugin's skill tells the host to pass the folder you are working in.

- Codex effort: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`
- Claude effort: `low`, `medium`, `high`, `xhigh`, `max`
- Claude models: an alias (`opus`, `sonnet`, `fable`) or a full model name. Codex models: any name your Codex CLI accepts.

Anything you leave out comes from your config.

### From the terminal

```bash
npx -y github:hamza-aziz-ai/codex-claude-council ask "Which is faster for 10M rows, A or B?"
npx -y github:hamza-aziz-ai/codex-claude-council debate "..." --codex-effort xhigh --claude-model opus
npx -y github:hamza-aziz-ai/codex-claude-council ask "..." --max-rounds 0      # until both agree
npx -y github:hamza-aziz-ai/codex-claude-council ask "..." --synthesizer codex  # ChatGPT writes the final answer
npx -y github:hamza-aziz-ai/codex-claude-council codex "..." --effort low
npx -y github:hamza-aziz-ai/codex-claude-council claude "..." --model sonnet --effort max
npx -y github:hamza-aziz-ai/codex-claude-council ask "..." --workspace ~/code/app  # read this project
npx -y github:hamza-aziz-ai/codex-claude-council ask "..." --no-workspace          # no file access
npx -y github:hamza-aziz-ai/codex-claude-council ask "..." --no-web                # no web search
```

In the terminal, both models read the git repository you run the command from (if any) unless you pass `--workspace` or `--no-workspace`. Each command is a new pair of sessions that lasts for that run.

For a shorter command, install it globally with `npm install -g github:hamza-aziz-ai/codex-claude-council` and use `codex-claude-council ask "..."`. Questions can also be piped on stdin.

## Configure

```bash
npx -y github:hamza-aziz-ai/codex-claude-council config --init
```

This creates `~/.codex-claude-council/config.json`. It is re-read on every call, so edits apply immediately:

```json
{
  "timeout_seconds": 600,
  "synthesizer": "claude",
  "max_rounds": 3,
  "web_search": true,
  "allow_api_key_auth": false,
  "codex":  { "command": null, "model": null, "effort": "high" },
  "claude": { "command": null, "model": null, "effort": "high" }
}
```

| Setting | Meaning |
|---|---|
| `timeout_seconds` | limit for each CLI call |
| `synthesizer` | which model writes the final answer: `claude` (default) or `codex` (ChatGPT) |
| `web_search` | whether both models may search the web and read pages: `true` (default) or `false` |
| `max_rounds` | default limit on draft/review rounds: `3` (default), `0` for no limit, `null` for a single pass without agreement |
| `codex.model`, `claude.model` | default model; `null` uses the CLI's own default |
| `codex.effort`, `claude.effort` | default effort |
| `codex.command`, `claude.command` | full path to a CLI if it isn't found automatically |
| `allow_api_key_auth` | `true` allows CLIs signed in with API keys (billed per token) |

Set `COUNCIL_CONFIG` to use a different config file.

## Troubleshooting

Run the doctor. It checks Node.js, both CLIs, their sign-ins and your effective config:

```bash
npx -y github:hamza-aziz-ai/codex-claude-council doctor
```

- **"The council needs both Codex and Claude Code signed in"**: before every council run, both CLIs are checked, and nothing is sent to either model unless both are signed in. The message names each CLI with a problem and the fix: `codex login` (choose *Sign in with ChatGPT*) and/or `claude auth login`.
- **"usage limit"**: your ChatGPT or Claude plan hit its limit. Wait for the reset or lower the effort.
- **"timed out"**: raise `timeout_seconds` or lower the effort.
- **Tools don't appear**: fully quit and reopen the app after installing. In Claude Desktop or the ChatGPT desktop app, check the plugin is installed and enabled under **Settings → Plugins**.
- **`node` not found by a desktop app on macOS**: GUI apps don't read your shell profile, so Node installed with nvm may be invisible to them. Install Node from nodejs.org or Homebrew.
- **CLI not found**: set `codex.command` / `claude.command` to the full path.

## Security and privacy

- Everything runs on your computer. Your question goes to OpenAI and Anthropic through their official CLIs, under your own accounts.
- **Neither model can change your files.** Codex runs `codex exec` in its **read-only sandbox**, enforced by the operating system, ignoring your `~/.codex/config.toml` and `.rules` files (so no plugins, hooks or MCP servers load). Claude Code runs with `--restricted` (no user, project or local settings, so no hooks, plugins or allow rules from them), no skills, no shell, and `--permission-mode dontAsk`, so it can use only its read tools (Read, Grep, Glob, confined to the project) and this plugin's read-only git tools (`src/git-mcp.mjs`: status, log, diff, show, a file at a revision, blame). Those run git with a fixed argument list and no shell; every path must stay inside the project (also through links) and every revision is checked, so no git option can write a file or read one outside the project.
- **What they can read.** With a `workspace`, whatever either model chooses to read in that project is sent to OpenAI or Anthropic, as when you paste it. Claude's file tools are confined to the project folder. Codex's read-only sandbox lets it read other files on your computer too, as Codex itself does by default. Without a `workspace`, Claude has no tools and Codex runs in an empty folder.
- **Web access.** With `web_search` on (the default), Codex's web search runs on OpenAI's side (its sandbox still has no network for commands), and Claude can search and fetch web pages. Your question and what the models read can shape their search queries and the pages they open. With a `workspace` as well, text in the project that tries to instruct the model (a prompt injection) could in principle get it to send project content to a website, for example in a URL it fetches. For sensitive projects, turn web access off with `web_search: false` or `"web_search": false` in your config.
- **Sessions.** The councils' sessions are saved by the CLIs like any other session, so they appear in `claude --resume` and `codex resume` for that folder.
- API-key environment variables are removed before the CLIs start, so calls use your subscriptions rather than per-token API billing. Codex must be signed in with ChatGPT and Claude Code with a Claude subscription unless you set `allow_api_key_auth`.
- A plugin with a local MCP server runs with your user permissions. This one is about 1,000 lines of dependency-free JavaScript in [`src/`](src); read it before installing if you like.

## Uninstall

```bash
npx -y github:hamza-aziz-ai/codex-claude-council uninstall
```

This removes the plugin from Claude Code and Codex and the Claude Desktop chat entry, and keeps your config file. In Claude Desktop or the ChatGPT desktop app, uninstall it under **Settings → Plugins**.

## Development

```bash
git clone https://github.com/hamza-aziz-ai/codex-claude-council.git
cd codex-claude-council
npm test
```

The tests use fake `codex` / `claude` executables, so they make no model calls. CI runs them on Windows, macOS and Linux.

To try a local checkout, use its path as the marketplace: `claude plugin marketplace add ./codex-claude-council` or `codex plugin marketplace add ./codex-claude-council`.

## Disclaimer

Not affiliated with, or endorsed by, OpenAI or Anthropic. Codex, ChatGPT, Claude and Claude Code are trademarks of their owners. Your use of each CLI is subject to its provider's terms and your plan's limits.

## License

[MIT](LICENSE) © Hamza Aziz
