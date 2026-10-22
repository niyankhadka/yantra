import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lint, computeScene, renderSvg, toMarkdown, measureNode, CARD } from '../src/core/index.js';
import { MINI, MINI_KINDS, CHART_CARD, CHART_BUDGET, CARD_CHART_CSS, measureChart, chartBlock, miniModel, checkCardChart, inlineChart } from '../src/core/cardchart.js';
import { computeSequenceScene } from '../src/core/sequence.js';
import { renderBlock } from '../src/core/page.js';
import { localeOf } from '../src/core/i18n.js';
import { TOKENS } from '../src/core/theme.js';
import { ROOT } from './support.js';

const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));
const codes = (payload) => {
  const r = lint(payload);
  return { errors: r.errors.map((f) => f.code), warnings: r.warnings.map((f) => f.code) };
};
const card = (id, chart, extra = {}) => ({ id, type: 'svc', data: { title: id, subtitle: 'Job', ...(chart ? { chart } : {}) }, ...extra });
const diagram = (nodes, edges = []) => ({
  meta: { title: 'Charts' },
  roles: { svc: { label: 'Service', color: 'blue' } },
  nodes,
  edges,
  scenarios: [{ id: 'm', steps: [{ id: 's1', title: 'Overview' }, { id: 's2', title: 'Focus', highlightNodes: nodes.slice(0, 2).map((n) => n.id), highlightEdges: edges.slice(0, 1).map((e) => e.id) }] }]
});
const LINE = { kind: 'line', label: 'p95 latency', unit: ' ms', values: [180, 172, 165, 190, 158, 142], target: 160 };
const MINIS = {
  line: LINE,
  area: { kind: 'area', values: [3, 4, 2, 5] },
  column: { kind: 'column', label: 'Per hour', values: [120, 340, 210] },
  bar: { kind: 'bar', label: 'Conversion', unit: '%', data: [{ label: 'Basket', value: 100 }, { label: 'Paid', value: 41 }] },
  donut: { kind: 'donut', data: [{ label: 'Web', value: 58 }, { label: 'iOS', value: 42 }] },
  ring: { kind: 'ring', label: 'Uptime', value: 99.95, unit: '%', target: 99.9 },
  bullet: { kind: 'bullet', label: 'Revenue', prefix: '£', unit: 'm', value: 1.24, target: 1.5 }
};
const COLUMN_CARD = { kind: 'column', unit: ' ms', categories: ['London', 'Paris', 'Dublin'], series: [{ name: 'Last week', values: [140, 160, 150] }, { name: 'This week', values: [130, 150, 155] }] };

test('every mini chart kind draws, grows its card by gap + chart height, and the height is a grid multiple', () => {
  const plain = measureNode(card('a'));
  for (const kind of MINI_KINDS) {
    const node = card('a', MINIS[kind]);
    const m = measureNode(node);
    const chart = m.lines.chart;
    assert.ok(chart && chart.mini, kind);
    assert.match(chart.svg, /^<svg class="y-cc"/, kind);
    assert.equal(chart.svg.match(/height="(\d+)"/)[1], String(chart.h), kind);
    assert.equal(m.w, plain.w, `${kind}: mini charts keep the card width`);
    const raw = CARD.padY + CARD.kicker + CARD.kickerGap + CARD.titleLine + CARD.subGap + CARD.subLine + MINI.gap + chart.h + CARD.padY;
    assert.equal(m.h, Math.max(80, Math.ceil(raw / 20) * 20), kind);
    assert.ok(chart.label.length > 5, `${kind} has an accessible summary`);
  }
});

test('mini charts past the card limit say so: a "+N more" bar row and an "Other" donut slice', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ label: `Team ${i + 1}`, value: 10 + i }));
  const eight = measureNode(card('a', { kind: 'bar', data: rows(8) })).lines.chart;
  const ten = measureNode(card('a', { kind: 'bar', data: rows(10) })).lines.chart;
  assert.doesNotMatch(eight.svg, /data-more/, 'no row at the limit');
  assert.equal((ten.svg.match(/class="m-bar"/g) || []).length, 8, 'the card draws 8 bars');
  assert.match(ten.svg, /<g class="m-more-row" data-more="1">.*\+2 more<\/text><\/g>/, 'then a "+2 more" row');
  assert.equal(ten.h, eight.h + MINI.row, 'the row adds one line to the card');
  assert.match(ten.label, /Team 10 19/, 'a screen reader still hears every value');
  const nine = measureNode(card('a', { kind: 'donut', data: rows(9) })).lines.chart;
  assert.equal((nine.svg.match(/class="m-slice"/g) || []).length, 6, 'five slices and "Other"');
  assert.match(nine.svg, /<path class="m-slice" data-hue="slate" data-more="1"/, 'the merged slice opens Details');
  assert.match(nine.svg, />Other<\/text>/);
  const total = rows(9).slice(5).reduce((a, d) => a + d.value, 0);
  assert.match(nine.svg, new RegExp(`Other: ${total} `), '"Other" adds up the merged slices');
  const tops = [...nine.svg.matchAll(/<rect class="m-key"[^>]* y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(tops.every((y, i) => i === 0 || y - tops[i - 1] >= MINI.legendRow), 'legend rows never overlap');
  // the static export drops the click marker
  assert.doesNotMatch(inlineChart(ten.svg, TOKENS.light, () => '#000', '#000'), /data-more/);
  const w = lint(diagram([card('a', { kind: 'bar', data: rows(10) }), card('b')])).warnings.find((f) => f.code === 'chart/too-many-points');
  assert.match(w.message, /add "shape": "chart"/, 'the warning says how to show every bar');
});

test('mini chart model: defaults, value and the target', () => {
  assert.equal(miniModel({ values: [1, 2] }).kind, 'line');
  assert.equal(miniModel({ value: 40 }).kind, 'ring');
  assert.equal(miniModel({ value: 40 }).max, 100);
  assert.equal(miniModel(LINE).value, 142, 'the latest value');
  assert.equal(miniModel({ kind: 'bullet', value: 1.24, target: 1.7 }).max, 2, 'a round end at or above value and target');
  assert.equal(miniModel({ kind: 'pie' }).kind, null);
});

test('chart cards are wider, draw axes and a legend, and take node.width (240-480)', () => {
  const node = card('lat', COLUMN_CARD, { shape: 'chart' });
  const m = measureNode(node);
  assert.equal(m.w, CHART_CARD.width);
  assert.equal(measureNode({ ...node, width: 420 }).w, 420);
  assert.equal(measureNode({ ...node, width: 900 }).w, CHART_CARD.maxWidth);
  assert.equal(measureNode({ ...node, width: 100 }).w, CHART_CARD.minWidth);
  const svg = m.lines.chart.svg;
  assert.ok(!m.lines.chart.mini);
  assert.match(svg, /class="c-grid"/);
  assert.match(svg, /Last week/);
  assert.match(svg, /<title>Column chart<\/title>/);
  assert.ok(m.h > 250);
  // pie and donut: the drawing plus a legend of shares
  const pie = measureNode(card('p', { kind: 'pie', data: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] }, { shape: 'chart' }));
  assert.match(pie.lines.chart.svg, /75%/);
  // a single series takes the card's colour (no hue of its own)
  const single = measureNode(card('s', { kind: 'line', categories: ['a', 'b', 'c'], series: [{ name: 'x', values: [1, 3, 2] }] }, { shape: 'chart' }));
  assert.ok(!/data-hue="(card|blue)"/.test(single.lines.chart.svg));
});

test('the scene carries the chart; the sequence view leaves it out', () => {
  const p = diagram([card('a', LINE), card('b', COLUMN_CARD, { shape: 'chart' })], [{ id: 'e', source: 'a', target: 'b', label: 'Metrics' }]);
  const scene = computeScene(p);
  for (const n of scene.nodes) assert.ok(n.lines.chart, n.id);
  assert.equal(scene.nodes.find((n) => n.id === 'b').shape, 'chart');
  const seq = computeSequenceScene({ ...p, scenarios: [{ id: 'm', steps: [{ id: 's', title: 'x', highlightNodes: ['a', 'b'], highlightEdges: ['e'] }] }] });
  for (const n of seq.participants) assert.ok(!n.lines.chart, n.id);
});

test('numbers follow meta.lang', () => {
  const de = measureNode(card('a', { kind: 'ring', value: 99.5, unit: '%' }), { L: localeOf({ lang: 'de' }) });
  assert.match(de.lines.chart.svg, /99,5%/);
  assert.match(de.lines.chart.label, /Fortschrittsring/);
});

test('SVG export inlines the chart styles for each theme (no classes, no CSS)', () => {
  const p = diagram([card('a', LINE), card('b', COLUMN_CARD, { shape: 'chart' }), card('c', MINIS.ring)], [{ id: 'e', source: 'a', target: 'b', label: 'Metrics' }, { id: 'f', source: 'a', target: 'c', label: 'SQL' }]);
  const scene = computeScene(p);
  for (const theme of ['light', 'dark']) {
    const svg = renderSvg(scene, { theme });
    assert.ok(!/class="(m|c|l)-/.test(svg), `${theme}: classes are inlined`);
    assert.ok(!svg.includes('var(--'), `${theme}: no CSS variables`);
    assert.ok(!svg.includes('foreignObject'));
    assert.ok(svg.includes(TOKENS[theme].ink3), `${theme} ink`);
    assert.match(svg, /p95 latency/);
  }
  const one = inlineChart('<svg class="y-cc"><rect class="m-bar" data-hue="rose" fill="red"/><text class="m-value">1</text></svg>', TOKENS.light, () => '#c00', '#00f');
  assert.equal(one, `<svg color="#00f"><rect fill="currentColor" color="#c00"/><text fill="${TOKENS.light.ink}" font-weight="600">1</text></svg>`);
});

test('viewer CSS covers every chart class the export inlines', () => {
  const svg = Object.keys(MINIS).map((k) => measureChart(card('a', MINIS[k]), 200).svg).join('') + measureChart(card('b', COLUMN_CARD, { shape: 'chart' }), 330).svg;
  const used = new Set([...svg.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ')).filter((c) => /^(m|c|l)-/.test(c)));
  for (const c of used) assert.ok(CARD_CHART_CSS.includes(`.${c}`), c);
});

test('inspector and Markdown get a full-size equivalent', () => {
  assert.deepEqual(chartBlock(card('a', MINIS.ring)).data.map((d) => d.value), [99.95, 100 - 99.95]);
  assert.equal(chartBlock(card('a', MINIS.bullet)).kind, 'bar');
  // the card's target reaches the full-size chart as a target line
  assert.equal(chartBlock(card('a', LINE)).target, 160);
  assert.deepEqual(chartBlock(card('a', MINIS.bullet)).data.map((d) => d.value), [1.24], 'a bullet is its value, the target a line');
  assert.equal(chartBlock(card('a', MINIS.bullet)).target, 1.5);
  assert.equal(chartBlock(card('a', { ...MINIS.bar, target: 50 })).target, 50);
  assert.equal(chartBlock(card('a', MINIS.ring)).target, undefined, 'a ring keeps its tick (a donut has no target line)');
  const full = renderBlock({ ...chartBlock(card('a', LINE)), title: undefined }, 'x', { width: 300 });
  assert.match(full, /class="c-target"/);
  assert.match(full, /class="c-target-l">Target 160 ms</);
  assert.match(full, /aria-label="Line chart; Target 160 ms"/);
  assert.match(full, /<th scope="row">Target<\/th><td>160 ms<\/td>/);
  assert.match(measureChart(card('a', { ...MINIS.bar, target: 50 }), 200).svg, /class="m-target"/, 'mini bars draw their target too');
  assert.equal(chartBlock(card('a', LINE)).series[0].values.length, 6);
  assert.equal(chartBlock(card('b', COLUMN_CARD, { shape: 'chart' })).type, 'chart');
  assert.equal(chartBlock(card('c')), null);
  const md = toMarkdown(diagram([card('a', LINE), card('b', COLUMN_CARD, { shape: 'chart' }), card('c', MINIS.ring)]));
  assert.match(md, /## Chart/);
  assert.match(md, /- p95 latency: 180 ms, 172 ms, 165 ms, 190 ms, 158 ms, 142 ms/);
  assert.match(md, /- \*\*Target:\*\* 160 ms/);
  assert.match(md, /\| London \| 140 ms \| 130 ms \|/);
  assert.match(md, /- Uptime: 99.95% \/ 100%/);
});

test('lint: chart codes', () => {
  const one = (chart, extra) => checkCardChart(card('a', chart, extra)).map((f) => f.code);
  assert.deepEqual(one(undefined, { shape: 'chart' }), ['chart/missing']);
  assert.deepEqual(one('high'), ['chart/invalid']);
  assert.deepEqual(one({ kind: 'pie', values: [1, 2] }), ['chart/unknown-kind']);
  assert.deepEqual(one({ kind: 'ring', values: [1] }, { shape: 'chart' }), ['chart/unknown-kind']);
  assert.deepEqual(one({ values: [1] }), ['chart/invalid']);
  assert.deepEqual(one({ values: [1, 'x'] }), ['chart/invalid']);
  assert.deepEqual(one({ kind: 'ring' }), ['chart/invalid']);
  assert.deepEqual(one({ values: [1, 2], labels: ['a'] }), ['chart/mismatch']);
  assert.deepEqual(one({ kind: 'donut', data: [{ label: 'a', value: -1 }, { label: 'b', value: 2 }] }), ['chart/negative']);
  assert.deepEqual(one({ kind: 'ring', value: 120 }), ['chart/out-of-range']);
  assert.deepEqual(one({ values: Array.from({ length: 60 }, (_, i) => i) }), ['chart/too-many-points']);
  assert.deepEqual(one({ kind: 'bar', data: Array.from({ length: 8 }, (_, i) => ({ label: `r${i}`, value: i })) }), [], '8 bars fit a card');
  assert.deepEqual(one({ kind: 'bar', data: Array.from({ length: 9 }, (_, i) => ({ label: `r${i}`, value: i })) }), ['chart/too-many-points']);
  assert.deepEqual(one({ kind: 'donut', data: Array.from({ length: 6 }, (_, i) => ({ label: `d${i}`, value: i + 1 })) }), [], '6 slices fit a card');
  assert.deepEqual(one({ kind: 'donut', data: Array.from({ length: 7 }, (_, i) => ({ label: `d${i}`, value: i + 1 })) }), ['chart/too-many-points']);
  assert.deepEqual(one({ kind: 'column', data: [{ label: 'a' }] }, { shape: 'chart' }), ['chart/invalid']);
  assert.deepEqual(one({ ...COLUMN_CARD, series: [{ name: 'x', values: [1] }] }, { shape: 'chart' }), ['chart/mismatch']);
  const many = { kind: 'line', categories: ['a', 'b'], series: Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, values: [i, i + 1] })) };
  assert.deepEqual(one(many, { shape: 'chart' }), ['chart/too-many-series']);
  assert.deepEqual(one({ kind: 'column', data: Array.from({ length: 14 }, (_, i) => ({ label: `c${i}`, value: i })) }, { shape: 'chart' }), ['chart/too-many-points']);
  assert.deepEqual(one(LINE), []);
  assert.deepEqual(one(COLUMN_CARD, { shape: 'chart' }), []);
  // the diagram validator reports them with the node id, and checks the budgets
  const r = lint(diagram([card('a', { kind: 'pie', values: [1] }), card('b')]));
  assert.ok(r.errors.some((f) => f.code === 'chart/unknown-kind' && f.node === 'a'));
  const cards = Array.from({ length: CHART_BUDGET.chartCards + 1 }, (_, i) => card(`c${i}`, COLUMN_CARD, { shape: 'chart' }));
  assert.ok(codes(diagram(cards)).warnings.includes('budget/too-many-chart-cards'));
  const minis = Array.from({ length: CHART_BUDGET.miniCharts + 1 }, (_, i) => card(`m${i}`, LINE));
  assert.ok(codes(diagram(minis)).warnings.includes('budget/too-many-mini-charts'));
  assert.ok(!codes(diagram([card('a', LINE), card('b', COLUMN_CARD, { shape: 'chart' })])).errors.includes('schema/node-shape-invalid'));
});

test('a step can highlight a chart card; the chart examples validate clean', () => {
  const p = example('live-operations-dashboard');
  const r = lint(p);
  assert.deepEqual([...r.errors, ...r.warnings], []);
  const step = p.scenarios[0].steps.find((s) => s.highlightNodes?.includes('latency-chart'));
  assert.ok(step);
  const svg = renderSvg(computeScene(p), { highlight: { nodes: new Set(step.highlightNodes), edges: new Set(step.highlightEdges) } });
  assert.match(svg, /p95 latency by service/);
  assert.ok(p.nodes.filter((n) => n.shape === 'chart').length >= 3);
  for (const name of ['cloud-architecture', 'sales-pipeline', 'smart-city-operations']) assert.ok(example(name).nodes.some((n) => n.data.chart), name);
  const gallery = fs.readFileSync(path.join(ROOT, 'src/app/examples.js'), 'utf-8');
  assert.match(gallery, /live-operations-dashboard/);
});
