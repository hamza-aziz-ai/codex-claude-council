#!/usr/bin/env node
// Entry point used by the Claude and Codex plugins (.mcp.json) and by Claude Desktop.
import { homedir } from 'node:os';
import { serve } from './mcp.mjs';

// Codex starts this server with the plugin folder as its working folder ("cwd": "."). On Windows a
// process's working folder cannot be moved, so `codex plugin add` could not update the plugin while a
// Codex session was running ("Access is denied"). Nothing here uses the working folder.
process.chdir(homedir());
process.on('unhandledRejection', error => console.error(error));
const { abortAll } = serve();
// Stop running codex/claude processes if the host shuts the server down mid-call.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    abortAll();
    setTimeout(() => process.exit(0), 500);
  });
}
