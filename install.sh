#!/usr/bin/env bash
# Codex–Claude Council installer for macOS, Linux and WSL.
#   curl -fsSL https://raw.githubusercontent.com/hamza-aziz-ai/codex-claude-council/main/install.sh | bash
# Options go after "bash -s --", e.g.:  ... | bash -s -- --claude-desktop
set -euo pipefail

REPO="hamza-aziz-ai/codex-claude-council"
missing=0

have() { command -v "$1" >/dev/null 2>&1 || [ -x "$HOME/.local/bin/$1" ]; }

if ! command -v node >/dev/null 2>&1; then
  echo "[x]  Node.js 20+ is required: https://nodejs.org"; missing=1
elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "[x]  Node.js $(node --version) found; version 20 or newer is required: https://nodejs.org"; missing=1
fi
if ! have claude; then
  echo "[x]  Claude Code CLI not found. Install:  curl -fsSL https://claude.ai/install.sh | bash   then: claude auth login"; missing=1
fi
if ! have codex; then
  echo "[x]  Codex CLI not found. Install:  npm install -g @openai/codex   then: codex login"; missing=1
fi
if [ "$missing" -ne 0 ]; then
  echo
  echo "codex-claude-council needs Node.js 20+, the Claude Code CLI and the Codex CLI. Install what is missing and run this again."
  exit 1
fi

exec npx --yes "github:${REPO}" install "$@"
