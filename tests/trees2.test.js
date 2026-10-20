import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint, computeScene, renderSvg } from '../src/core/index.js';
import { COMPACT, COMPACT_AUTO, ASSIST } from '../src/core/tree.js';
import { YantraEngine } from '../src/app/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'yantra.js');
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));

const node = (id, extra = {}) => ({ id, width: 180, data: { title: `Card ${id}` }, ...extra });
const link = (source, target, label) => ({ id: `${source}-${target}`, source, target, ...(label ? { label } : {}) });
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const codes = (p) => {
  const r = lint(p);
  return { errors: r.errors.map((f) => f.code), warnings: r.warnings.map((f) => f.code) };
};
const at = (s, id) => s.nodes.find((n) => n.id === id);
const edge = (s, id) => s.edges.find((e) => e.id === id);

/** A CEO with `teams` leaders, each leading `size` people (leaves). */
function org(teams, size, layout = {}, extra = (p) => p) {
  const nodes = [node('ceo')];
  const edges = [];
  for (let t = 0; t < teams; t++) {
    nodes.push(node(`l${t}`));
    edges.push(link('ceo', `l${t}`));
    for (let k = 0; k < size; k++) {
      nodes.push(node(`l${t}.${k}`));
      edges.push(link(`l${t}`, `l${t}.${k}`));
    }
  }
  return extra({ meta: { title: 'Org', layout: { algorithm: 'tree', direction: 'TB', ...layout } }, nodes, edges, steps: [{ title: 'Overview' }] });
}

function assertNoOverlap(scene) {
  for (let i = 0; i < scene.nodes.length; i++)
    for (let j = i + 1; j < scene.nodes.length; j++)
      assert.ok(!overlaps(scene.nodes[i], scene.nodes[j]), `${scene.nodes[i].id} overlaps ${scene.nodes[j].id}`);
}

test('compact: leaf teams stack in one column below their leader, on a side bus', () => {
  const s = computeScene(org(3, 4, { compact: true }));
  assertNoOverlap(s);
  const lead = at(s, 'l1');
  const team = [0, 1, 2, 3].map((k) => at(s, `l1.${k}`));
  for (const m of team) assert.equal(m.x, team[0].x, 'one column');
  for (let k = 1; k < team.length; k++) assert.ok(team[k].y > team[k - 1].y + team[k - 1].h, 'top to bottom, apart');
  assert.ok(team[0].y >= lead.y + lead.h + COMPACT.gap, 'below the leader');
  assert.ok(team[0].x > lead.x && team[0].x < lead.x + lead.w, 'indented under the leader');
  const e = edge(s, 'l1-l1.2');
  assert.ok(e.tree);
  assert.deepEqual(e.points[0], { x: lead.x + COMPACT.indent, y: lead.y + lead.h }, 'leaves the leader bottom, on the bus');
  assert.equal(e.points.at(-1).x, team[2].x, 'enters the card from the left');
  assert.equal(e.points.at(-1).y, team[2].y + team[2].h / 2);
  // The leaders themselves still hang off the CEO's comb, in one row
  assert.equal(at(s, 'l0').y, at(s, 'l2').y);
  assert.deepEqual(codes(org(3, 4, { compact: true })), { errors: [], warnings: [] });
});

test('compact: auto stacks a wide 35-person org chart and leaves small trees spread', () => {
  const wide = org(5, 6);
  assert.equal(wide.nodes.length, 36);
  const auto = computeScene(wide);
  const spread = computeScene(org(5, 6, { compact: false }));
  assert.ok(spread.bounds.w > COMPACT_AUTO.width && spread.bounds.w > spread.bounds.h * COMPACT_AUTO.ratio, 'spread is too wide');
  assert.ok(auto.bounds.w < spread.bounds.w / 2, `auto compacts (${auto.bounds.w} vs ${spread.bounds.w})`);
  assert.ok(auto.bounds.w / auto.bounds.h < 2 && auto.bounds.h / auto.bounds.w < 1.5, `reasonable aspect ${auto.bounds.w}x${auto.bounds.h}`);
  assertNoOverlap(auto);
  assert.equal(lint(wide).errors.length, 0);
  // A small org stays a classic spread tree
  const small = computeScene(org(2, 2));
  assert.equal(at(small, 'l0.0').y, at(small, 'l0.1').y, 'small teams stay in a row');
  assert.equal(computeScene(example('incident-triage-decision-tree')).nodes.length > 0, true);
});

test('compact: mixed parents, deeper levels and folded subtrees stay clear of stacks', () => {
  // l0 leads a manager with a team, l1 a flat team: the stack must not hit the deeper row
  const p = org(2, 5, { compact: true }, (q) => {
    q.nodes.push(node('m'), node('m.0'), node('m.1'), node('m.2'));
    q.edges.splice(1, 0, link('l0', 'm'));
    q.edges.push(link('m', 'm.0'), link('m', 'm.1'), link('m', 'm.2'));
    return q;
  });
  const s = computeScene(p);
  assertNoOverlap(s);
  assert.deepEqual(codes(p), { errors: [], warnings: [] });
  assert.equal(at(s, 'l0.0').y, at(s, 'l0.1').y, 'a parent with a non-leaf child keeps its row');
  assert.equal(at(s, 'm.0').x, at(s, 'm.2').x, 'the leaf team below the manager stacks');
  // Folding a leader drops its stack
  const f = computeScene(p, { collapsed: ['l1'] });
  assert.equal(at(f, 'l1').collapsed, 5);
  assert.ok(!at(f, 'l1.0'));
});

test('compact: labelled leaf edges, LR trees and mind maps are never stacked', () => {
  const labelled = org(2, 3, { compact: true }, (q) => ((q.edges.find((e) => e.id === 'l0-l0.1').label = 'Interim'), q));
  const s = computeScene(labelled);
  assert.equal(at(s, 'l0.0').y, at(s, 'l0.1').y, 'labelled team spreads');
  assert.equal(at(s, 'l1.0').x, at(s, 'l1.1').x, 'unlabelled team stacks');
  const lr = org(2, 3, { compact: true, direction: 'LR' });
  assert.ok(codes(lr).warnings.includes('layout/compact-ignored'));
  const mm = org(2, 3, { compact: true, algorithm: 'mindmap' });
  assert.ok(codes(mm).warnings.includes('layout/compact-ignored'));
  assert.ok(codes(org(1, 2, { compact: 'yes' })).errors.includes('schema/layout-compact-invalid'));
  assert.deepEqual(codes(org(1, 2, { compact: 'auto' })).warnings, []);
});

test('assistants sit beside their manager on a short side connector', () => {
  const p = org(3, 2, { compact: false }, (q) => {
    q.nodes.push(node('ea', { data: { title: 'Assistant', assistant: true } }), node('cos', { data: { title: 'Chief of staff', assistant: true } }));
    q.edges.push(link('ceo', 'ea'), link('ceo', 'cos'));
    return q;
  });
  const s = computeScene(p);
  assertNoOverlap(s);
  assert.deepEqual(codes(p), { errors: [], warnings: [] });
  const ceo = at(s, 'ceo');
  const ea = at(s, 'ea');
  const cos = at(s, 'cos');
  assert.equal(ea.y, ceo.y, 'same row as the manager');
  assert.equal(ea.x, ceo.x + ceo.w + ASSIST.gap, 'first assistant on the right');
  assert.equal(cos.x + cos.w, ceo.x - ASSIST.gap, 'second on the left');
  assert.ok(at(s, 'l0').y > ceo.y + ceo.h, 'reports still a level below');
  const e = edge(s, 'ceo-ea');
  assert.deepEqual(e.points, [{ x: ceo.x + ceo.w, y: ceo.y + ceo.h / 2 }, { x: ea.x, y: ea.y + ea.h / 2 }], 'one straight link');
  // The CEO stays centred over the leaders, not over the assistants
  const mid = (at(s, 'l0').x + at(s, 'l2').x + at(s, 'l2').w) / 2;
  assert.ok(Math.abs(ceo.x + ceo.w / 2 - mid) <= 10);
  // LR: below the manager
  const lr = computeScene({ ...p, meta: { ...p.meta, layout: { algorithm: 'tree', direction: 'LR' } } });
  assertNoOverlap(lr);
  assert.equal(at(lr, 'ea').x + at(lr, 'ea').w / 2, at(lr, 'ceo').x + at(lr, 'ceo').w / 2);
  assert.ok(at(lr, 'ea').y >= at(lr, 'ceo').y + at(lr, 'ceo').h + ASSIST.gap);
  assert.equal(lint({ ...p, meta: { ...p.meta, layout: { algorithm: 'tree', direction: 'LR' } } }).errors.length, 0);
});

test('assistant flags that cannot apply warn and draw an ordinary card', () => {
  const base = org(1, 2, {}, (q) => ((q.nodes[0].data.assistant = true), (q.nodes[1].data.assistant = true), q));
  const w = lint(base).warnings.filter((f) => f.code === 'layout/assistant-ignored').map((f) => f.node);
  assert.deepEqual(w.sort(), ['ceo', 'l0'], 'a root and a card with reports');
  const mm = org(1, 2, { algorithm: 'mindmap' }, (q) => ((q.nodes[2].data.assistant = true), q));
  assert.ok(codes(mm).warnings.includes('layout/assistant-ignored'));
  const bad = org(1, 2, {}, (q) => ((q.nodes[2].data.assistant = 'yes'), q));
  assert.ok(codes(bad).warnings.includes('layout/assistant-ignored'));
});

test('dragging keeps tidy tree connectors; the subtree moves with its card', () => {
  const p = org(2, 2, { compact: false });
  const s0 = computeScene(p);
  const l0 = at(s0, 'l0');
  // Move l0 and its team 200px left, as the viewer does
  const overrides = new Map([['l0', { x: l0.x - 200, y: l0.y }], ['l0.0', { x: at(s0, 'l0.0').x - 200, y: at(s0, 'l0.0').y }], ['l0.1', { x: at(s0, 'l0.1').x - 200, y: at(s0, 'l0.1').y }]]);
  const s = computeScene(p, { overrides });
  const moved = at(s, 'l0');
  for (const id of ['l0-l0.0', 'l0-l0.1']) {
    const e = edge(s, id);
    const kid = at(s, e.edge.target);
    assert.deepEqual(e.points[0], { x: moved.x + moved.w / 2, y: moved.y + moved.h }, 'trunk from the bottom centre');
    assert.equal(e.points.at(-1).x, kid.x + kid.w / 2, 'drop into the top centre');
    assert.ok(e.points.length <= 4);
  }
  // relative geometry is the same as before the drag
  assert.deepEqual(edge(s, 'l0-l0.0').points.map((q) => ({ x: q.x + 200, y: q.y })), edge(s0, 'l0-l0.0').points);
  // The CEO's comb into the moved card stays a comb
  const c = edge(s, 'ceo-l0');
  assert.equal(c.points.at(-1).x, moved.x + moved.w / 2);
  assert.equal(c.points[0].x, at(s, 'ceo').x + at(s, 'ceo').w / 2);
  // A child dragged above its parent falls back to the router (still a valid route)
  const up = computeScene(p, { overrides: { 'l1.0': { x: at(s0, 'l1.0').x, y: 0 } } });
  assert.ok(edge(up, 'l1-l1.0').ok);
  assert.ok(edge(up, 'l1-l1.1').points.length <= 4, 'its sibling keeps the comb');

  // The engine moves the visible subtree along with the dragged card
  const e = new YantraEngine(p);
  const before = new Map(e.getFlowScene().nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  e.moveNode('l0', before.get('l0').x - 100, before.get('l0').y + 40);
  const after = new Map(e.getFlowScene().nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  for (const id of ['l0.0', 'l0.1']) assert.deepEqual(after.get(id), { x: before.get(id).x - 100, y: before.get(id).y + 40 });
  assert.deepEqual(after.get('l1'), before.get('l1'), 'other cards stay');
});

test('dragging in compact stacks and to assistants keeps their connectors', () => {
  const p = org(1, 3, { compact: true }, (q) => {
    q.nodes.push(node('ea', { data: { title: 'EA', assistant: true } }));
    q.edges.push(link('ceo', 'ea'));
    return q;
  });
  const s0 = computeScene(p);
  const leaf = at(s0, 'l0.2');
  const s = computeScene(p, { overrides: { 'l0.2': { x: leaf.x + 60, y: leaf.y + 40 } } });
  const e = edge(s, 'l0-l0.2');
  assert.equal(e.points.length, 3, 'still down the bus and in');
  assert.equal(e.points.at(-1).x, leaf.x + 60);
  const ea = at(s0, 'ea');
  const s2 = computeScene(p, { overrides: { ea: { x: ea.x + 40, y: ea.y + 80 } } });
  const side = edge(s2, 'ceo-ea');
  assert.equal(side.points[0].x, at(s2, 'ceo').x + at(s2, 'ceo').w, 'still out of the side');
  assert.equal(side.points.at(-1).x, ea.x + 40);
});

test('mind map: dragging a branch keeps its curves', () => {
  const p = example('study-plan-mindmap');
  const s0 = computeScene(p);
  const n = s0.nodes.find((m) => m.id !== s0.nodes[0].id && s0.edges.some((e) => e.tree && e.edge.target === m.id));
  const s = computeScene(p, { overrides: { [n.id]: { x: n.x + 40, y: n.y + 30 } } });
  const e = s.edges.find((x) => x.tree && x.edge.target === n.id);
  assert.match(e.d, / C/, 'curved');
});

test('groups in tree layouts: not drawn, folding subtrees covers them', () => {
  const p = org(2, 2, {}, (q) => ((q.groups = [{ id: 'g', title: 'Team', nodes: ['l0', 'l0.0', 'l0.1'] }]), (q.meta.layout.collapsed = ['g']), q));
  const r = lint(p);
  const ignored = r.warnings.find((f) => f.code === 'layout/groups-ignored');
  assert.match(ignored.message, /folds its subtree/);
  const fold = r.warnings.find((f) => f.code === 'layout/collapse-ignored');
  assert.match(fold.message, /list the group's top card/);
  assert.equal(computeScene(p).groups.length, 0);
});

test('folded pseudo-states show a +N badge beside the dot or diamond', () => {
  const p = {
    meta: { title: 'States', layout: { algorithm: 'tree', direction: 'TB', collapsed: ['pick'] } },
    nodes: [node('start', { shape: 'initial' }), node('pick', { shape: 'choice' }), node('a'), node('b')],
    edges: [link('start', 'pick'), link('pick', 'a', 'yes'), link('pick', 'b', 'no')],
    steps: [{ title: 'Overview' }]
  };
  const s = computeScene(p);
  const pick = at(s, 'pick');
  assert.equal(pick.collapsed, 2);
  assert.equal(pick.toggle, 'bottom');
  assert.equal(at(s, 'start').toggle, undefined, 'an unfolded dot carries no button');
  assert.ok(s.bounds.y + s.bounds.h >= pick.y + pick.h + 20, 'bounds hold the badge');
  assert.match(renderSvg(s, { theme: 'light' }), />\+2<\/text>/);
  assert.equal(computeScene(p, { collapsed: [] }).nodes.find((n) => n.id === 'pick').toggle, undefined);
  assert.equal(lint(p).errors.length, 0);
});

test('CLI --collapsed and --expand-all for export, build and screenshot hash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-trees2-'));
  const input = path.join(ROOT, 'examples', 'org-chart.json');
  const svg = (args) => {
    const out = path.join(dir, `o${Math.random().toString(36).slice(2)}.svg`);
    const r = spawnSync(process.execPath, [CLI, 'export', input, '-f', 'svg', '-o', out, ...args], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    return fs.readFileSync(out, 'utf-8');
  };
  const chips = (text) => (text.match(/>\+\d+<\/text>/g) || []).length;
  assert.equal(chips(svg([])), 0);
  assert.equal(chips(svg(['--collapsed', 'cto,cfo'])), 2);
  const incident = path.join(ROOT, 'examples', 'incident-triage-decision-tree.json');
  const out = path.join(dir, 'i.svg');
  spawnSync(process.execPath, [CLI, 'export', incident, '-f', 'svg', '-o', out]);
  assert.ok(chips(fs.readFileSync(out, 'utf-8')) > 0, 'opens folded');
  spawnSync(process.execPath, [CLI, 'export', incident, '-f', 'svg', '-o', out, '--expand-all']);
  assert.equal(chips(fs.readFileSync(out, 'utf-8')), 0, '--expand-all unfolds');
  const bad = spawnSync(process.execPath, [CLI, 'build', input, '-o', path.join(dir, 'x.html'), '--collapsed', 'nobody'], { encoding: 'utf-8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /ref\/collapsed-unknown/);
  const page = spawnSync(process.execPath, [CLI, 'export', path.join(ROOT, 'examples', 'answer-launch-plan.json'), '-f', 'md', '-o', path.join(dir, 'p.md'), '--expand-all'], { encoding: 'utf-8' });
  assert.notEqual(page.status, 0, 'pages refuse folds');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MCP export and screenshot take collapsed / expandAll', async () => {
  const proc = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
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
  const send = (m) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  const payload = example('org-chart');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ id: 2, method: 'tools/list' });
  send({ id: 3, method: 'tools/call', params: { name: 'yantra_export', arguments: { payload, format: 'svg', collapsed: ['cto'] } } });
  send({ id: 4, method: 'tools/call', params: { name: 'yantra_export', arguments: { payload: example('incident-triage-decision-tree'), format: 'svg', expandAll: true } } });
  send({ id: 5, method: 'tools/call', params: { name: 'yantra_export', arguments: { payload, format: 'svg', collapsed: 'cto' } } });
  const deadline = Date.now() + 10000;
  while (replies.size < 5 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  proc.kill();
  const tools = replies.get(2).result.tools;
  for (const name of ['yantra_export', 'yantra_screenshot', 'yantra_build']) {
    const props = tools.find((t) => t.name === name).inputSchema.properties;
    assert.ok(props.collapsed && props.expandAll, `${name} takes collapsed and expandAll`);
  }
  const text = (id) => JSON.parse(replies.get(id).result.content[0].text).content;
  assert.match(text(3), />\+5<\/text>/, 'the CTO folds its five people');
  assert.doesNotMatch(text(4), />\+\d+<\/text>/);
  assert.ok(replies.get(5).result.isError, 'collapsed must be an array');
});

test('org-chart example uses compact stacks and an assistant, and validates clean', () => {
  const p = example('org-chart');
  assert.equal(p.meta.layout.compact, true);
  assert.ok(p.nodes.some((n) => n.data.assistant === true));
  assert.deepEqual(codes(p), { errors: [], warnings: [] });
  const s = computeScene(p);
  assertNoOverlap(s);
  assert.ok(s.edges.some((e) => e.id === 'ceo-cos' && e.points.length === 2));
});
