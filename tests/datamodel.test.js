import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, computeScene, renderSvg, toMarkdown, measureNode, CARD } from '../src/core/index.js';
import { ROWS, measureMembers, memberKey, memberName, memberType } from '../src/core/entity.js';
import { edgeEnds, markerShape, END_KINDS, RELATIONS, notationText } from '../src/core/notation.js';
import { renderPage } from '../src/core/page.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));
const codes = (payload) => {
  const r = lint(payload);
  return { errors: r.errors.map((f) => f.code), warnings: r.warnings.map((f) => f.code) };
};
const field = (name, extra = {}) => ({ name, type: 'int', ...extra });
const entity = (id, fields, extra = {}) => ({ id, type: 'table', data: { title: id, fields, ...extra } });
const erd = (edges, nodes) => ({
  meta: { title: 'ERD' },
  nodes: nodes || [entity('a', [field('id', { pk: true })]), entity('b', [field('id', { pk: true }), field('a_id', { fk: true, ref: 'a.id' })])],
  edges: edges || [{ id: 'ab', source: 'a', target: 'b', label: 'has', sourceEnd: 'one', targetEnd: 'zero-or-many' }],
  steps: [{ title: 'Overview' }]
});

test('entity cards grow with their rows and keep grid-friendly sizes', () => {
  const plain = measureNode({ id: 'p', data: { title: 'Plain' } });
  const sizes = [1, 4, 8].map((n) => measureNode(entity('t', Array.from({ length: n }, (_, i) => field(`col_${i}`)))));
  assert.ok(sizes[0].h >= plain.h);
  assert.ok(sizes[1].h > sizes[0].h && sizes[2].h > sizes[1].h, 'height grows with the field count');
  assert.equal(sizes[2].h - sizes[1].h, 4 * ROWS.line, 'one row per field');
  for (const s of sizes) assert.equal(s.h % 20, 0);
  // Rows sit below the header, inside the card, in order
  const rows = sizes[2].lines.rows.sections[0].rows;
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r, i) => i === 0 || r.y === rows[i - 1].y + ROWS.line));
  assert.ok(rows[7].y + ROWS.line + CARD.padY <= sizes[2].h);
});

test('entity cards widen to fit long types, up to the maximum width', () => {
  const narrow = measureNode(entity('t', [field('id')]));
  const wide = measureNode(entity('t', [field('a_rather_long_column_name', { type: 'timestamp with time zone' })]));
  assert.equal(narrow.w, CARD.width);
  assert.ok(wide.w > CARD.width && wide.w <= CARD.maxWidth && wide.w % 20 === 0);
  assert.equal(measureNode({ ...entity('t', [field('a_rather_long_column_name', { type: 'timestamp with time zone' })]), width: 200 }).w, 200, 'an explicit width wins');
});

test('rows are capped with a "+ N more" row and a lint warning', () => {
  const many = Array.from({ length: 20 }, (_, i) => field(`c${i}`));
  const m = measureMembers({ fields: many }, 192, 0);
  const rows = m.sections[0].rows;
  assert.equal(rows.length, ROWS.max);
  assert.equal(rows.at(-1).more, 20 - (ROWS.max - 1));
  // Methods keep some rows when fields overflow
  const both = measureMembers({ fields: many, methods: Array.from({ length: 6 }, (_, i) => ({ name: `m${i}` })) }, 192, 0);
  assert.equal(both.sections.reduce((s, sec) => s + sec.rows.length, 0), ROWS.max);
  assert.ok(both.sections[1].rows.length >= 4);
  const p = erd([], [entity('big', many)]);
  assert.ok(codes(p).warnings.includes('content/too-many-fields'));
});

test('member text: keys, visibility, method signatures, nullable types', () => {
  assert.equal(memberKey({ name: 'id', pk: true, fk: true }, 'fields'), 'PK FK');
  assert.equal(memberKey({ name: 'email', unique: true }, 'fields'), 'UK');
  assert.equal(memberKey({ name: 'x', visibility: '-' }, 'fields'), '-');
  assert.equal(memberKey({ name: 'x', visibility: '?' }, 'fields'), '');
  assert.equal(memberName({ name: 'pay', params: 'm: Method' }, 'methods'), 'pay(m: Method)');
  assert.equal(memberName({ name: 'pay(m)' }, 'methods'), 'pay(m)');
  assert.equal(memberType({ name: 'x', type: 'text', nullable: true }), 'text?');
});

test('edge ends: default arrow, ER cardinality, UML relations and overrides', () => {
  assert.deepEqual(edgeEnds({}), { start: null, end: 'arrow', dashed: false });
  assert.deepEqual(edgeEnds({ sourceEnd: 'one', targetEnd: 'zero-or-many' }), { start: 'one', end: 'zero-or-many', dashed: false });
  assert.deepEqual(edgeEnds({ targetEnd: 'many' }), { start: null, end: 'many', dashed: false }, 'notation drops the default arrow');
  assert.deepEqual(edgeEnds({ relation: 'inheritance' }), { start: 'triangle', end: null, dashed: false });
  assert.deepEqual(edgeEnds({ relation: 'realization' }), { start: 'triangle', end: null, dashed: true });
  assert.deepEqual(edgeEnds({ relation: 'composition', targetEnd: 'open-arrow' }), { start: 'diamond', end: 'open-arrow', dashed: false });
  assert.deepEqual(edgeEnds({ relation: 'dependency' }), { start: null, end: 'open-arrow', dashed: true });
  assert.deepEqual(edgeEnds({ relation: 'association', targetEnd: 'none' }), { start: null, end: null, dashed: false });
  assert.deepEqual(edgeEnds({ relation: 'bogus' }), { start: null, end: 'arrow', dashed: false }, 'unknown values are ignored (lint reports them)');
  for (const kind of END_KINDS.filter((k) => k !== 'none')) {
    const m = markerShape(kind, '#000', '#fff');
    assert.ok(m && m.w <= 20, `${kind} fits inside the 20px port stub`);
  }
  assert.equal(notationText({ sourceEnd: 'one', targetEnd: 'zero-or-many' }), 'exactly one to zero or more');
  assert.equal(notationText({ relation: 'aggregation' }), 'aggregation');
  assert.equal(notationText({}), '');
});

test('scene edges carry their markers; realization and dependency are dashed', () => {
  const p = example('payment-classes');
  const scene = computeScene(p);
  const e = (id) => scene.edges.find((x) => x.id === id);
  assert.equal(e('entity-order').start, 'triangle');
  assert.equal(e('entity-order').end, null);
  assert.equal(e('order-line').start, 'diamond');
  assert.equal(e('customer-order').start, 'open-diamond');
  assert.ok(e('method-card').dashed && e('order-method').dashed && !e('entity-order').dashed);
  const stereo = scene.nodes.find((n) => n.id === 'method');
  assert.equal(stereo.kicker, '«interface»');
  assert.ok(stereo.stereotype);
  // Plain diagrams keep the default arrowhead and no start marker
  const plain = computeScene(example('supply-chain'));
  assert.ok(plain.edges.every((x) => x.end === 'arrow' && x.start === null));
});

test('labels stay clear of the markers at edge ends', () => {
  for (const name of ['payment-classes', 'ecommerce-schema']) {
    const scene = computeScene(example(name));
    for (const e of scene.edges) {
      if (!e.label) continue;
      const box = { x: e.label.x - e.label.w / 2, y: e.label.y - e.label.h / 2, w: e.label.w, h: e.label.h };
      const ends = [e.start && [e.points[0], e.points[1]], e.end && e.end !== 'arrow' && [e.points.at(-1), e.points.at(-2)]].filter(Boolean);
      for (const [tip, next] of ends) {
        const far = { x: tip.x + Math.sign(next.x - tip.x) * 20, y: tip.y + Math.sign(next.y - tip.y) * 20 };
        const zone = { x: Math.min(tip.x, far.x) - 4, y: Math.min(tip.y, far.y) - 4, w: Math.abs(far.x - tip.x) + 8, h: Math.abs(far.y - tip.y) + 8 };
        const hit = box.x < zone.x + zone.w && box.x + box.w > zone.x && box.y < zone.y + zone.h && box.y + box.h > zone.y;
        assert.ok(!hit, `${name}: label of ${e.id} covers an end marker`);
      }
    }
  }
});

test('SVG export draws rows, stereotypes and notation markers in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const svg = renderSvg(computeScene(example('ecommerce-schema')), { theme });
    assert.match(svg, />PK</);
    assert.match(svg, />varchar\(255\)</);
    assert.match(svg, new RegExp(`<marker id="end-${theme}-zero-or-many"`));
    assert.match(svg, new RegExp(`marker-start="url\\(#end-${theme}-one\\)"`));
    const focused = renderSvg(computeScene(example('ecommerce-schema')), { theme, highlight: { nodes: new Set(['customers', 'orders']), edges: new Set(['customers-orders']) } });
    assert.match(focused, new RegExp(`end-${theme}-zero-or-many-violet`), 'active ends take the node hue');
  }
  const cls = renderSvg(computeScene(example('payment-classes')));
  assert.match(cls, /font-style="italic"[^>]*>«interface»</);
  assert.match(cls, /text-decoration="underline"[^>]*>zero\(currency\)</);
  assert.match(cls, /end-light-triangle/);
});

test('page figures scope marker ids so light and dark copies do not collide', () => {
  const html = renderPage({ kind: 'page', meta: { title: 'P' }, answer: { headline: 'H' }, blocks: [{ type: 'diagram', diagram: example('ecommerce-schema') }] });
  const ids = [...html.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.some((id) => /^end-light-one-/.test(id)) && ids.some((id) => /^end-dark-one-/.test(id)));
  const ends = ids.filter((id) => id.startsWith('end-'));
  assert.equal(new Set(ends).size, ends.length, 'notation marker ids are unique on the page');
  for (const [, ref] of html.matchAll(/marker-(?:start|end)="url\(#(end-[^)]+)\)"/g)) assert.ok(ends.includes(ref), `${ref} is defined`);
});

test('lint: members, refs, relations and ends carry stable codes', () => {
  const bad = erd(
    [
      { id: 'ab', source: 'a', target: 'b', label: 'has', relation: 'friendship' },
      { id: 'ba', source: 'b', target: 'a', label: 'x', sourceEnd: 'lots' }
    ],
    [
      entity('a', [field('id'), field('id'), { type: 'int' }]),
      entity('b', [field('a_id', { fk: true, ref: 'a.nope' }), field('c_id', { fk: true, ref: 'c' })], { methods: 'x', stereotype: 3 })
    ]
  );
  const c = codes(bad);
  for (const code of ['schema/members-invalid', 'ref/field-unknown-ref', 'schema/unknown-relation', 'schema/unknown-end']) assert.ok(c.errors.includes(code), code);
  assert.ok(c.warnings.includes('content/duplicate-field'));
  assert.equal(c.errors.filter((x) => x === 'ref/field-unknown-ref').length, 2);
  // Structural UML relations need no label; associations still do
  const uml = erd([
    { id: 'ab', source: 'a', target: 'b', relation: 'inheritance' },
    { id: 'ba', source: 'b', target: 'a', relation: 'association' }
  ]);
  const w = lint(uml).warnings.filter((f) => f.code === 'content/edge-missing-label').map((f) => f.edge);
  assert.deepEqual(w, ['ba']);
  assert.deepEqual(codes(erd()), { errors: [], warnings: [] });
});

test('Markdown lists fields and adds a relationship column only when edges carry notation', () => {
  const md = toMarkdown(example('ecommerce-schema'));
  assert.match(md, /## Fields/);
  assert.match(md, /### order_items\n\n\| Field \| Type \| Key \| Notes \|/);
  assert.match(md, /\| customer_id \| uuid \| FK \| → customers\.id \|/);
  assert.match(md, /\| From \| To \| Label \| Relationship \|/);
  assert.match(md, /\| customers \| orders \| places \| exactly one to zero or more \|/);
  const cls = toMarkdown(example('payment-classes'));
  assert.match(cls, /### «interface» PaymentMethod/);
  assert.match(cls, /\| zero\(currency\) \(static\) \| Money \| public \|/);
  assert.match(cls, /\| Entity \| Order \| — \| inheritance \|/);
  const plain = toMarkdown(example('supply-chain'));
  assert.doesNotMatch(plain, /Relationship|## Fields/);
});

test('every relation and end kind renders without geometry errors', () => {
  const kinds = END_KINDS.filter((k) => k !== 'none');
  const nodes = [entity('hub', [field('id', { pk: true })]), ...kinds.map((k) => entity(k, [field('id')]))];
  const edges = kinds.map((k, i) => ({ id: `e${i}`, source: 'hub', target: k, label: k, ...(i % 2 ? { sourceEnd: k } : { targetEnd: k }) }));
  const p = { meta: { title: 'Ends' }, nodes, edges, steps: [{ title: 'Overview' }] };
  assert.deepEqual(lint(p).errors, []);
  for (const rel of Object.keys(RELATIONS)) {
    const q = erd([{ id: 'ab', source: 'a', target: 'b', relation: rel, label: rel }]);
    assert.deepEqual(lint(q).errors, [], rel);
  }
});

test('notation works alongside edge arrows, self-loops and drill marks', () => {
  assert.deepEqual(edgeEnds({ arrow: 'both' }), { start: 'arrow', end: 'arrow', dashed: false });
  assert.deepEqual(edgeEnds({ arrow: 'none' }), { start: null, end: null, dashed: false });
  assert.deepEqual(edgeEnds({ arrow: 'both', sourceEnd: 'one', targetEnd: 'many' }), { start: 'one', end: 'many', dashed: false }, 'notation wins over arrow');
  const p = erd([
    { id: 'ab', source: 'a', target: 'b', label: 'has', sourceEnd: 'one', targetEnd: 'zero-or-many' },
    { id: 'ba', source: 'b', target: 'a', label: 'syncs', arrow: 'both' }
  ]);
  p.nodes[0].data.drill = 'detail';
  p.diagrams = { detail: { meta: { title: 'Detail' }, nodes: [entity('x', [field('id', { pk: true })])], edges: [], steps: [{ title: 'Overview' }] } };
  assert.deepEqual(codes(p), { errors: [], warnings: [] });
  const scene = computeScene(p);
  const ba = scene.edges.find((e) => e.id === 'ba');
  assert.deepEqual([ba.start, ba.end, ba.arrow], ['arrow', 'arrow', 'both']);
  const svg = renderSvg(scene);
  assert.match(svg, /Has a detail diagram/, 'entity card keeps the drill mark');
  assert.match(svg, />PK</);
  assert.match(svg, /marker-start="url\(#arrow\)" marker-end="url\(#arrow\)"/);
  assert.match(toMarkdown(p), /\| Direction \| Label \| Relationship \|/);
});
