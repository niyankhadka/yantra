#!/usr/bin/env node
/**
 * Chat packs (written to dist-chat/, which is not committed):
 *   node scripts/pack-chat.js skill   -> dist-chat/yantra-skill.zip   (Claude.ai: Settings > Capabilities > Skills, upload)
 *   node scripts/pack-chat.js gpt     -> dist-chat/yantra-gpt/        (ChatGPT custom GPT: instructions, starters, knowledge files)
 *   node scripts/pack-chat.js         -> both
 * Sources: chat/claude-skill/yantra/SKILL.md, chat/chatgpt/*, chat/prompt.md, the
 * schemas and a few examples (with their file references inlined). No dependencies: the zip is written by hand (stored
 * names, deflated data, CRC-32).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolveAny } from '../lib/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-chat');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel));

/** Examples shipped with both packs (diagram kinds plus a page and a chart page). */
export const PACK_EXAMPLES = ['oauth-login', 'aws-serverless', 'ticket-lifecycle', 'ecommerce-schema', 'org-chart', 'answer-checkout-saga', 'chart-sales-dashboard'];
const SCHEMAS = ['yantra-payload.schema.json', 'yantra-page.schema.json'];

/** An example with its page `src` / drill-down `$ref` files inlined: a chat has no folder to read them from. */
function example(name) {
  const dir = path.join(ROOT, 'examples');
  const payload = resolveAny(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf-8')), dir);
  for (const b of payload.blocks || []) if (b?.type === 'diagram' && b.diagram) delete b.src;
  return Buffer.from(`${JSON.stringify(payload, null, 2)}
`);
}

/** Files of the Claude.ai skill: path inside the zip -> bytes. */
export function skillFiles() {
  const files = { 'yantra/SKILL.md': read('chat/claude-skill/yantra/SKILL.md') };
  for (const s of SCHEMAS) files[`yantra/reference/${s}`] = read(`schemas/${s}`);
  for (const e of PACK_EXAMPLES) files[`yantra/examples/${e}.json`] = example(e);
  return files;
}

/** Files of the custom GPT pack: relative path -> bytes. */
export function gptFiles() {
  const files = {
    'instructions.md': read('chat/chatgpt/instructions.md'),
    'conversation-starters.md': read('chat/chatgpt/conversation-starters.md'),
    'knowledge/authoring-guide.md': Buffer.from(`# Yantra authoring guide (short)\n\nThe same rules as the copyable chat prompt; the schemas next to this file are the full reference.\n\n${read('chat/prompt.md').toString('utf-8')}`)
  };
  for (const s of SCHEMAS) files[`knowledge/${s}`] = read(`schemas/${s}`);
  for (const e of PACK_EXAMPLES) files[`knowledge/example-${e}.json`] = example(e);
  return files;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive (deflate) of { name: bytes }, with a fixed timestamp so builds are reproducible. */
export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const time = 0; // 00:00:00
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1; // 01/01/2026
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function writeSkill() {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'yantra-skill.zip');
  const data = zip(skillFiles());
  fs.writeFileSync(file, data);
  console.error(`✓ ${path.relative(ROOT, file)} (${(data.length / 1024).toFixed(1)} kB)`);
}

function writeGpt() {
  const dir = path.join(OUT, 'yantra-gpt');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, data] of Object.entries(gptFiles())) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  const chars = [...read('chat/chatgpt/instructions.md').toString('utf-8')].length;
  console.error(`✓ ${path.relative(ROOT, dir)}/ (instructions: ${chars} characters; paste instructions.md into Instructions, upload knowledge/*)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const what = process.argv[2] || 'all';
  if (!['skill', 'gpt', 'all'].includes(what)) {
    console.error('Usage: node scripts/pack-chat.js [skill|gpt|all]');
    process.exit(1);
  }
  if (what !== 'gpt') writeSkill();
  if (what !== 'skill') writeGpt();
}
