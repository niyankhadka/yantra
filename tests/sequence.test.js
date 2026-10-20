import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeSequenceScene, hasSequence, sceneForView } from '../src/core/sequence.js';
import { renderSvg } from '../src/core/svg.js';
import { lint } from '../src/core/lint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'yantra.js');
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));

const node = (id, type = 'service') => ({ id, type, data: { title: id.toUpperCase() } });
const edge = (id, source, target, extra = {}) => ({ id, source, target, label: `${source} to ${target}`, ...extra });
const steps = (...lists) => [{ id: 'main', name: 'Main', steps: lists.map((e, i) => ({ id: `s${i + 1}`, title: `Step ${i + 1}`, highlightEdges: e })) }];

test('participants are ordered by first appearance and messages follow the steps', () => {
  const p = {
    meta: { title: 'Order' },
    nodes: [node('db'), node('api'), node('user'), node('idle')],
    edges: [edge('a', 'user', 'api'), edge('b', 'api', 'db'), edge('c', 'db', 'api'), edge('d', 'api', 'user')],
    scenarios: steps(['a'], ['b', 'c'], ['d', 'a'])
  };
  const s = computeSequenceScene(p);
  assert.equal(s.kind, 'sequence');
  assert.deepEqual(s.participants.map((x) => x.id), ['user', 'api', 'db'], 'idle node is not a participant');
  assert.equal(s.messages.length, 5, 'one message per highlightEdges id, repeats included');
  assert.deepEqual(s.rows.map((r) => r.messages.length), [1, 2, 2]);
  // Arrows run source -> target and end exactly on the lifelines
  const cx = new Map(s.participants.map((x) => [x.id, x.cx]));
  for (const m of s.messages) {
    assert.equal(m.points[0].x, cx.get(m.source));
    assert.equal(m.points[m.points.length - 1].x, cx.get(m.target));
  }
  // Rows stack downwards without overlapping
  s.rows.slice(1).forEach((r, i) => assert.ok(r.y >= s.rows[i].y + s.rows[i].h));
  // Header x positions sit on the 10px grid
  s.participants.forEach((x) => assert.equal(x.x % 10, 0));

  const all = computeSequenceScene({ ...p, meta: { title: 'All', sequence: { allParticipants: true } } });
  assert.deepEqual(all.participants.map((x) => x.id), ['user', 'api', 'db', 'idle']);
});

test('a self-edge draws a loop that returns to its own lifeline', () => {
  const p = { meta: { title: 'Loop' }, nodes: [node('a'), node('b')], edges: [edge('ab', 'a', 'b'), edge('aa', 'a', 'a')], scenarios: steps(['ab', 'aa']) };
  const s = computeSequenceScene(p);
  const loop = s.messages.find((m) => m.edgeId === 'aa');
  assert.ok(loop.self);
  assert.equal(loop.points.length, 4);
  assert.equal(loop.points[0].x, loop.points[3].x);
  assert.ok(loop.points[1].x > loop.points[0].x);
  // The loop label clears the next lifeline
  const next = s.participants.find((x) => x.id === 'b');
  assert.ok(loop.label.x + loop.label.w / 2 < next.cx);
});

test('long labels widen the gap between lifelines instead of colliding', () => {
  const long = 'a very long message label that needs room';
  const p = { meta: { title: 'Wide' }, nodes: [node('a'), node('b')], edges: [edge('ab', 'a', 'b', { label: long })], scenarios: steps(['ab']) };
  const s = computeSequenceScene(p);
  const m = s.messages[0];
  assert.ok(m.label.x - m.label.w / 2 >= m.points[0].x && m.label.x + m.label.w / 2 <= m.points[1].x);
});

test('group members stay adjacent and get one box spanning their columns', () => {
  const p = {
    meta: { title: 'Groups' },
    nodes: [node('client'), node('api'), node('cache'), node('db')],
    edges: [edge('a', 'client', 'api'), edge('b', 'api', 'cache'), edge('c', 'client', 'db')],
    groups: [{ id: 'backend', title: 'Backend', nodes: ['api', 'db'] }],
    scenarios: steps(['a'], ['b'], ['c'])
  };
  const s = computeSequenceScene(p);
  // First appearance would give client, api, cache, db; the group pulls db next to api
  assert.deepEqual(s.participants.map((x) => x.id), ['client', 'api', 'db', 'cache']);
  const box = s.groups.find((g) => g.id === 'backend');
  const byId = new Map(s.participants.map((x) => [x.id, x]));
  assert.ok(box.x < byId.get('api').x && box.x + box.w > byId.get('db').x + byId.get('db').w);
  assert.ok(box.x + box.w < byId.get('cache').x, 'non-members stay outside the box');
  assert.ok(box.y < byId.get('api').y && box.y + box.h >= s.lifeline.y2);

  const aws = computeSequenceScene(example('aws-serverless'));
  for (const g of aws.groups) {
    const cols = aws.participants.filter((x) => g.members.includes(x.id)).map((x) => x.index);
    assert.equal(Math.max(...cols) - Math.min(...cols) + 1, cols.length, `group ${g.id} members are adjacent`);
  }
});

test('sequence scenes render to SVG and through the CLI', () => {
  const p = example('oauth-login');
  assert.ok(hasSequence(p));
  const scene = sceneForView(p);
  assert.equal(scene.kind, 'sequence', 'meta.view picks the sequence');
  assert.equal(sceneForView(p, { view: 'flow' }).kind, undefined);
  const svg = renderSvg(scene, { theme: 'dark', step: 4 });
  assert.match(svg, /^<svg[^>]+viewBox/);
  assert.equal((svg.match(/stroke-dasharray="4 4"/g) || []).length, scene.participants.length, 'one lifeline per participant');
  assert.ok(svg.includes('POST /token + verifier'));

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-seq-')), 'c.svg');
  const res = spawnSync(process.execPath, [CLI, 'export', path.join(ROOT, 'examples', 'cloud-architecture.json'), '-f', 'svg', '--view', 'sequence', '--step', '3', '-o', out], { encoding: 'utf-8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(fs.readFileSync(out, 'utf-8'), /stroke-dasharray="4 4"/);
});

test('lint warns when the sequence view has nothing to show and rejects unknown views', () => {
  const base = { meta: { title: 'Quiet', view: 'sequence' }, nodes: [node('a'), node('b')], edges: [edge('ab', 'a', 'b')], scenarios: [{ id: 'm', steps: [{ title: 'Look', highlightNodes: ['a'] }] }] };
  assert.ok(lint(base).warnings.some((w) => w.code === 'sequence/no-messages'));
  assert.equal(sceneForView(base).kind, undefined, 'falls back to the flow view');
  const ok = lint({ ...base, scenarios: steps(['ab']) });
  assert.ok(!ok.warnings.some((w) => w.code.startsWith('sequence/')));
  assert.ok(lint({ ...base, meta: { title: 'X', view: 'timeline' } }).errors.some((e) => e.code === 'schema/unknown-view'));
});
