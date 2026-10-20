import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fromMermaid, mermaidBlocks, cleanLabel, hueOf } from '../src/core/mermaid.js';
import { lint } from '../src/core/lint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'yantra.js');
const SAMPLES = path.join(ROOT, 'examples', 'mermaid');

const flow = (body, opts) => fromMermaid(`flowchart LR\n${body}`, opts);
const node = (p, id) => p.nodes.find((n) => n.id === id);
const edge = (p, s, t) => p.edges.find((e) => e.source === s && e.target === t);

test('header direction maps to LR/TB and reversed directions warn', () => {
  for (const [dir, want] of [['TD', 'TB'], ['TB', 'TB'], ['BT', 'TB'], ['LR', 'LR'], ['RL', 'LR']]) {
    const { payload, warnings } = fromMermaid(`graph ${dir}\n  A --> B`);
    assert.equal(payload.meta.layout.direction, want, dir);
    assert.equal(warnings.some((w) => /does not reverse/.test(w)), dir === 'BT' || dir === 'RL', dir);
  }
});

test('node shapes map to types, icons and titles', () => {
  const { payload } = flow(
    'a[Rect] --> b(Round) --> c([Stadium]) --> d[(Orders DB)] --> e((Circle))\n' +
      'e --> f{Decide?} --> g>Flag] --> h[/Para/] --> i{{Hex}} --> j["Quoted <br> second line"] --> k[[Sub]]'
  );
  const t = Object.fromEntries(payload.nodes.map((n) => [n.id, n.type]));
  assert.deepEqual(t, { a: 'node', b: 'node', c: 'terminal', d: 'store', e: 'terminal', f: 'decision', g: 'event', h: 'io', i: 'node', j: 'node', k: 'node' });
  assert.equal(node(payload, 'd').data.icon, 'database');
  assert.equal(node(payload, 'd').data.title, 'Orders DB');
  assert.deepEqual(node(payload, 'j').data, { title: 'Quoted', subtitle: 'second line' });
  assert.equal(payload.roles.store.icon, 'database');
  assert.equal(payload.roles.decision.label, 'Decision');
});

test('labels lose html, markdown and entities', () => {
  assert.equal(cleanLabel('"**Bold** and _it_ <b>x</b> #quot;q#quot;"'), 'Bold and it x "q"');
  assert.equal(cleanLabel('fa:fa-user Person<br/>Sub'), 'Person\nSub');
});

test('edge kinds, labels and chains', () => {
  const { payload } = flow('A --> B --> C\nA --- D\nA -.-> E\nA ==> F\nA --o G\nA --x H\nB -->|pipe| D\nC -- text --> E\nD -. dotted .-> F\nE == thick ==> G');
  assert.ok(edge(payload, 'A', 'B') && edge(payload, 'B', 'C'), 'chained');
  assert.equal(edge(payload, 'A', 'E').style, 'dashed');
  assert.equal(edge(payload, 'A', 'F').style, 'solid');
  assert.ok(edge(payload, 'A', 'D') && edge(payload, 'A', 'G') && edge(payload, 'A', 'H'));
  assert.equal(edge(payload, 'B', 'D').label, 'pipe');
  assert.equal(edge(payload, 'C', 'E').label, 'text');
  assert.equal(edge(payload, 'D', 'F').label, 'dotted');
  assert.equal(edge(payload, 'D', 'F').style, 'dashed');
  assert.equal(edge(payload, 'E', 'G').label, 'thick');
  assert.equal(new Set(payload.edges.map((e) => e.id)).size, payload.edges.length, 'edge ids unique');
});

test('& fan-out on both sides, semicolons and duplicate edges', () => {
  const { payload } = flow('A & B --> C & D; A --> C');
  assert.equal(payload.edges.length, 5);
  assert.deepEqual(payload.edges.map((e) => e.id).sort(), ['A-C', 'A-C-2', 'A-D', 'B-C', 'B-D']);
});

test('subgraphs become nested groups; edges to a subgraph go to its first node', () => {
  const { payload, warnings } = flow('subgraph outer [Outer box]\n  A --> B\n  subgraph inner\n    C\n  end\nend\nsubgraph "Free title"\n  D\nend\nD --> outer');
  assert.deepEqual(payload.groups, [
    { id: 'outer', title: 'Outer box', nodes: ['A', 'B'] },
    { id: 'inner', title: 'inner', nodes: ['C'], parent: 'outer' },
    { id: 'Free-title', title: 'Free title', nodes: ['D'] }
  ]);
  assert.ok(edge(payload, 'D', 'A'));
  assert.ok(!node(payload, 'outer'));
  assert.ok(warnings.some((w) => /first node/.test(w)));
});

test('classDef, class and ::: set node types and coloured roles', () => {
  const { payload } = flow('A:::hot --> B\nB --> C\nclassDef hot fill:#fecaca,stroke:#dc2626\nclassDef cool fill:#e0f2fe\nclass B,C cool');
  assert.equal(node(payload, 'A').type, 'hot');
  assert.equal(node(payload, 'C').type, 'cool');
  assert.deepEqual(payload.roles.hot, { label: 'Hot', color: 'rose' });
  assert.equal(payload.roles.cool.color, 'blue');
  assert.equal(hueOf('#999'), 'slate');
  assert.equal(hueOf('#16a34a'), 'green');
});

test('comments are dropped; click/style/linkStyle are ignored with a warning', () => {
  const { payload, warnings } = flow('%% a comment\nA --> B %% trailing\nclick A "https://x"\nstyle A fill:#f00\nstyle B fill:#0f0\nlinkStyle 0 stroke:red');
  assert.equal(payload.nodes.length, 2);
  assert.ok(warnings.some((w) => /Ignored 2 `style` lines/.test(w)));
  assert.ok(warnings.some((w) => /`click`/.test(w)) && warnings.some((w) => /`linkStyle`/.test(w)));
});

test('ids are sanitised and stay unique; long titles are shortened', () => {
  const long = 'An extremely long label that will not fit on a single card title';
  const { payload } = flow(`node.one[x] --> node_one[y]\nz[${long}]`);
  const ids = payload.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id)));
  const z = node(payload, 'z');
  assert.ok(z.data.title.length <= 42 && z.data.description === long);
});

test('flowchart walkthrough: overview first, at most 8 steps, edges with both ends lit', () => {
  const body = Array.from({ length: 12 }, (_, i) => `n${i} -->|next| n${i + 1}`).join('\n');
  const { payload } = flow(body);
  const steps = payload.scenarios[0].steps;
  assert.equal(steps[0].id, 'overview');
  assert.ok(steps.length <= 8);
  for (const s of steps.slice(1))
    for (const id of s.highlightEdges || []) {
      const e = payload.edges.find((x) => x.id === id);
      assert.ok(s.highlightNodes.includes(e.source) && s.highlightNodes.includes(e.target));
    }
  const small = flow('A -->|go| B{ok?}\nB -->|yes| C\nB -->|no| A').payload.scenarios[0].steps;
  assert.deepEqual(small.map((s) => s.title), ['Overview', 'A', 'ok?', 'C']);
  assert.match(small[2].description, /Branches: yes → C and no → A/);
});

test('sequence diagrams: participants, deduped edges, one step per message, notes and blocks', () => {
  const { payload, warnings } = fromMermaid(
    'sequenceDiagram\n  actor U as User\n  participant API\n  Note over U,API: Before anything\n  U->>API: Ask\n  loop every second\n    API->>DB: Query\n    DB-->>API: Rows\n    API->>DB: Query again\n  end\n  Note right of API: cached\n  alt ok\n    API-->>U: Answer\n  else failed\n    API--xU: Error\n  end\n  API->>API: Log',
    { title: 'Seq' }
  );
  assert.equal(payload.meta.title, 'Seq');
  assert.deepEqual(payload.nodes.map((n) => [n.id, n.type]), [['U', 'actor'], ['API', 'service'], ['DB', 'store']]);
  assert.equal(node(payload, 'U').data.title, 'User');
  assert.equal(edge(payload, 'API', 'DB').label, 'Query');
  assert.equal(edge(payload, 'DB', 'API').style, 'dashed');
  assert.equal(payload.edges.length, 4);
  const steps = payload.scenarios[0].steps;
  assert.equal(steps.length, 1 + 7);
  assert.match(steps[0].description, /Before anything/);
  assert.equal(steps[4].title, 'Query again');
  assert.deepEqual(steps[4].highlightEdges, [edge(payload, 'API', 'DB').id]);
  assert.match(steps[2].description, /loop “every second”/);
  assert.match(steps[4].description, /cached/);
  assert.match(steps[6].description, /alt “failed”/);
  assert.deepEqual(steps[7].highlightNodes, ['API']);
  assert.ok(warnings.some((w) => /repeated message/.test(w)));
  assert.equal(lint(payload).errors.length, 0);
});

test('sequence boxes become groups; unsupported diagrams throw', () => {
  const { payload } = fromMermaid('sequenceDiagram\n  box Aqua Frontend\n    participant W\n  end\n  W->>S: call');
  assert.deepEqual(payload.groups, [{ id: 'box-1', title: 'Frontend', nodes: ['W'] }]);
  assert.throws(() => fromMermaid('classDiagram\n  A <|-- B'), /Unsupported Mermaid diagram type "classDiagram"/);
});

test('every sample imports and lints with zero errors', () => {
  for (const f of fs.readdirSync(SAMPLES).filter((x) => x.endsWith('.mmd'))) {
    const { payload } = fromMermaid(fs.readFileSync(path.join(SAMPLES, f), 'utf-8'));
    const r = lint(payload);
    assert.deepEqual(r.errors, [], f);
    assert.ok(r.warnings.length <= 1, `${f}: ${r.warnings.map((w) => w.code).join(', ')}`);
  }
});

test('mermaidBlocks finds fenced blocks', () => {
  assert.deepEqual(mermaidBlocks('# x\n```mermaid\ngraph LR\nA-->B\n```\ntext\n~~~mermaid\nsequenceDiagram\n~~~\n'), ['graph LR\nA-->B\n', 'sequenceDiagram\n']);
});

test('CLI import reads the first mermaid block of a .md file, or all with --all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-mmd-'));
  const md = path.join(dir, 'notes.md');
  fs.writeFileSync(md, '# Notes\n\n```mermaid\ngraph TD\n  A[Start] -->|go| B[Done]\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n');
  const res = spawnSync(process.execPath, [CLI, 'import', md, '--title', 'My notes'], { encoding: 'utf-8' });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'notes.json'), 'utf-8'));
  assert.equal(out.meta.title, 'My notes');
  assert.equal(out.meta.layout.direction, 'TB');
  assert.match(res.stderr, /is valid/);

  const all = spawnSync(process.execPath, [CLI, 'import', md, '--all', '-o', path.join(dir, 'x.json')], { encoding: 'utf-8' });
  assert.equal(all.status, 0, all.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'x-1.json')) && fs.existsSync(path.join(dir, 'x-2.json')));
});

test('MCP yantra_import_mermaid returns a validated payload or writes a file', async () => {
  // Writes outside the working directory need an explicit output root
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-mmd-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, YANTRA_OUTPUT_ROOT: outDir } });
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
  const outputPath = path.join(outDir, 'out.json');
  send({ id: 1, method: 'tools/list' });
  send({ id: 2, method: 'tools/call', params: { name: 'yantra_import_mermaid', arguments: { mermaid: 'graph LR\n  A -->|x| B\n  style A fill:#fff', title: 'T' } } });
  send({ id: 3, method: 'tools/call', params: { name: 'yantra_import_mermaid', arguments: { mermaid: 'sequenceDiagram\n  A->>B: hi', outputPath } } });
  const deadline = Date.now() + 10000;
  while (replies.size < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  proc.kill();

  assert.ok(replies.get(1).result.tools.some((t) => t.name === 'yantra_import_mermaid'));
  const r2 = JSON.parse(replies.get(2).result.content[0].text);
  assert.equal(r2.payload.meta.title, 'T');
  assert.equal(r2.validation.valid, true);
  assert.ok(r2.warnings.some((w) => /style/.test(w)));
  const r3 = JSON.parse(replies.get(3).result.content[0].text);
  assert.equal(r3.outputPath, outputPath);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf-8')).nodes.length, 2);
});
