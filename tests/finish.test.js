import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, computeScene } from '../src/core/index.js';
import { renderBlock, renderPage } from '../src/core/page.js';
import { enhanceCharts, FIT_WIDTHS } from '../src/core/charts.js';
import { fromMermaid } from '../src/core/mermaid.js';
import { fromPlantUml } from '../src/core/plantuml.js';
import { fromVisio } from '../src/core/visio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p));
const routes = (payload) => new Map(computeScene(payload).edges.map((e) => [e.id, e.points]));
const clean = (payload) => {
  const r = lint(payload);
  assert.deepEqual(r.errors.map((f) => f.message), []);
  assert.deepEqual(r.warnings.map((f) => f.message), []);
};

const table = (id, fields) => ({ id, type: 't', data: { title: id, fields: fields.map(([name, k]) => ({ name, type: 'int', ...(k ? { [k]: true } : {}) })) } });
const schema = (nodes, edges) => ({
  meta: { title: 'Rows', layout: { direction: 'LR' } },
  roles: { t: { label: 'Table', color: 'blue' } },
  nodes,
  edges,
  scenarios: [{ id: 'main', name: 'Main', steps: [{ id: 's1', title: 'Overview', description: 'All tables.' }] }]
});

// --- router: field rows -----------------------------------------------------------------

test('two edges between the same field rows run on separate tracks', () => {
  const p = schema(
    [table('users', [['id', 'pk'], ['name']]), table('follows', [['id', 'pk'], ['user_id', 'fk'], ['note']])],
    [
      { id: 'a', source: 'users', target: 'follows', label: 'follows', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'user_id' },
      { id: 'b', source: 'users', target: 'follows', label: 'followed by', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'user_id' }
    ]
  );
  clean(p);
  const r = routes(p);
  const [a, b] = [r.get('a'), r.get('b')];
  assert.notEqual(a[0].y, b[0].y, 'separate ports on the key row');
  assert.notEqual(a[a.length - 1].y, b[b.length - 1].y, 'separate ports on the foreign key row');
  assert.ok(Math.abs(a[0].y - b[0].y) <= 20, 'both within the row');
  assert.equal(Math.sign(a[0].y - b[0].y), Math.sign(a[a.length - 1].y - b[b.length - 1].y), 'the tracks do not cross');
});

test('a field-row self-loop nests inside an edge leaving the same row', () => {
  const p = schema(
    [table('dept', [['id', 'pk']]), table('emp', [['id', 'pk'], ['dept_id', 'fk'], ['manager_id', 'fk']]), table('task', [['id', 'pk'], ['emp_id', 'fk']])],
    [
      { id: 'd', source: 'dept', target: 'emp', label: 'employs', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'dept_id' },
      { id: 'm', source: 'emp', target: 'emp', label: 'manages', sourceEnd: 'zero-or-one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'manager_id' },
      { id: 't', source: 'emp', target: 'task', label: 'does', sourceEnd: 'one', targetEnd: 'zero-or-many', sourceField: 'id', targetField: 'emp_id' }
    ]
  );
  clean(p);
  const r = routes(p);
  const loop = r.get('m');
  const out = r.get('t');
  assert.equal(loop[0].x, out[0].x, 'both leave the same side');
  assert.ok(out[0].y < loop[0].y && loop[0].y < loop[loop.length - 1].y, 'the outgoing edge sits outside the loop');
});

test('Mermaid staff schema keeps every key row (no fallback to card sides)', () => {
  const { payload, warnings } = fromMermaid(read('examples', 'mermaid', 'staff-schema.mmd').toString());
  assert.deepEqual(warnings, []);
  const loop = payload.edges.find((e) => e.source === e.target);
  assert.deepEqual([loop.sourceField, loop.targetField], ['id', 'manager_id']);
  assert.ok(payload.edges.every((e) => e.sourceField && e.targetField));
  clean(payload);
});

test('foreign keys to one key row share a trunk out of the port, then branch', () => {
  const p = JSON.parse(read('examples', 'ecommerce-schema.json'));
  clean(p);
  const r = routes(p);
  const fan = ['orders-items', 'orders-payments', 'orders-shipments'].map((id) => r.get(id));
  const [port, tip] = [fan[0][0], fan[0][1]];
  for (const pts of fan) {
    assert.deepEqual(pts[0], port, 'one port');
    assert.deepEqual(pts[1], tip, 'one trunk');
  }
  assert.equal(tip.y, port.y);
  assert.ok(Math.abs(tip.x - port.x) >= 40, 'the trunk clears the end marker before branching');
  // branches leave one spine
  assert.ok(fan.every((pts) => pts[2].x === tip.x));
});

// --- answer pages at phone width ------------------------------------------------------------

test('page charts carry narrower drawings that the page script swaps in', () => {
  const gantt = { type: 'gantt', items: [{ title: 'Design', start: '2026-10-05', days: 5 }, { title: 'Build', days: 10 }] };
  const html = renderBlock(gantt);
  const widths = [...html.matchAll(/<template class="p-fit" data-w="(\d+)">/g)].map((m) => +m[1]);
  assert.deepEqual(widths, FIT_WIDTHS.filter((w) => w < 760));
  assert.equal((html.match(/<svg class="p-chart-svg"/g) || []).length, widths.length + 1, 'one static drawing plus the variants');
  assert.doesNotMatch(renderBlock(gantt, 'x', { width: 320 }), /p-fit/, 'a measured panel draws at its width instead');
  const half = renderBlock({ type: 'matrix', span: 'half', items: [{ label: 'A', x: 2, y: 3 }] });
  assert.ok([...half.matchAll(/data-w="(\d+)"/g)].every((m) => +m[1] < 440));
  assert.doesNotMatch(renderBlock({ type: 'chart', kind: 'pie', data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }), /p-fit/, 'pies already fit');
  const src = enhanceCharts.toString();
  for (const word of ['ResizeObserver', 'template.p-fit', 'beforeprint', 'setTimeout']) assert.ok(src.includes(word), word);
  const page = renderPage({ kind: 'page', meta: { question: 'Q?' }, answer: { headline: 'A.' }, blocks: [gantt] });
  assert.match(page, /<template class="p-fit"/);
  assert.match(page, /ResizeObserver/);
});

// --- importers: gantt working days --------------------------------------------------------

const ganttOf = (payload) => payload.blocks.find((b) => b.type === 'gantt');

test('Mermaid gantt excludes weekends and dates become workdays and holidays; until ends a task', () => {
  const src = ['gantt', '    dateFormat YYYY-MM-DD', '    excludes weekends, 2026-12-25', '    Build :a, 2026-12-21, 5d', '    Wait :w, after a, until r', '    Review :r, 2027-01-11, 2d'].join('\n');
  const { payload, warnings } = fromMermaid(src);
  assert.deepEqual(warnings, []);
  const g = ganttOf(payload);
  assert.equal(g.workdays, true);
  assert.deepEqual(g.holidays, ['25/12/2026']);
  const wait = g.items.find((it) => it.id === 'w');
  assert.equal(wait.end, '10/01/2027', 'the day before Review starts');
  assert.equal(wait.days, undefined);
  assert.equal(wait.until, undefined);
  clean(payload);

  const odd = fromMermaid(['gantt', '    dateFormat YYYY-MM-DD', '    excludes friday, 2026-12-25', '    A :a, 2026-12-21, 5d'].join('\n'));
  assert.equal(ganttOf(odd.payload).workdays, undefined);
  assert.ok(odd.warnings.some((w) => /friday still counts as working/.test(w)));
  assert.ok(odd.warnings.some((w) => /excluded dates only count together/.test(w)));
  const weekend = fromMermaid(['gantt', '    dateFormat YYYY-MM-DD', '    excludes saturday sunday', '    weekend friday', '    A :a, 2026-12-21, 5d'].join('\n'));
  assert.equal(ganttOf(weekend.payload).workdays, true);
  assert.ok(weekend.warnings.some((w) => /weekend/.test(w)));
});

test('PlantUML closed weekends and dates become workdays and holidays', () => {
  const src = '@startgantt\nProject starts 2026-12-14\nsaturday are closed\nsundays are closed\n2026-12-24 to 2026-12-26 is closed\n2027-01-01 is closed\n[Build] lasts 10 days\n@endgantt';
  const { payload, warnings } = fromPlantUml(src);
  assert.deepEqual(warnings, []);
  const g = ganttOf(payload);
  assert.equal(g.workdays, true);
  assert.deepEqual(g.holidays, ['24/12/2026', '25/12/2026', '26/12/2026', '01/01/2027']);
  clean(payload);
  const monday = fromPlantUml('@startgantt\nProject starts 2026-12-14\nmonday are closed\n[Build] lasts 3 days\n@endgantt');
  assert.ok(monday.warnings.some((w) => /monday still counts as working/.test(w)));
  const sample = fromPlantUml(read('examples', 'plantuml', 'launch-plan.puml').toString());
  assert.deepEqual(sample.warnings, []);
  assert.equal(ganttOf(sample.payload).workdays, true);
});

// --- importers: Visio colours, Mermaid regions ---------------------------------------------------

test('Visio fill colours become role colours as in draw.io', () => {
  const { payload, warnings } = fromVisio(read('examples', 'visio', 'order-approval.vsdx'));
  assert.deepEqual(warnings, []);
  const red = payload.nodes.find((n) => n.data.title === 'Back-order');
  assert.equal(red.type, 'node-rose');
  assert.equal(payload.roles['node-rose'].color, 'rose');
  assert.match(payload.roles['node-rose'].label, /\(red\)/);
});

test('Mermaid concurrent regions take their name from a note or the one composite they hold', () => {
  const src = [
    'stateDiagram-v2',
    '    [*] --> Busy',
    '    state Busy {',
    '        [*] --> Authorising',
    '        Authorising --> Captured : ok',
    '        note right of Authorising : Payment',
    '        --',
    '        state Stock {',
    '            [*] --> Reserving',
    '            Reserving --> Packed : picked',
    '        }',
    '        --',
    '        [*] --> Idle',
    '    }',
    '    Busy --> [*] : done'
  ].join('\n');
  const { payload, warnings } = fromMermaid(src);
  const regions = payload.groups.filter((g) => g.kind === 'region').map((g) => g.title);
  assert.deepEqual(regions, ['Payment', 'Stock', 'Busy 3']);
  assert.ok(!warnings.some((w) => /note/.test(w)), 'a note used as a region name is not reported as ignored');
});
