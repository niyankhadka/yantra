import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { lint } from '../src/core/lint.js';
import { STRING_KEYS } from '../src/core/i18n.js';
import { ROOT } from '../lib/build.js';
import { crc32, zip, skillFiles, gptFiles, PACK_EXAMPLES } from '../scripts/pack-chat.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const jsonBlocks = (text) => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
const shapeBlocks = (text) => [...text.matchAll(/```\n(\{[\s\S]*?)```/g)].map((m) => m[1]);

const PROMPT = read('chat/prompt.md');
const SKILL = read('chat/claude-skill/yantra/SKILL.md');
const GPT = read('chat/chatgpt/instructions.md');

for (const [name, text] of [['chat/prompt.md', PROMPT], ['chat/claude-skill/yantra/SKILL.md', SKILL]]) {
  test(`${name}: every JSON example is valid with no warnings`, () => {
    const blocks = jsonBlocks(text);
    assert.ok(blocks.length >= 2, 'has a diagram and a page example');
    for (const b of blocks) {
      const r = lint(JSON.parse(b));
      assert.deepEqual([...r.errors, ...r.warnings].map((f) => `${f.code} ${f.message}`), []);
    }
  });
}

test('the chat skill and the prompt describe the same shapes', () => {
  const shapes = shapeBlocks(PROMPT);
  assert.equal(shapes.length, 2, 'diagram and page shape');
  assert.deepEqual(shapeBlocks(SKILL), shapes);
});

test('Claude.ai skill: frontmatter name and description', () => {
  const m = /^---\nname: ([^\n]+)\ndescription: "([^"]+)"\n---\n/.exec(SKILL);
  assert.ok(m, 'frontmatter with name and a quoted description');
  assert.match(m[1], /^[a-z0-9-]{1,64}$/);
  assert.ok(m[2].length <= 1024, `description is ${m[2].length} characters`);
  // The portable (coding agent) skill keeps the same name
  assert.match(read('skills/yantra/SKILL.md'), /^---\nname: yantra\n/);
});

test('custom GPT instructions fit the 8000-character limit', () => {
  const n = [...GPT].length;
  assert.ok(n <= 8000, `instructions.md is ${n} characters`);
  for (const f of PACK_EXAMPLES) assert.ok(GPT.includes(`example-${f}.json`), `instructions name example-${f}.json`);
  assert.ok(read('chat/chatgpt/conversation-starters.md').trim().split('\n').length >= 3);
});

test('pack examples are self-contained and valid', () => {
  const files = { ...skillFiles(), ...gptFiles() };
  const examples = Object.entries(files).filter(([k]) => /examples?[/-].*\.json$/.test(k));
  assert.equal(examples.length, PACK_EXAMPLES.length * 2);
  for (const [name, data] of examples) {
    const text = data.toString('utf-8');
    assert.ok(!text.includes('"$ref"') && !/"src"\s*:\s*"[^"]*\.json"/.test(text), `${name} has no file references`);
    const r = lint(JSON.parse(text));
    assert.ok(r.valid && !r.warnings.length, `${name}: ${JSON.stringify([...r.errors, ...r.warnings])}`);
  }
});

test('zip: CRC-32 and a readable archive', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const files = { 'yantra/SKILL.md': Buffer.from('# hi\n'), 'yantra/a.json': Buffer.from('{"a":1}') };
  const buf = zip(files);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  assert.equal(buf.readUInt16LE(end + 10), 2);
  // Walk the local entries and inflate each one
  let at = 0;
  const seen = {};
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf-8');
    const data = zlib.inflateRawSync(buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size));
    assert.equal(crc32(data), buf.readUInt32LE(at + 14));
    seen[name] = data.toString('utf-8');
    at += 30 + nameLen + size;
  }
  assert.deepEqual(seen, { 'yantra/SKILL.md': '# hi\n', 'yantra/a.json': '{"a":1}' });
  assert.ok(Object.keys(skillFiles()).includes('yantra/SKILL.md'), 'SKILL.md sits in the skill folder');
});

test('playground strings exist in the string table, and it copies the chat prompt', () => {
  const html = read('playground/index.html');
  const main = read('playground/main.js');
  const keys = [
    ...[...html.matchAll(/data-i18n(?:-label|-tip|-placeholder)?="([^"]+)"/g)].map((m) => m[1]),
    ...[...main.matchAll(/\bL\.t\('([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1])
  ];
  assert.ok(keys.length > 20);
  for (const k of keys) assert.ok(STRING_KEYS.includes(k), k);
  assert.match(main, /from '\.\.\/chat\/prompt\.md\?raw'/);
  assert.match(main, /from '\.\.\/src\/core\/standalone\.js'/, 'built files are assembled by the shared core module');
});

test('the Pages workflow deploys the playground from main only and publishes nothing', () => {
  const yml = read('.github/workflows/pages.yml');
  assert.match(yml, /on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/);
  assert.ok(!/pull_request/.test(yml), 'never runs on pull requests');
  assert.ok(!/npm publish|stage publish|pypi|twine/i.test(yml), 'publishes no packages');
  assert.match(yml, /npm run build:playground/);
  assert.match(yml, /path: dist-pages/);
  assert.match(yml, /pages: write\n\s+id-token: write/);
  assert.match(yml, /needs: build/, 'deploys only what the build job uploaded');
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['build:playground'], /playground\/vite\.config\.js/);
  assert.match(read('playground/vite.config.js'), /YANTRA_PLAYGROUND_BASE \|\| '\/'/, 'served from the root of yantra.nbk.com.np');
});

test('docs quote the current size of the GPT instructions', () => {
  const n = [...GPT].length.toLocaleString('en-GB');
  assert.ok(read('docs/chat.md').includes(`(${n}\n   characters`) || read('docs/chat.md').includes(`(${n} characters`), `docs/chat.md states ${n} characters`);
});
