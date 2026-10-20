import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint } from '../src/core/index.js';
import { renderBlock, renderPage, pageToMarkdown } from '../src/core/page.js';
import { niceTicks, parseDay, fmtDay, fmtValue, resolveGantt, chartSeries, isSimpleBars, SERIES_HUES } from '../src/core/charts.js';

const page = (blocks) => ({ kind: 'page', meta: { question: 'Q?' }, answer: { headline: 'A.' }, blocks });
const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);
const series = { categories: ['Q1', 'Q2', 'Q3'], series: [{ name: 'North', values: [3, 5, 8] }, { name: 'South', values: [2, -1, 4] }] };

test('nice ticks are round numbers that cover the range', () => {
  assert.deepEqual(niceTicks(0, 97).ticks, [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(-38, 97).ticks, [-50, 0, 50, 100]);
  assert.deepEqual(niceTicks(0, 4.1).ticks, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(niceTicks(0, 0).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.equal(niceTicks(0, 0.9).dec, 1);
});

test('dates parse as YYYY-MM-DD or DD/MM/YYYY and print as DD/MM/YYYY', () => {
  assert.equal(parseDay('2026-11-02'), parseDay('02/11/2026'));
  assert.equal(fmtDay(parseDay('2026-11-02')), '02/11/2026');
  for (const bad of ['31/02/2026', '2026-13-01', '11/2026', 'soon', 5]) assert.equal(parseDay(bad), null, String(bad));
  assert.equal(fmtValue(-1200, { prefix: '£' }), '−£1,200');
  assert.equal(fmtValue(12.5, { unit: '%' }), '12.5%');
});

test('plain bar charts keep the HTML bar list; other kinds draw accessible SVG', () => {
  const bars = { type: 'chart', data: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] };
  assert.ok(isSimpleBars(bars));
  assert.match(renderBlock(bars), /<div class="p-bars" role="list">/);
  for (const kind of ['bar', 'column', 'line', 'area']) {
    const html = renderBlock({ type: 'chart', kind, title: 'Sales', ...series });
    assert.match(html, new RegExp(`<figure class="p-chart p-chart--${kind}">`), kind);
    assert.match(html, /<svg class="p-chart-svg" viewBox="0 0 \d+ \d+" role="img" aria-label="[^"]+Sales"/, kind);
    assert.match(html, /<ul class="p-legend" aria-hidden="true"><li data-hue="blue" data-i="0">.*North<\/li><li data-hue="orange" data-i="1">/, kind);
    assert.match(html, /data-s="1"/, `${kind}: series marks are tagged for legend toggles`);
    assert.match(html, /<table class="p-sr"><caption>[^<]*Sales<\/caption>.*<th scope="row">Q2<\/th><td>5<\/td><td>−1<\/td>/, kind);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/, kind);
  }
  // A negative value switches plain bars to SVG with a zero line
  const neg = renderBlock({ type: 'chart', data: [{ label: 'Up', value: 3 }, { label: 'Down', value: -2 }] });
  assert.match(neg, /p-chart--bar/);
  assert.match(neg, /class="c-zero"/);
});

test('stacked columns stack, half blocks draw narrower, series colours follow the safe order', () => {
  const full = renderBlock({ type: 'chart', kind: 'column', stacked: true, ...series });
  const half = renderBlock({ type: 'chart', kind: 'column', span: 'half', ...series });
  assert.match(full, /viewBox="0 0 760 /);
  assert.match(half, /viewBox="0 0 440 /);
  assert.deepEqual(chartSeries({ categories: ['a'], series: [1, 2, 3].map((n) => ({ name: `s${n}`, values: [n] })) }).series.map((s) => s.hue), SERIES_HUES.slice(0, 3));
  assert.equal(chartSeries({ categories: ['a'], series: [{ name: 's', values: [1], tone: 'bad' }] }).series[0].hue, 'rose');
});

test('line charts space dated categories by time and break at null values', () => {
  const html = renderBlock({ type: 'chart', kind: 'line', categories: ['01/01/2026', '02/01/2026', '31/01/2026'], series: [{ name: 'x', values: [1, null, 3] }] });
  const xs = [...html.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => +m[1]);
  assert.equal(xs.length, 2);
  assert.ok(xs[1] - xs[0] > 400, 'thirty days apart spans most of the axis');
  assert.doesNotMatch(html, /class="c-line"/, 'no line through a single-point run');
});

test('pie and donut show shares; a donut shows its total in the centre', () => {
  const data = [{ label: 'A', value: 75 }, { label: 'B', value: 25 }];
  const donut = renderBlock({ type: 'chart', kind: 'donut', prefix: '£', data });
  assert.match(donut, /class="c-total">£100<\/text>/);
  assert.match(donut, /<li data-hue="blue" data-i="0" data-v="75"><i><\/i><span>A<\/span><b>£75<\/b><em>75%<\/em><\/li>/);
  const pie = renderBlock({ type: 'chart', kind: 'pie', data: [{ label: 'Only', value: 5 }] });
  assert.match(pie, /<circle data-hue="blue" data-i="0" fill="currentColor" cx="120" cy="120" r="112">/);
});

test('chart lint: kinds, lengths, limits and negative slices', () => {
  const r = lint(page([
    { type: 'chart', kind: 'radar', data: [{ label: 'a', value: 1 }] },
    { type: 'chart', kind: 'line', categories: ['a', 'b'], series: [{ name: 's', values: [1] }] },
    { type: 'chart', kind: 'pie', data: [{ label: 'a', value: -1 }, { label: 'b', value: 2 }] },
    { type: 'chart', kind: 'column', categories: ['a'], series: Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, values: [i] })) },
    { type: 'chart', kind: 'column', data: Array.from({ length: 30 }, (_, i) => ({ label: `p${i}`, value: i })) },
    { type: 'chart', kind: 'line', categories: ['a'], series: [{ name: 's', values: ['x'] }] },
    { type: 'metrics', items: [{ label: 'm', value: '1', trend: [1] }] }
  ]));
  const c = codes(r);
  for (const code of ['page/chart-kind', 'page/chart-mismatch', 'page/chart-negative', 'page/chart-too-many-series', 'page/chart-too-many-points', 'page/block-invalid']) assert.ok(c.includes(code), code);
  assert.equal(r.errors.filter((f) => f.code === 'page/block-invalid').length, 2);
  assert.deepEqual(codes(lint(page([{ type: 'chart', kind: 'area', stacked: true, ...series }]))), []);
});

test('gantt resolves dates, relative days, dependencies and milestones', () => {
  const g = resolveGantt({
    items: [
      { id: 'a', title: 'Design', start: '02/11/2026', days: 5 },
      { id: 'b', title: 'Build', after: 'a', end: '2026-11-20' },
      { title: 'Test', days: 3 },
      { title: 'Launch', milestone: true, after: ['b', 'Test'] }
    ]
  });
  assert.equal(g.mode, 'date');
  assert.deepEqual(g.tasks.map((t) => [fmtDay(t.s), t.e - t.s]), [['02/11/2026', 5], ['07/11/2026', 14], ['21/11/2026', 3], ['24/11/2026', 0]]);
  assert.deepEqual(g.problems, []);
  const rel = resolveGantt({ items: [{ title: 'One', start: 0, days: 2 }, { title: 'Two', days: 3 }] });
  assert.equal(rel.mode, 'day');
  assert.deepEqual(rel.tasks.map((t) => [t.s, t.e]), [[0, 2], [2, 5]]);
});

test('gantt renders bars, groups, milestones, arrows and today; lint reports bad plans', () => {
  const b = {
    type: 'gantt', title: 'Plan', today: '05/11/2026',
    items: [
      { id: 'a', title: 'Design', group: 'Phase 1', start: '02/11/2026', days: 5, progress: 50 },
      { id: 'b', title: 'Ship', group: 'Phase 2', milestone: true, after: 'a' }
    ]
  };
  const html = renderBlock(b);
  assert.match(html, /<figure class="p-chart p-chart--gantt">/);
  assert.match(html, /class="c-group"[^>]*>Phase 1<\/text>/);
  assert.match(html, /class="c-track"/);
  assert.match(html, /class="c-ms"/);
  assert.match(html, /class="c-arrow"/);
  assert.match(html, /class="c-today-l">Today<\/text>/);
  assert.match(html, /<th scope="row">Design<\/th><td>Phase 1<\/td><td>02\/11\/2026<\/td><td>06\/11\/2026<\/td>/);
  assert.deepEqual(codes(lint(page([b]))), []);

  const bad = lint(page([{ type: 'gantt', items: [
    { id: 'x', title: 'X', after: 'y', days: 1 },
    { id: 'y', title: 'Y', after: 'x', days: 1 },
    { title: 'Z', start: '31/02/2026', days: 1 },
    { title: 'W', after: 'nope', days: 1 },
    { title: 'V', start: '10/11/2026', end: '01/11/2026' },
    { title: 'U', start: '10/11/2026' }
  ] }, { type: 'gantt', items: [{ start: 0 }] }]));
  for (const code of ['page/gantt-dependency', 'page/gantt-date', 'page/gantt-order', 'page/block-invalid']) assert.ok(codes(bad).includes(code), code);
});

test('matrix draws a 2x2 or a heat map and checks its axes', () => {
  const quad = { type: 'matrix', x: { label: 'Effort', low: 'Low', high: 'High' }, y: 'Impact', quadrants: ['Quick wins', 'Big bets', 'Fill-ins', { title: 'Avoid', tone: 'bad' }], items: [{ label: 'Alerts', x: 2, y: 8 }, { label: 'Chat', x: 8, y: 2 }] };
  const html = renderBlock(quad);
  assert.match(html, /class="c-qt">Quick wins<\/text>/);
  assert.match(html, /<circle data-hue="blue" class="c-dot"/);
  assert.match(html, /<rect data-hue="rose" class="c-heat"/);
  assert.deepEqual(codes(lint(page([quad]))), []);

  const heat = { type: 'matrix', grid: 3, x: { label: 'Likelihood', labels: ['Low', 'Mid', 'High'] }, y: 'Impact', items: [{ label: 'Outage', x: 3, y: 3 }] };
  const hm = renderBlock(heat);
  assert.equal((hm.match(/class="c-heat"/g) || []).length, 9);
  assert.match(hm, /class="c-pt">Outage<\/text>/);

  const r = lint(page([
    { ...quad, quadrants: ['a', 'b'] },
    { ...heat, x: { labels: ['a'] } },
    { ...quad, items: [{ label: 'Far', x: 20, y: 5 }] },
    { type: 'matrix', grid: 9, items: [] }
  ]));
  for (const code of ['page/chart-mismatch', 'page/chart-out-of-range', 'page/block-invalid']) assert.ok(codes(r).includes(code), code);
});

test('metric trends draw sparklines; markdown has text equivalents for every new block', () => {
  const p = page([
    { type: 'metrics', items: [{ label: 'Revenue', value: '£1.8m', trend: [1, 2, 3], tone: 'good' }] },
    { type: 'chart', kind: 'column', title: 'By region', ...series },
    { type: 'chart', kind: 'donut', unit: '%', data: [{ label: 'A', value: 60 }, { label: 'B', value: 40 }] },
    { type: 'gantt', items: [{ title: 'Build', start: '2026-11-02', days: 2 }, { title: 'Go live', milestone: true }] },
    { type: 'matrix', x: 'Effort', y: 'Value', quadrants: ['Quick wins', 'Big bets', 'Fill-ins', 'Avoid'], items: [{ label: 'Alerts', x: 2, y: 8 }] },
    { type: 'matrix', grid: 3, items: [{ label: 'Outage', x: 3, y: 3 }] }
  ]);
  assert.match(renderPage(p), /<svg class="p-spark" data-hue="green"/);
  const md = pageToMarkdown(p);
  assert.match(md, /\*\*Revenue:\*\* £1\.8m; trend 1 → 2 → 3/);
  assert.match(md, /\| {2}\| North \| South \|\n\|---\|---\|---\|\n\| Q1 \| 3 \| 2 \|\n\| Q2 \| 5 \| -1 \|/);
  assert.match(md, /- A: 60% \(60%\)\n- B: 40% \(40%\)\n- \*\*Total:\*\* 100%/);
  assert.match(md, /\| Task \| Start \| End \|\n\|---\|---\|---\|\n\| Build \| 02\/11\/2026 \| 03\/11\/2026 \|\n\| Go live \| 04\/11\/2026 \| Milestone \|/);
  assert.match(md, /- \*\*Quick wins:\*\* Alerts/);
  assert.match(md, /\| 3 \|  \|  \| Outage \|/);
});

test('gantt workdays skip weekends and holidays in durations and dependencies', () => {
  // 16/10/2026 is a Friday; Monday 26/10/2026 is a holiday
  const b = {
    type: 'gantt', start: '16/10/2026', workdays: true, holidays: ['2026-10-26'], today: 2,
    items: [
      { id: 'a', title: 'Design', days: 3 },
      { id: 'b', title: 'Build', after: 'a', days: 2 },
      { id: 'm', title: 'Ready', milestone: true, after: 'b' },
      { id: 'c', title: 'Test', after: 'b', days: 2 },
      { title: 'Deploy', after: 'c', days: 1 },
      { title: 'Fixed', start: 1, days: 1 }
    ]
  };
  const g = resolveGantt(b);
  const at = (t) => [fmtDay(t.s), fmtDay(t.e - 1), t.len];
  assert.deepEqual(g.tasks.map(at), [
    ['16/10/2026', '20/10/2026', 3], // Fri, Mon, Tue
    ['21/10/2026', '22/10/2026', 2],
    ['23/10/2026', '22/10/2026', 0], // the milestone marks the moment Build ends
    ['23/10/2026', '27/10/2026', 2], // Fri, (weekend, holiday), Tue
    ['28/10/2026', '28/10/2026', 1],
    ['19/10/2026', '19/10/2026', 1] // numeric start: working day 1 after the first
  ]);
  assert.deepEqual(g.problems, []);
  const html = renderBlock(b);
  assert.match(html, /<title>Test: 23\/10\/2026 – 27\/10\/2026 \(2 days\)<\/title>/, 'tooltips count working days');
  assert.match(html, /c-today-l/);
  assert.deepEqual(codes(lint(page([b]))), []);
  // A task that would start on a weekend moves to Monday; calendar days without workdays
  const plain = resolveGantt({ ...b, workdays: undefined, holidays: undefined });
  assert.equal(fmtDay(plain.tasks[0].e - 1), '18/10/2026');

  const bad = codes(lint(page([
    { type: 'gantt', workdays: true, holidays: ['31/02/2026'], items: [{ title: 'A', start: '2026-10-16', days: 1 }] },
    { type: 'gantt', holidays: ['2026-10-26'], items: [{ title: 'A', start: '2026-10-16', days: 1 }] },
    { type: 'gantt', workdays: true, items: [{ title: 'A', start: 0, days: 1 }] }
  ])));
  assert.equal(bad.filter((c) => c === 'page/gantt-date').length, 3, 'bad holiday, holidays without workdays, workdays without dates');
});

test('charts fit a measured container width (inspector panels) instead of scrolling', () => {
  const minWidth = (html) => +/min-width:(\d+)px/.exec(html)[1];
  const viewW = (html) => +/viewBox="0 0 (\d+) /.exec(html)[1];
  const blocks = [
    { type: 'chart', kind: 'column', ...series },
    { type: 'chart', kind: 'bar', ...series },
    { type: 'chart', kind: 'line', ...series },
    { type: 'gantt', items: [{ title: 'Design the new onboarding', start: '02/11/2026', days: 5 }, { title: 'Build', days: 10 }] },
    { type: 'matrix', x: 'Effort', y: 'Impact', items: [{ label: 'Alerts', x: 2, y: 8 }] },
    { type: 'matrix', grid: 3, items: [{ label: 'Outage', x: 3, y: 3 }] }
  ];
  for (const b of blocks) {
    const html = renderBlock(b, 'x', { width: 300 });
    assert.ok(viewW(html) <= 300 && minWidth(html) <= 300, `${b.type} ${b.kind || ''}: drawn at ${viewW(html)}px, min ${minWidth(html)}px`);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/);
    assert.ok(viewW(renderBlock(b)) > 400, 'without a width the design width is kept');
  }
  assert.match(renderBlock(blocks[0], 'x', { width: 5000 }), /viewBox="0 0 760 /, 'never wider than the design width');
});

test('pages inline the legend toggle script; series and slices are linked to legend items', () => {
  const html = renderPage(page([{ type: 'chart', kind: 'donut', data: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] }]));
  assert.match(html, /\(function enhanceCharts\(root\)[\s\S]*\)\(document\);/);
  assert.match(html, /data-fmt="\{&quot;p&quot;:&quot;&quot;,&quot;u&quot;:&quot;&quot;,&quot;l&quot;:&quot;en-GB&quot;\}"/);
  // The inlined source must not depend on module scope: it runs on its own
  const src = /\(function enhanceCharts[\s\S]*?\)\(document\);/.exec(html)[0];
  assert.doesNotThrow(() => new Function('document', src)({ querySelectorAll: () => [] }));
});
