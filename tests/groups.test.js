import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint, computeScene, renderSvg, toMarkdown, GROUP } from '../src/core/index.js';
import { GROUP_MAX_DEPTH, GROUP_BUDGET } from '../src/core/model.js';

const node = (id) => ({ id, data: { title: `Service ${id}` } });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target, label: 'calls' });

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Every non-nested pair of boxes is disjoint and no outsider sits in a box. */
function assertClean(scene) {
  const byId = new Map(scene.groups.map((g) => [g.id, g]));
  const ancestors = (g) => {
    const out = [];
    for (let p = g.parent; p; p = byId.get(p)?.parent) out.push(p);
    return out;
  };
  for (const a of scene.groups)
    for (const b of scene.groups) {
      if (a === b || ancestors(a).includes(b.id) || ancestors(b).includes(a.id)) continue;
      assert.ok(!overlaps(a, b), `groups ${a.id} and ${b.id} overlap`);
    }
  for (const g of scene.groups)
    for (const n of scene.nodes) if (!g.members.includes(n.id)) assert.ok(!overlaps(n, g), `node ${n.id} inside foreign group ${g.id}`);
}

function codes(payload) {
  const r = lint(payload);
  return { errors: r.errors.map((f) => f.code), warnings: r.warnings.map((f) => f.code) };
}

const base = () => ({
  meta: { title: 'Groups' },
  nodes: ['a', 'b', 'c', 'd'].map(node),
  edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
  steps: [{ title: 'Overview' }]
});

test('group structure errors carry stable codes', () => {
  const p = base();
  p.groups = [
    { id: 'g1', title: 'One', nodes: ['a', 'zzz'] },
    { id: 'g2', title: 'Two', nodes: ['a'], parent: 'missing' },
    { id: 'b', title: 'Clash', nodes: [] },
    { id: 'g1', title: 'Again', nodes: [] },
    { id: 'x', title: 'X', nodes: ['c'], parent: 'y' },
    { id: 'y', title: 'Y', nodes: [], parent: 'x' }
  ];
  const { errors } = codes(p);
  for (const c of ['group/unknown-node', 'group/node-in-two-groups', 'group/unknown-parent', 'group/duplicate-id', 'group/cycle'])
    assert.ok(errors.includes(c), c);
});

test('nesting deeper than the maximum is an error, beyond the budget warns, empty groups warn', () => {
  const chain = (depth) => {
    const p = base();
    p.groups = Array.from({ length: depth }, (_, i) => ({ id: `l${i + 1}`, title: `L${i + 1}`, nodes: i === depth - 1 ? ['a'] : [], ...(i ? { parent: `l${i}` } : {}) }));
    return codes(p);
  };
  assert.ok(chain(GROUP_MAX_DEPTH + 1).errors.includes('group/too-deep'));
  assert.ok(!chain(GROUP_MAX_DEPTH).errors.includes('group/too-deep'), 'exactly the maximum is accepted');
  assert.ok(chain(GROUP_BUDGET.depth + 1).warnings.includes('budget/deep-nesting'));
  assert.ok(!chain(GROUP_BUDGET.depth).warnings.includes('budget/deep-nesting'), 'six levels are within budget');
  const q = base();
  q.groups = [{ id: 'g', title: 'G', nodes: ['a'] }, { id: 'e', title: 'Empty', nodes: [] }];
  const r = codes(q);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['group/empty']);
});

test('members of a group stay contiguous within a rank', () => {
  // The source fans out in an interleaved author order: a1 b1 a2 b2 a3
  const ids = ['a1', 'b1', 'a2', 'b2', 'a3'];
  const p = {
    meta: { title: 'Fan' },
    nodes: [node('s'), ...ids.map(node), node('t')],
    edges: [...ids.map((id) => edge('s', id)), edge('a1', 't'), edge('b2', 't')],
    groups: [
      { id: 'ga', title: 'Group A', nodes: ['a1', 'a2', 'a3'] },
      { id: 'gb', title: 'Group B', nodes: ['b1', 'b2'] }
    ],
    steps: [{ title: 'Overview' }]
  };
  for (const direction of ['LR', 'TB']) {
    p.meta.layout = { direction };
    const scene = computeScene(p);
    const axis = direction === 'LR' ? 'y' : 'x';
    const order = scene.nodes.filter((n) => ids.includes(n.id)).sort((m, n) => m[axis] - n[axis]).map((n) => n.id[0]);
    assert.equal(order.join('').replace(/(.)\1+/g, '$1').length, 2, `${direction}: ${order.join('')}`);
    assertClean(scene);
    assert.deepEqual(lint(p).errors, []);
  }
});

/** 4 x 3 grid with nested and sibling groups, a skip edge and a feedback loop. */
function grouped(direction) {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) nodes.push({ id: `n${i}${j}`, type: `t${j}`, data: { title: `Service ${i}.${j}` } });
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      edges.push(edge(`n${i}${j}`, `n${i + 1}${j}`));
      if (j < 2) edges.push(edge(`n${i}${j}`, `n${i + 1}${j + 1}`));
    }
  edges.push(edge('n00', 'n32'), edge('n32', 'n00'));
  return {
    meta: { title: 'Grouped', layout: { direction } },
    nodes,
    edges,
    groups: [
      { id: 'outer', title: 'Platform', nodes: ['n20'], color: 'orange', style: 'solid' },
      { id: 'left', title: 'Ingest', parent: 'outer', nodes: ['n01', 'n11'], color: 'blue' },
      { id: 'right', title: 'Storage', parent: 'outer', nodes: ['n12', 'n22', 'n21'], color: 'violet' },
      { id: 'ops', title: 'Operations', nodes: ['n30', 'n31'], color: 'green' }
    ],
    steps: [{ title: 'Overview' }]
  };
}

for (const direction of ['LR', 'TB']) {
  test(`nested and sibling groups do not overlap (${direction})`, () => {
    const p = grouped(direction);
    const scene = computeScene(p);
    assert.equal(scene.groups.length, 4);
    assert.equal(scene.groups[0].depth, 0, 'outer groups come first');
    assertClean(scene);
    // children sit inside their parent box
    const outer = scene.groups.find((g) => g.id === 'outer');
    for (const id of ['left', 'right']) {
      const g = scene.groups.find((x) => x.id === id);
      assert.ok(g.x >= outer.x && g.y >= outer.y + GROUP.padTop - 1 && g.x + g.w <= outer.x + outer.w && g.y + g.h <= outer.y + outer.h, id);
    }
    // bounds include every box
    const b = scene.bounds;
    for (const g of scene.groups) assert.ok(g.x >= b.x && g.y >= b.y && g.x + g.w <= b.x + b.w && g.y + g.h <= b.y + b.h);
    const r = lint(p);
    assert.deepEqual(r.errors.map((e) => e.code), []);
    assert.deepEqual(r.warnings.filter((w) => w.code.startsWith('geometry/') && w.code !== 'geometry/edges-stacked').map((w) => w.code), []);
  });
}

test('edges never run through a group title strip', () => {
  for (const direction of ['LR', 'TB']) {
    const scene = computeScene(grouped(direction));
    for (const e of scene.edges)
      for (let k = 1; k < e.points.length; k++) {
        const a = e.points[k - 1];
        const b = e.points[k];
        const seg = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) || 0.1, h: Math.abs(a.y - b.y) || 0.1 };
        for (const g of scene.groups) assert.ok(!overlaps(seg, g.titleBox), `${direction}: edge ${e.id} crosses title of ${g.id}`);
      }
  }
});

test('manual layout boxes wrap member rects; geometry problems are reported', () => {
  const p = {
    meta: { title: 'Manual', layout: { mode: 'manual' } },
    nodes: [
      { id: 'a', x: 0, y: 0, data: { title: 'A' } },
      { id: 'b', x: 300, y: 0, data: { title: 'B' } },
      { id: 'c', x: 150, y: 0, data: { title: 'C' } }
    ],
    edges: [],
    groups: [
      { id: 'g', title: 'G', nodes: ['a', 'b'] },
      { id: 'h', title: 'H', nodes: ['c'] }
    ],
    steps: [{ title: 'Overview' }]
  };
  const scene = computeScene(p);
  const g = scene.groups.find((x) => x.id === 'g');
  assert.equal(g.x, -GROUP.padX);
  assert.equal(g.y, -GROUP.padTop);
  assert.equal(g.w, 300 + 220 + GROUP.padX * 2);
  const { errors } = codes(p);
  assert.ok(errors.includes('geometry/group-overlap'));
  assert.ok(errors.includes('geometry/node-in-foreign-group'));
});

test('dragging a member moves its box', () => {
  const p = grouped('LR');
  const before = computeScene(p).groups.find((g) => g.id === 'ops');
  const n = computeScene(p).nodes.find((x) => x.id === 'n30');
  const after = computeScene(p, { overrides: { n30: { x: n.x, y: n.y + 400 } } }).groups.find((g) => g.id === 'ops');
  assert.ok(after.h > before.h);
});

test('SVG and Markdown include groups', () => {
  const p = grouped('LR');
  const svg = renderSvg(computeScene(p));
  assert.match(svg, /PLATFORM/);
  assert.match(svg, /stroke-dasharray="5 4"/);
  const md = toMarkdown(p);
  assert.match(md, /## Groups/);
  assert.match(md, /\| \*\*Storage\*\* \| Platform \|/);
});
