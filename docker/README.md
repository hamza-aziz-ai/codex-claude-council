# Codex–Claude Council

**ChatGPT (through the Codex CLI) and Claude (through Claude Code) discuss your question until they agree on one answer, on your own subscriptions.** This image runs the council's MCP server over HTTP, with Node.js, both CLIs and cloudflared, so you can use it from claude.ai, ChatGPT or your phone, in the background on a server of your own or on your computer.

Source, full docs and the plugin for Claude Code, Codex and the desktop apps: **[github.com/hamza-aziz-ai/codex-claude-council](https://github.com/hamza-aziz-ai/codex-claude-council)**

## Quick start (Docker Compose)

In an empty folder:

```bash
curl -fsSLO https://raw.githubusercontent.com/hamza-aziz-ai/codex-claude-council/main/compose.yaml
docker compose up -d
docker compose exec council codex-claude-council login   # once: sign both CLIs in
docker compose logs council                              # the URL to add as a connector
```

`compose.yaml` uses `ghcr.io/hamza-aziz-ai/codex-claude-council`; to pull from Docker Hub instead, set `image: hamzaazizai/codex-claude-council:latest` in it. Same image, same tags.

Then add the URL (`https://<random words>.trycloudflare.com/mcp/<token>`) as a custom connector, with no sign-in. In claude.ai: **Settings → Connectors → Add custom connector**. Ask: "Ask the council: …"

## Without Compose

```bash
docker run -d --name council --restart unless-stopped --security-opt seccomp=unconfined \
  -v council-home:/home/node -v ~/code:/projects:ro \
  hamzaazizai/codex-claude-council serve --tunnel
docker exec -it council codex-claude-council login
docker logs council
```

## What to know

- **Your plans, your accounts.** `login` signs in the Codex CLI with ChatGPT (with a code to enter on any device) and Claude Code with your Claude plan. No API keys. It is your council, for your own use.
- **Keep the URL secret.** The token in it is the only key: anyone with it can use your council and plans, and the models can read the mounted projects.
- **Read-only.** The models read your projects (mount them read-only at `/projects`) and never change them: Codex runs in its read-only sandbox, Claude in plan mode.
- **`--security-opt seccomp=unconfined`** is needed: Codex's sandbox (bubblewrap) uses user namespaces, which Docker's default seccomp profile blocks.
- **The `/home/node` volume** keeps the sign-ins, config, skills and the URL's token across restarts and new images.
- **The address changes** when the container restarts (a Cloudflare quick tunnel); `docker logs` shows the new one. For a fixed address, run `serve --host 0.0.0.0 --port 8000` with `-p 127.0.0.1:8000:8000` behind your own named tunnel or reverse proxy.

## Tags

`latest` and each release's version (such as `0.17.0`), for `linux/amd64` and `linux/arm64`. MIT licensed. Not affiliated with OpenAI or Anthropic.
