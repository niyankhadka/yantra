// Regression tests for seams between features (URL hash, drag storage, MCP roots, UI chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashParams, layoutStorageKey } from '../src/app/hash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('hash params round-trip ids the viewer encodes (role, panel, mode)', () => {
  const p = hashParams('#example=oauth-login&role=data.store&inspector=risks%20%26%20gaps&step=3&flag');
  assert.equal(p.get('role'), 'data.store');
  assert.equal(p.get('inspector'), 'risks & gaps');
  assert.equal(p.get('step'), '3');
  assert.equal(p.get('example'), 'oauth-login');
  assert.equal(p.get('flag'), '');
  // keys are matched exactly, not as substrings
  assert.equal(hashParams('#xstep=4').get('step'), undefined);
  // raw mode keeps the encoding for rewriting the hash
  assert.equal(hashParams('#inspector=a%20b', false).get('inspector'), 'a%20b');
  assert.equal(hashParams('#bad=%E0%A4%A').get('bad'), '%E0%A4%A', 'malformed escapes do not throw');
});

test('dragged positions of two diagrams with the same title do not collide', () => {
  const a = { meta: { title: 'Checkout' }, nodes: [{ id: 'web' }, { id: 'api' }] };
  const b = { meta: { title: 'Checkout' }, nodes: [{ id: 'web' }, { id: 'queue' }] };
  const untitledA = { nodes: [{ id: 'x' }] };
  const untitledB = { nodes: [{ id: 'y' }] };
  assert.notEqual(layoutStorageKey(a), layoutStorageKey(b));
  assert.notEqual(layoutStorageKey(untitledA), layoutStorageKey(untitledB));
  assert.equal(layoutStorageKey(a), layoutStorageKey({ meta: { title: 'Checkout' }, nodes: [{ id: 'api' }, { id: 'web' }] }), 'node order does not matter');
  assert.match(layoutStorageKey(a), /^yantra:layout:checkout:/);
});

test('viewer hash mirror never throws in an embedded (about:srcdoc) frame', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'app', 'main.js'), 'utf8');
  const sync = main.slice(main.indexOf('  syncHash() {'), main.indexOf('  // --- Lifecycle'));
  assert.ok(!/location\.pathname/.test(sync), 'a relative path resolves against the host page inside srcdoc');
  assert.match(sync, /try \{\s*history\.replaceState/);
});

test('scroll arrows get their own gutters instead of covering the first chip', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'app.css'), 'utf8');
  const gutter = /\.y-hscroll-wrap\.is-overflow\s*\{[^}]*padding-inline:\s*(\d+)px/.exec(css);
  const width = /\.y-hscroll-btn\s*\{[^}]*width:\s*(\d+)px/.exec(css);
  assert.ok(gutter && width && Number(gutter[1]) >= Number(width[1]), 'gutter is at least as wide as the arrow');
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'app', 'ui.js'), 'utf8'), /'is-overflow'/);
});

test('MCP resolves relative filePath against YANTRA_INPUT_ROOT, not the cwd', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-mcp-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
    cwd: out,
    env: { ...process.env, YANTRA_INPUT_ROOT: path.join(ROOT, 'examples'), YANTRA_OUTPUT_ROOT: out },
    stdio: ['pipe', 'pipe', 'inherit']
  });
  const replies = new Map();
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      replies.set(msg.id, msg);
    }
  });
  const call = (id, name, args) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
  call(1, 'yantra_validate', { filePath: 'answer-how-to-choose-database.json' });
  call(2, 'yantra_export', { filePath: 'aws-serverless.json', format: 'svg', view: 'sequence', outputPath: 'aws.svg' });
  call(3, 'yantra_validate', { filePath: '../package.json' });
  const deadline = Date.now() + 15000;
  while (replies.size < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  proc.kill();
  try {
    const text = (id) => replies.get(id).result.content[0].text;
    assert.equal(JSON.parse(text(1)).valid, true, 'page and its diagram src resolve inside the input root');
    assert.ok(fs.readFileSync(path.join(out, 'aws.svg'), 'utf8').includes('<svg'), 'sequence export with groups is written to the output root');
    assert.equal(replies.get(3).result.isError, true, 'paths outside the input root are refused');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
