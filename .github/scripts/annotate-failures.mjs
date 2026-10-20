// Turns failing tests in a node --test log into GitHub annotations, so the
// reason shows on the run summary without opening the full log.
import fs from 'node:fs';

const lines = fs.readFileSync(process.argv[2] || 'test.log', 'utf-8').split(/\r?\n/);
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
for (let i = 0; i < lines.length; i++) {
  const m = /^\s*not ok \d+ - (.*)$/.exec(lines[i]);
  if (!m) continue;
  const body = [];
  for (let j = i + 1; j < lines.length && !/^\s*(ok|not ok) \d+ /.test(lines[j]) && body.length < 25; j++) body.push(lines[j]);
  console.log(`::error title=${esc(m[1]).slice(0, 200)}::${esc(body.join('\n'))}`);
}
