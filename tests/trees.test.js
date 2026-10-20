import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, computeScene, renderSvg } from '../src/core/index.js';
import { treeIndex, collapseGraph, hidingIds, TREE } from '../src/core/tree.js';
import { TREE_BUDGET } from '../src/core/lint.js';
import { fromMermaid } from '../src/core/mermaid.js';
import { YantraEngine } from '../src/app/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));

const node = (id, extra = {}) => ({ id, data: { title: `Card ${id}` }, ...extra });
const link = (source, target, label) => ({ id: `${source}-${target}`, source, target, ...(label ? { label } : {}) });
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const cx = (n) => n.x + n.w / 2;
const codes = (p) => {
  const r = lint(p);
  return { errors: r.errors.map((f) => f.code), warnings: r.warnings.map((f) => f.code) };
};

/** a -> b, c, d; b -> e, f; d -> g */
const org = (layout = {}) => ({
  meta: { title: 'Org', layout: { algorithm: 'tree', direction: 'TB', ...layout } },
  nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => node(id)),
  edges: [link('a', 'b'), link('a', 'c'), link('a', 'd'), link('b', 'e'), link('b', 'f'), link('d', 'g')],
  steps: [{ title: 'Overview' }, { title: 'B team', highlightNodes: ['b', 'e', 'f'], highlightEdges: ['b-e', 'b-f'] }]
});

/** A balanced tree with `fan` children per node, `depth` levels below the root. */
function bigTree(fan, depth, algorithm = 'tree') {
  const nodes = [node('r')];
  const edges = [];
  let level = ['r'];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const p of level)
      for (let k = 0; k < fan; k++) {
        const id = `${p}.${k}`;
        nodes.push(node(id));
        edges.push(link(p, id));
        next.push(id);
      }
    level = next;
  }
  return { meta: { title: 'Big', layout: { algorithm, direction: 'TB' } }, nodes, edges, steps: [{ title: 'Overview' }] };
}

function assertNoOverlap(scene) {
  for (let i = 0; i < scene.nodes.length; i++)
    for (let j = i + 1; j < scene.nodes.length; j++)
      assert.ok(!overlaps(scene.nodes[i], scene.nodes[j]), `${scene.nodes[i].id} overlaps ${scene.nodes[j].id}`);
}

test('treeIndex: first parent wins, extra parents become cross-links, cycles still get a root', () => {
  const ix = treeIndex(['a', 'b', 'c', 'd'], [link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')]);
  assert.deepEqual(ix.roots, ['a']);
  assert.equal(ix.parent.get('d'), 'b');
  assert.deepEqual(ix.cross, ['c-d']);
  assert.equal(ix.depth.get('d'), 2);
  const cyc = treeIndex(['x', 'y'], [link('x', 'y'), link('y', 'x')]);
  assert.deepEqual(cyc.roots, ['x']);
  assert.deepEqual(cyc.cross, ['y-x']);
});

test('tidy tree (TB): parents centred over their children, one row per depth, no overlaps', () => {
  const s = computeScene(org());
  const at = (id) => s.nodes.find((n) => n.id === id);
  assertNoOverlap(s);
  assert.ok(Math.abs(cx(at('a')) - (cx(at('b')) + cx(at('d'))) / 2) <= 10, 'root centred over first and last child');
  assert.ok(Math.abs(cx(at('b')) - (cx(at('e')) + cx(at('f'))) / 2) <= 10);
  assert.equal(cx(at('d')), cx(at('g')), 'an only child sits straight below its parent');
  assert.equal(at('b').y, at('c').y);
  assert.equal(at('e').y, at('g').y);
  assert.ok(at('b').x < at('c').x && at('c').x < at('d').x, 'children keep author order');
  for (const n of s.nodes) assert.equal(n.x % 10, 0);
});

test('tidy tree: comb connectors share a bus per parent and are not reported as stacked', () => {
  const s = computeScene(org());
  const bus = (id) => s.edges.find((e) => e.id === id).points;
  for (const e of s.edges) {
    assert.ok(e.tree, `${e.id} is a hierarchy edge`);
    const src = s.nodes.find((n) => n.id === e.edge.source);
    const tgt = s.nodes.find((n) => n.id === e.edge.target);
    const p = e.points;
    assert.deepEqual(p[0], { x: cx(src), y: src.y + src.h }, 'leaves the parent at the bottom centre');
    assert.deepEqual(p[p.length - 1], { x: cx(tgt), y: tgt.y }, 'enters the child at the top centre');
    for (let k = 1; k < p.length; k++) assert.ok(p[k].x === p[k - 1].x || p[k].y === p[k - 1].y, 'orthogonal');
  }
  assert.equal(bus('a-b')[1].y, bus('a-d')[1].y, 'siblings share the bus');
  assert.equal(bus('a-b')[1].y - (s.nodes[0].y + s.nodes[0].h), TREE.bus);
  const r = lint(org());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [], 'hierarchy edges need no label and may share a trunk');
});

test('tidy tree (LR) and labelled decision edges keep labels on their drop segment', () => {
  const p = org({ direction: 'LR' });
  p.edges = p.edges.map((e, i) => ({ ...e, label: i % 2 ? 'No' : 'Yes, always' }));
  const s = computeScene(p);
  assertNoOverlap(s);
  const at = (id) => s.nodes.find((n) => n.id === id);
  assert.equal(at('b').x, at('c').x, 'one column per depth');
  assert.ok(at('b').x > at('a').x + at('a').w);
  for (const e of s.edges) {
    const tgt = at(e.edge.target);
    assert.equal(e.label.y, tgt.y + tgt.h / 2, 'label on the drop into the child');
    assert.ok(e.label.x + e.label.w / 2 < tgt.x, 'label clear of the child');
  }
  assert.deepEqual(lint(p).errors, []);
  assert.deepEqual(lint(p).warnings, []);
});

test('mind map: root in the centre, branches on both sides, curves and one colour per branch', () => {
  const p = example('study-plan-mindmap');
  const s = computeScene(p);
  assertNoOverlap(s);
  const root = s.nodes.find((n) => n.id === 'goal');
  const right = s.nodes.filter((n) => n.x > root.x + root.w);
  const left = s.nodes.filter((n) => n.x + n.w < root.x);
  assert.equal(right.length + left.length, s.nodes.length - 1, 'every card is left or right of the root');
  assert.ok(right.length >= 4 && left.length >= 4, 'balanced halves');
  assert.ok(s.branchColors);
  const hue = (id) => s.nodes.find((n) => n.id === id).hue;
  assert.equal(hue('topics'), hue('inference'));
  assert.equal(hue('wellbeing'), hue('sleep'));
  assert.notEqual(hue('topics'), hue('wellbeing'));
  assert.notEqual(hue('topics'), hue('goal'));
  for (const e of s.edges) assert.match(e.d, / C/, `${e.id} is a curve`);
  const svg = renderSvg(s, { theme: 'light' });
  assert.ok(!svg.includes('>Task</text>'), 'no roles legend: cards are coloured by branch');
  assert.deepEqual(lint(p).warnings, []);
});

test('collapsing a subtree hides it, counts it and maps step ids onto the folded card', () => {
  const s = computeScene(org(), { collapsed: ['b'] });
  assert.deepEqual(s.nodes.map((n) => n.id).sort(), ['a', 'b', 'c', 'd', 'g']);
  const b = s.nodes.find((n) => n.id === 'b');
  assert.equal(b.collapsed, 2);
  assert.equal(b.toggle, 'bottom');
  assert.equal(s.nodes.find((n) => n.id === 'd').collapsed, 0, 'expanded parents can fold');
  assert.equal(s.nodes.find((n) => n.id === 'c').toggle, undefined, 'leaves cannot');
  assert.equal(s.collapse.alias.get('e'), 'b');
  assert.equal(s.collapse.edgeAlias.get('b-e'), null);
  assert.match(renderSvg(s, { theme: 'dark' }), />\+2</);
  // Default state comes from meta.layout.collapsed; an outer fold wins over an inner one
  const nested = computeScene(org({ collapsed: ['a', 'b'] }));
  assert.deepEqual(nested.nodes.map((n) => n.id), ['a']);
  assert.equal(nested.nodes[0].collapsed, 6);
  assert.deepEqual([...nested.collapse.active], ['a']);
});

test('layered layout folds a group into one summary card that takes over its edges', () => {
  const p = {
    meta: { title: 'Groups', layout: { collapsed: ['inner'] } },
    nodes: ['u', 'a', 'b', 'c', 'd'].map((id) => node(id)),
    edges: [link('u', 'a', 'calls'), link('u', 'b', 'calls'), link('a', 'b', 'reads'), link('b', 'd', 'writes'), link('c', 'd', 'syncs')],
    groups: [
      { id: 'outer', title: 'Outer', nodes: ['d'] },
      { id: 'inner', title: 'Inner', nodes: ['a', 'b'], parent: 'outer', color: 'teal' }
    ],
    steps: [{ title: 'Overview' }, { title: 'Write', highlightNodes: ['b', 'd'], highlightEdges: ['b-d'] }]
  };
  const s = computeScene(p);
  const card = s.nodes.find((n) => n.id === 'inner');
  assert.ok(card && card.node.summary, 'summary card replaces the members');
  assert.equal(card.collapsed, 2);
  assert.equal(card.hue, 'teal');
  assert.equal(card.toggle, 'corner');
  assert.ok(!s.nodes.some((n) => n.id === 'a' || n.id === 'b'));
  assert.deepEqual(s.edges.map((e) => `${e.edge.source}>${e.edge.target}`).sort(), ['c>d', 'inner>d', 'u>inner']);
  assert.equal(s.collapse.edgeAlias.get('u-b'), 'u-a', 'parallel edges merge');
  assert.equal(s.collapse.edgeAlias.get('a-b'), null, 'internal edges vanish');
  assert.deepEqual(s.groups.map((g) => g.id), ['outer']);
  assert.ok(s.groups[0].members.includes('inner'), 'the card stays inside the parent group');
  const r = lint(p);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  // Unfolded again, the layered layout is exactly the one without collapsed ids
  const open = computeScene(p, { collapsed: [] });
  const plain = computeScene({ ...p, meta: { title: 'Groups' } });
  assert.deepEqual(open.nodes.map((n) => [n.id, n.x, n.y]), plain.nodes.map((n) => [n.id, n.x, n.y]));
});

test('the layered layout is unchanged by the new layout options', () => {
  const p = example('aws-serverless');
  const before = computeScene(p);
  const after = computeScene({ ...p, meta: { ...p.meta, layout: { ...p.meta.layout, algorithm: 'layered' } } });
  assert.deepEqual(after.nodes.map((n) => [n.id, n.x, n.y]), before.nodes.map((n) => [n.id, n.x, n.y]));
  assert.deepEqual(after.edges.map((e) => e.d), before.edges.map((e) => e.d));
  assert.equal(before.layout, 'layered');
  assert.ok(before.edges.every((e) => !e.tree));
});

test('hidingIds names the folds a step must open', () => {
  const ix = treeIndex(['a', 'b', 'e'], [link('a', 'b'), link('b', 'e')]);
  assert.deepEqual([...hidingIds({ collapsed: new Set(['a', 'b']), algorithm: 'tree', index: ix }, ['e'])].sort(), ['a', 'b']);
  assert.deepEqual([...hidingIds({ collapsed: new Set(['g']), algorithm: 'layered', groups: [{ id: 'g', nodes: ['x'] }] }, ['x'])], ['g']);
  assert.equal(hidingIds({ collapsed: new Set(), algorithm: 'tree', index: ix }, ['e']).size, 0);
});

test('collapseGraph leaves the graph alone when nothing is folded', () => {
  const nodes = [node('a'), node('b')];
  const edges = [link('a', 'b')];
  const out = collapseGraph({ nodes, edges, groups: [], collapsed: new Set(), algorithm: 'tree', index: treeIndex(['a', 'b'], edges) });
  assert.equal(out.nodes, nodes);
  assert.equal(out.edges, edges);
});

test('lint: layout codes for algorithms, folds, groups, cross-links and mind-map roots', () => {
  let p = org();
  p.meta.layout.algorithm = 'radial';
  assert.ok(codes(p).errors.includes('schema/unknown-layout-algorithm'));

  p = org({ collapsed: ['nope', 'c'] });
  const c1 = codes(p);
  assert.ok(c1.errors.includes('ref/collapsed-unknown'));

  p = org({ collapsed: ['c'] });
  assert.ok(codes(p).warnings.includes('layout/collapse-ignored'), 'a leaf has nothing to fold');

  p = org();
  p.meta.layout = { collapsed: ['b'] };
  assert.ok(codes(p).warnings.includes('layout/collapse-ignored'), 'layered folds groups only');

  p = org();
  p.groups = [{ id: 'team', title: 'Team', nodes: ['b', 'e', 'f'] }];
  assert.ok(codes(p).warnings.includes('layout/groups-ignored'));
  assert.equal(computeScene(p).groups.length, 0);

  p = org();
  p.edges.push(link('c', 'g', 'dotted line'));
  const c2 = codes(p);
  assert.ok(c2.warnings.includes('layout/tree-cross-link'));
  assert.deepEqual(c2.errors, []);
  assert.ok(!computeScene(p).edges.find((e) => e.id === 'c-g').tree, 'cross-links are routed');

  p = org();
  p.meta.layout.algorithm = 'mindmap';
  p.nodes.push(node('z'), node('y'));
  p.edges.push(link('z', 'y'));
  assert.ok(codes(p).warnings.includes('layout/mindmap-roots'));
  assert.deepEqual(codes(p).errors, []);

  // Unlabelled edges still warn in the layered layout
  p = org();
  delete p.meta.layout.algorithm;
  assert.ok(codes(p).warnings.includes('content/edge-missing-label'));
});

test('lint: trees have a larger node budget, counted as the tree opens', () => {
  const big = bigTree(3, 3); // 40 nodes
  assert.equal(big.nodes.length, TREE_BUDGET.nodes);
  assert.ok(!codes(big).warnings.includes('budget/too-many-nodes'));
  const bigger = bigTree(4, 3); // 85 nodes
  const w = codes(bigger).warnings;
  assert.ok(w.includes('budget/too-many-nodes'));
  // Opening folded keeps the reader's view small, and both states must be clean
  bigger.meta.layout.collapsed = ['r.0', 'r.1', 'r.2', 'r.3'];
  const r = lint(bigger);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((f) => f.code), []);
  // A layered diagram of the same size keeps the strict budget
  const flat = bigTree(3, 3);
  flat.meta.layout = {};
  assert.ok(codes(flat).warnings.includes('budget/too-many-nodes'));
});

test('stress: a 156-node tree and mind map lay out without geometry errors', () => {
  for (const algorithm of ['tree', 'mindmap']) {
    const p = bigTree(5, 3, algorithm);
    const t0 = Date.now();
    const s = computeScene(p);
    assert.ok(Date.now() - t0 < 5000, `${algorithm} is fast`);
    assertNoOverlap(s);
    const r = lint(p);
    assert.deepEqual(r.errors.map((e) => e.code), [], algorithm);
  }
});

test('viewer engine: folding, hash state helpers and steps that unfold hidden cards', () => {
  const e = new YantraEngine(example('incident-triage-decision-tree'));
  assert.deepEqual([...e.collapsed], ['q-degraded']);
  assert.ok(e.isDefaultCollapse());
  assert.ok(!e.getScene().nodes.some((n) => n.id === 'q-reach'));
  let changed = 0;
  e.on('collapseChanged', () => changed++);
  e.goToStep(4); // highlights q-reach, hidden under q-degraded
  assert.equal(changed, 1);
  assert.ok(!e.collapsed.has('q-degraded'), 'the step unfolded the branch');
  assert.ok(e.getScene().nodes.some((n) => n.id === 'q-reach'));
  assert.ok(!e.isDefaultCollapse());
  e.toggleCollapse('q-outage');
  assert.equal(e.getScene().nodes.length, 1);
  // Highlights of hidden cards land on the folded card
  e.goToStep(0);
  e.setCollapsed(['q-risk']);
  e.stepIndex = 2; // without goToStep: no unfolding
  const hl = e.getHighlight();
  assert.ok(hl.nodes.has('q-risk'));
  assert.ok(!hl.edges.has('risk-yes'));
});

test('Mermaid mindmap import: indentation, shapes, ids, icons and a walkthrough per branch', () => {
  const { payload, warnings } = fromMermaid(`mindmap
  root((Launch plan))
    c1[Content]
      Audit
      Examples
    Design
      Examples
      ::icon(fa fa-pen)
    Build))Ship it((
      :::urgent
`);
  assert.equal(payload.meta.layout.algorithm, 'mindmap');
  assert.equal(payload.meta.title, 'Launch plan');
  assert.deepEqual(payload.nodes.map((n) => n.id), ['root', 'c1', 'Audit', 'Examples', 'Design', 'Examples-2', 'Build']);
  assert.equal(payload.nodes.find((n) => n.id === 'Build').data.title, 'Ship it');
  assert.deepEqual(payload.nodes.map((n) => n.type), ['root', 'branch', 'topic', 'topic', 'branch', 'topic', 'branch']);
  assert.ok(payload.edges.some((e) => e.source === 'Design' && e.target === 'Examples-2'));
  assert.ok(warnings.some((w) => /::icon/.test(w)) && warnings.some((w) => /:::class/.test(w)));
  const steps = payload.scenarios[0].steps;
  assert.deepEqual(steps.map((s) => s.title), ['Overview', 'Content', 'Design', 'Ship it']);
  assert.ok(steps[1].highlightNodes.includes('Audit') && steps[1].highlightEdges.includes('c1-Audit'));
  const r = lint(payload);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('Mermaid mindmap import: a second root attaches to the first; big maps open folded', () => {
  const two = fromMermaid('mindmap\nA\n  B\nC\n');
  assert.ok(two.warnings.some((w) => /one root/.test(w)));
  assert.ok(two.payload.edges.some((e) => e.source === 'A' && e.target === 'C'));
  const lines = ['mindmap', '  root((Big))'];
  for (let b = 0; b < 6; b++) {
    lines.push(`    Branch ${b}`);
    for (let k = 0; k < 8; k++) lines.push(`      Leaf ${b}.${k}`);
  }
  const big = fromMermaid(lines.join('\n'));
  assert.equal(big.payload.meta.layout.collapsed.length, 6);
  assert.ok(big.warnings.some((w) => /opens folded|open folded/.test(w)));
  const r = lint(big.payload);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('tree layouts keep room for self-loops, skip fold buttons on pseudo-states and work in drill-down levels', () => {
  const p = {
    meta: { title: 'Mixed', layout: { algorithm: 'tree', direction: 'TB', collapsed: ['b'] } },
    nodes: [
      node('start', { shape: 'initial' }), node('q', { shape: 'choice' }), node('a', { shape: 'state' }),
      { id: 'b', shape: 'state', data: { title: 'Rejected', drill: 'detail' } }, node('c'), node('d'), node('end', { shape: 'final' })
    ],
    edges: [link('start', 'q'), link('q', 'a', 'Yes'), link('q', 'b', 'No'), link('a', 'a', 'retry'), link('b', 'c', 'go'), link('b', 'd', 'stop'), link('a', 'end')],
    diagrams: {
      detail: {
        meta: { title: 'Detail', layout: { algorithm: 'tree', collapsed: ['x'] } },
        nodes: [node('x'), node('y'), node('z')],
        edges: [link('x', 'y'), link('x', 'z'), link('y', 'y', 'again')],
        steps: [{ title: 'Overview' }]
      }
    },
    steps: [{ title: 'Overview' }, { title: 'Appeal', highlightNodes: ['b', 'c'], highlightEdges: ['b-c'] }]
  };
  for (const [algorithm, direction] of [['tree', 'TB'], ['tree', 'LR'], ['mindmap', 'LR']]) {
    const q = { ...p, meta: { ...p.meta, layout: { ...p.meta.layout, algorithm, direction } } };
    const r = lint(q);
    assert.deepEqual(r.errors.map((f) => f.message), [], `${algorithm} ${direction}`);
    assert.deepEqual(r.warnings.map((f) => f.code), [], `${algorithm} ${direction}`);
    const s = computeScene(q, { collapsed: [] });
    const loop = s.edges.find((e) => e.id === 'a-a');
    assert.ok(loop.self && !loop.tree, 'a self-loop is not a hierarchy edge');
    assertNoOverlap(s);
  }
  const s = computeScene(p);
  assert.equal(s.nodes.find((n) => n.id === 'q').toggle, undefined, 'no fold button on a choice diamond');
  assert.equal(s.nodes.find((n) => n.id === 'b').collapsed, 2);
  assert.match(renderSvg(s, { theme: 'light' }), /Has a detail diagram/);
  // A detail level opens with its own folds
  const e = new YantraEngine(p.diagrams.detail);
  assert.deepEqual([...e.collapsed], ['x']);
  assert.equal(e.getScene().nodes.length, 1);
});

test('tree and mind-map layouts use the real height of table and class cards', () => {
  const table = (id, n) => ({ id, data: { title: id, fields: Array.from({ length: n }, (_, k) => ({ name: `col_${k}`, type: 'text', ...(k ? {} : { pk: true }) })) } });
  for (const [algorithm, direction] of [['tree', 'TB'], ['tree', 'LR'], ['mindmap', 'LR']]) {
    const p = {
      meta: { title: 'Schema tree', layout: { algorithm, direction } },
      nodes: [table('root', 3), table('a', 9), table('b', 2), table('c', 12), table('d', 1), { id: 'e', data: { title: 'Base', methods: [{ name: 'run' }, { name: 'stop' }] } }],
      edges: [link('root', 'a'), link('root', 'b'), link('root', 'c'), link('a', 'd'), link('b', 'e', 'extends')],
      steps: [{ title: 'Overview' }]
    };
    const s = computeScene(p);
    const at = (id) => s.nodes.find((n) => n.id === id);
    assert.ok(at('c').h > at('b').h + 100, 'a 12-row table is much taller than a 2-row one');
    assertNoOverlap(s);
    if (algorithm === 'tree' && direction === 'TB') {
      // the next row starts below the tallest card of the row above
      assert.ok(at('d').y >= at('c').y + at('c').h, `${algorithm} ${direction}`);
      const drop = s.edges.find((e) => e.id === 'a-d').points;
      assert.equal(drop[0].y, at('a').y + at('a').h, 'connector leaves from the bottom of the table');
    }
    const r = lint(p);
    assert.deepEqual(r.errors.map((f) => f.message), [], `${algorithm} ${direction}`);
    assert.deepEqual(r.warnings.map((f) => f.code), [], `${algorithm} ${direction}`);
  }
});
