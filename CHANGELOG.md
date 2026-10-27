# Changelog

## 0.21.0 (2026-10-27)

- **Claude Desktop: enter a partner model's API key in the extension's settings.** The `.mcpb` extension now has settings (Claude Desktop: **Settings → Extensions → Codex–Claude Council**): an OpenAI API key, an Anthropic API key, and a model for each side, all optional. A side with a key runs through its API with no CLI needed; a side without one uses its CLI, as before. The keys are marked sensitive, so Claude Desktop masks them, and this server never passes them on to the CLIs. With only an OpenAI key, "Discuss with ChatGPT whether …" (`council_join`) makes Claude Desktop itself the Claude member, so it needs neither Claude Code nor an Anthropic key. A config file that sets a side's `via` still decides. See [Without the CLIs](README.md#without-the-clis-through-the-apis).
- **The extension includes the providers' SDKs,** so no `api-setup` there (6.8 MB, was 0.6 MB).

## 0.20.0 (2026-10-27)

- **Without the CLIs: a side through its API, optional.** An add-on to the CLIs, which stay the default: set `"codex": { "via": "api" }` or `"claude": { "via": "api" }` (or `COUNCIL_CODEX_VIA` / `COUNCIL_CLAUDE_VIA` in the environment) and that side runs through its provider's API with its API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), so its CLI needn't be installed. Claude goes through Anthropic's Messages API (default `claude-opus-5-5`, adaptive thinking, your `effort`, server-side refusal fallback on the models that have it), the ChatGPT side through OpenAI's Responses API (default `gpt-6-astra`, your reasoning effort, `store: false`), with the official SDKs. Such a member reads the project with three read-only tools of the council's own, confined to the project folder (`list_files`, `read_file`, `search`), searches the web with its provider's search, and keeps its conversation in the server's memory; it can't continue your own CLI sessions, and it gets skills as text. Mix freely, such as Claude Code on your plan with ChatGPT through the API. See [Without the CLIs](README.md#without-the-clis-through-the-apis).
- **`api-setup`.** The SDKs load only for a side through its API. npm and Docker installs include them; the Claude Code and Codex plugins and the Claude Desktop extension, which run from a copy without `node_modules`, get them with `npx -y codex-claude-council api-setup` once (into `~/.codex-claude-council/api-sdks`). Without it, the CLI mode works as before and an API side says what to run.
- **`doctor` and the installer know API sides:** they check the key and the SDKs instead of the CLI, and the installer skips adding the plugin to an app whose CLI isn't installed.
- **The plugin now has dependencies:** `@anthropic-ai/sdk` and `openai`, used only in API mode.

## 0.19.0 (2026-10-27)

- **API keys per side, optional.** Each side can now pay per token instead of using a plan: set `"codex": { "auth": "api_key" }` or `"claude": { "auth": "api_key" }` in the config, or `COUNCIL_CODEX_AUTH` / `COUNCIL_CLAUDE_AUTH` in the environment (Docker's `.env`), for example Claude on your Claude plan and ChatGPT through an OpenAI API key. The default stays `subscription` on both sides. Codex takes its key from `codex login --with-api-key`, or from `OPENAI_API_KEY` through `codex-claude-council login`, which stores it; Claude Code uses `ANTHROPIC_API_KEY` as it is, or a Console sign-in (`login` runs `claude auth login --console`). `allow_api_key_auth: true` still works and means both sides. See [API keys instead of a plan](README.md#api-keys-instead-of-a-plan).
- **Each CLI gets only its own side's key.** API-key variables used to be kept for both CLIs, or for neither. Now a CLI gets its own side's credentials only when that side is set to `api_key`, never the other side's, and other programs the council runs (`ssh`) get none.
- **Fixed: a Codex that isn't signed in passed the check when API keys were allowed.** Its "Not logged in" status matched "logged in".

## 0.18.0 (2026-10-27)

- **A fixed address in Docker: your named tunnel.** With `TUNNEL_TOKEN` (a Cloudflare named tunnel's token, from `cloudflared tunnel token <name>`) and `COUNCIL_PUBLIC_URL` (its address) set, `serve --tunnel` runs that tunnel (`cloudflared tunnel run`, the token passed in its environment, not its command line) instead of a quick tunnel, and prints `<COUNCIL_PUBLIC_URL>/mcp/<token>` once the tunnel has connected. The address stays the same across restarts, so the connector never needs updating. `compose.yaml` passes both from `.env`, so the whole setup, fixed address included, runs in one container in the background. See [With Docker Compose](README.md#with-docker-compose-in-the-background).

## 0.17.0 (2026-10-27)

- **Docker Compose: the whole setup in the background.** [`compose.yaml`](compose.yaml) runs the published image with `serve --tunnel`, restarts with the machine, keeps sign-ins, config and token in a volume, and mounts a `projects` folder read-only. Three commands: `docker compose up -d`, `docker compose exec council codex-claude-council login` once, and `docker compose logs council` for the URL. See [With Docker Compose](README.md#with-docker-compose-in-the-background).
- **`login`: sign both CLIs in with one command.** It signs in each CLI that isn't signed in yet, one after the other, in the terminal: Codex with ChatGPT, Claude Code with your Claude plan. With `COUNCIL_DEVICE_AUTH` set, as the Docker image does, Codex signs in with a code to enter on any device, since there is no browser.

## 0.16.0 (2026-10-27)

- **Prompts: three starters.** Apps that show MCP prompts (claude.ai and Claude Desktop, in their **+** menu) now offer `ask_council`, `second_opinion` (Codex by default, or `model: claude`) and `debate`. Each takes your question and fills in a request that names the tool to call. The Claude Desktop extension's manifest lists them too.
- **Resources: the guide and the config.** `council://guide` (markdown: which tool to use for what, with every tool's description) and `council://config` (JSON: the effective settings and the installed skills; no secrets) can be read or attached in apps that support resources.

## 0.15.1 (2026-10-26)

- **The connector icon, for favicon indexes.** claude.ai shows a connector with its domain's icon from a favicon index fed by search crawling, and falls back to the parent domain's (a URL on `council.example.com` showed `example.com`'s icon). `serve` now answers `HEAD` as well as `GET` for `/` and `/favicon.ico`, as crawlers check, and serves a 192 px icon (72 KB, was the 1254 px, 353 KB one), declared with `sizes="192x192"`. Once a search engine has indexed your server's address, the connector should show the council's icon (not yet confirmed; a domain of its own avoids the fallback).

## 0.15.0 (2026-10-26)

- **`serve --tunnel`: online in one command.** It starts a Cloudflare quick tunnel (`cloudflared`, no account needed) to the server and prints the HTTPS URL to add as a connector, `https://<random words>.trycloudflare.com/mcp/<token>`, instead of a second terminal and joining the URL by hand. Ctrl+C stops both; if the tunnel stops, so does the server. Without `cloudflared`, it says how to install it.
- **A ready-made Docker image**, `ghcr.io/hamza-aziz-ai/codex-claude-council` (amd64 and arm64), published with each release (`:latest` and `:<version>`), with `cloudflared` included: on a server, `docker run … ghcr.io/hamza-aziz-ai/codex-claude-council serve --tunnel`, no clone or build. Its entry point is now the `codex-claude-council` command. See [With Docker Compose](README.md#with-docker-compose-in-the-background).
- **The connector shows the council's icon.** claude.ai shows a connector with its site's favicon, so a tunnel's URL showed Cloudflare's logo. `serve` now answers `/favicon.ico` with the plugin's icon (and `/` with a page naming it), without the token; everything else still needs it.
- **Releases publish themselves.** When a version bump merges, `autorelease.yml` creates release `v<version>` with its CHANGELOG.md section as the notes and runs Publish.

## 0.14.0 (2026-10-26)

- **Use it online: `serve` runs the MCP server over HTTP.** Apps on the web and on phones (claude.ai, ChatGPT) connect to MCP servers over HTTPS from their providers' servers, so they couldn't use the council. `npx -y codex-claude-council serve` runs the same server on your computer over Streamable HTTP, at `http://127.0.0.1:8000/mcp/<token>`, with your CLIs and plans as always. The secret token in the path is the only key, so the URL works in connectors that take only a URL; it is generated on the first start and saved next to the config file (`serve-token`), or set with `--token` / `COUNCIL_TOKEN`. `--port` and `--host` choose where it listens (default: this computer only). Put HTTPS in front, such as a Cloudflare Tunnel, and add the URL as a custom connector: see [Use it online](README.md#use-it-online-claudeai-chatgpt-your-phone). Each request gets one JSON response, without progress notifications.
- **A `Dockerfile` for a server of your own.** It runs `serve` with Node.js and both CLIs; sign them in once with `codex login --device-auth` and `claude auth login`, and a volume keeps the sign-ins, config, skills and token. Codex's read-only sandbox needs user namespaces, which Docker's default seccomp profile blocks, so the README's `docker run` sets `--security-opt seccomp=unconfined`. See [With Docker Compose](README.md#with-docker-compose-in-the-background).
- **Each release carries the Claude Desktop extension again.** The publish workflow now builds `codex-claude-council-<version>.mcpb` and attaches it to the release; 0.13.5 was released without it.

## 0.13.5 (2026-10-25)

- **A failed Codex turn is reported by its own error.** With `--json`, Codex says why a turn failed in its `error` / `turn.failed` events on stdout, but the council reported stderr whenever it had anything. So an unrelated error there hid the cause: a council stopped with `codex failed: … rmcp::transport::worker … (http://127.0.0.1:64462/stream)`, from an MCP server in the user's Codex config that was down, which on its own doesn't stop Codex. The turn's own error is now reported, and stderr only when there is none; Codex's warnings (an ignored config setting, the skills context budget) are left out.

## 0.13.4 (2026-10-13)

- **The installer's icon shows over ssh too.** It was drawn only in terminals recognised by their environment variables (`WT_SESSION`, `TERM_PROGRAM`, …), which don't reach a remote machine, so `npx codex-claude-council install` run over ssh from Windows Terminal showed no icon. When the environment doesn't say, the installer now asks the terminal (`ESC [ c`, DA1) and shows the image if the reply lists sixel (`4`), waiting at most 0.3 s for an answer. `COUNCIL_BANNER=image` forces the image (for terminals that don't answer, such as some tmux setups); `COUNCIL_BANNER=text` still turns it off.

## 0.13.3 (2026-10-13)

- **A failed remote member is reported, not worked around.** A session whose plugin predated 0.13.2 hit "npx: command not found" on a remote machine and went on to run `claude --resume … -p` over ssh itself, which wrote into the user's session without plan mode (nothing was changed on that machine). The error a remote member returns now says to report it to the user and not to run the CLI over ssh, and the plugin's skill says the same.

## 0.13.2 (2026-10-13)

- **A remote machine whose Node.js comes from nvm works.** nvm is usually loaded in `~/.bashrc`, which a command run through `ssh` skips, so `npx` was "not found" there. The remote command now loads nvm first when it is installed (`$NVM_DIR`, else `~/.nvm`), and goes on as before where it is not. Checked against a real machine with nvm-only Node.js: the plugin ran there, found the session by name and listed its installed skills.

## 0.13.1 (2026-10-13)

- **Fix: a member on another machine gets each council step as it is.** In 0.13.0 its `claude` / `codex` command wrapped every step (answer, exchange, final answer, check) in its own template for a new question. It now runs with `--raw`, which sends the prompt to the model unchanged.
- **Skills on the remote machine are used by name.** With `skill`, the council asks that machine, in one `ssh` call (`skill installed <claude|codex> --session …`, which prints a JSON list), which of the skills are installed for its CLI, in the session's folder too. Those it loads itself; the others' instructions are sent, as before, and all of them if the check fails.
- **A remote member is no longer pointed at this machine's skill folders,** which it can't read; a local member still is. A skill step there gets the longer `skill_timeout_seconds` (`--skill-step`).

## 0.13.0 (2026-10-13)

- **Sessions on another machine.** Pass a session as `user@host:<id or name>` (`claude_session_id`, `codex_session_id`, `session_id`, `other_session_id`, or `--session` / `--claude-session` / `--codex-session`), and that member runs on that machine through `ssh`, as this plugin's own `codex` / `claude` command (fetched with `npx` at this version): that machine's CLI and sign-in, so another Claude or ChatGPT account works too, in the session's own folder, read-only. It needs key-based ssh (no password prompt) and Node.js 20+ there; its sign-in is checked there on each turn, and a failed login says how to set up ssh. Every argument is quoted for the remote shell (checked with a real bash against quotes, `, backticks and `;`). The `ssh` command can be set with `"ssh": { "command": … }` in the config.

## 0.12.0 (2026-10-13)

- **Releases publish themselves:** creating a GitHub release now publishes it to npm (trusted publishing, no token), the MCP Registry (GitHub OIDC) and Smithery, from `.github/workflows/publish.yml`; Actions → Publish → Run workflow repeats it.
- **The README on npmjs.com renders properly.** npm shows GitHub's alerts as `[!NOTE]` text and Mermaid diagrams as code; the publish workflow now converts the package's copy (`scripts/npm-readme.mjs`): alerts become bold-labelled quotes (💡 Tip, ❗ Important, …), the three diagrams become images (rendered by mermaid.ink), and relative paths point to the repository at the release tag. The README on GitHub is unchanged.
- **A privacy policy,** [`PRIVACY.md`](PRIVACY.md): the plugin has no servers, no accounts and no telemetry; questions, the discussion and what the models read go to OpenAI and Anthropic through the user's own CLIs; the plugin itself contacts only GitHub, for `skill add`; what it stores, and where. The README links it, and the Codex plugin manifest (`privacyPolicyURL`) and the MCPB manifest (`privacy_policies`) point to it.

## 0.11.9 (2026-10-13)

- **Accurate tool annotations:** `council_turn` is no longer marked read-only (sending a reply moves the council on), and `council_cancel` is marked destructive (it ends the job's CLI processes and discards its progress), so clients can ask before running it. The other tools are unchanged: read-only, never destructive. Both points were flagged by the Tool Definition Quality Score, which rates the tools 4.7 out of 5 (tier A); the README has its badge.

## 0.11.8 (2026-10-13)

- **Tool descriptions rewritten to the Tool Definition Quality Score rubric** (TDQS 1.2, which Glama uses). Each says what the tool does first, when to use it and which tool to use instead, and what the annotations cannot say: the tools run the user's local CLIs on their own plans' quota and take minutes, a call still running after about 50 s returns a job_id for `council_result`, and `council_cancel` ends the CLI processes and discards the progress. They no longer repeat the schema ("optional model/effort overrides"). `npx mcp-tdqs lint` finds nothing to flag.

## 0.11.7 (2026-10-12)

- **Every tool name starts with `council_`:** `debate`, `ask_codex` and `ask_claude` are now `council_debate`, `council_ask_codex` and `council_ask_claude`. Calls by the old names still work; they are just no longer listed. The CLI commands (`ask`, `debate`, `codex`, `claude`) are unchanged.
- **Structured results:** every tool declares an `outputSchema` and returns `structuredContent` beside its text: `status` (`done`, `working`, `your_turn` or `stopped`), the `text`, and the `job_id` or `council_id` to use next.
- **The Smithery bundle's manifest carries each tool's title, output schema and annotations** (read-only, open world; `council_cancel` is not read-only) as well as its input schema, so Smithery can see them.

## 0.11.6 (2026-10-12)

- **The installer's banner shows the icon twice as big** (440×440 px instead of 220×220), so the icon, not COUNCIL, leads the banner. The title now starts right under the image whatever the terminal's font size (the terminal moves the cursor below it as it draws), and a terminal narrower than 46 columns shows the banner without the image.

## 0.11.5 (2026-10-12)

- **A new icon**, `mcpb/icon.png`: the two council members, ChatGPT and Claude, discussing over one checked answer. It is now the plugin's picture everywhere: the installer's banner (as a sixel image, in the terminals that draw them; the others show the title alone), the README banner, the social preview, the Claude Desktop extension and Smithery, the Codex plugin card (`interface.logo` and `composerIcon`), the MCP Registry (`icons` in `server.json`) and the MCP server's `serverInfo.icons`. It replaces the OpenAI and Claude logos and the crossing lines in the banners; the npm package now includes it, and the old `mcpb/icon.svg` and the text logos are gone. A test keeps every manifest pointing at the one file.

## 0.11.4 (2026-10-12)

- **An MCPB bundle** (`codex-claude-council-<version>.mcpb`, attached to each GitHub release): the MCP server packed for one-click install in Claude Desktop (open the file, or Settings → Extensions → Install Extension…) and for publishing to Smithery (`smithery mcp publish`). `node mcpb/build.mjs` builds it with the official `@anthropic-ai/mcpb` tool from `mcpb/manifest.json` (spec 0.3: Node 20+, the 8 tools, macOS, Windows and Linux) and an icon of the two lines crossing into one answer. A test keeps the manifest's version and tools in step with the code. The Codex and Claude Code CLIs still need to be installed and signed in. The build also writes a Smithery copy (`…-smithery.mcpb`) whose manifest gives each tool its input schema: Smithery requires one, and the MCPB manifest spec does not allow it.

## 0.11.3 (2026-10-12)

- **The final answer keeps to the length the question asks for**, also when the models did not agree. Asked for "under 60 words", an unresolved council wrote a long report of every point in dispute; now the writer leads with its recommendation and names the main point in dispute. The writer of an agreed answer is told the same.
- **The VHS demo** (`assets/demo.tape`) plays at normal speed: the start live, the wait skipped, the exchanges and the answer on screen long enough to read. It asks a question that splits the models (UUIDv7 or integer keys for a multi-tenant SaaS), allows up to 8 exchanges, waits for the shell prompt whatever the outcome, and hides npm's notices.

## 0.11.2 (2026-10-12)

- **Ready for the Official MCP Registry** (registry.modelcontextprotocol.io) as `io.github.hamza-aziz-ai/codex-claude-council`: `package.json` has the `mcpName` the registry checks on npm, and `server.json` describes the server (the npm package, started with `npx codex-claude-council mcp` over stdio). It passes `mcp-publisher validate`, and a test keeps the two files in step with the package version.
- **The one-line install scripts install from npm** (`npx codex-claude-council@latest install`). npm 12 refuses to install from git repositories by default (`allow-git`), so the old `npx github:hamza-aziz-ai/codex-claude-council` form, which `install.sh` and `install.ps1` used, fails there with `EALLOWGIT`. The VHS demo script uses the npm package too.

## 0.11.1 (2026-10-12)

- **On npm:** `npx -y codex-claude-council install` (and `update`, `doctor`, `ask`, …) is now the documented command, in the README, the plugin's skill, the installer's messages, a shared discussion page and the social preview. The longer `npx -y github:hamza-aziz-ai/codex-claude-council …` still works, and the one-line install scripts still install from GitHub. The README has an npm version badge.
- **A harder benchmark set** (`bench/hard.mjs`, now the default): 24 longer programs in which several traps interact, with an answer key checked by running them. `node bench/run.mjs --set hard|classic|all`.

## 0.11.0 (2026-10-12)

- **Share a discussion as a page.** `ask` and `debate` take `--html <file>`: the question, both opening answers, every exchange (each side's reply with its "agrees" or "not yet") and the final answer, as one self-contained page that follows the reader's light or dark theme, with a link back to the plugin. An example is in `docs/examples/postgres-or-sqlite.html`.
- **A benchmark** in `bench/`: 24 programs with classic traps (the event loop, `sort()`, mutable defaults, `finally`, SQL's `NULL`), an answer key checked by running them (`--verify`), and a runner that asks Codex alone, Claude alone and the council, with fresh sessions, in an empty folder and without the web, and scores all three.
- **README:** "Two AIs. One answer.", a "Why two models?" section with a real run, and an animated banner: the lines draw themselves and the exchanges light up in turn (the finished picture shows wherever animation does not run, or with reduced motion). `assets/make-banner.cjs` writes the banners and the social preview (`assets/social-preview.png`); `assets/demo.tape` records a demo with VHS.

## 0.10.2 (2026-10-12)

- **A new look for the README.** A banner of the council (both logos, the lines crossing at each exchange and meeting in one answer, beside COUNCIL shaded from ChatGPT green to Claude orange) in a dark and a light version for GitHub's themes (`assets/banner-*.svg`), centered badges and links, a feature grid, a three-step quick start, and callouts for the notes that matter most.
- **The installer's text uses the banner's colors.** Claude Code in orange and Codex / ChatGPT in green (their checks, sections and commands), box titles, numbers and the try-it prompt in gold, paths, links and commands to copy in soft blue, good states in green and secondary text dimmed. A color that wraps inside a box carries on to the next line.
- **The banner shows the OpenAI and Claude logos.** `install` and `update` draw both logos (from @lobehub/icons, turned once with chafa into 14×7-character terminal text in full color, with a 256-color version for macOS Terminal, so nobody needs chafa installed), and a line from each runs to the middle, where the two cross three times, each loop narrower, before they meet in one answer. Each crossing is marked as an exchange (`⇄ exchange 1`, `2`, `3`). The text has its own colors: ChatGPT in green and Claude in orange, the crossings and the answer in gold, and "they discuss with each other until they agree" shaded from green to orange. In terminals that draw sixel images (Windows Terminal 1.22+, WezTerm, iTerm2, Konsole, foot, mlterm) the logos are real pixels, 120×120 (about 12 columns by 6 rows), also made once with chafa; `COUNCIL_BANNER=text` turns them off. The logos need colors; piped output and `NO_COLOR` get the same picture with a prompt box and a spark instead.

## 0.10.1 (2026-10-12)

- **A clearer installer.** `install`, `update`, `uninstall` and `doctor` now show their progress as a rail of steps (`◇` done, `▲` warning, `■` failed), with a spinner while each `claude` / `codex` command runs, the commands' own output dimmed under them, and boxed summaries: what was installed, the next steps, the config. `install` and `update` open with a banner of the council: Codex's prompt (`>_`) and Claude's spark each send out a line, and the lines cross until they meet in one answer, over COUNCIL in block letters shaded from Codex green to Claude orange (a smaller banner on narrow terminals). No new dependencies (`src/ui.mjs`). Colors and the spinner only on a terminal; piped output (and `NO_COLOR`) is plain text with the same layout, wrapped to 100 columns.

## 0.10.0 (2026-10-11)

- **The models now discuss until they agree, not just once.** Before, each model critiqued the other's answer and replied to the critique once; then one drafted a joint answer and the other only reviewed it, so the exchange of ideas happened in the first round only and the drafter held the pen. Now, after the two independent answers, they **exchange**: each gets the other's latest message (first its answer, then its replies) and replies point by point, with its current answer and `VERDICT: AGREE` or `VERDICT: DISAGREE`. Both replies are sent at once and cross over, and the exchange repeats until both agree in the same exchange. Only then does the synthesizer write the final answer, and the other checks that it matches what they agreed (revised once if not).
- `max_rounds` now limits the exchanges: **5 by default** (was 3 draft/review rounds), `0` for no limit, `null` in the config for one. If the limit is reached without agreement, the final answer sets out what they agree on and each point still in dispute, with both positions, and is marked as not agreed. A failure after the first exchange (for example a usage limit) ends the discussion with what was reached.
- The draft prompt no longer tells the writer that the other model "must agree with it"; the writer only turns an agreement both reached into the final text.
- `debate`'s JSON has `exchanges` (each with both replies and verdicts) and `converged` instead of the critiques and replies; `rounds` is the check of the final answer.
- `council_join`: the host takes part in every exchange like any member.

## 0.9.3 (2026-10-11)

- **A skill a member already has is named, not sent.** Before, every skill's full `SKILL.md` went into each member's first prompt. Now each member is checked: a skill installed for its own CLI (Claude Code: `~/.claude/skills`, the project's `.claude/skills`, enabled plugins; Codex: `~/.codex/skills`, `~/.agents/skills`, the project's `.agents/skills`, enabled plugins) is named, and the member loads it the way it loads any of its skills. Only the skills it lacks are sent in full. For llm-council and graphify, installed for both CLIs here, the first prompt's skill part drops from 60,716 to 1,075 characters. The host of a `council_join` still gets every skill's instructions. Checked with the real Codex CLI, which found its llm-council skill by name.
- Skills of Claude Code's and Codex's enabled plugins can be named in `skill` (enabled: `enabledPlugins` in Claude Code's `settings.json`, `[plugins."…"] enabled = true` in Codex's `config.toml`). The tool descriptions do not list them, since there can be hundreds.

## 0.9.2 (2026-10-11)

- **Several skills at once.** `skill` takes several names separated by commas (`"llm-council, caveman"`) or a list, on every tool that takes it; in the terminal, repeat `--skill` or separate names with commas. Each is checked before anything runs, used once, in the order given. Both models get each skill's instructions in the first prompt, and each later step names them all as still available. One skill works as before, word for word.
- In `debate`'s JSON, `settings.skill` is now a list of names (or `null`).

## 0.9.1 (2026-10-10)

- **A job waiting for a session now says so.** Each session takes one council or question at a time, and a job queued behind another one reported "starting" until it got the session, with no reason given. It now reports "Waiting for the Codex (ChatGPT) session …: another council or question is using it". If a `council_join` is holding the session while it waits for the host's reply, the message names that job and how to release it (`council_turn` or `council_cancel`). Found in a real run: a `council_join` whose host lost track of its turn held a ChatGPT Work session for its full 30-minute wait, and a second council on that session showed "starting" for 25 minutes.
- `ask_codex` and `ask_claude` report "… is answering" while they run, instead of "starting".

## 0.9.0 (2026-10-06)

- **`network`: Codex's commands can reach the network**, still read-only on disk. Off by default; turn it on per question (`network: true`, `--network`) or in the config (`"network": true`). `"network_domains"` limits it to some domains, enforced by Codex's network proxy. Codex then runs with a permission profile (a beta Codex feature) instead of its read-only sandbox: the whole disk read-only, the network on. Checked with the real Codex CLI 0.160 on Windows: an API call and a web page fetched, a write refused, a domain off the list blocked. Codex is told it may use the network; on Windows, to use Python or Node for HTTPS, since `curl.exe`, `Invoke-WebRequest` and `git` fail over HTTPS in the sandbox there. Claude's read-only commands already reach the network in plan mode, so the option is about Codex.

## 0.8.3 (2026-09-30)

- **With `council_join`, the host writes the final answer by default**, whichever model it is (Claude or Codex): it has the whole context, and the other model reviews it. `synthesizer` still picks the other model when passed. The config's `synthesizer` now applies to `council_ask` and `debate` only. Before, a Codex host with the default config had Claude draft.
- Looking up a Claude Code session by name now closes each transcript before returning. On Windows the file could still be open for a moment, so it could not be deleted right away.
- All eight tools are declared in one list in `src/mcp.mjs`, so tools that read the source (such as the M8ven Trust Index) see all of them.

## 0.8.2 (2026-09-25)

- A Codex session the user passes that is still open in the Codex CLI or app (Codex: `already has an active writer`) now gets a message saying to close it and try again, or to leave out the session id. One Codex has not saved yet (`no rollout found`) gets a message saying to send it a first message or check the id with `codex resume`. Every other Codex failure keeps its message.

## 0.8.1 (2026-09-25)

- **Sessions by name.** Wherever a session id is taken (`claude_session_id`, `codex_session_id`, `session_id`, `other_session_id`, and `--claude-session`, `--codex-session`, `--session`), the name the user gave the session with `/rename` works too, spaces included. Claude Code names are read from the session's own transcript (its latest `custom-title` entry), Codex names from `~/.codex/session_index.jsonl`. The most recently used session with that name is taken, an exact match before one that differs only in case, and it is resumed by its id in its own folder. Checked with a real Claude Code session renamed with `/rename`. Codex also resolves simple names itself, so a Codex name not found in the index is passed on.
- Looking up a Claude Code name streams each transcript line by line, without blocking the server, and remembers each file's size and name, so later lookups read only what was added since (a 207 MB transcript: 0.6 s the first time, then instant). The workspace's own project is searched first.
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
