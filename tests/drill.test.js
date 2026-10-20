import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { lint } from '../src/core/lint.js';
import { toMarkdown } from '../src/core/markdown.js';
import { renderSvg } from '../src/core/svg.js';
import { computeScene } from '../src/core/scene.js';
import { collectDiagrams, levelPath, safeUrl, getLevel, replaceLevel, levelOrder, DRILL_MAX_DEPTH } from '../src/core/drill.js';
import { Levels } from '../src/app/levels.js';
import { buildPage, resolveLevels, resolvePage, ROOT } from '../lib/build.js';
import { startMcp, removeDir } from './support.js';

const CLI = path.join(ROOT, 'bin', 'yantra.js');
const example = () => resolveLevels(JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'platform-overview.json'), 'utf-8')), path.join(ROOT, 'examples'));
const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-drill-'));

/** A small valid level; `drill` maps node id -> target diagram id. */
const level = (title, drill = {}) => ({
  meta: { title },
  nodes: [
    { id: 'a', data: { title: 'A', ...(drill.a ? { drill: drill.a } : {}) } },
    { id: 'b', data: { title: 'B', ...(drill.b ? { drill: drill.b } : {}) } }
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', label: 'Call' }],
  steps: [{ title: 'Overview' }, { title: 'Call', highlightNodes: ['a', 'b'], highlightEdges: ['ab'] }]
});

test('the drill-down example validates with zero warnings at every level', () => {
  const r = lint(example());
  assert.deepEqual(codes(r), []);
  assert.deepEqual([...collectDiagrams(example()).map.keys()], ['payments', 'search']);
});

test('levelPath keeps valid paths, repairs deep links and drops unknown ids', () => {
  const p = { ...level('Root', { a: 'x' }), diagrams: { x: level('X', { b: 'y' }), y: level('Y') } };
  assert.deepEqual(levelPath(p, ['x', 'y']), ['x', 'y']);
  assert.deepEqual(levelPath(p, 'y'), ['x', 'y'], 'a single id gets its parents');
  assert.deepEqual(levelPath(p, ['y', 'x']), ['x'], 'an impossible path becomes the route to its last known id');
  assert.deepEqual(levelPath(p, ['nope']), []);
  assert.equal(getLevel(p, 'y').meta.title, 'Y');
  assert.deepEqual(levelOrder(p).map((l) => l.trail.join('/')), ['x', 'x/y']);
});

test('nested diagrams maps share one namespace; replaceLevel finds nested entries', () => {
  const p = { ...level('Root', { a: 'x' }), diagrams: { x: { ...level('X', { b: 'y' }), diagrams: { y: level('Y') } } } };
  assert.deepEqual(codes(lint(p)), []);
  const next = replaceLevel(p, 'y', level('Y2'));
  assert.equal(next.diagrams.x.diagrams.y.meta.title, 'Y2');
  assert.equal(p.diagrams.x.diagrams.y.meta.title, 'Y', 'input untouched');
});

test('lint: unknown target, cycle, depth, start level, unused and invalid entries', () => {
  assert.ok(codes(lint({ ...level('R', { a: 'nope' }), diagrams: { x: level('X') } })).includes('drill/unknown-target'));
  const cycle = lint({ ...level('R', { a: 'x' }), diagrams: { x: level('X', { b: 'y' }), y: level('Y', { a: 'x' }) } });
  assert.ok(cycle.errors.some((e) => e.code === 'drill/cycle' && /x > y > x/.test(e.message)), JSON.stringify(cycle.errors));
  const chain = { ...level('R', { a: 'l1' }), diagrams: {} };
  for (let i = 1; i <= DRILL_MAX_DEPTH + 1; i++) chain.diagrams[`l${i}`] = level(`L${i}`, i <= DRILL_MAX_DEPTH ? { a: `l${i + 1}` } : {});
  assert.ok(codes(lint(chain)).includes('drill/too-deep'));
  delete chain.diagrams[`l${DRILL_MAX_DEPTH + 1}`];
  chain.diagrams[`l${DRILL_MAX_DEPTH}`] = level('Last');
  assert.ok(!codes(lint(chain)).includes('drill/too-deep'), 'exactly the maximum is fine');
  assert.ok(codes(lint({ ...level('R'), meta: { title: 'R', startLevel: 'zz' } })).includes('drill/unknown-start-level'));
  assert.ok(codes(lint({ ...level('R'), diagrams: { x: level('X') } })).includes('drill/unused-diagram'));
  const bad = lint({ ...level('R', { a: 'x' }), diagrams: { x: [1], y: { kind: 'page' } } });
  assert.ok(codes(bad).includes('drill/invalid-diagram'));
  assert.ok(codes(lint({ ...level('R'), diagrams: [] })).includes('drill/diagrams-invalid'));
  const dup = lint({ ...level('R', { a: 'x' }), diagrams: { x: { ...level('X'), diagrams: { x: level('X again') } } } });
  assert.ok(codes(dup).includes('drill/duplicate-id'));
});

test('lint checks every detail diagram and names it in the message', () => {
  const sub = level('X');
  sub.edges.push({ id: 'bad', source: 'a', target: 'ghost', label: 'x' });
  const r = lint({ ...level('R', { a: 'x' }), diagrams: { x: sub } });
  const e = r.errors.find((f) => f.code === 'ref/edge-unknown-target');
  assert.ok(e && e.diagram === 'x' && e.message.startsWith('diagrams.x: '), JSON.stringify(r.errors));
});

test('links: only http(s) and mailto are allowed on nodes, edges and steps', () => {
  assert.equal(safeUrl(' https://example.com/a '), 'https://example.com/a');
  assert.equal(safeUrl('mailto:team@example.com'), 'mailto:team@example.com');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x', 'https://x"onclick', 42]) assert.equal(safeUrl(bad), null, String(bad));
  const p = level('R');
  p.nodes[0].data.url = 'javascript:alert(1)';
  p.edges[0].url = 'https://ok.example.com';
  p.steps[1].url = 'data:text/html,x';
  const r = lint(p);
  assert.equal(r.errors.filter((e) => e.code === 'link/unsafe-url').length, 2);
});

test('resolveLevels loads $ref files relative to the file that holds them, inside the root', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'detail'));
  fs.writeFileSync(path.join(dir, 'detail', 'x.json'), JSON.stringify({ ...level('X', { a: 'y' }), diagrams: { y: { $ref: '../y.json' } } }));
  fs.writeFileSync(path.join(dir, 'y.json'), JSON.stringify(level('Y')));
  const root = { ...level('R', { a: 'x' }), diagrams: { x: { $ref: './detail/x.json' } } };
  const out = resolveLevels(root, dir);
  assert.equal(out.diagrams.x.diagrams.y.meta.title, 'Y');
  assert.deepEqual(codes(lint(out)), []);
  assert.equal(root.diagrams.x.$ref, './detail/x.json', 'input untouched');

  const outside = tmpdir();
  fs.writeFileSync(path.join(outside, 'z.json'), JSON.stringify(level('Z')));
  const rel = path.relative(dir, path.join(outside, 'z.json')).split(path.sep).join('/');
  const cases = {
    missing: { $ref: './missing.json' },
    unsafeUp: { $ref: rel },
    unsafeAbs: { $ref: path.join(outside, 'z.json') },
    notJson: { $ref: './y.txt' }
  };
  const r = lint(resolveLevels({ ...level('R', { a: 'missing', b: 'unsafeUp' }), diagrams: cases }, dir));
  const by = (id) => r.errors.find((e) => e.diagram === id)?.code;
  assert.equal(by('missing'), 'drill/ref-missing');
  assert.equal(by('unsafeUp'), 'drill/ref-unsafe');
  assert.equal(by('unsafeAbs'), 'drill/ref-unsafe');
  assert.equal(by('notJson'), 'drill/ref-unsafe');
  // Unresolved (no builder): still reported, never silently ignored
  assert.ok(codes(lint({ ...level('R', { a: 'x' }), diagrams: { x: { $ref: './x.json' } } })).includes('drill/ref-missing'));
});

test('files that reference each other are reported as a cycle, not followed forever', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ ...level('A', { a: 'b' }), diagrams: { b: { $ref: './b.json' } } }));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ ...level('B', { a: 'a2' }), diagrams: { a2: { $ref: './a.json' } } }));
  const out = resolveLevels(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf-8')), dir);
  assert.ok(codes(lint(out)).includes('drill/cycle'));
});

test('exports: SVG marks drill cards, Markdown covers one level or all of them', () => {
  const p = example();
  const svg = renderSvg(computeScene(p), { theme: 'light' });
  assert.equal(svg.match(/<title>Has a detail diagram<\/title>/g).length, 2);
  const one = toMarkdown(p);
  assert.match(one, /\| \*\*Payments\*\* \(detail: Payments service\) \|/);
  assert.match(one, /\[\*\*API gateway\*\*\]\(https:\/\/www\.envoyproxy\.io\/docs\)/);
  assert.match(one, /\[Charge\]\(https:\/\/example\.com\/docs\/payments-api\)/);
  assert.ok(!one.includes('Card provider'), 'one level by default');
  const all = toMarkdown(p, { levels: true });
  assert.match(all, /^## Shop platform overview › Payments service$/m);
  assert.match(all, /^### Components$/m);
  assert.match(all, /^## Shop platform overview › Search service$/m);
  assert.ok(toMarkdown({ ...level('R'), nodes: [{ id: 'a', data: { title: 'A', url: 'javascript:x' } }], edges: [] }).includes('| **A** |'), 'unsafe links are dropped');
});

test('viewer level state: hash round trip and breadcrumb', () => {
  const lv = new Levels({ ...level('Root <1>', { a: 'x/1' }), diagrams: { 'x/1': level('X') } });
  lv.setPath(['x/1']);
  assert.equal(lv.hashValue(), 'x%2F1');
  assert.deepEqual(Levels.parseHash(lv.hashValue()), ['x/1']);
  assert.match(lv.crumbsHtml(), /data-level="0">Root &lt;1&gt;<\/button>.*aria-current="page">X</);
  assert.equal(lv.target({ data: { drill: 'x/1' } }), null, 'no drilling into a level already on the path');
  lv.popTo(0);
  assert.equal(lv.target({ data: { drill: 'x/1' } }), 'x/1');
  assert.equal(new Levels(level('Plain')).crumbsHtml(), '');
});

test('answer pages: level picks the figure, embeds open there, unknown levels fail', () => {
  const diagram = example();
  const base = { kind: 'page', meta: { title: 'P' }, answer: { headline: 'H.' } };
  const page = { ...base, blocks: [{ type: 'diagram', diagram, level: 'payments', interactive: true }] };
  assert.deepEqual(codes(lint(page)), []);
  const html = buildPage(page, ROOT);
  assert.match(html, /title="Payments service \(interactive\)"/);
  const embed = /<script type="application\/json" id="yantra-embed-0">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(embed).meta.startLevel, 'payments');
  assert.ok(JSON.parse(embed).diagrams.search, 'the embed carries every level');
  assert.ok(codes(lint({ ...base, blocks: [{ type: 'diagram', diagram, level: 'nope' }] })).includes('page/unknown-level'));
  // Drillable diagrams still count once each toward the two-viewer budget
  const three = { ...base, blocks: [0, 1, 2].map(() => ({ type: 'diagram', diagram, interactive: true })) };
  assert.ok(codes(lint(three)).includes('page/heavy-embed'));
});

test('page diagram src files get their $ref levels loaded too', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(level('X')));
  fs.writeFileSync(path.join(dir, 'top.json'), JSON.stringify({ ...level('Top', { a: 'x' }), diagrams: { x: { $ref: 'x.json' } } }));
  const page = resolvePage({ kind: 'page', meta: { title: 'P' }, answer: { headline: 'H.' }, blocks: [{ type: 'diagram', src: 'top.json', level: 'x' }] }, dir);
  assert.equal(page.blocks[0].diagram.diagrams.x.meta.title, 'X');
  assert.deepEqual(codes(lint(page)), []);
});

test('CLI: $ref files, --level and --all-levels', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(level('X level')));
  const top = path.join(dir, 'top.json');
  fs.writeFileSync(top, JSON.stringify({ ...level('Top', { a: 'x' }), diagrams: { x: { $ref: './x.json' } } }));
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf-8' });
  assert.equal(run('validate', top).status, 0);
  run('export', top, '-f', 'svg', '--level', 'x', '-o', path.join(dir, 'x.svg'));
  assert.match(fs.readFileSync(path.join(dir, 'x.svg'), 'utf-8'), /X level/);
  run('export', top, '-f', 'md', '--all-levels', '-o', path.join(dir, 'all.md'));
  assert.match(fs.readFileSync(path.join(dir, 'all.md'), 'utf-8'), /^## Top › X level$/m);
  const bad = run('export', top, '-f', 'svg', '--level', 'nope', '-o', path.join(dir, 'n.svg'));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown level "nope"/);
  fs.writeFileSync(top, JSON.stringify({ ...level('Top', { a: 'x' }), diagrams: { x: { $ref: '../outside.json' } } }));
  const unsafe = run('validate', top, '--json');
  assert.equal(unsafe.status, 1);
  assert.equal(JSON.parse(unsafe.stdout).errors[0].code, 'drill/ref-unsafe', 'leaving the input folder is unsafe even when the file is missing');
});

test('MCP: $ref levels resolve inside the input root and level is a tool input', async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(level('X')));
  fs.writeFileSync(path.join(dir, 'top.json'), JSON.stringify({ ...level('Top', { a: 'x' }), diagrams: { x: { $ref: 'x.json' } } }));
  const s = startMcp({ cwd: dir, env: { YANTRA_INPUT_ROOT: dir, YANTRA_OUTPUT_ROOT: dir } });
  const send = s.send;
  send({ id: 1, method: 'tools/list' });
  send({ id: 2, method: 'tools/call', params: { name: 'yantra_validate', arguments: { filePath: 'top.json' } } });
  send({ id: 3, method: 'tools/call', params: { name: 'yantra_export', arguments: { filePath: 'top.json', format: 'md', allLevels: true } } });
  send({ id: 4, method: 'tools/call', params: { name: 'yantra_export', arguments: { filePath: 'top.json', format: 'svg', level: 'x' } } });
  let replies;
  try {
    replies = await s.waitFor(4);
  } finally {
    await s.close();
    removeDir(dir);
  }
  const text = (id) => replies.get(id).result.content[0].text;
  const tools = replies.get(1).result.tools;
  assert.ok(tools.find((t) => t.name === 'yantra_export').inputSchema.properties.level);
  assert.ok(tools.find((t) => t.name === 'yantra_screenshot').inputSchema.properties.level);
  assert.equal(JSON.parse(text(2)).valid, true, text(2));
  assert.match(JSON.parse(text(3)).content, /^## Top › X$/m);
  assert.match(JSON.parse(text(4)).content, /^<svg/);
});

test('mode overrides of data.drill are validated, followed and exported', () => {
  const p = {
    ...level('Root', { a: 'x' }),
    modes: [{ id: 'prod', name: 'Production' }, { id: 'local', name: 'Local' }],
    diagrams: { x: level('X'), y: level('Y local') }
  };
  p.nodes[0].data.modes = { local: { drill: 'y' } };
  p.nodes[1].data.modes = { prod: { drill: null } };
  assert.deepEqual(codes(lint(p)), [], 'y is reached through the local mode, so it is not unused');
  assert.deepEqual(levelOrder(p).map((l) => l.id), ['x', 'y']);
  assert.deepEqual(levelPath(p, ['y']), ['y']);
  const md = toMarkdown(p, { levels: true });
  assert.match(md, /\| \*\*A\*\* \(detail: X; Local: detail: Y local\) \|/);
  assert.match(md, /^## Root › Y local$/m);

  const bad = structuredClone(p);
  bad.nodes[0].data.modes = { local: { drill: 'nope' }, staging: { drill: 'x' }, prod: { drill: 3 } };
  const r = lint(bad);
  const msgs = r.errors.filter((e) => e.code === 'drill/unknown-target').map((e) => e.message);
  assert.ok(msgs.some((m) => /data\.modes\.local\.drill drills into "nope"/.test(m)), msgs.join(' / '));
  assert.ok(msgs.some((m) => /data\.modes\.prod\.drill must be a diagram id/.test(m)));
  assert.ok(r.warnings.some((w) => w.code === 'drill/unknown-mode' && /"staging"/.test(w.message)));
});

test('the dev server inlines $ref levels of imported examples, inside the project only', async () => {
  const config = (await import('../vite.config.js')).default;
  const plugin = config.plugins.find((x) => x.name === 'yantra-drill-refs');
  const watched = [];
  const run = (code, id) => plugin.transform.call({ addWatchFile: (f) => watched.push(f) }, code, id);
  const file = path.join(ROOT, 'examples', 'platform-overview.json');
  const out = JSON.parse(run(fs.readFileSync(file, 'utf-8'), `${file}?import`).code);
  assert.equal(out.diagrams.search.meta.title, 'Search service');
  assert.deepEqual(codes(lint(out)), []);
  assert.ok(watched.some((f) => f.endsWith('platform-search.json')), 'the level file is watched');
  // Outside the project, absolute or not JSON: left as a $ref with $error for lint
  const unsafe = JSON.parse(run(JSON.stringify({ ...level('R', { a: 'x', b: 'y' }), diagrams: { x: { $ref: '../../../outside.json' }, y: { $ref: '/etc/passwd.json' } } }), file).code);
  assert.equal(unsafe.diagrams.x.$error, 'unsafe');
  assert.equal(unsafe.diagrams.y.$error, 'unsafe');
  assert.equal(run('{"nodes": []}', file), null, 'files without refs are left to Vite');
  assert.equal(run('{"$ref": 1', path.join(ROOT, 'package.json')), null, 'invalid JSON is left to Vite');
});
