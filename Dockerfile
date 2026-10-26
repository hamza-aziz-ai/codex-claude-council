# The council's MCP server over HTTP (`serve`), with the Codex and Claude Code CLIs, for a server of your own.
# Sign both CLIs in once; the sign-ins, the config and the URL's token live in the /home/node volume.
# See "Run it on a server" in the README.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep bubblewrap \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex @anthropic-ai/claude-code \
  && npm cache clean --force

COPY --chown=node:node . /opt/codex-claude-council
RUN npm install -g /opt/codex-claude-council

USER node
WORKDIR /home/node
VOLUME /home/node
EXPOSE 8000
CMD ["codex-claude-council", "serve", "--host", "0.0.0.0", "--port", "8000"]
