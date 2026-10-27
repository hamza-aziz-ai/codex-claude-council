# The council's MCP server over HTTP (`serve`), with the Codex and Claude Code CLIs and cloudflared, for a server of
# your own. Published as ghcr.io/hamza-aziz-ai/codex-claude-council. Sign both CLIs in once; the sign-ins, the
# config and the URL's token live in the /home/node volume. See "With Docker Compose" in the README.
FROM node:22-slim
ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep bubblewrap \
  && curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}.deb" \
  && dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex @anthropic-ai/claude-code \
  && npm cache clean --force

COPY --chown=node:node . /opt/codex-claude-council
RUN npm install -g /opt/codex-claude-council

LABEL org.opencontainers.image.source="https://github.com/hamza-aziz-ai/codex-claude-council" \
  org.opencontainers.image.description="Codex–Claude Council: its MCP server over HTTP, with the Codex and Claude Code CLIs" \
  org.opencontainers.image.licenses="MIT"

USER node
WORKDIR /home/node
# No browser in here: `codex-claude-council login` signs Codex in with a code to enter on any device.
ENV COUNCIL_DEVICE_AUTH=1
VOLUME /home/node
EXPOSE 8000
# `docker run … serve --tunnel` puts it online through a Cloudflare quick tunnel instead of publishing a port.
ENTRYPOINT ["codex-claude-council"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8000"]
