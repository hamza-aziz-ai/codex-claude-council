// A stand-in for cloudflared: records its arguments (and whether it got TUNNEL_TOKEN), then logs like a tunnel that
// came up, on stderr: `tunnel --url <local>` a quick tunnel's address, `tunnel run` (a named tunnel) a registered connection.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CLOUDFLARED_LOG, `${JSON.stringify({ args, token: Boolean(process.env.TUNNEL_TOKEN) })}\n`);
if (args.includes('run')) {
  process.stderr.write('2026-10-27T09:00:00Z INF Registered tunnel connection connIndex=0 event=0 ip=198.41.192.107 location=bom06 protocol=quic\n');
} else {
  process.stderr.write('2026-10-26T17:22:52Z INF Requesting new quick Tunnel on trycloudflare.com...\n');
  process.stderr.write('2026-10-26T17:22:57Z INF |  https://quiet-test-words-here.trycloudflare.com                                   |\n');
}
// Stops by itself: on Windows, killing the test's server leaves its children running.
setTimeout(() => process.exit(0), 30_000);
