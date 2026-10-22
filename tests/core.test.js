import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, computeScene, renderSvg, toMarkdown } from '../src/core/index.js';
import { renderPage, pageToMarkdown, md } from '../src/core/page.js';
import { resolvePage, resolveAny } from '../lib/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Every .json under examples/, subfolders included (detail levels kept in their own files)
const examples = fs.readdirSync(path.join(ROOT, 'examples'), { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.json')).sort();
const load = (f) => {
  const file = path.join(ROOT, 'examples', f);
  return resolveAny(JSON.parse(fs.readFileSync(file, 'utf-8')), path.dirname(file), { root: path.join(ROOT, 'examples') });
};

for (const file of examples) {
  test(`example ${file} has no errors or warnings`, () => {
    const r = lint(load(file));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });
}

/** n x m grid of services with cross links, a feedback loop and a long skip edge. */
function stressPayload(direction) {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) nodes.push({ id: `n${i}${j}`, type: `t${j}`, data: { title: `Service ${i}.${j}`, subtitle: 'Does one thing well' } });
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      edges.push({ id: `e${i}${j}`, source: `n${i}${j}`, target: `n${i + 1}${j}`, label: `step ${i}` });
      if (j < 2) edges.push({ id: `x${i}${j}`, source: `n${i}${j}`, target: `n${i + 1}${j + 1}`, label: 'fan out' });
    }
  edges.push({ id: 'skip', source: 'n00', target: 'n32', label: 'skip ahead' });
  edges.push({ id: 'back', source: 'n32', target: 'n00', label: 'feedback' });
  return {
    meta: { title: 'Stress', layout: { direction } },
    nodes,
    edges,
    scenarios: [{ id: 's', name: 'S', steps: [{ title: 'Overview' }] }]
  };
}

for (const direction of ['LR', 'TB']) {
  test(`dense ${direction} graph renders without geometry errors`, () => {
    const r = lint(stressPayload(direction));
    assert.deepEqual(r.errors.map((e) => e.code), []);
  });
}

test('cycles are laid out and routed', () => {
  const p = {
    meta: { title: 'Loop' },
    nodes: ['a', 'b', 'c'].map((id) => ({ id, data: { title: id.toUpperCase() } })),
    edges: [
      { id: 'ab', source: 'a', target: 'b', label: 'go' },
      { id: 'bc', source: 'b', target: 'c', label: 'go' },
      { id: 'ca', source: 'c', target: 'a', label: 'again' },
      { id: 'cc', source: 'c', target: 'c', label: 'retry' }
    ],
    steps: [{ title: 'Overview' }]
  };
  const scene = computeScene(p);
  assert.ok(scene.edges.every((e) => e.ok));
  assert.equal(lint(p).errors.length, 0);
});

test('main path of a chain is a straight row', () => {
  const p = {
    meta: { title: 'Chain' },
    nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, data: { title: id } })),
    edges: [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
      { id: 'cd', source: 'c', target: 'd' }
    ]
  };
  const scene = computeScene(p);
  assert.equal(new Set(scene.nodes.map((n) => n.y)).size, 1);
  assert.ok(scene.edges.every((e) => e.points.length === 2), 'edges should be single straight segments');
});

test('reference and story errors carry stable codes', () => {
  const r = lint({
    meta: {},
    nodes: [{ id: 'a', data: { title: 'A' } }, { id: 'a', data: { title: 'A2' } }],
    edges: [{ id: 'e', source: 'a', target: 'zzz' }],
    steps: [{ title: 'S', highlightNodes: ['nope'], highlightEdges: ['e'] }]
  });
  const codes = r.errors.map((e) => e.code);
  for (const c of ['schema/missing-title', 'ref/duplicate-node-id', 'ref/edge-unknown-target', 'ref/step-unknown-node']) assert.ok(codes.includes(c), c);
});

test('manual layout reports overlaps and missing coordinates', () => {
  const r = lint({
    meta: { title: 'M', layout: { mode: 'manual' } },
    nodes: [
      { id: 'a', x: 0, y: 0, data: { title: 'A' } },
      { id: 'b', x: 40, y: 20, data: { title: 'B' } },
      { id: 'c', data: { title: 'C' } }
    ],
    edges: []
  });
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes('layout/manual-missing-xy'));
});

test('modes hide nodes and apply data overrides', () => {
  const p = {
    meta: { title: 'Modes' },
    modes: [{ id: 'prod', name: 'Prod' }, { id: 'dev', name: 'Dev', hideNodes: ['b'] }],
    nodes: [
      { id: 'a', data: { title: 'A', modes: { dev: { title: 'A (dev)' } } } },
      { id: 'b', data: { title: 'B' } }
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b', label: 'x' }]
  };
  const dev = computeScene(p, { modeId: 'dev' });
  assert.deepEqual(dev.nodes.map((n) => n.id), ['a']);
  assert.equal(dev.edges.length, 0);
  assert.equal(dev.nodes[0].lines.title[0], 'A (dev)');
});

test('SVG export is self-contained and escapes text', () => {
  const p = load('cloud-architecture.json');
  p.meta.title = 'A <b> & "quote"';
  const svg = renderSvg(computeScene(p), { theme: 'dark' });
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
  assert.ok(!svg.includes('<b>'));
  assert.ok(!svg.includes('foreignObject'));
});

test('Markdown spec lists components and steps', () => {
  const md = toMarkdown(load('sales-pipeline.json'));
  assert.match(md, /^# /);
  assert.match(md, /## Components/);
  assert.match(md, /### 1\. /);
});

test('SVG export carries the watermark unless meta.watermark is false', () => {
  const p = load('cloud-architecture.json');
  assert.match(renderSvg(computeScene(p)), /Made with Yantra/);
  assert.match(renderSvg(computeScene({ ...p, meta: { ...p.meta, watermark: 'Acme Ltd' } })), /Acme Ltd/);
  assert.doesNotMatch(renderSvg(computeScene({ ...p, meta: { ...p.meta, watermark: false } })), /Made with Yantra/);
});

test('diagram Markdown includes the summary card', () => {
  assert.match(toMarkdown(load('cloud-architecture.json')), /## Summary[\s\S]*45k req\/s/);
});

test('answer page renders answer first, all block types and the watermark', () => {
  const page = load('answer-checkout-saga.json');
  const html = renderPage(page);
  assert.ok(html.indexOf('p-answer') < html.indexOf('p-grid'), 'answer comes before blocks');
  for (const t of ['diagram', 'steps', 'callout', 'compare', 'metrics', 'chart', 'sources']) assert.ok(html.includes(`p-block--${t}`), t);
  assert.match(html, /Made with Yantra/);
  assert.match(html, /<a class="p-badge" href="https:\/\/github\.com\/niyankhadka\/yantra" target="_blank" rel="noopener noreferrer"/);
  assert.ok(!/<script[^>]+src=|<link[^>]+stylesheet/.test(html), 'no external assets');
  assert.match(pageToMarkdown(page), /^# Why does our checkout/);
});

test('page markdown escapes HTML and drops non-http links', () => {
  const out = md('<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://example.com) **b**');
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('href="javascript'));
  assert.match(out, /<a href="https:\/\/example.com"/);
  assert.match(out, /<strong>b<\/strong>/);
});

test('page validation reports missing answer, bad blocks and embedded diagram errors', () => {
  const r = lint({
    kind: 'page',
    meta: { question: 'Q?' },
    blocks: [
      { type: 'nope' },
      { type: 'table', columns: ['a', 'b'], rows: [['only one']] },
      { type: 'diagram', diagram: { meta: { title: 'D' }, nodes: [{ id: 'a', data: { title: 'A' } }], edges: [{ id: 'e', source: 'a', target: 'zz' }] } }
    ]
  });
  const codes = r.errors.map((e) => e.code);
  for (const c of ['page/missing-answer', 'page/unknown-block', 'page/block-invalid', 'ref/edge-unknown-target']) assert.ok(codes.includes(c), c);
});

test('panels and inspector tabs are validated', () => {
  const base = load('cloud-architecture.json');
  assert.deepEqual(lint(base).errors, []);
  const bad = lint({
    ...base,
    meta: { ...base.meta, inspector: { tabs: ['summary', 'nope'] } },
    panels: [{ id: 'summary', title: 'Dup', blocks: [{ type: 'points', items: [] }] }, { id: 'x' }]
  });
  const codes = bad.errors.map((e) => e.code);
  for (const c of ['panel/duplicate-id', 'page/block-invalid', 'panel/missing-id-or-title', 'ref/inspector-unknown-tab']) assert.ok(codes.includes(c), c);
});

test('diagram Markdown includes custom panels', () => {
  const md = toMarkdown(load('cloud-architecture.json'));
  assert.match(md, /## Risks\n\n### System-wide[\s\S]*### Payment gateway\n\n- \*\*Provider outage\*\*/);
  assert.match(md, /## Glossary[\s\S]*\| Term \| Meaning \|/);
});

test('autoplay dwells per step, stops after the last step and replays from the start', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { YantraEngine } = await import('../src/app/engine.js');
  const e = new YantraEngine(load('sales-pipeline.json'));
  const total = e.getSteps().length;
  e.setSpeed(1000);
  e.play();
  assert.equal(e.playing, true);
  t.mock.timers.tick(1000);
  assert.equal(e.stepIndex, 1);
  e.goToStep(3); // manual navigation restarts the dwell
  t.mock.timers.tick(999);
  assert.equal(e.stepIndex, 3);
  t.mock.timers.tick(1);
  assert.equal(e.stepIndex, 4);
  for (let k = 0; k < total; k++) t.mock.timers.tick(1000);
  assert.equal(e.stepIndex, total - 1);
  assert.equal(e.playing, false, 'stops at the end');
  e.play();
  assert.equal(e.stepIndex, 0, 'play on the last step replays');
  e.pause();
});

test('onNodeClick and panel block nodes are validated', () => {
  const base = load('cloud-architecture.json');
  assert.deepEqual(lint({ ...base, meta: { ...base.meta, inspector: { onNodeClick: 'risks' } } }).errors, []);
  assert.deepEqual(lint({ ...base, meta: { ...base.meta, inspector: { onNodeClick: 'stay' } } }).errors, []);
  const bad = lint({
    ...base,
    meta: { ...base.meta, inspector: { onNodeClick: 'nowhere' } },
    panels: [{ id: 'p', title: 'P', blocks: [{ type: 'text', body: 'x', nodes: ['ghost'] }] }]
  });
  const codes = bad.errors.map((e) => e.code);
  assert.ok(codes.includes('ref/inspector-unknown-click-target'));
  assert.ok(codes.includes('ref/panel-unknown-node'));
  const hidden = lint({ ...base, meta: { ...base.meta, inspector: { tabs: ['summary'], onNodeClick: 'risks' } } });
  assert.ok(hidden.warnings.some((w) => w.code === 'ref/inspector-click-tab-hidden'));
});

test('meta.story takes "open", "collapsed" or "off"', () => {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'supply-chain.json'), 'utf-8'));
  for (const story of ['open', 'collapsed', 'off']) assert.deepEqual(lint({ ...base, meta: { ...base.meta, story } }).errors, [], story);
  const r = lint({ ...base, meta: { ...base.meta, story: 'hidden' } });
  assert.deepEqual(r.errors.map((f) => f.code), ['schema/unknown-story']);
});
