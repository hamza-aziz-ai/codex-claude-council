#!/usr/bin/env node
// Entry point used by the Claude and Codex plugins (.mcp.json) and by Claude Desktop.
import { serve } from './mcp.mjs';

process.on('unhandledRejection', error => console.error(error));
const { abortAll } = serve();
// Stop running codex/claude processes if the host shuts the server down mid-call.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    abortAll();
    setTimeout(() => process.exit(0), 500);
  });
}
