import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint, computeScene, renderSvg, toMarkdown, measureNode, computeSequenceScene, renderSequenceSvg } from '../src/core/index.js';
import { selfLoop } from '../src/core/layout.js';
import { fromMermaid } from '../src/core/mermaid.js';

const card = (id, extra = {}) => ({ id, type: 'state', shape: 'state', data: { title: id.toUpperCase() }, ...extra });
const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);
const inside = (inner, outer) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** start -> a <-> b, a loops, b -> choice -> (a | end). */
function machine(direction = 'LR', extra = {}) {
  return {
    meta: { title: 'Machine', layout: { direction } },
    nodes: [
      { id: 's', type: 'pseudo', shape: 'initial', data: { title: 'Start' } },
      card('a'),
      card('b'),
      { id: 'c', type: 'pseudo', shape: 'choice', data: { title: 'OK?' } },
      { id: 'e', type: 'pseudo', shape: 'final', data: { title: 'End' } }
    ],
    edges: [
      { id: 'sa', source: 's', target: 'a' },
      { id: 'aa', source: 'a', target: 'a', label: 'retry' },
      { id: 'ab', source: 'a', target: 'b', label: 'sync', arrow: 'both' },
      { id: 'bc', source: 'b', target: 'c', label: 'check' },
      { id: 'ca', source: 'c', target: 'a', label: 'again' },
      { id: 'ce', source: 'c', target: 'e', label: 'done', arrow: 'none' }
    ],
    steps: [
      { title: 'Overview' },
      { title: 'Retry', highlightNodes: ['a'], highlightEdges: ['aa'] },
      { title: 'Check', highlightNodes: ['b', 'c', 'a'], highlightEdges: ['bc', 'ca'] }
    ],
    ...extra
  };
}

for (const direction of ['LR', 'TB']) {
  test(`state machine with a self-loop, back-edge and two-way edge is clean (${direction})`, () => {
    const r = lint(machine(direction));
    assert.deepEqual(codes(r), []);
  });
}

test('pseudo-states are small and textless; states are cards', () => {
  assert.deepEqual([measureNode({ shape: 'initial', data: { title: 'x' } }).w, measureNode({ shape: 'final', data: {} }).h, measureNode({ shape: 'choice', data: {} }).w], [20, 20, 40]);
  assert.deepEqual(measureNode({ shape: 'initial', data: { title: 'Start' } }).lines.title, []);
  const scene = computeScene(machine());
  const byId = Object.fromEntries(scene.nodes.map((n) => [n.id, n]));
  assert.equal(byId.s.shape, 'initial');
  assert.equal(byId.a.shape, 'state');
  assert.equal(byId.a.w, 220);
});

test('a self-loop is a tidy loop on one side with its label clear of the card', () => {
  for (const direction of ['LR', 'TB']) {
    const scene = computeScene(machine(direction));
    const loop = scene.edges.find((e) => e.id === 'aa');
    const a = scene.nodes.find((n) => n.id === 'a');
    assert.ok(loop.self && loop.ok);
    assert.equal(loop.points.length, 4, 'two legs and a far segment');
    const [p0, , , p3] = loop.points;
    // both ends sit on the same side of the card
    const onSide = (p) => p.y === a.y || p.y === a.y + a.h || p.x === a.x || p.x === a.x + a.w;
    assert.ok(onSide(p0) && onSide(p3));
    assert.ok(p0.x === p3.x || p0.y === p3.y);
    const box = { x: loop.label.x - loop.label.w / 2, y: loop.label.y - loop.label.h / 2, w: loop.label.w, h: loop.label.h };
    assert.ok(box.y + box.h <= a.y || box.y >= a.y + a.h || box.x >= a.x + a.w || box.x + box.w <= a.x, `${direction}: label outside the card`);
    // TB layouts put loops on the right, LR layouts above or below
    if (direction === 'TB') assert.equal(p0.x, a.x + a.w);
    else assert.ok(p0.y === a.y || p0.y === a.y + a.h);
  }
});

test('selfLoop geometry: label on the far segment (top) or outside it (right)', () => {
  const r = { x: 0, y: 100, w: 220, h: 80 };
  const top = selfLoop(r, 'top', { w: 60, h: 20 });
  assert.equal(top.label.y, top.points[1].y);
  assert.ok(top.points[2].x - top.points[1].x >= 60, 'far segment holds the label');
  const right = selfLoop(r, 'right', { w: 60, h: 20 });
  assert.ok(right.label.x - right.label.w / 2 > right.points[1].x, 'label right of the far segment');
  assert.equal(right.extent, 36 + 6 + 60);
});

test('a self-loop works in manual layout and after dragging', () => {
  const p = machine('LR', { meta: { title: 'M', layout: { mode: 'manual' } } });
  p.nodes.forEach((n, i) => Object.assign(n, { x: i * 300, y: 100 }));
  const r = lint(p);
  assert.deepEqual(r.errors, []);
  const scene = computeScene(machine(), { overrides: { a: { x: 400, y: 400 } } });
  assert.ok(scene.edges.find((e) => e.id === 'aa').ok);
});

test('a group box wraps its members\' self-loops', () => {
  const p = machine('LR', { groups: [{ id: 'g', title: 'Work', nodes: ['a', 'b'] }] });
  const r = lint(p);
  assert.deepEqual(r.errors, []);
  const scene = computeScene(p);
  const g = scene.groups[0];
  const loop = scene.edges.find((e) => e.id === 'aa');
  for (const pt of loop.points) assert.ok(pt.x >= g.x && pt.x <= g.x + g.w && pt.y >= g.y && pt.y <= g.y + g.h);
  const l = loop.label;
  assert.ok(inside({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h }, g));
});

test('edge ends are clipped to dot and diamond outlines', () => {
  const scene = computeScene(machine());
  const node = (id) => scene.nodes.find((n) => n.id === id);
  const dist = (p, n) => Math.hypot(p.x - (n.x + n.w / 2), p.y - (n.y + n.h / 2));
  const sa = scene.edges.find((e) => e.id === 'sa');
  assert.ok(Math.abs(dist(sa.points[0], node('s')) - 10) < 0.6, 'leaves the dot on its circle');
  const bc = scene.edges.find((e) => e.id === 'bc');
  const c = node('c');
  const end = bc.points[bc.points.length - 1];
  // on the diamond |dx| + |dy| = half its size
  assert.ok(Math.abs(Math.abs(end.x - (c.x + 20)) + Math.abs(end.y - (c.y + 20)) - 20) < 0.6);
});

test('SVG export draws arrow heads per edge and the pseudo-state shapes', () => {
  const scene = computeScene(machine());
  const svg = renderSvg(scene, { highlight: { nodes: new Set(['a', 'b']), edges: new Set(['ab']) } });
  const path = (id) => {
    const e = scene.edges.find((x) => x.id === id);
    return svg.split('\n').find((l) => l.includes(`d="${e.d}"`));
  };
  assert.match(path('ab'), /marker-start="url\(#arrow-/);
  assert.match(path('ab'), /marker-end=/);
  assert.doesNotMatch(path('ce'), /marker-(start|end)/);
  assert.doesNotMatch(path('bc'), /marker-start/);
  assert.match(svg, /<polygon points="20,0 40,20 20,40 0,20"/, 'choice diamond');
  assert.match(svg, /<title>End<\/title>/);
  assert.match(svg, /rx="16"/, 'state cards are rounder');
});

test('sequence view keeps the arrow setting and draws pseudo-states as cards', () => {
  const p = machine();
  p.steps.push({ title: 'Sync', highlightNodes: ['a', 'b'], highlightEdges: ['ab'] });
  const seq = computeSequenceScene(p);
  assert.equal(seq.messages.find((m) => m.edgeId === 'ab').arrow, 'both');
  assert.ok(seq.participants.every((x) => x.w >= 160));
  assert.match(renderSequenceSvg(seq, { step: 3 }), /marker-start=/);
});

test('Markdown lists directions when some edge is not one-way', () => {
  const md = toMarkdown(machine());
  assert.match(md, /\| From \| To \| Direction \| Label \|/);
  assert.match(md, /↔ both ways/);
  assert.match(md, /— undirected/);
  assert.match(md, /↻ self-loop/);
  const plain = toMarkdown({ meta: { title: 'P' }, nodes: [card('a'), card('b')], edges: [{ id: 'ab', source: 'a', target: 'b', label: 'x' }] });
  assert.match(plain, /\| From \| To \| Label \|/);
});

test('lint: unknown shape or arrow is an error; pseudo-states used wrongly warn', () => {
  const bad = machine();
  bad.nodes[1].shape = 'blob';
  bad.edges[2].arrow = 'backward';
  assert.deepEqual(lint(bad).errors.map((e) => e.code).sort(), ['schema/edge-arrow-invalid', 'schema/node-shape-invalid']);

  const odd = machine();
  odd.edges.push({ id: 'as', source: 'a', target: 's', label: 'back' }, { id: 'ea', source: 'e', target: 'a', label: 'revive' });
  odd.edges = odd.edges.filter((e) => e.id !== 'ca');
  const w = lint(odd).warnings.map((x) => x.code);
  assert.ok(w.includes('story/initial-has-incoming'));
  assert.ok(w.includes('story/final-has-outgoing'));
  assert.ok(w.includes('story/choice-needs-branches'));
});

test('lint: transitions out of a start or into an end need no label', () => {
  const p = machine();
  p.edges.find((e) => e.id === 'ce').label = undefined;
  assert.ok(!codes(lint(p)).includes('content/edge-missing-label'));
  p.edges.find((e) => e.id === 'bc').label = undefined;
  assert.ok(codes(lint(p)).includes('content/edge-missing-label'));
});

// --- Mermaid ------------------------------------------------------------------

test('flowchart links: --- and -.- are undirected, <--> is two-way, self-loops are kept', () => {
  const { payload, warnings } = fromMermaid('flowchart LR\n  A --- B\n  B <--> C\n  C -.- D\n  D --> D\n  A o--o C\n  A -- text --- D');
  const e = (s, t) => payload.edges.find((x) => x.source === s && x.target === t);
  assert.equal(e('A', 'B').arrow, 'none');
  assert.equal(e('B', 'C').arrow, 'both');
  assert.equal(e('C', 'D').arrow, 'none');
  assert.equal(e('C', 'D').style, 'dashed');
  assert.equal(e('D', 'D').arrow, undefined, 'a self-loop is a normal edge');
  assert.equal(e('A', 'C').arrow, 'both');
  assert.equal(e('A', 'D').arrow, 'none');
  assert.ok(warnings.some((w) => /Circle and cross heads/.test(w)));
  assert.ok(!warnings.some((w) => /self-loop/.test(w)));
  assert.ok(payload.scenarios[0].steps.some((s) => (s.highlightEdges || []).includes('D-D')));
  assert.deepEqual(lint(payload).errors, []);
});

test('stateDiagram: [*] start and end, labels, choice, composite states and notes', () => {
  const src = [
    'stateDiagram-v2',
    '  [*] --> Idle',
    '  state "Waiting for input" as Idle',
    '  Idle --> Busy : start job',
    '  Busy --> Busy : tick',
    '  state ok <<choice>>',
    '  Busy --> ok : finish',
    '  ok --> Idle : again',
    '  ok --> Done : stop',
    '  state Done {',
    '    [*] --> Saving',
    '    Saving --> Saved : flush',
    '    Saved --> [*]',
    '  }',
    '  Done --> [*]',
    '  Busy : Runs the job',
    '  note right of Busy : ignored',
    '  note left of Idle',
    '    also ignored',
    '  end note'
  ].join('\n');
  const { payload, warnings } = fromMermaid(src, { title: 'Jobs' });
  const n = (id) => payload.nodes.find((x) => x.id === id);
  assert.equal(payload.meta.layout.direction, 'TB');
  assert.equal(n('start').shape, 'initial');
  assert.equal(n('end').shape, 'final');
  assert.equal(n('Idle').data.title, 'Waiting for input');
  assert.equal(n('Busy').data.subtitle, 'Runs the job');
  assert.equal(n('ok').shape, 'choice');
  assert.ok(!n('Done-start') && !n('Done-end'), 'a composite entered and left from outside drops its inner start and end');
  assert.ok(!n('Done'), 'a composite becomes a group, not a node');
  assert.deepEqual(payload.groups, [{ id: 'Done', title: 'Done', nodes: ['Saving', 'Saved'] }]);
  const e = (s, t) => payload.edges.find((x) => x.source === s && x.target === t);
  assert.equal(e('Busy', 'Busy').label, 'tick');
  assert.ok(e('ok', 'Saving'), 'into the composite = into its first state');
  assert.ok(e('Saved', 'end'), 'out of the composite = from its exit state');
  assert.ok(warnings.some((w) => /Ignored 2 notes/.test(w)));
  assert.ok(warnings.some((w) => /composite state "Done"/.test(w)));
  const r = lint(payload);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('stateDiagram: direction, fork/join and unknown lines', () => {
  const { payload, warnings } = fromMermaid('stateDiagram\n  direction LR\n  state f <<fork>>\n  [*] --> f\n  f --> A : go\n  A --> [*]\n  ??? what');
  assert.equal(payload.meta.layout.direction, 'LR');
  assert.equal(payload.nodes.find((x) => x.id === 'f').shape, 'fork');
  assert.ok(!warnings.some((w) => /<<fork>>/.test(w)));
  assert.ok(warnings.some((w) => /could not parse/.test(w)));
});

test('stateDiagram: concurrent regions become region groups; fork and join become bars', () => {
  const src = 'stateDiagram-v2\n  [*] --> Cart\n  state Split <<fork>>\n  Cart --> Split : order\n  Split --> Work\n  state Work {\n    [*] --> Pay\n    Pay --> Paid : ok\n    Paid --> [*]\n    --\n    [*] --> Pick\n    Pick --> Packed : done\n    Packed --> [*]\n  }\n  state Merge <<join>>\n  Work --> Merge\n  Merge --> Shipped : ship\n  Shipped --> [*]';
  const { payload } = fromMermaid(src);
  const n = (id) => payload.nodes.find((x) => x.id === id);
  assert.deepEqual([n('Split').shape, n('Merge').shape, n('Split').type], ['fork', 'fork', 'fork']);
  assert.deepEqual(payload.groups, [
    { id: 'Work', title: 'Work', nodes: [] },
    { id: 'Work-region-1', title: 'Work 1', kind: 'region', parent: 'Work', nodes: ['Pay', 'Paid'] },
    { id: 'Work-region-2', title: 'Work 2', kind: 'region', parent: 'Work', nodes: ['Pick', 'Packed'] }
  ]);
  const e = (s, t) => payload.edges.find((x) => x.source === s && x.target === t);
  assert.ok(e('Split', 'Pay') && e('Split', 'Pick'), 'a transition into the composite enters every region');
  assert.ok(e('Paid', 'Merge') && e('Packed', 'Merge'), 'and leaves from every region');
  const r = lint(payload);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});
