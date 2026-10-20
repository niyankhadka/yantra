import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startMcp } from './support.js';
import { fileURLToPath } from 'node:url';
import { embedPayload } from '../lib/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'yantra.js');

test('embedPayload fills the last slot and neutralises </script>', () => {
  const shell = '<title>x</title><script>var s = \'<script type="application/json" id="yantra-payload">\';</script><script type="application/json" id="yantra-payload">null</script>';
  const out = embedPayload(shell, { meta: { title: 'T </script><b>' } });
  assert.ok(out.includes("var s = '<script type=\"application/json\" id=\"yantra-payload\">'"), 'code before the slot is untouched');
  assert.ok(!out.includes('</script><b>'));
  assert.match(out, /<title>T &lt;\/script>&lt;b><\/title>/);
});

test('CLI validate exits 0 for a valid file and 1 with codes for an invalid one', () => {
  const ok = spawnSync(process.execPath, [CLI, 'validate', path.join(ROOT, 'examples', 'supply-chain.json')], { encoding: 'utf-8' });
  assert.equal(ok.status, 0, ok.stderr);

  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-test-')), 'bad.json');
  fs.writeFileSync(tmp, JSON.stringify({ meta: { title: 'Bad' }, nodes: [{ id: 'a', data: { title: 'A' } }], edges: [{ id: 'e', source: 'a', target: 'b' }] }));
  const bad = spawnSync(process.execPath, [CLI, 'validate', tmp, '--json'], { encoding: 'utf-8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).errors[0].code, 'ref/edge-unknown-target');
});

test('CLI builds an answer page and exports it as Markdown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-test-'));
  const input = path.join(ROOT, 'examples', 'answer-checkout-saga.json');
  const res = spawnSync(process.execPath, [CLI, 'build', input, '-o', path.join(dir, 'a.html')], { encoding: 'utf-8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'a.html'), 'utf-8'), /class="p-answer"/);
  spawnSync(process.execPath, [CLI, 'export', input, '-o', path.join(dir, 'a.md')]);
  assert.match(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8'), /^# Why/);
});

test('CLI export writes SVG and Markdown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-test-'));
  const input = path.join(ROOT, 'examples', 'cloud-architecture.json');
  spawnSync(process.execPath, [CLI, 'export', input, '-f', 'svg', '-o', path.join(dir, 'd.svg')]);
  spawnSync(process.execPath, [CLI, 'export', input, '-f', 'md', '-o', path.join(dir, 'd.md')]);
  assert.match(fs.readFileSync(path.join(dir, 'd.svg'), 'utf-8'), /^<svg/);
  assert.match(fs.readFileSync(path.join(dir, 'd.md'), 'utf-8'), /^# /);
});

test('MCP server answers initialize, tools/list and yantra_validate', async () => {
  const s = startMcp();
  const send = s.send;
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  send({ id: 3, method: 'tools/call', params: { name: 'yantra_validate', arguments: { filePath: path.join(ROOT, 'examples', 'sales-pipeline.json') } } });
  send({ id: 4, method: 'nope' });
  send({ id: 5, method: 'tools/call', params: { name: 'yantra_validate', arguments: { filePath: path.join(ROOT, 'examples', 'answer-checkout-saga.json') } } });
  send({ id: 6, method: 'tools/call', params: { name: 'yantra_get_schema', arguments: { kind: 'page' } } });
  let replies;
  try {
    replies = await s.waitFor(6);
  } finally {
    await s.close();
  }

  assert.equal(replies.get(1).result.protocolVersion, '2025-06-18');
  assert.ok(replies.get(2).result.tools.some((t) => t.name === 'yantra_build'));
  assert.equal(JSON.parse(replies.get(3).result.content[0].text).valid, true);
  assert.equal(replies.get(4).error.code, -32601);
  assert.equal(JSON.parse(replies.get(5).result.content[0].text).valid, true, 'page with diagram src validates');
  assert.match(JSON.parse(replies.get(6).result.content[0].text).rules, /# Answer pages/);
});

test('Claude and Antigravity skill copies are identical', () => {
  const a = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'yantra', 'SKILL.md'), 'utf-8');
  const b = fs.readFileSync(path.join(ROOT, '.agents', 'skills', 'yantra', 'SKILL.md'), 'utf-8');
  assert.equal(a, b, 'Run: cp .claude/skills/yantra/SKILL.md .agents/skills/yantra/SKILL.md');
});
