// Deep hierarchies: nested groups six levels deep in one frame (layout, tints, lint, folding to a
// depth, focusing a group) and long drill-down paths (limits, truncated breadcrumbs), across the
// core, CLI, MCP server and the viewer in a headless browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { lint, computeScene, renderSvg } from '../src/core/index.js';
import { GROUP_MAX_DEPTH, GROUP_BUDGET } from '../src/core/model.js';
import { groupPad, GROUP, groupTitleWidth } from '../src/core/layout.js';
import { GROUP_TONES, groupTone, themeCss } from '../src/core/theme.js';
import { foldLevels, foldsForDepth, depthOfFolds, groupTrail, foldsHidingGroup, crumbWindow, DEPTH_KEYS } from '../src/core/nesting.js';
import { DRILL_MAX_DEPTH, levelPath } from '../src/core/drill.js';
import { crumbListHtml } from '../src/app/levels.js';
import { fromMermaid } from '../src/core/mermaid.js';
import { findBrowser } from '../lib/browser.js';
import { buildAny, resolveAny } from '../lib/build.js';
import { ROOT, startBrowser, startMcp, tempDir, removeDir } from './support.js';

const CLI = path.join(ROOT, 'bin', 'yantra.js');
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));
const codes = (p) => {
  const r = lint(p);
  return { errors: r.errors.map((f) => f.code), warnings: r.warnings.map((f) => f.code), report: r };
};
const node = (id, title = `Service ${id}`) => ({ id, type: 'svc', data: { title } });
const edge = (source, target, label = 'calls') => ({ id: `${source}-${target}`, source, target, label });
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/**
 * Two branches six boxes deep, cards at every level, edges that cross several
 * boundaries on their way to a card outside every box.
 */
function deep(direction = 'LR') {
  const nodes = [node('hub', 'Operations hub')];
  const edges = [];
  const groups = [];
  for (const side of ['a', 'b']) {
    for (let d = 0; d < 6; d++) {
      const id = `${side}${d}`;
      groups.push({ id: `g-${id}`, title: `${side === 'a' ? 'North' : 'South'} level ${d + 1}`, nodes: [`n-${id}`], ...(d ? { parent: `g-${side}${d - 1}` } : {}) });
      nodes.push(node(`n-${id}`, `${side.toUpperCase()} card ${d + 1}`));
      if (d) edges.push(edge(`n-${id}`, `n-${side}${d - 1}`, 'reports'));
    }
    edges.push(edge(`n-${side}0`, 'hub', 'feed'));
  }
  edges.push(edge('hub', 'n-a5', 'command'));
  return {
    meta: { title: 'Deep', layout: { direction } },
    nodes,
    edges,
    groups,
    scenarios: [{ id: 's', name: 'S', steps: [{ title: 'All' }, { title: 'Deepest', focusGroup: 'g-a5', highlightNodes: ['n-a5'] }] }]
  };
}

/** Every box sits inside its parent, below the parent's title; sibling boxes and outsiders stay apart; titles are whole. */
function assertNested(scene) {
  const byId = new Map(scene.groups.map((g) => [g.id, g]));
  const chain = (g) => {
    const out = [];
    for (let p = g.parent; p; p = byId.get(p)?.parent) out.push(p);
    return out;
  };
  for (const g of scene.groups) {
    const p = byId.get(g.parent);
    if (p) {
      assert.ok(inside(g, p), `${g.id} inside ${p.id}`);
      assert.ok(!overlaps(g, p.titleBox), `${g.id} clear of the title of ${p.id}`);
    }
    assert.equal(g.label, g.title.toUpperCase(), `title of ${g.id} is not cut`);
    for (const n of scene.nodes) {
      assert.ok(!overlaps(n, g.titleBox), `${n.id} clear of the title of ${g.id}`);
      if (!g.members.includes(n.id)) assert.ok(!overlaps(n, g), `${n.id} outside ${g.id}`);
    }
  }
  for (const a of scene.groups)
    for (const b of scene.groups)
      if (a !== b && !chain(a).includes(b.id) && !chain(b).includes(a.id)) assert.ok(!overlaps(a, b), `${a.id} and ${b.id} apart`);
}

test('six levels in one frame lay out cleanly in both directions, with whole titles', () => {
  for (const dir of ['LR', 'TB']) {
    const p = deep(dir);
    const r = codes(p);
    assert.deepEqual(r.errors, [], `${dir}: ${JSON.stringify(r.report.errors)}`);
    assert.deepEqual(r.warnings, [], `${dir}: ${JSON.stringify(r.report.warnings)}`);
    const scene = computeScene(p);
    assert.equal(Math.max(...scene.groups.map((g) => g.depth)), 5);
    assertNested(scene);
    for (const e of scene.edges) assert.ok(e.ok, `${dir}: ${e.id} routed`);
  }
});

test('padding tightens with depth; the title strip and fold button always fit', () => {
  for (let d = 0; d <= 2; d++) assert.deepEqual(groupPad(d), { padX: GROUP.padX, padTop: GROUP.padTop, padBottom: GROUP.padBottom });
  for (let d = 3; d < 8; d++) {
    const pad = groupPad(d);
    assert.ok(pad.padX <= groupPad(d - 1).padX && pad.padBottom <= groupPad(d - 1).padBottom, `depth ${d} is no looser`);
    assert.ok(pad.padTop >= GROUP.titleY + GROUP.titleH + 6, 'the title keeps its strip');
  }
  const scene = computeScene(deep());
  const byId = new Map(scene.groups.map((g) => [g.id, g]));
  // the innermost box: its card sits the depth's padding in from the border
  const g = byId.get('g-a5');
  const n = scene.nodes.find((x) => x.id === 'n-a5');
  assert.equal(n.y - g.y, groupPad(5).padTop);
  assert.ok(g.toggleBox && g.toggleBox.x > g.titleBox.x + g.titleBox.w, 'the fold button sits after the title');
  assert.ok(g.w >= groupTitleWidth(g.title) + GROUP.titleX + GROUP.toggle);
});

test('nested tints get calmer with depth, the same in the viewer CSS and the SVG export', () => {
  for (let d = 1; d < GROUP_TONES.length; d++) {
    assert.ok(GROUP_TONES[d].fill <= GROUP_TONES[d - 1].fill && GROUP_TONES[d].fillDark <= GROUP_TONES[d - 1].fillDark);
  }
  // six translucent layers stay calm
  const sum = (k) => [0, 1, 2, 3, 4, 5].reduce((t, d) => t + groupTone(d)[k], 0);
  assert.ok(sum('fill') < 0.2 && sum('fillDark') < 0.3);
  assert.equal(groupTone(12), GROUP_TONES[GROUP_TONES.length - 1]);
  const css = themeCss();
  assert.match(css, /\.y-group\[data-depth="1"\] \{ background: color-mix\(in srgb, var\(--y-hue\) 3\.5%/);
  assert.match(css, /:root\[data-theme="dark"\] \.y-group-layer \.y-group\[data-depth="2"\]/);
  assert.match(css, /border-style: dotted/);
  for (const theme of ['light', 'dark']) {
    const svg = renderSvg(computeScene(deep()), { theme });
    assert.ok(svg.includes(`fill-opacity="${theme === 'dark' ? groupTone(5).fillDark : groupTone(5).fill}"`), `${theme}: deepest tint`);
    assert.ok(svg.includes('stroke-dasharray="1.5 3"'), `${theme}: dotted deep outline`);
  }
});

test('fold to depth: levels, ids, and the depth a fold state amounts to', () => {
  const p = deep();
  const info = foldLevels(p);
  assert.equal(info.kind, 'groups');
  assert.equal(info.levels, 6);
  assert.deepEqual(foldsForDepth(p, 6), []);
  assert.deepEqual(foldsForDepth(p, null), []);
  assert.deepEqual(foldsForDepth(p, 4).sort(), ['g-a4', 'g-a5', 'g-b4', 'g-b5']);
  assert.equal(foldsForDepth(p, 0).length, 12, 'depth 0 folds every box, inner ones too');
  assert.equal(depthOfFolds(p, foldsForDepth(p, 2)), 2);
  assert.equal(depthOfFolds(p, ['g-a2']), null, 'hand-picked folds are no depth');
  // depth 2: two levels of boxes stay open, each branch shows one summary card
  const scene = computeScene(p, { collapsed: foldsForDepth(p, 2) });
  assert.deepEqual(scene.groups.map((g) => g.id).sort(), ['g-a0', 'g-a1', 'g-b0', 'g-b1']);
  const summary = scene.nodes.find((n) => n.id === 'g-a2');
  assert.equal(summary.node.data.subtitle, '4 cards · 3 groups');
  assert.equal(summary.collapsed, 4);
  // trees fold by card depth (0 and 1 both leave the roots)
  const tree = example('org-chart');
  const t = foldLevels(tree);
  assert.equal(t.kind, 'tree');
  assert.deepEqual(foldsForDepth(tree, 1), foldsForDepth(tree, 0));
  assert.ok(computeScene(tree, { collapsed: foldsForDepth(tree, 1) }).nodes.length < computeScene(tree, { collapsed: foldsForDepth(tree, 2) }).nodes.length);
  assert.equal(foldLevels({ meta: { title: 'Flat' }, nodes: [node('a')], edges: [] }).kind, null);
  assert.equal(DEPTH_KEYS, 6);
});

test('unfolding an outer box restores the inner folds; summaries count cards and boxes', () => {
  const p = deep();
  const both = computeScene(p, { collapsed: ['g-a1', 'g-a3'] });
  assert.ok(!both.groups.some((g) => g.id === 'g-a1'));
  assert.equal(both.nodes.find((n) => n.id === 'g-a1').node.data.subtitle, '5 cards · 4 groups');
  const inner = computeScene(p, { collapsed: ['g-a3'] });
  assert.ok(inner.groups.some((g) => g.id === 'g-a1'), 'the outer box is open again');
  assert.equal(inner.nodes.find((n) => n.id === 'g-a3').node.data.subtitle, '3 cards · 2 groups');
  const leaf = computeScene(p, { collapsed: ['g-a5'] }).nodes.find((n) => n.id === 'g-a5');
  assert.equal(leaf.node.data.subtitle, '1 card folded');
  // translated summaries
  const de = computeScene({ ...p, meta: { ...p.meta, lang: 'de' } }, { collapsed: ['g-a3'] }).nodes.find((n) => n.id === 'g-a3');
  assert.equal(de.node.data.subtitle, '3 Karten · 2 Gruppen');
  assert.equal(de.node.data.badge, 'Gruppe');
  // a focused group opens with every box around it
  assert.deepEqual(groupTrail(p, 'g-a3').map((g) => g.id), ['g-a0', 'g-a1', 'g-a2', 'g-a3']);
  assert.deepEqual(foldsHidingGroup(p, 'g-a3', new Set(['g-a1', 'g-a3', 'g-b1'])), ['g-a1', 'g-a3']);
});

test('lint: depth and group budgets, focusGroup references, budgets counted as the diagram opens', () => {
  const chain = (depth, extra = {}) => {
    const p = { meta: { title: 'C' }, nodes: [node('a'), node('b')], edges: [edge('a', 'b')] };
    p.groups = Array.from({ length: depth }, (_, i) => ({ id: `l${i + 1}`, title: `Level ${i + 1}`, nodes: i === depth - 1 ? ['a'] : [], ...(i ? { parent: `l${i}` } : {}) }));
    return codes({ ...p, ...extra });
  };
  assert.equal(GROUP_MAX_DEPTH, 8);
  assert.deepEqual(GROUP_BUDGET, { groups: 24, depth: 6, nodes: 48, edges: 64 });
  assert.ok(chain(9).errors.includes('group/too-deep'));
  assert.ok(chain(8).warnings.includes('budget/deep-nesting') && !chain(8).errors.length);
  assert.ok(!chain(6).warnings.includes('budget/deep-nesting'));

  const many = (n) => codes({ meta: { title: 'M' }, nodes: Array.from({ length: n }, (_, i) => node(`n${i}`)), edges: [], groups: Array.from({ length: n }, (_, i) => ({ id: `g${i}`, title: `Box ${i}`, nodes: [`n${i}`] })) });
  assert.ok(!many(12).warnings.includes('budget/too-many-groups'), 'twelve groups are fine now');
  assert.ok(many(25).warnings.includes('budget/too-many-groups'));

  const p = deep();
  p.scenarios[0].steps[1].focusGroup = 'nope';
  assert.ok(codes(p).errors.includes('ref/step-unknown-group'));
  const tree = example('org-chart');
  tree.scenarios[0].steps[0].focusGroup = 'eng';
  tree.groups = [{ id: 'eng', title: 'Engineering', nodes: ['cto'] }];
  assert.ok(codes(tree).warnings.includes('layout/focus-group-ignored'));

  // 30 cards that open folded to 10 stay within budget; all of them unfolded are capped at 48
  const big = (n) => {
    const nodes = [node('hub')];
    const groups = [];
    const edges = [];
    for (let k = 0; nodes.length <= n; k++) {
      const ids = [0, 1, 2].map((i) => `c${k}-${i}`);
      ids.forEach((id) => nodes.push(node(id)));
      groups.push({ id: `box${k}`, title: `Team ${k}`, nodes: ids });
      edges.push(edge(ids[0], 'hub', 'feed'));
    }
    return { meta: { title: 'Big', layout: { collapsed: groups.map((g) => g.id) } }, nodes, edges, groups, scenarios: [{ id: 's', name: 'S', steps: [{ title: 'All' }] }] };
  };
  assert.ok(!codes(big(27)).warnings.includes('budget/too-many-nodes'), JSON.stringify(codes(big(27)).report.warnings));
  assert.ok(codes(big(50)).warnings.includes('budget/too-many-nodes'));
});

test('lint checks nested geometry at every depth the viewer folds to', () => {
  const r = lint(example('smart-city-operations'));
  assert.equal(r.valid, true);
  assert.deepEqual(r.warnings, []);
  // a manual layout that pushes a card into a foreign box is caught, tagged by state
  const p = deep();
  p.meta.layout = { mode: 'manual' };
  p.nodes.forEach((n, i) => Object.assign(n, { x: (i % 4) * 300, y: Math.floor(i / 4) * 200 }));
  const bad = codes(p);
  assert.ok(bad.errors.some((c) => c.startsWith('geometry/')), bad.errors.join(', '));
});

test('drill-down: eight levels below the overview, cycle detection kept', () => {
  assert.equal(DRILL_MAX_DEPTH, 8);
  const level = (title, drill) => ({ meta: { title }, nodes: [{ id: `${title}-n`, data: { title, ...(drill ? { drill } : {}) } }], edges: [] });
  const root = level('Top', 'l1');
  root.diagrams = {};
  for (let i = 1; i <= 8; i++) root.diagrams[`l${i}`] = level(`L${i}`, i < 8 ? `l${i + 1}` : null);
  assert.ok(!codes(root).errors.includes('drill/too-deep'));
  assert.deepEqual(levelPath(root, ['l8']), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'], 'a deep link with only the last id is repaired');
  root.diagrams.l8 = level('L8', 'l9');
  root.diagrams.l9 = level('L9');
  assert.ok(codes(root).errors.includes('drill/too-deep'));
  root.diagrams.l9 = level('L9', 'l3');
  assert.ok(codes(root).errors.includes('drill/cycle'));
  // the retail example: five levels below its overview, nested groups inside levels
  const retail = example('global-retail-group');
  assert.deepEqual(lint(retail).warnings, []);
  assert.deepEqual(levelPath(retail, ['kernel']), ['europe', 'uk', 'flagship', 'terminal', 'kernel']);
});

test('breadcrumbs: short trails whole, long ones first › … › parent › current', () => {
  assert.deepEqual(crumbWindow(3), { shown: [0, 1, 2], hidden: [] });
  assert.deepEqual(crumbWindow(4), { shown: [0, 1, 2, 3], hidden: [] });
  assert.deepEqual(crumbWindow(6), { shown: [0, null, 4, 5], hidden: [1, 2, 3] });
  const items = ['Overview', 'Europe', 'United Kingdom', 'London flagship', 'Terminal', 'Kernel'].map((title, i) => ({ title, attr: `data-level="${i}"` }));
  const html = crumbListHtml(items, (n) => `Show ${n} hidden levels`);
  assert.match(html, /data-crumb-more="1,2,3"/);
  assert.match(html, /aria-label="Show 3 hidden levels"/);
  assert.match(html, /<span aria-current="page">Kernel<\/span>/);
  assert.ok(!html.includes('United Kingdom'), 'hidden levels wait in the menu');
  assert.match(crumbListHtml(items.slice(0, 3), () => ''), /Europe/);
});

test('importers keep six levels of nesting and merge deeper ones', () => {
  const open = Array.from({ length: 8 }, (_, i) => `${'  '.repeat(i)}subgraph s${i} [Level ${i + 1}]`).join('\n');
  const close = Array.from({ length: 8 }, (_, i) => `${'  '.repeat(7 - i)}end`).join('\n');
  const { payload, warnings } = fromMermaid(`flowchart LR\n${open}\n${'  '.repeat(8)}A --> B\n${close}`);
  const depthOf = (g) => {
    let d = 0;
    for (let q = g; q; q = payload.groups.find((x) => x.id === q.parent)) d++;
    return d;
  };
  assert.equal(Math.max(...payload.groups.map(depthOf)), GROUP_BUDGET.depth);
  assert.ok(warnings.some((w) => /nested deeper than 6 levels/.test(w)), warnings.join('\n'));
});

test('CLI --depth folds build and export output; it does not mix with --collapsed', () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, 'deep.json');
    fs.writeFileSync(input, JSON.stringify(deep()));
    const chips = (file) => (fs.readFileSync(file, 'utf-8').match(/>\+\d+<\/text>/g) || []).length;
    let res = spawnSync(process.execPath, [CLI, 'export', input, '-f', 'svg', '--depth', '3', '-o', path.join(dir, 'a.svg')], { encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(chips(path.join(dir, 'a.svg')), 2, 'one summary card per branch');
    res = spawnSync(process.execPath, [CLI, 'export', input, '-f', 'svg', '--depth', 'all', '-o', path.join(dir, 'b.svg')], { encoding: 'utf-8' });
    assert.equal(chips(path.join(dir, 'b.svg')), 0);
    res = spawnSync(process.execPath, [CLI, 'build', input, '--depth', '1', '-o', path.join(dir, 'c.html')], { encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'c.html'), 'utf-8'), /"collapsed":\["g-a1","g-b1"/);
    res = spawnSync(process.execPath, [CLI, 'build', input, '--depth', '1', '--collapsed', 'g-a1', '-o', path.join(dir, 'd.html')], { encoding: 'utf-8' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /one of --collapsed, --expand-all and --depth/);
    res = spawnSync(process.execPath, [CLI, 'build', input, '--depth', 'two', '-o', path.join(dir, 'e.html')], { encoding: 'utf-8' });
    assert.equal(res.status, 1);
  } finally {
    removeDir(dir);
  }
});

test('MCP export takes depth; the schema lists it and screenshot takes focus', async () => {
  const s = startMcp();
  s.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  s.send({ method: 'notifications/initialized' });
  s.send({ id: 2, method: 'tools/list' });
  s.call(3, 'yantra_export', { payload: deep(), format: 'svg', depth: 2 });
  s.call(4, 'yantra_export', { payload: deep(), format: 'svg', depth: 2, expandAll: true });
  let replies;
  try {
    replies = await s.waitFor(4);
  } finally {
    await s.close();
  }
  const tools = replies.get(2).result.tools;
  assert.ok(tools.find((t) => t.name === 'yantra_build').inputSchema.properties.depth);
  assert.ok(tools.find((t) => t.name === 'yantra_screenshot').inputSchema.properties.focus);
  const svg = JSON.parse(replies.get(3).result.content[0].text).content;
  assert.equal((svg.match(/>\+\d+<\/text>/g) || []).length, 2);
  assert.ok(replies.get(4).result.isError, 'depth and expandAll together are refused');
});

// --- the viewer --------------------------------------------------------------------------
const executable = findBrowser();
const skip = executable ? false : 'no Chrome, Edge or Chromium found (set YANTRA_BROWSER to run the browser tests)';
let browser = null;
let dir = null;

async function open(name, hash = '') {
  const file = path.join(ROOT, 'examples', `${name}.json`);
  const data = resolveAny(JSON.parse(fs.readFileSync(file, 'utf-8')), path.dirname(file));
  const out = path.join(dir, `${name}.html`);
  fs.writeFileSync(out, buildAny(data, path.dirname(file)));
  const page = await browser.open(`${pathToFileURL(out).href}${hash ? `#${hash}` : ''}`);
  await page.waitFor('location.protocol === "file:" && document.readyState === "complete" && !!window.yantra');
  return page;
}
const key = (page, k, extra = '') => page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true${extra} }))`);

before(async () => {
  if (skip) return;
  dir = tempDir('yantra-nesting-');
  browser = await startBrowser(executable);
});

after(async () => {
  if (browser) await browser.close();
  if (dir) removeDir(dir);
});

test('viewer: keys and the toolbar menu fold to a depth; the link keeps it', { skip }, async () => {
  const page = await open('smart-city-operations');
  assert.equal(await page.eval('document.getElementById("depth").hidden'), false, 'the depth menu is offered');
  await key(page, '2', ", code: 'Digit2'");
  await page.waitFor('/depth=2/.test(location.hash)');
  assert.equal(await page.eval('document.querySelectorAll(".y-group").length'), 5, 'city, two districts, operations centre... and no deeper box');
  assert.match(await page.eval(`document.querySelector('.y-node[data-id="n-transport"]').textContent`), /4 cards · 3 groups/);
  await key(page, '0', ", code: 'Digit0'");
  await page.waitFor('/depth=all/.test(location.hash)');
  assert.equal(await page.eval('window.yantra.engine.collapsed.size'), 0);
  await page.eval(`document.getElementById('btn-depth').click()`);
  assert.equal(await page.eval('document.getElementById("depth-menu").hidden'), false);
  await page.eval(`document.querySelector('#depth-menu [data-depth="1"]').click()`);
  await page.waitFor('/depth=1/.test(location.hash)');
  assert.equal(await page.eval(`document.querySelector('#depth-menu [data-depth="1"]').getAttribute('aria-checked')`), 'true');
  // a deep link opens folded to that depth
  const linked = await open('smart-city-operations', 'depth=3');
  assert.equal(await linked.eval('window.yantra.engine.foldDepth()'), 3);
});

test('viewer: double-click a group title to zoom to it; the path shows; Esc zooms out', { skip }, async () => {
  const page = await open('smart-city-operations', 'depth=all');
  await page.eval(`document.querySelector('.y-group-title[data-group="n-junction"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await page.waitFor('/focus=n-junction/.test(location.hash)');
  const crumbs = await page.eval('document.getElementById("focus-crumbs").textContent');
  assert.match(crumbs, /Whole diagram/);
  assert.match(crumbs, /Junction 14 cabinet/);
  assert.match(crumbs, /…/, 'a deep path folds its middle');
  assert.ok(await page.eval(`document.querySelector('.y-group[data-id="n-junction"]').classList.contains('is-focused')`));
  // the "…" lists the hidden boxes; choosing one zooms there
  await page.eval(`document.querySelector('#focus-crumbs [data-crumb-more]').click()`);
  assert.equal(await page.eval('document.getElementById("crumb-menu").hidden'), false);
  assert.match(await page.eval('document.getElementById("crumb-menu").textContent'), /North district/);
  await page.eval(`document.querySelector('#crumb-menu [data-focus="north"]').click()`);
  await page.waitFor('/focus=north/.test(location.hash)');
  await key(page, 'Escape');
  await page.waitFor('/focus=city/.test(location.hash)');
  await key(page, 'Escape');
  await page.waitFor('!/focus=/.test(location.hash)');
  assert.equal(await page.eval('document.getElementById("focus-crumbs").hidden'), true);
  // key G zooms to the selected card's innermost group
  await page.eval(`window.yantra.select('pump-controller')`);
  await key(page, 'g');
  await page.waitFor('window.yantra.focusId === "s-pump-rack"');
});

test('viewer: a step with focusGroup unfolds its boxes and frames it', { skip }, async () => {
  const page = await open('smart-city-operations');
  assert.ok(await page.eval(`window.yantra.engine.collapsed.has('s-pumping')`), 'opens folded');
  await page.eval('window.yantra.engine.goToStep(3)');
  await page.waitFor('window.yantra.focusId === "s-pumping"');
  assert.equal(await page.eval(`window.yantra.engine.collapsed.has('s-pumping')`), false, 'the step unfolded it');
  assert.ok(await page.eval(`!!document.querySelector('.y-group[data-id="s-pump-rack"]')`));
  assert.ok(!/focus=/.test(await page.eval('location.hash')), "a step's focus lives in step=");
  await page.eval('window.yantra.engine.goToStep(5)');
  await page.waitFor('window.yantra.focusId === null');
});

test('viewer: a deep drill level truncates its breadcrumb; the menu jumps up', { skip }, async () => {
  const page = await open('global-retail-group', 'level=kernel');
  await page.waitFor('window.yantra.levels.depth === 5');
  const text = await page.eval('document.getElementById("crumbs").textContent');
  assert.match(text, /Global retail group/);
  assert.match(text, /…/);
  assert.match(text, /Payment terminal T-07/);
  assert.ok(!/United Kingdom/.test(text));
  await page.eval(`document.querySelector('#crumbs [data-crumb-more]').click()`);
  assert.match(await page.eval('document.getElementById("crumb-menu").textContent'), /Europe region.*United Kingdom.*London flagship store/s);
  await page.eval(`document.querySelector('#crumb-menu [data-level="2"]').click()`);
  await page.waitFor('window.yantra.levels.depth === 2');
  assert.equal(await page.eval('window.yantra.engine.model.meta.title'), 'United Kingdom');
});
