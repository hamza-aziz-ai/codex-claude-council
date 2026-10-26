// A stand-in for `cloudflared tunnel --url <local>`: records its arguments, prints a quick tunnel's address in
// cloudflared's log format on stderr, and keeps running like a tunnel.
import { appendFileSync } from 'node:fs';

appendFileSync(process.env.FAKE_CLOUDFLARED_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
process.stderr.write('2026-10-26T17:22:52Z INF Requesting new quick Tunnel on trycloudflare.com...\n');
process.stderr.write('2026-10-26T17:22:57Z INF |  https://quiet-test-words-here.trycloudflare.com                                   |\n');
// Stops by itself: on Windows, killing the test's server leaves its children running.
setTimeout(() => process.exit(0), 30_000);
