/**
 * Robustness: hostile or malformed input must never hang or crash the core,
 * the importer or the MCP server, and file access stays inside its roots.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeScene } from '../src/core/scene.js';
import { lint } from '../src/core/lint.js';
import { normalize } from '../src/core/model.js';
import { wrapText, textWidth, TEXT_CAP } from '../src/core/text.js';
import { renderSvg } from '../src/core/svg.js';
import { sceneForView } from '../src/core/sequence.js';
import { toMarkdown } from '../src/core/markdown.js';
import { pageToMarkdown } from '../src/core/page.js';
import { fromMermaid } from '../src/core/mermaid.js';
import { resolvePage } from '../lib/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);

const base = (extra = {}) => ({
  meta: { title: 'T' },
  nodes: [
    { id: 'a', type: 'api', data: { title: 'A' } },
    { id: 'b', type: 'db', data: { title: 'B' } }
  ],
  edges: [{ id: 'e', source: 'a', target: 'b', label: 'reads' }],
  steps: [{ title: 'Read', highlightNodes: ['a', 'b'], highlightEdges: ['e'] }],
  ...extra
});

/** Seeded random graph; `cyclic` lets edges point backwards. */
function graph(n, m, { seed = 1, cyclic = true } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: ['api', 'db', 'svc'][i % 3], data: { title: `Node ${i}` } }));
  const edges = [];
  const seen = new Set();
  while (edges.length < m) {
    const a = Math.floor(rnd() * n);
    const b = Math.floor(rnd() * n);
    if (a === b || seen.has(`${a}-${b}`)) continue;
    seen.add(`${a}-${b}`);
    const [x, y] = cyclic ? [a, b] : [Math.min(a, b), Math.max(a, b)];
    edges.push({ id: `e${edges.length}`, source: `n${x}`, target: `n${y}`, label: `calls ${edges.length}` });
  }
  return { meta: { title: 'Big' }, nodes, edges, steps: [{ title: 'S', highlightNodes: ['n0'] }] };
}

// --- 1. text wrapping is linear and capped -------------------------------------
test('wrapText hard-breaks long words in linear time and keeps every line within width', () => {
  let t = performance.now();
  const lines = wrapText('W'.repeat(20000), 200, 14, { weight: 600 });
  assert.ok(performance.now() - t < 200, 'long word wraps quickly');
  assert.equal(lines.join(''), 'W'.repeat(20000));
  for (const l of lines) assert.ok(textWidth(l, 14, { weight: 600 }) <= 200);
  t = performance.now();
  const capped = wrapText('x'.repeat(1_000_000), 200, 14, {}, 2);
  assert.ok(performance.now() - t < 200, 'stops once maxLines is reached');
  assert.equal(capped.length, 2);
  assert.ok(capped[1].endsWith('…'));
  // ordinary text is unchanged by the rewrite
  assert.deepEqual(wrapText('Order service talks to the payment gateway', 120, 14), ['Order service talks', 'to the payment', 'gateway']);
});

test('a 100k-character title renders quickly, is cut, and lint warns content/text-too-long', () => {
  const p = base();
  p.nodes[0].data.title = 'W'.repeat(100_000);
  p.edges[0].label = 'word '.repeat(20_000);
  const t = performance.now();
  const scene = computeScene(p);
  assert.ok(performance.now() - t < 200, `computeScene took ${performance.now() - t}ms`);
  assert.ok(scene.nodes[0].lines.title.join('').length < 400);
  assert.ok(String(scene.edges[0].edge.label).length <= TEXT_CAP + 1);
  const r = lint(p);
  assert.ok(codes(r).includes('content/text-too-long'));
  assert.equal(p.nodes[0].data.title.length, 100_000, 'the payload itself is not modified');
});

// --- 2. routing scales ------------------------------------------------------------
test('100 nodes / 200 edges (cyclic, labelled) route in under 5s with no failed routes', () => {
  const p = graph(100, 200);
  const t = performance.now();
  const scene = computeScene(p);
  const ms = performance.now() - t;
  assert.ok(ms < 5000, `computeScene took ${Math.round(ms)}ms`);
  assert.equal(scene.edges.filter((e) => !e.ok).length, 0);
  assert.ok(codes(lint(p)).includes('budget/large-graph-fast-routing'));
});

test('small graphs keep exact routing (no fast-routing warning)', () => {
  assert.ok(!codes(lint(base())).includes('budget/large-graph-fast-routing'));
});

// --- 3. file access stays inside its roots --------------------------------------------
test('resolvePage only loads relative .json diagram src inside the page folder', () => {
  const root = tmp('yantra-page-');
  const inner = path.join(root, 'site');
  fs.mkdirSync(inner);
  fs.writeFileSync(path.join(root, 'secret.json'), JSON.stringify(base()));
  fs.writeFileSync(path.join(inner, 'ok.json'), JSON.stringify(base()));
  fs.writeFileSync(path.join(inner, 'notes.txt'), JSON.stringify(base()));
  fs.writeFileSync(path.join(inner, 'bad.json'), '{ nope');
  const page = {
    kind: 'page',
    meta: { title: 'P', question: 'Q?' },
    answer: { headline: 'A.' },
    blocks: [
      { type: 'diagram', src: 'ok.json' },
      { type: 'diagram', src: '../secret.json' },
      { type: 'diagram', src: path.join(root, 'secret.json') },
      { type: 'diagram', src: 'notes.txt' },
      { type: 'diagram', src: 'bad.json' }
    ]
  };
  const out = resolvePage(page, inner);
  assert.ok(out.blocks[0].diagram);
  for (const k of [1, 2, 3, 4]) assert.equal(out.blocks[k].diagram, undefined, `block ${k} stays unresolved`);
  const r = lint(out);
  const unresolved = r.errors.filter((e) => e.code === 'page/diagram-unresolved');
  assert.equal(unresolved.length, 4);
  assert.match(unresolved[0].message, /inside the page's folder/);
});

function mcp(env = {}) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], { stdio: ['pipe', 'pipe', 'inherit'], cwd: env.cwd || ROOT, env: { ...process.env, ...env.vars } });
  const replies = [];
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  return {
    raw: (line) => proc.stdin.write(`${line}\n`),
    call: (id, name, args) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`),
    async wait(n) {
      const deadline = Date.now() + 10000;
      while (replies.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 30));
      proc.kill();
      return replies;
    }
  };
}

test('MCP rejects reads and writes outside its roots and with wrong extensions', async () => {
  const work = tmp('yantra-mcp-');
  const outside = tmp('yantra-out-');
  fs.writeFileSync(path.join(work, 'd.json'), JSON.stringify(base()));
  fs.writeFileSync(path.join(outside, 'd.json'), JSON.stringify(base()));
  const s = mcp({ cwd: work });
  s.call(1, 'yantra_export', { filePath: path.join(outside, 'd.json'), format: 'md' });
  s.call(2, 'yantra_export', { filePath: 'd.json', format: 'md', outputPath: path.join(outside, 'x.md') });
  s.call(3, 'yantra_export', { filePath: 'd.json', format: 'md', outputPath: '../escape.md' });
  s.call(4, 'yantra_export', { filePath: 'd.json', format: 'md', outputPath: 'x.html' });
  s.call(5, 'yantra_import_mermaid', { mermaid: 'graph LR\n A --> B', outputPath: path.join(outside, 'x.json') });
  s.call(6, 'yantra_export', { filePath: 'd.json', format: 'md', outputPath: 'sub-ok.md' });
  s.call(7, 'yantra_build', { filePath: 'd.json', outputPath: '../x.html', force: true });
  const replies = await s.wait(7);
  const byId = new Map(replies.map((r) => [r.id, r]));
  for (const id of [1, 2, 3, 4, 5, 7]) {
    assert.equal(byId.get(id).result.isError, true, `call ${id} is refused`);
    assert.match(byId.get(id).result.content[0].text, /must (be inside|end with)/);
  }
  assert.ok(!byId.get(6).result.isError);
  assert.ok(fs.existsSync(path.join(work, 'sub-ok.md')));
  assert.deepEqual(fs.readdirSync(outside), ['d.json'], 'nothing written outside the root');
  assert.ok(!fs.existsSync(path.join(path.dirname(work), 'escape.md')));
});

test('MCP output root can be widened with YANTRA_OUTPUT_ROOT / YANTRA_INPUT_ROOT', async () => {
  const work = tmp('yantra-mcp-');
  const other = tmp('yantra-root-');
  fs.writeFileSync(path.join(other, 'd.json'), JSON.stringify(base()));
  const s = mcp({ cwd: work, vars: { YANTRA_OUTPUT_ROOT: other, YANTRA_INPUT_ROOT: other } });
  s.call(1, 'yantra_export', { filePath: path.join(other, 'd.json'), format: 'md', outputPath: 'out.md' });
  const [r] = await s.wait(1);
  assert.ok(!r.result.isError, r.result.content?.[0]?.text);
  assert.ok(fs.existsSync(path.join(other, 'out.md')));
});

// --- 4. MCP survives non-object messages -------------------------------------------------
test('MCP answers null, arrays and numbers with -32600 and keeps serving', async () => {
  const s = mcp();
  s.raw('null');
  s.raw('[1,2]');
  s.raw('42');
  s.raw('"x"');
  s.raw('{"jsonrpc":"2.0","id":9,"method":"ping"}');
  const replies = await s.wait(5);
  assert.equal(replies.filter((r) => r.error?.code === -32600 && r.id === null).length, 4);
  assert.deepEqual(replies.find((r) => r.id === 9).result, {});
});

// --- 5. malformed payloads never crash -----------------------------------------------------
const MALFORMED = [
  null, 42, 'str', [], {}, { nodes: {} }, { nodes: [null] }, { nodes: [1, 'a', [], true] },
  { meta: { title: 'T' }, nodes: [null, { id: 'a', data: { title: 'A' } }], edges: [null, 5] },
  { meta: { title: 'T' }, nodes: [{ id: 1, data: { title: 'A' } }, { id: 2, data: { title: 'B' } }], edges: [{ id: 3, source: 1, target: 2 }] },
  { meta: { title: 'T' }, nodes: [{ id: {}, data: { title: 'A' } }] },
  { meta: { title: 'T' }, nodes: [{ id: 'a', data: 'x' }] },
  { meta: { title: 'T' }, nodes: [{ id: 'a', data: { title: 7 } }] },
  { meta: { title: 'T' }, nodes: [{ id: 'a', data: { title: { x: 1 } } }] },
  { meta: { title: 'T' }, nodes: [{ id: 'a', data: null }] },
  { meta: 'oops', nodes: [{ id: 'a', data: { title: 'A' } }] },
  { meta: null, nodes: [{ id: 'a', data: { title: 'A' } }] },
  { ...base(), edges: [{ id: 'e', source: { x: 1 }, target: ['b'] }] },
  { ...base(), edges: [{ id: 'e', source: 'a', target: 'b', label: 42 }] },
  { ...base(), edges: {} },
  { ...base(), groups: {} },
  { ...base(), groups: [null, 'g', { id: 'g', nodes: 'a' }] },
  { ...base(), groups: [{ id: 'g', nodes: ['a'], parent: 'g' }] },
  { ...base(), panels: [null, { id: 'p', title: 'P', blocks: 'x' }] },
  { ...base(), modes: [null, { id: 'm', hideNodes: 'a', hideEdges: 5 }] },
  { ...base(), modes: 'x' },
  { ...base(), steps: [null, 'x', { title: 'S', highlightNodes: 'a', highlightEdges: {} }] },
  { ...base(), steps: {} },
  { ...base(), scenarios: [null, { id: 's', steps: 'x' }] },
  { ...base(), scenarios: [{ id: 's', steps: [null, 3] }] },
  { ...base(), roles: [] },
  { ...base(), roles: { api: null, db: 'x' } },
  { ...base(), meta: { title: 'T', layout: 'x', inspector: 5, summary: [] } },
  { ...base(), meta: { title: 'T', inspector: { tabs: 5, onNodeClick: {} } } },
  { ...base(), meta: { title: 'T', layout: { mode: 'manual' } } },
  { ...base(), meta: { title: 'T', view: 'sequence' } },
  { ...base(), meta: { title: 'T', view: 'sequence' }, steps: [{ title: 'x', highlightEdges: ['e', 'nope'] }] },
  { ...base(), nodes: [{ id: 'a', data: { title: 'A', modes: 'x' } }, { id: 'b', data: { title: 'B', modes: { default: 5 } } }] },
  { kind: 'page' },
  { kind: 'page', blocks: [null, 5, { type: 'diagram', src: 7 }] }
];

test(`fuzz: ${MALFORMED.length} malformed payloads never crash lint, computeScene or the exporters`, () => {
  assert.ok(MALFORMED.length >= 30);
  MALFORMED.forEach((p, i) => {
    let report;
    assert.doesNotThrow(() => (report = lint(p)), `lint #${i}`);
    assert.ok(Array.isArray(report.errors), `lint #${i} returns a report`);
    if (p && typeof p === 'object' && p.kind === 'page') {
      assert.doesNotThrow(() => pageToMarkdown(p), `pageToMarkdown #${i}`);
      return;
    }
    // build --force renders whatever is there
    assert.doesNotThrow(() => renderSvg(computeScene(p)), `computeScene/renderSvg #${i}`);
    assert.doesNotThrow(() => sceneForView(p, { view: 'sequence' }), `sequence #${i}`);
    assert.doesNotThrow(() => toMarkdown(p), `toMarkdown #${i}`);
  });
});

test('malformed entries get schema errors and numeric ids are coerced', () => {
  assert.ok(codes(lint({ meta: { title: 'T' }, nodes: {} })).includes('schema/no-nodes'));
  assert.ok(codes(lint({ meta: { title: 'T' }, nodes: [null] })).includes('schema/nodes-entry-not-object'));
  const r = lint(MALFORMED[9]);
  assert.ok(!codes(r).some((c) => c.startsWith('ref/')), JSON.stringify(r.errors));
  const m = normalize(MALFORMED[9]);
  assert.equal(m.edges[0].source, '1');
  assert.ok(codes(lint(MALFORMED[17])).includes('ref/edge-unknown-source'));
});

// --- 6. Mermaid importer never crashes ----------------------------------------------------------
test('Mermaid long arrows import or warn instead of throwing', () => {
  for (const text of ['graph LR\n A ---------x', 'graph LR\n A ---------x B', 'graph LR\n A ==========> B', `graph LR\n A ${'-'.repeat(5000)}> B`, 'graph LR\n A -.-.-.-> B', `graph LR\n A -${'.'.repeat(3000)}-> B`]) {
    let out;
    const t = performance.now();
    assert.doesNotThrow(() => (out = fromMermaid(text)), text.slice(0, 40));
    assert.ok(performance.now() - t < 1000);
    assert.ok(Array.isArray(out.warnings));
  }
  assert.equal(fromMermaid('graph LR\n A ---------x B').payload.edges.length, 1);
});

test('fuzz: 60 random Mermaid inputs never throw unexpected errors', () => {
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pieces = ['A', 'B', 'c1', '-->', '---', '-.->', '==>', '--x', '--o', '<-->', '|lbl|', '[box]', '(round)', '{dec}', '((c))', '>flag]', '[(db)]', 'subgraph', 'end', ';', '&', ':::cls', 'classDef', 'style', '"q"', '%%', '\n', ' ', '-', '=', '.', '|', '[', ']', '(', ')', '{', '}', '__proto__', 'constructor', 'participant', '->>', '-->>', ':', 'Note', 'loop', 'alt', 'else'];
  const allowed = /empty|Unsupported Mermaid diagram type|no participants/;
  for (let k = 0; k < 60; k++) {
    const header = ['graph LR', 'flowchart TB', 'sequenceDiagram', 'graph', ''][k % 5];
    let body = '';
    const len = 1 + Math.floor(rnd() * 40);
    for (let j = 0; j < len; j++) body += pieces[Math.floor(rnd() * pieces.length)] + (rnd() < 0.3 ? ' ' : '');
    const text = `${header}\n${body}`;
    try {
      const out = fromMermaid(text);
      assert.ok(out.payload && Array.isArray(out.warnings));
      assert.doesNotThrow(() => lint(out.payload));
    } catch (err) {
      assert.match(err.message, allowed, `input ${JSON.stringify(text)} threw ${err.stack}`);
    }
  }
});

// --- 7. prototype keys are plain unknown values ------------------------------------------------
test('prototype keys never resolve to Object.prototype members', () => {
  const p = base({
    roles: { api: { color: 'constructor', icon: 'constructor' }, __proto__x: { color: 'blue' } },
    groups: [{ id: 'g', nodes: ['a'], color: '__proto__' }]
  });
  p.nodes[0].data.icon = 'constructor';
  p.nodes[1].type = 'hue';
  p.nodes.push({ id: 'c', type: '__proto__', data: { title: 'C' } });
  p.nodes.push({ id: 'd', type: 'constructor', data: { title: 'D', icon: 'toString' } });
  const scene = computeScene(p);
  for (const n of scene.nodes) {
    assert.equal(typeof n.hue, 'string', `node ${n.id} hue`);
    assert.equal(typeof n.icon, 'string', `node ${n.id} icon`);
    assert.notEqual(n.icon, 'constructor');
  }
  assert.equal(scene.groups[0].hue, 'slate');
  const model = normalize(p);
  assert.equal(typeof model.roles.__proto__.hue, 'string');
  const c = codes(lint(p));
  assert.ok(c.includes('content/unknown-color'));
  assert.ok(c.includes('content/unknown-icon'));
  assert.doesNotThrow(() => renderSvg(scene));
  const page = { kind: 'page', meta: { title: 'P', question: 'Q?' }, answer: { headline: 'A' }, blocks: [{ type: 'timeline', items: [{ date: '1', title: 'x', tone: 'constructor' }] }] };
  assert.doesNotThrow(() => lint(page));
});

// --- 8. Markdown cannot be injected -------------------------------------------------------------
test('Markdown exports escape headings, HTML and links in payload text', () => {
  const p = base();
  p.meta.title = 'Title\n# Injected heading';
  p.nodes[0].data.title = '<script>alert(1)</script>';
  p.edges[0].label = '[click](http://evil)';
  p.steps[0].title = 'Step\n## Fake';
  const md = toMarkdown(p);
  assert.ok(!/^#+ Injected|^#+ Fake/m.test(md), md);
  assert.ok(!/(^|[^\\])<script>/.test(md), 'raw HTML is escaped');
  assert.ok(!md.includes('[click](http://evil)'));
  const page = {
    kind: 'page',
    meta: { title: 'P', question: 'Why?\n# Boom' },
    answer: { headline: '<img src=x onerror=alert(1)>', points: ['# not a heading'] },
    blocks: [
      { type: 'points', title: 'T\n# H', items: [{ title: '[x](javascript:alert(1))' }] },
      { type: 'code', code: 'a\n```\n# escaped?\n```' }
    ]
  };
  const pm = pageToMarkdown(page);
  assert.ok(!/^# Boom|^# H$|^- # not/m.test(pm), pm);
  assert.ok(!/(^|[^\\])<img/.test(pm), 'raw HTML is escaped');
  assert.ok(!pm.includes('[x](javascript'));
  assert.ok(pm.includes('````'), 'code fence is longer than any fence inside the code');
});
