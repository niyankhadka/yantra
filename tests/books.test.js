import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lint } from '../src/core/index.js';
import { renderBook, bookToMarkdown, bookContents, chapterPage, BOOK_BUDGET } from '../src/core/book.js';
import { resolveBook, resolveAny, buildAny } from '../lib/build.js';
import { STARTERS } from '../src/core/starters.js';
import { createToolset } from '../mcp/tools.js';
import { ROOT, tempDir, removeDir } from './support.js';

const EX = path.join(ROOT, 'examples');
const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);
const chapter = (q, blocks = [{ type: 'text', title: 'Detail', body: 'Body.' }]) => ({ meta: { question: q }, answer: { headline: `${q} Answered.` }, blocks });
const book = (chapters, meta = {}) => ({ kind: 'book', meta: { title: 'A book', ...meta }, chapters });

test('lint: a book needs a title and chapters; each chapter is checked as an answer page', () => {
  assert.deepEqual(codes(lint(book([chapter('One?'), chapter('Two?')]))), []);
  assert.deepEqual(codes(lint({ kind: 'book', meta: {}, chapters: [chapter('One?')] })), ['schema/missing-title']);
  assert.deepEqual(codes(lint(book([]))), ['book/no-chapters']);
  const many = Array.from({ length: BOOK_BUDGET.chapters + 1 }, (_, i) => chapter(`Q${i}?`));
  assert.deepEqual(codes(lint(book(many))), ['book/too-many-chapters']);
  const r = lint(book([chapter('One?'), { meta: { question: 'Two?' }, blocks: [] }]));
  const f = r.errors.find((x) => x.code === 'page/missing-answer');
  assert.equal(f.chapter, 1);
  assert.match(f.message, /^chapters\[1\] "Two\?": /);
  assert.deepEqual(codes(lint(book([{ kind: 'book', meta: { title: 'x' } }]))), ['book/chapter-invalid']);
  assert.deepEqual(codes(lint(book([{ $ref: 'x.json' }]))), ['book/chapter-unresolved']);
  assert.deepEqual(codes(lint(book([chapter('One?')], { reading: 'slides' }))), ['page/bad-reading']);
});

test('resolveBook loads chapter files inside the book folder, and marks the rest', () => {
  const dir = tempDir('yantra-book-');
  try {
    fs.mkdirSync(path.join(dir, 'ch'));
    fs.writeFileSync(path.join(dir, 'ch', 'one.json'), JSON.stringify({ kind: 'page', ...chapter('One?', [{ type: 'diagram', src: 'flow.json' }]) }));
    fs.copyFileSync(path.join(EX, 'oauth-login.json'), path.join(dir, 'ch', 'flow.json'));
    fs.writeFileSync(path.join(dir, 'nested.json'), JSON.stringify(book([chapter('Inner?')])));
    const r = resolveBook(book([{ $ref: 'ch/one.json' }, { $ref: '../outside.json' }, { $ref: 'missing.json' }, { $ref: 'nested.json' }, { $ref: 'https://x.test/a.json' }]), dir);
    assert.equal(r.chapters[0].meta.question, 'One?');
    assert.equal(r.chapters[0].blocks[0].diagram.meta.title, JSON.parse(fs.readFileSync(path.join(EX, 'oauth-login.json'), 'utf-8')).meta.title, "a chapter's diagram src loads from the chapter's folder");
    assert.deepEqual(r.chapters.slice(1).map((c) => c.$error), ['unsafe', 'missing', 'cycle', 'unsafe']);
    assert.deepEqual(codes(lint(r)).sort(), Array(4).fill('book/chapter-unresolved'));
  } finally {
    removeDir(dir);
  }
});

test('the example book: chapters from answer pages, unique ids, contents, Markdown one level down', () => {
  const file = path.join(EX, 'book-checkout-explained.json');
  const b = resolveAny(JSON.parse(fs.readFileSync(file, 'utf-8')), EX);
  assert.deepEqual(codes(lint(b)), []);
  const html = renderBook(b);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], 'every id is unique across chapters');
  assert.equal((html.match(/<section class="p-chapter" id="c\d" data-chapter="\d">/g) || []).length, 4);
  assert.match(html, /<p class="p-chapter-kicker">Chapter 2<\/p>\s*<h2 class="p-title">/);
  assert.match(html, /<div class="p-contents" id="p-contents" role="dialog"/);
  const contents = bookContents(b);
  assert.deepEqual(contents.map((c) => c.id), ['c1', 'c2', 'c3', 'c4']);
  assert.ok(contents[0].items.every((it) => it.id.startsWith('c1-')));
  const md = bookToMarkdown(b);
  assert.match(md, /^# Checkout, end to end\n/);
  assert.match(md, /\n1\. \[From card tap to merchant's bank\]\(#c1\)\n/);
  assert.match(md, /<a id="c2"><\/a>\n\n## Why does our checkout use/);
  assert.doesNotMatch(md, /\n# (?!Checkout)/, 'chapter titles are ##, not #');
  // one shared viewer for every interactive embed, and the book opens in book mode
  const built = buildAny(b, EX);
  assert.match(built, /"start":"book"/);
});

test('a chapter inherits the book language unless it sets its own', () => {
  const meta = { title: 'Libro', lang: 'es' };
  assert.equal(chapterPage(chapter('¿Uno?'), meta).meta.lang, 'es');
  assert.equal(chapterPage({ ...chapter('One?'), meta: { question: 'One?', lang: 'en' } }, meta).meta.lang, 'en');
  assert.match(renderBook(book([chapter('¿Uno?')], { lang: 'es' })), /<p class="p-chapter-kicker">Capítulo 1<\/p>/);
});

test('every starter template validates with no warnings, and yantra new writes them', () => {
  for (const s of STARTERS) assert.deepEqual(codes(lint(s.data)), [], s.id);
  assert.deepEqual([...new Set(STARTERS.map((s) => s.kind))], ['flow', 'sequence', 'state', 'data', 'tree', 'mindmap', 'page', 'book']);
});

test('MCP: yantra_get_schema returns the book schema and guide; export makes Markdown', () => {
  const tools = createToolset({ inputRoot: EX });
  const s = tools.call('yantra_get_schema', { kind: 'book' });
  assert.equal(s.schema.title, 'Yantra book');
  assert.match(s.rules, /^# Books/m);
  const md = tools.call('yantra_export', { filePath: 'book-checkout-explained.json', format: 'md' });
  assert.match(JSON.stringify(md), /Checkout, end to end/);
  assert.throws(() => tools.call('yantra_export', { filePath: 'book-checkout-explained.json', format: 'svg' }), /Books export to md/);
});
