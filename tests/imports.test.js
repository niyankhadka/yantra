import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { startMcp, removeDir } from './support.js';
import { fileURLToPath } from 'node:url';
import { inflateRaw } from '../src/core/inflate.js';
import { fromDrawio, drawioPages, parseStyle, shapeType } from '../src/core/drawio.js';
import { fromMermaid } from '../src/core/mermaid.js';
import { fromPlantUml, plantUmlBlocks, umlText } from '../src/core/plantuml.js';
import { detectFormat, importText } from '../src/core/import.js';
import { lint } from '../src/core/lint.js';
import { fileIncluder } from '../lib/includes.js';
import { fromVisio, unzip } from '../src/core/visio.js';
import { drawioFromPng, cellHue, imageOf } from '../src/core/drawio.js';
import { preprocessPlantUml } from '../src/core/plantuml.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'yantra.js');

const node = (p, id) => p.nodes.find((n) => n.id === id);
const byTitle = (p, title) => p.nodes.find((n) => n.data.title === title);
const edge = (p, s, t) => p.edges.find((e) => e.source === s && e.target === t);
const compress = (xml) => zlib.deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');

/** A draw.io file from cell XML (one page per entry). */
const mxfile = (...pages) =>
  `<mxfile host="test">${pages.map((cells, i) => `<diagram id="p${i}" name="Page ${i + 1}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`).join('')}</mxfile>`;
const v = (id, value, style = '', parent = '1', geo = '') => `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry ${geo} as="geometry"/></mxCell>`;
const e = (id, s, t, value = '', style = '') => `<mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`;

// --- inflate -----------------------------------------------------------------------

test('inflateRaw matches zlib for stored, fixed and dynamic blocks', () => {
  const samples = [Buffer.alloc(0), Buffer.from('a'), Buffer.from('yantra '.repeat(3000)), crypto.randomBytes(40000), Buffer.concat([crypto.randomBytes(500), Buffer.alloc(20000, 7)])];
  for (const data of samples)
    for (const level of [0, 1, 6, 9]) {
      const out = inflateRaw(new Uint8Array(zlib.deflateRawSync(data, { level })));
      assert.ok(Buffer.from(out).equals(data), `${data.length} bytes, level ${level}`);
    }
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff])), /invalid|ends early/);
});

// --- draw.io -------------------------------------------------------------------------

test('draw.io: shapes map to types; HTML labels become title and subtitle', () => {
  const { payload, warnings } = fromDrawio(
    mxfile(
      v('a', '&lt;b&gt;Web app&lt;/b&gt;&lt;br&gt;React storefront', 'rounded=1;html=1;', '1', 'x="0" y="0" width="120" height="60"') +
        v('b', 'Orders DB', 'shape=cylinder3;html=1;', '1', 'x="300" y="0" width="80" height="80"') +
        v('c', 'Paid?', 'rhombus;html=1;', '1', 'x="600" y="0" width="80" height="80"') +
        v('d', 'Shopper', 'shape=umlActor;html=1;', '1', 'x="-300" y="0" width="30" height="60"') +
        v('f', 'Done', 'ellipse;', '1', 'x="900" y="0" width="80" height="40"') +
        v('g', 'Invoice', 'shape=parallelogram;', '1', 'x="1200" y="0" width="80" height="40"') +
        e('e1', 'a', 'b', 'writes') + e('e2', 'b', 'c', 'checks') + e('e3', 'd', 'a', 'uses') + e('e4', 'c', 'f', 'yes') + e('e5', 'c', 'g', 'no', 'dashed=1;')
    ),
    { title: 'T' }
  );
  assert.equal(payload.meta.title, 'T');
  assert.equal(payload.meta.layout.direction, 'LR', 'edges run sideways in the drawing');
  const types = Object.fromEntries(payload.nodes.map((n) => [n.data.title, n.type]));
  assert.deepEqual(types, { 'Web app': 'node', 'Orders DB': 'store', 'Paid?': 'decision', Shopper: 'actor', Done: 'terminal', Invoice: 'io' });
  assert.deepEqual(byTitle(payload, 'Web app').data, { title: 'Web app', subtitle: 'React storefront' });
  assert.equal(byTitle(payload, 'Orders DB').data.icon, 'database');
  assert.equal(edge(payload, 'paid', 'invoice').style, 'dashed');
  assert.deepEqual(warnings, []);
  assert.deepEqual(lint(payload).errors, []);
});

test('draw.io: containers become groups, edge-label cells label edges, text and dangling edges are dropped', () => {
  const cells =
    v('lane', 'Backend', 'swimlane;fillColor=#dae8fc;') +
    v('inner', 'Data', 'swimlane;', 'lane') +
    v('api', 'API', 'rounded=1;', 'lane') +
    v('db', 'DB', 'shape=cylinder;', 'inner') +
    v('ui', 'UI', '') +
    v('note', 'Just a note', 'text;html=1;') +
    v('blank', '', 'rounded=1;') +
    e('e1', 'ui', 'api') +
    `<mxCell id="lbl" value="HTTPS" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e1"><mxGeometry relative="1" as="geometry"/></mxCell>` +
    e('e2', 'api', 'db', 'SQL') +
    e('e3', 'ui', 'inner', 'reads') +
    e('e4', 'ui', '', 'dangling') +
    e('e5', 'api', 'api', 'self');
  const { payload, warnings } = fromDrawio(mxfile(cells));
  assert.deepEqual(payload.groups, [
    { id: 'backend', title: 'Backend', nodes: ['api'], color: 'blue' },
    { id: 'data', title: 'Data', nodes: ['db'], parent: 'backend' }
  ]);
  assert.equal(edge(payload, 'ui', 'api').label, 'HTTPS');
  assert.equal(edge(payload, 'ui', 'db').label, 'reads', 'edge to a container goes to its first node');
  assert.ok(!byTitle(payload, 'Just a note'));
  assert.equal(edge(payload, 'api', 'api').label, 'self', 'self-loops are kept');
  assert.equal(payload.nodes.length, 3);
  for (const re of [/free-standing text/, /unlabelled, unconnected/, /attached to its first node/, /Dropped 1 edge/]) assert.ok(warnings.some((w) => re.test(w)), String(re));
  assert.deepEqual(lint(payload).errors, []);
});

test('draw.io: stacked-row shapes (classes, tables) collapse into one card', () => {
  const free = fromDrawio(mxfile(v('n', 'Notes', 'swimlane;childLayout=stackLayout;') + v('r', 'remember to call Bob back', 'text;', 'n') + v('o', 'Other', '') + e('x', 'o', 'n', 'reads')));
  assert.equal(byTitle(free.payload, 'Notes').type, 'card');
  assert.equal(byTitle(free.payload, 'Notes').data.subtitle, 'remember to call Bob back', 'rows that are not members stay text');
  assert.equal(free.payload.roles.card.label, 'Entity');

  const cells =
    v('cls', 'Order', 'swimlane;childLayout=stackLayout;') +
    v('r1', '+ id: UUID', 'text;', 'cls') +
    v('r2', '+ total: Money', 'text;', 'cls') +
    v('svc', 'Billing', 'rounded=1;') +
    e('e1', 'svc', 'r2', 'reads total');
  const { payload } = fromDrawio(mxfile(cells));
  assert.equal(payload.nodes.length, 2);
  const card = byTitle(payload, 'Order');
  assert.equal(card.type, 'class');
  assert.deepEqual(card.data.fields, [{ name: 'id', visibility: '+', type: 'UUID' }, { name: 'total', visibility: '+', type: 'Money' }]);
  assert.equal(payload.roles.class.label, 'Class');
  assert.ok(edge(payload, 'billing', 'order'), 'edge to a row lands on the card');
});

test('draw.io: compressed pages, page selection, UserObject and .drawio.svg', () => {
  const model = (t) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${v('a', t, '')}${v('b', 'B', '')}${e('x', 'a', 'b', 'go')}</root></mxGraphModel>`;
  const file = `<mxfile><diagram name="First">${compress(model('One'))}</diagram><diagram name="Second">${compress(model('Two'))}</diagram></mxfile>`;
  assert.deepEqual(drawioPages(file), ['First', 'Second']);
  const first = fromDrawio(file);
  assert.equal(byTitle(first.payload, 'One').type, 'node');
  assert.equal(first.payload.meta.title, 'First');
  assert.ok(first.warnings.some((w) => /2 pages; imported page 1 "First"/.test(w)));
  assert.ok(byTitle(fromDrawio(file, { page: 2 }).payload, 'Two'));
  assert.ok(byTitle(fromDrawio(file, { page: 'Second' }).payload, 'Two'));
  assert.throws(() => fromDrawio(file, { page: 3 }), /No page "3"/);

  const obj = mxfile(`<UserObject label="Gateway" tooltip="Routes &amp;lt;all&amp;gt; calls" id="u"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></UserObject>${v('b', 'B', '')}${e('x', 'u', 'b', 'calls')}`);
  assert.equal(byTitle(fromDrawio(obj).payload, 'Gateway').data.description, 'Routes <all> calls');

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${esc(mxfile(v('a', 'A', '') + v('b', 'B', '') + e('x', 'a', 'b', 'ok')))}"><g/></svg>`;
  assert.equal(fromDrawio(svg).payload.nodes.length, 2);
  assert.equal(fromDrawio(model('Bare')).payload.nodes.length, 2, 'a bare mxGraphModel is one page');
  assert.throws(() => fromDrawio('<html><body/></html>'), /Not a draw.io file/);
});

test('draw.io: arrow heads become edge arrows', () => {
  const cells = v('a', 'A', '') + v('b', 'B', '') + v('c', 'C', '') + v('d', 'D', '') +
    e('x', 'a', 'b', 'both ways', 'startArrow=classic;endArrow=classic;') +
    e('y', 'b', 'c', 'plain line', 'endArrow=none;') +
    e('z', 'c', 'd', 'backwards', 'startArrow=block;endArrow=none;');
  const { payload } = fromDrawio(mxfile(cells));
  assert.equal(edge(payload, 'a', 'b').arrow, 'both');
  assert.equal(edge(payload, 'b', 'c').arrow, 'none');
  assert.ok(edge(payload, 'd', 'c') && !edge(payload, 'd', 'c').arrow, 'a start-only head is drawn reversed');
  assert.deepEqual(lint(payload).errors, []);
});

test('draw.io: ER tables and UML heads become fields, cardinalities and relations', () => {
  const row = (id, parent, ...cells) => `<mxCell id="${id}" value="" style="shape=tableRow;" vertex="1" parent="${parent}"><mxGeometry as="geometry"/></mxCell>` +
    cells.map((t, i) => v(`${id}-${i}`, t, 'shape=partialRectangle;', id)).join('');
  const cells =
    v('users', 'users', 'shape=table;') + row('u1', 'users', 'PK', 'id uuid') + row('u2', 'users', '', 'email text') +
    v('orders', 'orders', 'shape=table;') + row('o1', 'orders', 'PK', 'id uuid') + row('o2', 'orders', 'FK', 'user_id uuid') +
    e('r1', 'users', 'o2-1', 'places', 'endArrow=ERzeroToMany;startArrow=ERmandOne;') +
    v('base', 'Payment', 'swimlane;childLayout=stackLayout;') + v('m1', '+ pay(amount: Money): Receipt', 'text;', 'base') +
    v('card', 'CardPayment', 'swimlane;childLayout=stackLayout;') + v('m2', '- token: String', 'text;', 'card') +
    e('r2', 'card', 'base', 'is a', 'endArrow=block;endFill=0;') +
    e('r3', 'orders', 'card', 'paid by', 'startArrow=diamondThin;startFill=1;endArrow=none;') +
    e('r4', 'card', 'users', 'uses', 'dashed=1;endArrow=open;');
  const { payload } = fromDrawio(mxfile(cells));
  const users = node(payload, 'users');
  assert.equal(users.type, 'table');
  assert.deepEqual(users.data.fields, [{ name: 'id', type: 'uuid', pk: true }, { name: 'email', type: 'text' }]);
  assert.deepEqual(node(payload, 'orders').data.fields[1], { name: 'user_id', type: 'uuid', fk: true });
  const er = edge(payload, 'users', 'orders');
  assert.deepEqual([er.sourceEnd, er.targetEnd, er.label], ['one', 'zero-or-many', 'places']);
  assert.deepEqual(node(payload, 'payment').data.methods, [{ name: 'pay', visibility: '+', params: 'amount: Money', type: 'Receipt' }]);
  assert.equal(edge(payload, 'payment', 'cardpayment').relation, 'inheritance', 'triangle end moves to the source');
  assert.equal(edge(payload, 'orders', 'cardpayment').relation, 'composition');
  assert.equal(edge(payload, 'cardpayment', 'users').relation, 'dependency');
  assert.deepEqual(lint(payload).errors, []);
});

test('draw.io style helpers', () => {
  assert.deepEqual(parseStyle('ellipse;whiteSpace=wrap;fillColor=#fff'), { ellipse: '', _shape: 'ellipse', whiteSpace: 'wrap', fillColor: '#fff' });
  assert.equal(shapeType(parseStyle('shape=mxgraph.flowchart.decision;')), 'decision');
  assert.equal(shapeType(parseStyle('sketch=0;resourceIcon;resIcon=mxgraph.aws4.dynamodb;')), 'store');
  assert.equal(shapeType(parseStyle('rounded=1;')), 'node');
});

// --- PlantUML ------------------------------------------------------------------------

test('PlantUML sequence: participants, aliases, arrows, blocks, notes and return', () => {
  const { payload, warnings } = fromPlantUml(`@startuml
title Login
actor User as U
participant "Auth service" as Auth
database Users
box "Backend" #LightBlue
  participant Auth
end box
U -> Auth : Sign in
activate Auth
Auth -> Users : find user
Users --> Auth : row
alt valid password
  Auth -->> U : token
else invalid
  U <-- Auth : 401
end
note right of Auth : rate limited
Auth -> Auth : audit
U -> Auth ++ : refresh
return new token
[-> Auth : ping
@enduml`);
  assert.equal(payload.meta.title, 'Login');
  assert.equal(payload.meta.view, 'sequence');
  assert.deepEqual(payload.nodes.map((n) => [n.id, n.type, n.data.title]), [['U', 'actor', 'User'], ['Auth', 'service', 'Auth service'], ['Users', 'store', 'Users']]);
  assert.equal(edge(payload, 'Users', 'Auth').style, 'dashed');
  assert.equal(edge(payload, 'Auth', 'U').label, 'token');
  const steps = payload.scenarios[0].steps;
  assert.deepEqual(steps.map((s) => s.title), ['Overview', 'Sign in', 'find user', 'row', 'token', '401', 'audit', 'refresh', 'new token']);
  assert.match(steps[4].description, /alt “valid password”/);
  assert.match(steps[5].description, /alt “invalid”/);
  assert.match(steps[5].description, /rate limited/);
  assert.deepEqual(steps[6].highlightNodes, ['Auth']);
  assert.deepEqual(steps[8].highlightEdges, [edge(payload, 'Auth', 'U').id]);
  assert.deepEqual(payload.groups, [{ id: 'box-1', title: 'Backend', nodes: ['Auth'] }]);
  assert.ok(warnings.some((w) => /found\/lost message/.test(w)));
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML component and use-case diagrams become flow payloads with groups', () => {
  const { payload, warnings } = fromPlantUml(`@startuml
left to right direction
skinparam monochrome true
actor :Shopper: as S
package "Shop" {
  [Web] as W
  usecase (Checkout) as UC
  node "Cluster" {
    component API
  }
}
database "Orders" as DB
interface "REST" as R
S --> UC : starts
UC ..> W : uses
W -left-> API : calls
API --> DB : SQL
DB <-- W : reads
R - API : exposes
S --> Shop : visits
@enduml`);
  assert.equal(payload.meta.layout.direction, 'LR');
  const types = Object.fromEntries(payload.nodes.map((n) => [n.id, n.type]));
  assert.deepEqual(types, { S: 'actor', W: 'component', UC: 'usecase', API: 'component', DB: 'store', R: 'interface' });
  assert.equal(payload.roles.usecase.label, 'Use case');
  assert.equal(edge(payload, 'UC', 'W').style, 'dashed');
  assert.ok(edge(payload, 'W', 'DB'), '<-- is reversed');
  assert.ok(edge(payload, 'S', 'W'), 'edge to a package goes to its first element');
  assert.deepEqual(payload.groups, [
    { id: 'shop', title: 'Shop', nodes: ['W', 'UC'] },
    { id: 'cluster', title: 'Cluster', nodes: ['API'], parent: 'shop' }
  ]);
  for (const re of [/skinparam/, /arrow direction hint/, /first element/]) assert.ok(warnings.some((w) => re.test(w)), String(re));
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML activity: start/stop, if/elseif/else, while, repeat, fork and swimlanes', () => {
  const { payload, warnings } = fromPlantUml(`@startuml
|Customer|
start
:Place order;
|Shop|
if (Paid?) then (yes)
  :Pack;
elseif (Invoice?) then (later)
  :Send invoice;
else (no)
  :Cancel;
  stop
endif
while (More items?) is (yes)
  :Scan item;
endwhile (no)
repeat
  :Try delivery;
repeat while (Delivered?) is (no) not (yes)
fork
  :Email;
fork again
  :SMS;
end fork
-> archived;
:Close order
with a note;
stop
@enduml`);
  const t = (title) => byTitle(payload, title)?.id;
  assert.equal(node(payload, 'start').type, 'terminal');
  assert.equal(byTitle(payload, 'Paid?').type, 'decision');
  assert.equal(edge(payload, t('Paid?'), t('Pack')).label, 'yes');
  assert.equal(edge(payload, t('Paid?'), t('Invoice?')).label, 'no');
  assert.equal(edge(payload, t('Invoice?'), t('Send invoice')).label, 'later');
  assert.equal(edge(payload, t('Cancel'), 'end').label, 'done');
  assert.ok(edge(payload, t('Pack'), t('More items?')) && edge(payload, t('Send invoice'), t('More items?')), 'branches merge');
  assert.equal(edge(payload, t('Scan item'), t('More items?')).label, 'repeat');
  assert.equal(edge(payload, t('More items?'), t('Try delivery')).label, 'no');
  assert.equal(edge(payload, t('Delivered?'), t('Try delivery')).label, 'no');
  const fork = byTitle(payload, 'Fork');
  assert.equal(fork.shape, 'fork');
  assert.ok(edge(payload, t('Delivered?'), fork.id) && edge(payload, fork.id, t('Email')) && edge(payload, fork.id, t('SMS')), 'fork branches leave a fork bar');
  const join = byTitle(payload, 'Join');
  assert.ok(edge(payload, t('Email'), join.id) && edge(payload, t('SMS'), join.id), 'branches meet at a join bar');
  assert.equal(edge(payload, join.id, t('Close order')).label, 'archived');
  assert.equal(byTitle(payload, 'Close order').data.subtitle, 'with a note');
  assert.deepEqual(payload.groups.map((g) => [g.title, g.nodes.length]), [['Customer', 2], ['Shop', payload.nodes.length - 3]]);
  const bars = new Set(payload.nodes.filter((n) => n.shape === 'fork').map((n) => n.id));
  assert.ok(payload.edges.every((x) => x.label || bars.has(x.source) || bars.has(x.target)), 'every transition (except at a bar) is labelled');
  assert.ok(warnings.some((w) => /Labelled \d+ unlabelled transition/.test(w)));
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML state diagrams: initial, final, choice, self-loops and composites', () => {
  const { payload, warnings } = fromPlantUml(`@startuml
title Door
[*] --> Closed
state "Locked tight" as Locked #pink
Closed -> Open : open
Open --> Closed : close
Closed -right-> Locked : lock
Locked --> Locked : jiggle
state decide <<choice>>
Locked --> decide : key
decide --> Closed : right key
decide --> Locked : wrong key
state Broken {
  [*] --> Jammed
  Jammed --> [*]
}
Open --> Broken : kick
Closed --> [*]
skinparam monochrome true
@enduml`);
  assert.equal(payload.meta.title, 'Door');
  assert.match(payload.meta.description, /PlantUML state diagram/);
  const shape = (id) => node(payload, id)?.shape;
  assert.equal(shape('Closed'), 'state');
  assert.equal(shape('decide'), 'choice');
  assert.ok(payload.nodes.some((n) => n.shape === 'initial') && payload.nodes.some((n) => n.shape === 'final'));
  assert.equal(node(payload, 'Locked').data.title, 'Locked tight');
  assert.equal(edge(payload, 'Locked', 'Locked').label, 'jiggle');
  assert.equal(edge(payload, 'Closed', 'Locked').label, 'lock');
  assert.ok(payload.groups.some((g) => g.title === 'Broken'));
  assert.ok(warnings.some((w) => /skinparam/.test(w)));
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML component arrows: both ways and plain lines', () => {
  const { payload } = fromPlantUml('@startuml\n[A] <--> [B] : sync\n[B] -- [C] : linked\n[C] --> [D] : calls\n@enduml');
  assert.equal(edge(payload, 'A', 'B').arrow, 'both');
  assert.equal(edge(payload, 'B', 'C').arrow, 'none');
  assert.equal(edge(payload, 'C', 'D').arrow, undefined);
});

test('PlantUML class diagrams become class cards with UML relations', () => {
  const { payload, warnings } = fromPlantUml(fs.readFileSync(path.join(ROOT, 'examples', 'plantuml', 'payments-classes.puml'), 'utf-8'));
  assert.match(payload.meta.description, /PlantUML class diagram/);
  assert.equal(node(payload, 'PaymentMethod').data.stereotype, 'interface');
  assert.equal(node(payload, 'Status').data.stereotype, 'enumeration');
  assert.deepEqual(node(payload, 'CardPayment').data.fields, [{ visibility: '-', name: 'token', type: 'String' }]);
  assert.equal(node(payload, 'BasePayment').data.fields[1].name, 'count', '{static} is dropped');
  assert.equal(edge(payload, 'PaymentMethod', 'CardPayment').relation, 'realization');
  assert.equal(edge(payload, 'BasePayment', 'CardPayment').relation, 'inheritance', 'direction hints are dropped');
  assert.equal(edge(payload, 'Order', 'BasePayment').relation, 'composition');
  assert.deepEqual(payload.groups, [{ id: 'Billing', title: 'Billing', nodes: ['PaymentMethod', 'BasePayment', 'CardPayment'] }]);
  assert.ok(warnings.some((w) => /note/.test(w)));
});

test('PlantUML mind maps and work breakdowns use the mind-map and tree layouts', () => {
  const mm = fromPlantUml('@startmindmap\ntitle Plan\n* Goals\n** Hire\n*** Two engineers\n-- Learn\n--- Demos\n**_ Boxless item\n@endmindmap');
  assert.equal(mm.payload.meta.title, 'Plan');
  assert.equal(mm.payload.meta.layout.algorithm, 'mindmap');
  assert.match(mm.payload.meta.description, /PlantUML mind map/);
  assert.deepEqual(mm.payload.nodes.map((n) => n.data.title), ['Goals', 'Hire', 'Two engineers', 'Learn', 'Demos', 'Boxless item']);
  const wbs = fromPlantUml('@startwbs\n* Launch\n** Build\n** Market\n*** Press kit\n@endwbs');
  assert.equal(wbs.payload.meta.layout.algorithm, 'tree');
  assert.equal(wbs.payload.edges.length, 3);
  assert.deepEqual(lint(wbs.payload).errors, []);
  assert.equal(detectFormat('@startwbs\n* A\n@endwbs'), 'plantuml');
});

test('PlantUML: blocks, creole text, unsupported diagrams', () => {
  assert.deepEqual(plantUmlBlocks('@startuml a\nA -> B\n@enduml\nx\n@startuml\nB -> C\n@enduml'), ['A -> B\n', 'B -> C\n']);
  assert.equal(umlText('"**Bold** //it// <b>x</b>\\nnext"'), 'Bold it x\nnext');
  assert.throws(() => fromPlantUml('@startjson\n{}\n@endjson'), /Unsupported PlantUML diagram "@startjson"/);
  assert.throws(() => fromPlantUml('@startuml\njson X {\n}\n@enduml'), /Unsupported PlantUML diagram/);
  const { warnings } = fromPlantUml('@startuml\nA -> B : x\n@enduml\n@startuml\nB -> C : y\n@enduml');
  assert.ok(warnings.some((w) => /2 @startuml blocks/.test(w)));
});

// --- dispatch, samples, CLI and MCP -------------------------------------------------

test('detectFormat and importText pick the importer from the name or the text', () => {
  assert.equal(detectFormat('', 'a.drawio'), 'drawio');
  assert.equal(detectFormat('', 'a.drawio.svg'), 'drawio');
  assert.equal(detectFormat('', 'a.puml'), 'plantuml');
  assert.equal(detectFormat('', 'a.mmd'), 'mermaid');
  assert.equal(detectFormat('<?xml version="1.0"?><mxfile>', 'export.xml'), 'drawio');
  assert.equal(detectFormat('@startuml\nA -> B\n@enduml'), 'plantuml');
  assert.equal(detectFormat('# Notes\n```plantuml\nA -> B\n```', 'n.md'), 'plantuml');
  assert.equal(detectFormat('graph LR\nA-->B'), 'mermaid');
  const md = importText('# x\n```puml\nA -> B : hi\n```\n```puml\nB -> C : yo\n```\n', { filename: 'notes.md', all: true });
  assert.equal(md.format, 'plantuml');
  assert.equal(md.results.length, 2);
  assert.throws(() => importText('x', { format: 'excalidraw' }), /Unknown import format/);
  assert.throws(() => importText('x', { format: 'visio' }), /needs the \.vsdx file/);
  assert.equal(detectFormat('', 'a.vsdx'), 'visio');
  assert.equal(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])), 'drawio');
  assert.equal(detectFormat('@startgantt\n[A] lasts 2 days\n@endgantt'), 'plantuml');
});

test('every draw.io, PlantUML and Visio sample imports and validates with no errors or warnings', () => {
  for (const dir of ['drawio', 'plantuml', 'visio']) {
    const base = path.join(ROOT, 'examples', dir);
    const files = fs.readdirSync(base).filter((f) => fs.statSync(path.join(base, f)).isFile());
    assert.ok(files.length >= (dir === 'visio' ? 1 : 2), dir);
    for (const f of files) {
      const file = path.join(base, f);
      const { results } = importText(fs.readFileSync(file), { filename: f, include: fileIncluder(base), path: file });
      const r = lint(results[0].payload);
      assert.deepEqual(r.errors, [], f);
      assert.deepEqual(r.warnings.map((w) => w.code), [], f);
    }
  }
});

test('CLI import: --from, --page and --all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-imp-'));
  const sample = path.join(ROOT, 'examples', 'drawio', 'support-triage.drawio');
  const res = spawnSync(process.execPath, [CLI, 'import', sample, '-o', path.join(dir, 's.json')], { encoding: 'utf-8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /drawio: 6 nodes/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 's.json'), 'utf-8')).meta.title, 'Support triage');

  const txt = path.join(dir, 'seq.txt');
  fs.writeFileSync(txt, '@startuml\nA -> B : hi\n@enduml\n');
  const forced = spawnSync(process.execPath, [CLI, 'import', txt, '--from', 'plantuml'], { encoding: 'utf-8' });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'seq.json'), 'utf-8')).meta.view, 'sequence');
  const bad = spawnSync(process.execPath, [CLI, 'import', txt, '--from', 'visio'], { encoding: 'utf-8' });
  assert.equal(bad.status, 1);

  const multi = path.join(dir, 'multi.drawio');
  fs.writeFileSync(multi, mxfile(v('a', 'A', '') + v('b', 'B', '') + e('x', 'a', 'b', 'go'), v('c', 'C', '') + v('d', 'D', '') + e('y', 'c', 'd', 'go')));
  const page = spawnSync(process.execPath, [CLI, 'import', multi, '--page', '2'], { encoding: 'utf-8' });
  assert.equal(page.status, 0, page.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'multi.json'), 'utf-8')).nodes[0].data.title, 'C');
  const all = spawnSync(process.execPath, [CLI, 'import', multi, '--all'], { encoding: 'utf-8' });
  assert.equal(all.status, 0, all.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'multi-1.json')) && fs.existsSync(path.join(dir, 'multi-2.json')));
});

test('MCP yantra_import converts text or a file inside the input root', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-imp-'));
  const s = startMcp({ env: { YANTRA_INPUT_ROOT: path.join(ROOT, 'examples'), YANTRA_OUTPUT_ROOT: outDir } });
  const send = s.send;
  const call = (id, args) => send({ id, method: 'tools/call', params: { name: 'yantra_import', arguments: args } });
  send({ id: 1, method: 'tools/list' });
  call(2, { text: '@startuml\nA -> B : hi\n@enduml', title: 'T' });
  call(3, { filePath: 'drawio/order-platform.drawio', outputPath: path.join(outDir, 'o.json') });
  call(4, { filePath: path.join(ROOT, 'package.json') });
  call(5, { filePath: '../README.md' });
  let replies;
  try {
    replies = await s.waitFor(5);
  } finally {
    await s.close();
  }

  assert.ok(replies.get(1).result.tools.some((t) => t.name === 'yantra_import'));
  const r2 = JSON.parse(replies.get(2).result.content[0].text);
  assert.equal(r2.format, 'plantuml');
  assert.equal(r2.payload.meta.title, 'T');
  assert.equal(r2.validation.valid, true);
  const r3 = JSON.parse(replies.get(3).result.content[0].text);
  assert.equal(r3.format, 'drawio');
  assert.equal(JSON.parse(fs.readFileSync(r3.outputPath, 'utf-8')).meta.title, 'Order platform');
  assert.equal(replies.get(4).result.isError, true, 'extension not allowed');
  assert.match(replies.get(5).result.content[0].text, /must be inside/);
  removeDir(outDir);
});

// --- PlantUML: two-way messages, objects, ER, gantt, old activity, preprocessor ------------

test('PlantUML sequence: <-> and <--> are two-way messages', () => {
  const { payload, warnings } = fromPlantUml('@startuml\nA <-> B : sync\nB <--> C : mirror\n@enduml');
  assert.equal(edge(payload, 'A', 'B').arrow, 'both');
  assert.deepEqual([edge(payload, 'B', 'C').arrow, edge(payload, 'B', 'C').style], ['both', 'dashed']);
  assert.match(payload.scenarios[0].steps[1].description, /A ↔ B/);
  assert.ok(!warnings.some((w) => /bidirectional/.test(w)));
});

test('PlantUML object diagrams become table cards', () => {
  const { payload, warnings } = fromPlantUml(
    '@startuml\nobject "alice : User" as alice {\n  name = "Alice"\n  age = 30\n}\nobject cart\ncart : items = 2\nmap Prices {\n  tea => 3.50\n  owner *-> alice\n}\nalice --> cart : owns\nalice *-- cart\n@enduml'
  );
  const alice = node(payload, 'alice');
  assert.equal(alice.type, 'object');
  assert.equal(alice.data.title, 'alice : User');
  assert.deepEqual(alice.data.fields, [{ name: 'name', type: 'Alice' }, { name: 'age', type: '30' }]);
  assert.deepEqual(node(payload, 'cart').data.fields, [{ name: 'items', type: '2' }]);
  assert.deepEqual(node(payload, 'Prices').data.fields, [{ name: 'tea', type: '3.50' }, { name: 'owner' }]);
  assert.equal(edge(payload, 'Prices', 'alice').label, 'owner');
  assert.equal(payload.edges.find((e) => e.relation === 'composition').source, 'alice');
  assert.deepEqual(warnings, []);
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML entity diagrams become ER table cards with crow\'s foot ends', () => {
  const { payload, warnings } = fromPlantUml(
    '@startuml\nentity "Customer" as c {\n  *id : int <<generated>>\n  --\n  *email : text <<UK>>\n  nickname\n}\nentity Order {\n  *id : int\n  --\n  customer_id : int <<FK>>\n}\nc ||--o{ Order : places\nOrder }|..|| c : billed to\nc -- Order\n@enduml'
  );
  const c = node(payload, 'c');
  assert.equal(c.data.title, 'Customer');
  assert.deepEqual(c.data.fields, [{ name: 'id', type: 'int', pk: true, note: 'generated' }, { name: 'email', type: 'text', unique: true }, { name: 'nickname' }]);
  assert.deepEqual(node(payload, 'Order').data.fields[1], { name: 'customer_id', type: 'int', fk: true });
  const places = edge(payload, 'c', 'Order');
  assert.deepEqual([places.sourceEnd, places.targetEnd, places.label], ['one', 'zero-or-many', 'places']);
  const billed = edge(payload, 'Order', 'c');
  assert.deepEqual([billed.sourceEnd, billed.targetEnd, billed.style], ['one-or-many', 'one', 'dashed']);
  assert.ok(warnings.some((w) => /Skipped 1 link without a crow's foot/.test(w)));
  assert.match(payload.meta.description, /PlantUML ER diagram/);
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML @startgantt becomes a plan page', () => {
  const { payload, warnings } = fromPlantUml(
    '@startgantt\ntitle Relaunch\nProject starts 2026-10-05\n-- Build --\n[Design] as [D] lasts 5 days and is 100% completed\n[Code] lasts 2 weeks\n[Code] starts at [D]\'s end\nthen [Test] lasts 3 days\n[Launch] happens at [Test]\'s end\n[Docs] starts 2026-10-12 and ends 2026-10-16\n[Code] -> [Review]\n[Review] lasts 2 days\nsaturday are closed\n@endgantt'
  );
  assert.equal(payload.kind, 'page');
  const items = payload.blocks[0].items;
  const by = (id) => items.find((it) => it.id === id);
  assert.deepEqual(by('design'), { id: 'design', title: 'Design', group: 'Build', start: '05/10/2026', days: 5, progress: 100 });
  assert.deepEqual([by('code').after, by('code').days], ['design', 14]);
  assert.equal(by('test').after, 'code');
  assert.deepEqual([by('launch').after, by('launch').milestone], ['test', true]);
  assert.deepEqual([by('docs').start, by('docs').end], ['12/10/2026', '16/10/2026']);
  assert.equal(by('review').after, 'code');
  assert.equal(payload.meta.title, 'Relaunch');
  assert.match(payload.answer.headline, /^The plan runs from 05\/10\/2026 to /);
  assert.ok(warnings.some((w) => /only weekends .*saturday still counts as working/.test(w)));
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML old activity syntax becomes a flow', () => {
  const { payload } = fromPlantUml(
    '@startuml\n(*) --> "Open ticket"\n"Open ticket" --> "Triage" as T\nif "Urgent?" then\n  -->[yes] "Page on-call" as P\nelse\n  -->[no] "Queue" as Q\nendif\nP --> (*)\nQ -->[later] (*)\n@enduml'
  );
  const t = (title) => byTitle(payload, title);
  assert.equal(t('Start').type, 'terminal');
  assert.equal(t('Urgent?').type, 'decision');
  assert.equal(edge(payload, t('Urgent?').id, t('Page on-call').id).label, 'yes');
  assert.equal(edge(payload, t('Urgent?').id, t('Queue').id).label, 'no');
  assert.equal(edge(payload, t('Queue').id, t('End').id).label, 'later');
  assert.equal(payload.nodes.filter((n) => n.data.title === 'End').length, 1);
  assert.deepEqual(lint(payload).errors, []);
});

test('PlantUML preprocessor: !define, !$var and safe !include', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-inc-'));
  const root = path.join(dir, 'root');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'parts.iuml'), '@startuml\n!$svc = "Billing"\nA -> B : from include\n!include ../loop.puml\n@enduml\n');
  fs.writeFileSync(path.join(root, 'loop.puml'), '!include lib/parts.iuml\nB -> C : once\n');
  fs.writeFileSync(path.join(dir, 'secret.puml'), 'X -> Y : leaked\n');
  const main = path.join(root, 'main.puml');
  const text = '@startuml\n!define CALLS ->\n!include lib/parts.iuml\n!include ../secret.puml\n!include https://example.com/x.puml\n!include <C4/C4_Container>\n!theme plain\nU CALLS A : $svc\n@enduml';
  fs.writeFileSync(main, text);
  const { payload, warnings } = fromPlantUml(text, { include: fileIncluder(root), path: main });
  const msgs = payload.scenarios[0].steps.slice(1).map((s) => s.title);
  assert.deepEqual(msgs, ['from include', 'once', 'Billing']);
  assert.ok(warnings.some((w) => /cycle/.test(w)), 'include cycles stop');
  assert.ok(warnings.some((w) => /secret\.puml: outside/.test(w)), 'files outside the root are refused');
  assert.ok(warnings.some((w) => /`!includeurl` preprocessor line \(URLs are never fetched\)/.test(w)));
  assert.ok(warnings.some((w) => /<stdlib>/.test(w)));
  assert.ok(warnings.some((w) => /`!theme`/.test(w)));
  assert.ok(!msgs.includes('leaked'));
  // Without a resolver (text from MCP or the browser) includes are skipped, not read
  const bare = preprocessPlantUml('!include lib/parts.iuml\nA -> B', {});
  assert.match(bare.warnings[0], /no file context/);
  // Deep nesting stops at 8 levels
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(root, `d${i}.iuml`), `!include d${i + 1}.iuml\nN${i} -> N${i + 1} : hop\n`);
  const deep = preprocessPlantUml('!include d0.iuml', { include: fileIncluder(root), path: main });
  assert.ok(deep.warnings.some((w) => /deeper than 8/.test(w)));
});

// --- draw.io colours, images, PNG; Visio -----------------------------------------------------

test('draw.io: fill colours become role colours; image shapes become icons', () => {
  const { payload, warnings } = fromDrawio(
    mxfile(
      v('a', 'API', 'rounded=1;fillColor=#dae8fc;', '1', 'x="0" y="0" width="100" height="60"') +
        v('b', 'Worker', 'rounded=1;fillColor=#dae8fc;', '1', 'x="200" y="0" width="100" height="60"') +
        v('c', 'Fraud', 'rounded=1;fillColor=#f8cecc;', '1', 'x="400" y="0" width="100" height="60"') +
        v('d', 'Plain', 'rounded=1;fillColor=#ffffff;', '1', 'x="600" y="0" width="100" height="60"') +
        v('f', 'Fn', 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;', '1', 'x="800" y="0" width="60" height="60"') +
        v('g', '', 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;', '1', 'x="1000" y="0" width="60" height="60"') +
        v('h', 'Logo', 'shape=image;image=data:image/png,iVBORw0KGgo;', '1', 'x="1200" y="0" width="60" height="60"') +
        e('e1', 'a', 'b', 'jobs') + e('e2', 'b', 'c', 'score') + e('e3', 'c', 'd', 'flag') + e('e4', 'd', 'f', 'run') + e('e5', 'f', 'g', 'save') + e('e6', 'g', 'h', 'show')
    )
  );
  // Uncoloured steps are the commonest, so they keep the base role; each fill gets its own
  assert.equal(node(payload, 'api').type, 'node-blue');
  assert.deepEqual(payload.roles['node-blue'], { label: 'Step (blue)', color: 'blue' });
  assert.notEqual(payload.roles.node.color, 'blue', 'no two roles share a colour by accident');
  assert.equal(node(payload, 'fraud').type, 'node-rose');
  assert.deepEqual(payload.roles['node-rose'], { label: 'Step (red)', color: 'rose' });
  assert.equal(node(payload, 'plain').type, 'node', 'white is no colour');
  assert.equal(node(payload, 'fn').data.icon, 'zap');
  const db = payload.nodes.find((n) => n.data.icon === 'database');
  assert.deepEqual([db.type, db.data.title], ['store', 'Dynamodb']);
  assert.equal(node(payload, 'logo').data.icon, undefined);
  assert.ok(warnings.some((w) => /Ignored 1 image with no matching built-in icon/.test(w)));
  assert.equal(cellHue({ fillColor: '#fff2cc' }), 'amber');
  assert.equal(cellHue({ fillColor: 'none', strokeColor: '#82b366' }), 'green');
  assert.equal(cellHue({ fillColor: '#000000' }), null);
  assert.equal(imageOf({ _shape: 'rounded' }), null);
  assert.equal(imageOf({ _shape: 'image', image: 'img/lib/azure2/databases/SQL_Database.svg' }).icon, 'database');
  assert.deepEqual(lint(payload).errors, []);
});

test('draw.io PNG export: the embedded diagram is read from the tEXt or zTXt chunk', () => {
  const png = fs.readFileSync(path.join(ROOT, 'examples', 'drawio', 'support-triage.drawio.png'));
  assert.match(drawioFromPng(png), /<mxfile/);
  const { format, results } = importText(png, { filename: 'support-triage.drawio.png' });
  assert.equal(format, 'drawio');
  assert.equal(results[0].payload.meta.title, 'Support triage');
  // zTXt (zlib) with the mxGraphModel keyword
  const crcChunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  const xml = mxfile(v('a', 'A', '') + v('b', 'B', '') + e('x', 'a', 'b', 'go'));
  const z = Buffer.concat([sig, crcChunk('zTXt', Buffer.concat([Buffer.from('mxGraphModel\0\0'), zlib.deflateSync(Buffer.from(xml))])), crcChunk('IEND', Buffer.alloc(0))]);
  assert.equal(importText(z).results[0].payload.nodes.length, 2);
  const plain = Buffer.concat([sig, crcChunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => importText(plain), /no embedded draw.io diagram/);
});

test('Visio .vsdx: shapes, glued connectors, master types and pages', () => {
  const bytes = fs.readFileSync(path.join(ROOT, 'examples', 'visio', 'order-approval.vsdx'));
  assert.ok(unzip(bytes).has('visio/pages/page1.xml'));
  const { payload, warnings, pages } = fromVisio(bytes);
  assert.deepEqual(pages, ['Order approval']);
  assert.equal(payload.meta.title, 'Order approval');
  assert.deepEqual(Object.fromEntries(payload.nodes.map((n) => [n.data.title, n.type])), {
    'Order received': 'terminal',
    'Check stock': 'node',
    'In stock?': 'decision',
    'Reserve items': 'node',
    'Back-order': 'node-rose',
    'Orders DB': 'store'
  });
  assert.equal(edge(payload, 'in-stock', 'back-order').style, 'dashed');
  assert.equal(payload.meta.layout.direction, 'LR');
  assert.deepEqual(warnings, []);
  assert.throws(() => fromVisio(bytes, { page: 3 }), /No page "3"/);
  assert.throws(() => importText(Buffer.from('PK\x03\x04 not really a zip')), /not a zip archive|end of central directory/);
});

test('CLI and MCP import binary files and resolve includes inside the root', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-bin-'));
  const vsdx = path.join(ROOT, 'examples', 'visio', 'order-approval.vsdx');
  const res = spawnSync(process.execPath, [CLI, 'import', vsdx, '-o', path.join(dir, 'v.json')], { encoding: 'utf-8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /visio: 6 nodes/);
  const inc = spawnSync(process.execPath, [CLI, 'import', path.join(ROOT, 'examples', 'plantuml', 'shared-services.puml'), '-o', path.join(dir, 'i.json')], { encoding: 'utf-8' });
  assert.equal(inc.status, 0, inc.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'i.json'), 'utf-8')).meta.title, 'Acme services');
  const gantt = spawnSync(process.execPath, [CLI, 'import', path.join(ROOT, 'examples', 'mermaid', 'launch-gantt.mmd'), '-o', path.join(dir, 'g.json')], { encoding: 'utf-8' });
  assert.equal(gantt.status, 0, gantt.stderr);
  assert.match(gantt.stderr, /answer page, 1 block/);

  const s = startMcp({ env: { YANTRA_INPUT_ROOT: path.join(ROOT, 'examples'), YANTRA_OUTPUT_ROOT: dir } });
  s.call(1, 'yantra_import', { filePath: 'visio/order-approval.vsdx' });
  s.call(2, 'yantra_import', { filePath: 'drawio/support-triage.drawio.png' });
  s.call(3, 'yantra_import', { filePath: 'plantuml/shared-services.puml' });
  let replies;
  try {
    replies = await s.waitFor(3);
  } finally {
    await s.close();
    removeDir(dir);
  }
  const r = (id) => JSON.parse(replies.get(id).result.content[0].text);
  assert.equal(r(1).format, 'visio');
  assert.equal(r(1).validation.valid, true);
  assert.equal(r(2).payload.meta.title, 'Support triage');
  assert.equal(r(3).payload.meta.title, 'Acme services');
});

test('draw.io: fork bars, and edges drawn to table rows attach to those fields', () => {
  const bar = v('bar', '', 'html=1;fillColor=#000000;strokeColor=none;', '1', 'x="200" y="100" width="120" height="6"');
  const flow = fromDrawio(
    mxfile(
      v('a', 'Start work', '', '1', 'x="200" y="0" width="120" height="40"') + bar +
        v('b', 'Left', '', '1', 'x="100" y="200" width="100" height="40"') + v('c', 'Right', '', '1', 'x="300" y="200" width="100" height="40"') +
        e('e1', 'a', 'bar', 'begin') + e('e2', 'bar', 'b') + e('e3', 'bar', 'c')
    )
  ).payload;
  const f = flow.nodes.find((n) => n.shape === 'fork');
  assert.deepEqual([f.type, f.data.title], ['fork', 'Fork']);
  assert.deepEqual(lint(flow).errors, []);

  const table = (id, name, rows, x) =>
    v(id, name, 'shape=table;startSize=30;container=1;childLayout=tableLayout;', '1', `x="${x}" y="0" width="160" height="90"`) +
    rows.map(([rid, text], i) => v(rid, text, 'shape=tableRow;', id, `y="${30 + i * 30}" width="160" height="30"`)).join('');
  const er = fromDrawio(
    mxfile(
      table('cust', 'customers', [['c1', 'PK id uuid'], ['c2', 'email text']], 0) +
        table('ord', 'orders', [['o1', 'PK id uuid'], ['o2', 'FK customer_id uuid']], 400) +
        e('r1', 'c1', 'o2', 'places', 'endArrow=ERzeroToMany;startArrow=ERmandOne;')
    )
  ).payload;
  const places = er.edges[0];
  assert.deepEqual([places.sourceField, places.targetField, places.sourceEnd, places.targetEnd], ['id', 'customer_id', 'one', 'zero-or-many']);
  assert.deepEqual(lint(er).errors, []);
});

test('ER imports attach relationships to key rows named after the entity', () => {
  const schema = 'erDiagram\n  CUSTOMERS { int id PK }\n  ORDER { int id PK; int customer_id FK }\n';
  const [down] = fromMermaid(`${schema}  CUSTOMERS ||--o{ ORDER : places`).payload.edges;
  const [up] = fromMermaid(`${schema}  ORDER }o--|| CUSTOMERS : "billed to"`).payload.edges;
  assert.deepEqual([down.sourceField, down.targetField], ['id', 'customer_id'], 'CUSTOMERS -> customer_id (plural stripped)');
  assert.deepEqual([up.sourceField, up.targetField], ['customer_id', 'id'], 'child -> parent');
  const plain = fromMermaid('erDiagram\n  A { int id PK }\n  B { int ref FK }\n  A ||--o{ B : has').payload;
  assert.equal(plain.edges[0].sourceField, undefined, 'no guess when the names do not match');
});

test('PlantUML class multiplicities become end labels', () => {
  const { payload } = fromPlantUml('@startuml\nclass Order\nclass Line\nOrder "1" *-- "1..*" Line : lines\n@enduml');
  const e = payload.edges[0];
  assert.deepEqual([e.relation, e.sourceLabel, e.targetLabel], ['composition', '1', '1..*']);
});
