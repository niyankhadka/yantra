import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lint, computeScene, renderSvg, toMarkdown } from '../src/core/index.js';
import { FORK } from '../src/core/layout.js';

const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);
const example = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const boxOf = (l) => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });
const node = (scene, id) => scene.nodes.find((n) => n.id === id);
const edge = (scene, id) => scene.edges.find((e) => e.id === id);
const state = (id, extra = {}) => ({ id, type: 'state', shape: 'state', data: { title: id.toUpperCase() }, ...extra });

/** Two tables, one foreign key, optional extra edges. */
function schema(edges, extra = {}) {
  return {
    meta: { title: 'Schema', layout: { direction: 'LR' } },
    nodes: [
      { id: 'users', type: 'table', data: { title: 'users', fields: [{ name: 'id', pk: true }, { name: 'email' }, { name: 'name' }, { name: 'manager_id', fk: true }] } },
      { id: 'posts', type: 'table', data: { title: 'posts', fields: [{ name: 'id', pk: true }, { name: 'title' }, { name: 'body' }, { name: 'author_id', fk: true }] } }
    ],
    edges,
    steps: [{ title: 'Overview' }],
    ...extra
  };
}

test('sourceField / targetField attach at the row, on the sides facing each other', () => {
  const p = schema([{ id: 'fk', source: 'users', target: 'posts', label: 'writes', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'author_id' }]);
  const r = lint(p);
  assert.deepEqual(codes(r), []);
  const s = computeScene(p);
  const e = edge(s, 'fk');
  const u = node(s, 'users');
  const t = node(s, 'posts');
  const a = e.points[0];
  const b = e.points[e.points.length - 1];
  const row = (n, name) => n.y + n.lines.rows.sections[0].rows.find((x) => x.member === name).y + 10;
  assert.equal(a.x, u.x + u.w, 'leaves the right side of users');
  assert.equal(a.y, row(u, 'id'));
  assert.equal(b.x, t.x, 'enters the left side of posts');
  assert.equal(b.y, row(t, 'author_id'));
  // Markdown names the fields
  assert.match(toMarkdown(p), /\| users\.id \| posts\.author_id \| writes \|/);
});

test('an unknown field name is an error', () => {
  const r = lint(schema([{ id: 'fk', source: 'users', target: 'posts', label: 'writes', sourceField: 'id', targetField: 'writer_id' }]));
  assert.ok(codes(r).includes('ref/edge-unknown-field'));
  const plain = lint({ meta: { title: 'x' }, nodes: [state('a'), state('b')], edges: [{ id: 'ab', source: 'a', target: 'b', label: 'go', sourceField: 'id' }] });
  assert.ok(codes(plain).includes('ref/edge-unknown-field'));
});

test('several foreign keys from one key share its port without a stacking warning', () => {
  const p = schema([
    { id: 'fk1', source: 'users', target: 'posts', label: 'writes', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'author_id' },
    { id: 'fk2', source: 'users', target: 'posts', label: 'edits', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'title' }
  ]);
  assert.deepEqual(codes(lint(p)), []);
});

test('a self-relationship on field rows loops on a side with its markers clear of the label', () => {
  const p = schema([
    { id: 'fk', source: 'users', target: 'posts', label: 'writes', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'author_id' },
    { id: 'mgr', source: 'users', target: 'users', label: 'manages', sourceEnd: 'zero-or-one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'manager_id' }
  ]);
  assert.deepEqual(codes(lint(p)), []);
  const s = computeScene(p);
  const e = edge(s, 'mgr');
  const u = node(s, 'users');
  const [a, , , b] = e.points;
  assert.equal(e.points.length, 4);
  assert.equal(a.x, b.x);
  assert.ok(a.x === u.x || a.x === u.x + u.w, 'legs on the left or right side');
  assert.equal(a.x, u.x, 'the right side holds the foreign key, so the loop takes the left');
  const row = (name) => u.y + u.lines.rows.sections[0].rows.find((x) => x.member === name).y + 10;
  assert.equal(a.y, row('id'));
  assert.equal(b.y, row('manager_id'));
  assert.ok(e.start && e.end, 'both markers drawn');
  // markers reach 20px from the card along each leg; the label stays outside that
  const zone = { x: u.x - 20, y: Math.min(a.y, b.y) - 8, w: 20, h: Math.abs(a.y - b.y) + 16 };
  assert.ok(e.label && !overlaps(boxOf(e.label), zone));
});

test('end labels sit beside each end, clear of nodes, markers and the edge label', () => {
  const p = schema([{ id: 'fk', source: 'users', target: 'posts', label: 'writes', relation: 'composition', sourceLabel: '1', targetLabel: '0..*' }]);
  assert.deepEqual(codes(lint(p)), []);
  const s = computeScene(p);
  const e = edge(s, 'fk');
  assert.equal(e.sourceLabel.text, '1');
  assert.equal(e.targetLabel.text, '0..*');
  for (const l of [e.sourceLabel, e.targetLabel]) {
    for (const n of s.nodes) assert.ok(!overlaps(boxOf(l), n), `${l.text} clear of ${n.id}`);
    assert.ok(!overlaps(boxOf(l), boxOf(e.label)));
  }
  // near their own end
  const d = (l, pt) => Math.abs(l.x - pt.x) + Math.abs(l.y - pt.y);
  assert.ok(d(e.sourceLabel, e.points[0]) < 60);
  assert.ok(d(e.targetLabel, e.points[e.points.length - 1]) < 60);
  const svg = renderSvg(s);
  assert.match(svg, />0\.\.\*<\/text>/);
  assert.match(toMarkdown(p), /composition; 1 → 0\.\.\* \|/);
});

test('end labels are short strings', () => {
  const long = lint(schema([{ id: 'fk', source: 'users', target: 'posts', label: 'writes', sourceLabel: 'the one and only owner here' }]));
  assert.ok(codes(long).includes('content/end-label-too-long'));
  const bad = lint(schema([{ id: 'fk', source: 'users', target: 'posts', label: 'writes', targetLabel: 3 }]));
  assert.ok(codes(bad).includes('schema/end-label-invalid'));
});

/** start -> a -> fork -> (b | c) -> join -> d -> end, optional regions. */
function forked(direction = 'LR', groups) {
  return {
    meta: { title: 'Fork', layout: { direction } },
    nodes: [
      { id: 's', type: 'pseudo', shape: 'initial', data: { title: 'Start' } },
      state('a'),
      { id: 'f', type: 'pseudo', shape: 'fork', data: { title: 'Fork' } },
      state('b'),
      state('c'),
      { id: 'j', type: 'pseudo', shape: 'fork', data: { title: 'Join' } },
      state('d'),
      { id: 'e', type: 'pseudo', shape: 'final', data: { title: 'End' } }
    ],
    edges: [
      { id: 'sa', source: 's', target: 'a' },
      { id: 'af', source: 'a', target: 'f', label: 'go' },
      { id: 'fb', source: 'f', target: 'b' },
      { id: 'fc', source: 'f', target: 'c' },
      { id: 'bj', source: 'b', target: 'j' },
      { id: 'cj', source: 'c', target: 'j' },
      { id: 'jd', source: 'j', target: 'd', label: 'done' },
      { id: 'de', source: 'd', target: 'e' }
    ],
    ...(groups ? { groups } : {}),
    steps: [{ title: 'Overview' }]
  };
}

for (const direction of ['LR', 'TB']) {
  test(`fork bars run across the flow and take edges along their length (${direction})`, () => {
    const p = forked(direction);
    assert.deepEqual(codes(lint(p)), [], 'edges at a fork need no label');
    const s = computeScene(p);
    const f = node(s, 'f');
    assert.equal(f.shape, 'fork');
    const vertical = direction === 'LR';
    assert.equal(vertical ? f.w : f.h, FORK.box);
    assert.ok((vertical ? f.h : f.w) >= FORK.min);
    const face = (pt) => (vertical ? Math.abs(pt.x - (f.x + f.w / 2)) : Math.abs(pt.y - (f.y + f.h / 2)));
    for (const id of ['af', 'fb', 'fc']) {
      const e = edge(s, id);
      const pt = id === 'af' ? e.points[e.points.length - 1] : e.points[0];
      assert.equal(face(pt), FORK.thick / 2, `${id} ends on the bar face`);
    }
    // the branches leave the bar straight towards their cards
    for (const id of ['fb', 'fc']) assert.equal(edge(s, id).points.length, 2, `${id} is straight`);
    const svg = renderSvg(s);
    assert.match(svg, new RegExp(`rx="${FORK.thick / 2}"`));
  });
}

test('a fork with one branch either way warns', () => {
  const p = forked();
  p.edges = p.edges.filter((e) => e.id !== 'fc' && e.id !== 'cj');
  assert.ok(codes(lint(p)).includes('story/fork-needs-branches'));
});

test('concurrent regions draw as dashed compartments of their parent', () => {
  const groups = [
    { id: 'par', title: 'Parallel', nodes: [] },
    { id: 'r1', title: 'One', kind: 'region', parent: 'par', nodes: ['b'] },
    { id: 'r2', title: 'Two', kind: 'region', parent: 'par', nodes: ['c'] }
  ];
  for (const direction of ['LR', 'TB']) {
    const p = forked(direction, groups);
    assert.deepEqual(codes(lint(p)), []);
    const s = computeScene(p);
    const parent = s.groups.find((g) => g.id === 'par');
    const [r1, r2] = ['r1', 'r2'].map((id) => s.groups.find((g) => g.id === id));
    assert.ok(r1.region && r2.region && !parent.region);
    const first = direction === 'LR' ? (r1.y < r2.y ? r1 : r2) : r1.x < r2.x ? r1 : r2;
    const second = first === r1 ? r2 : r1;
    assert.equal(first.divider, null);
    const d = second.divider;
    if (direction === 'LR') {
      assert.equal(d.y1, d.y2);
      assert.ok(d.y1 > first.y + first.h && d.y1 < second.y, 'divider between the regions');
      assert.deepEqual([d.x1, d.x2], [parent.x, parent.x + parent.w]);
    } else {
      assert.equal(d.x1, d.x2);
      assert.ok(d.x1 > first.x + first.w && d.x1 < second.x);
    }
    assert.match(renderSvg(s), /stroke-dasharray="6 4"/);
  }
});

test('region misuse is reported', () => {
  const lone = forked('LR', [{ id: 'r', title: 'R', kind: 'region', nodes: ['b'] }]);
  assert.ok(codes(lint(lone)).includes('group/region-needs-parent'));
  const single = forked('LR', [{ id: 'par', title: 'P', nodes: ['c'] }, { id: 'r', title: 'R', kind: 'region', parent: 'par', nodes: ['b'] }]);
  assert.ok(codes(lint(single)).includes('group/single-region'));
  assert.ok(codes(lint(single)).includes('group/region-mixed'));
  const kind = forked('LR', [{ id: 'g', title: 'G', kind: 'lane', nodes: ['b'] }]);
  assert.ok(codes(lint(kind)).includes('schema/group-kind-invalid'));
});

test('an extra end at a dot enters it from a free side without detouring', () => {
  const s = computeScene(example('ticket-lifecycle'));
  const end = node(s, 'end');
  const e = edge(s, 'rejected-end');
  const last = e.points[e.points.length - 1];
  const prev = e.points[e.points.length - 2];
  // enters from below (the free side facing its route), never loops over the top
  assert.equal(last.x, end.x + end.w / 2);
  assert.ok(prev.y > last.y);
  assert.ok(Math.min(...e.points.map((p) => p.y)) >= end.y, 'never passes above the dot');
  const other = edge(s, 'resolved-end').points.at(-1);
  assert.ok(other.x < end.x + end.w / 2, 'the in-line edge keeps the left side');
});

test('a dot with three incoming edges takes each on its own side', () => {
  const p = {
    meta: { title: 'Ends', layout: { direction: 'LR' } },
    nodes: [state('a', { rank: 0 }), state('b', { rank: 0 }), state('c', { rank: 0 }), { id: 'e', type: 'pseudo', shape: 'final', rank: 1, data: { title: 'End' } }],
    edges: ['a', 'b', 'c'].map((id) => ({ id: `${id}e`, source: id, target: 'e' })),
    steps: [{ title: 'x' }]
  };
  assert.deepEqual(codes(lint(p)), []);
  const s = computeScene(p);
  const e = node(s, 'e');
  const c = { x: e.x + e.w / 2, y: e.y + e.h / 2 };
  const sides = s.edges.map((x) => {
    const pt = x.points.at(-1);
    // each end touches the outline (radius 10)
    assert.ok(Math.abs(Math.hypot(pt.x - c.x, pt.y - c.y) - e.w / 2) < 0.6, `${x.id} on the outline`);
    return Math.abs(pt.x - c.x) > Math.abs(pt.y - c.y) ? (pt.x < c.x ? 'left' : 'right') : pt.y < c.y ? 'top' : 'bottom';
  });
  assert.equal(new Set(sides).size, 3);
});

test('a self-loop on a dot or diamond starts on its outline, on a side without other ports', () => {
  const p = {
    meta: { title: 'Choice loop', layout: { direction: 'LR' } },
    nodes: [state('a'), { id: 'c', type: 'pseudo', shape: 'choice', data: { title: 'Ok?' } }, state('b'), state('d')],
    edges: [
      { id: 'ac', source: 'a', target: 'c', label: 'check' },
      { id: 'cb', source: 'c', target: 'b', label: 'yes' },
      { id: 'cd', source: 'c', target: 'd', label: 'no' },
      { id: 'cc', source: 'c', target: 'c', label: 'wait' }
    ],
    steps: [{ title: 'x' }]
  };
  assert.deepEqual(codes(lint(p)), []);
  const s = computeScene(p);
  const c = node(s, 'c');
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const loop = edge(s, 'cc');
  const [a, , , b] = loop.points;
  for (const pt of [a, b]) assert.ok(Math.abs(Math.abs(pt.x - cx) + Math.abs(pt.y - cy) - c.w / 2) < 0.6, 'leg starts on the diamond');
  const sideOf = (pt) => (Math.abs(pt.x - cx) >= Math.abs(pt.y - cy) ? (pt.x < cx ? 'left' : 'right') : pt.y < cy ? 'top' : 'bottom');
  const loopSide = sideOf({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  // the side an end uses is the direction its route leaves (or enters) the diamond
  const DIR = { '1,0': 'right', '-1,0': 'left', '0,1': 'bottom', '0,-1': 'top' };
  for (const id of ['ac', 'cb', 'cd']) {
    const e = edge(s, id);
    const [pt, next] = e.edge.source === 'c' ? [e.points[0], e.points[1]] : [e.points.at(-1), e.points.at(-2)];
    const side = DIR[`${Math.sign(next.x - pt.x)},${Math.sign(next.y - pt.y)}`];
    assert.notEqual(side, loopSide, `${id} keeps off the loop's side`);
  }
  // the loop reaches well past the diamond
  const far = loopSide === 'top' ? c.y - Math.min(...loop.points.map((q) => q.y)) : Math.max(...loop.points.map((q) => q.y)) - c.y - c.h;
  assert.ok(far >= 36);
});

test('ports on a card side keep out of the self-loop on that side', () => {
  const p = {
    meta: { title: 'Loop side', layout: { direction: 'TB' } },
    nodes: [state('a'), state('b'), state('c'), state('d')],
    edges: [
      { id: 'aa', source: 'a', target: 'a', label: 'again', sides: ['right', 'right'] },
      { id: 'ab', source: 'a', target: 'b', label: 'one' },
      { id: 'ac', source: 'a', target: 'c', label: 'two' },
      { id: 'ad', source: 'a', target: 'd', label: 'three' }
    ],
    steps: [{ title: 'x' }]
  };
  const s = computeScene(p, { overrides: { b: { x: 400, y: 0 }, c: { x: 400, y: 120 }, d: { x: 400, y: 240 }, a: { x: 0, y: 120 } } });
  const loop = edge(s, 'aa').points;
  const a = node(s, 'a');
  const side = loop[0].x === a.x + a.w ? 'right' : loop[0].x === a.x ? 'left' : loop[0].y === a.y ? 'top' : 'bottom';
  const vertical = side === 'left' || side === 'right';
  const legs = [loop[0], loop[3]].map((q) => (vertical ? q.y : q.x));
  const [lo, hi] = [Math.min(...legs), Math.max(...legs)];
  for (const id of ['ab', 'ac', 'ad']) {
    const pt = edge(s, id).points[0];
    const onSide = vertical ? pt.x === loop[0].x : pt.y === loop[0].y;
    if (onSide) assert.ok((vertical ? pt.y : pt.x) < lo - 8 || (vertical ? pt.y : pt.x) > hi + 8, `${id} clear of the loop legs`);
  }
});

test('the fork / join example validates and renders', () => {
  const p = example('parallel-checkout-states');
  const r = lint(p);
  assert.deepEqual([...r.errors, ...r.warnings], []);
  const s = computeScene(p);
  assert.ok(s.groups.some((g) => g.region && g.divider));
  assert.ok(renderSvg(s, { theme: 'dark' }).includes('<line'));
});

test('fork bars and field-row loops work in tree and mind-map layouts', () => {
  for (const algorithm of ['tree', 'mindmap'])
    for (const direction of ['TB', 'LR']) {
      const p = {
        meta: { title: 'T', layout: { algorithm, direction } },
        nodes: [state('a'), { id: 'f', type: 'p', shape: 'fork', data: { title: 'F' } }, state('b'), state('c'),
          { id: 'u', type: 't', data: { title: 'u', fields: [{ name: 'id' }, { name: 'boss' }] } }],
        edges: [
          { id: 'af', source: 'a', target: 'f' }, { id: 'fb', source: 'f', target: 'b' }, { id: 'fc', source: 'f', target: 'c' },
          { id: 'au', source: 'a', target: 'u', label: 'has', targetField: 'boss' },
          { id: 'uu', source: 'u', target: 'u', label: 'reports to', sourceField: 'boss', targetField: 'id' }
        ],
        steps: [{ title: 'x' }]
      };
      assert.deepEqual(codes(lint(p)), [], `${algorithm} ${direction}`);
      // a folded fork bar carries the +N badge like the other pseudo-states
      const s = computeScene(p, { collapsed: ['f'] });
      assert.ok(node(s, 'f').toggle && node(s, 'f').collapsed > 0);
    }
});
