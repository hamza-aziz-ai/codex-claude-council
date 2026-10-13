// Stand-in for `ssh` to a machine running this plugin: records its arguments and stdin to $FAKE_LOG, and answers
// like a remote council member (a verdict line for exchange and review prompts). FAKE_SSH_FAIL: fail with that text.
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const input = readFileSync(0, 'utf8');
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ cli: 'ssh', args, input })}\n`);
if (process.env.FAKE_SSH_FAIL) {
  process.stderr.write(`${process.env.FAKE_SSH_FAIL}\n`);
  process.exit(255);
}
// `skill installed …`: the skills installed there, from FAKE_SSH_SKILLS (a JSON list).
if (/'\\''installed'\\''/.test(args.at(-1))) {
  process.stdout.write(`${process.env.FAKE_SSH_SKILLS || '[]'}\n`);
  process.exit(0);
}
const lastLine = input.split(/\r?\n/).filter(line => line.trim()).pop() || '';
process.stdout.write(input.includes('VERDICT: AGREE or VERDICT: DISAGREE') ? 'remote: looks right\nVERDICT: AGREE\n' : `remote ${lastLine}\n`);
