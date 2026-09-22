#!/usr/bin/env node
// Entry point used by the Claude and Codex plugins (.mcp.json) and by Claude Desktop.
import { serve } from './mcp.mjs';

process.on('unhandledRejection', error => console.error(error));
serve();
