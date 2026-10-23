// Detail pages: a page's `details` map, opened from blocks with "detail": validator, HTML and Markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintPage, lintBook } from '../src/core/lint.js';
import { renderPage, pageToMarkdown } from '../src/core/page.js';
import { renderBook } from '../src/core/book.js';
import { detailTree, detailTrail } from '../src/core/details.js';

const page = (extra = {}) => ({
  kind: 'page',
  meta: { title: 'Incident' },
  answer: { headline: 'A certificate expired.' },
  blocks: [{ type: 'text', title: 'Cause', body: 'The renewal failed.', detail: 'renewal' }],
  details: {
    renewal: { meta: { title: 'Renewal' }, answer: { headline: 'The job lost access.' }, blocks: [{ type: 'text', body: 'Quietly.', detail: 'alerting' }] },
    alerting: { meta: { title: 'Alerting' }, answer: { headline: 'The alert waited.' } }
  },
  ...extra
});

const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);

test('details: reachable breadth first, with parents and trails', () => {
  const tree = detailTree(page());
  assert.deepEqual(tree.map((d) => [d.id, d.parent]), [['renewal', null], ['alerting', 'renewal']]);
  assert.deepEqual(detailTrail(tree, 'alerting'), ['renewal', 'alerting']);
});

test('details: a valid page passes; bad links, unused and nested details are reported', () => {
  assert.deepEqual(codes(lintPage(page())), []);
  const bad = page();
  bad.blocks[0].detail = 'missing';
  assert.ok(codes(lintPage(bad)).includes('page/detail-unknown'));
  assert.ok(codes(lintPage(bad)).includes('page/detail-unused'));
  const nested = page();
  nested.details.alerting.details = {};
  assert.ok(codes(lintPage(nested)).includes('page/nested-details'));
  const notPage = page();
  notPage.details.alerting = 'text';
  assert.ok(codes(lintPage(notPage)).includes('page/detail-invalid'));
  const unresolved = page();
  unresolved.details.alerting = { $ref: 'alerting.json' };
  assert.ok(codes(lintPage(unresolved)).includes('page/detail-unresolved'));
});

test('details: a detail is checked like a page, its findings prefixed', () => {
  const p = page();
  delete p.details.alerting.answer;
  const r = lintPage(p);
  assert.ok(r.errors.some((f) => f.code === 'page/missing-answer' && f.message.startsWith('details.alerting:')));
});

test('details: the HTML links each block to a hidden detail section with a back bar and path', () => {
  const html = renderPage(page());
  assert.match(html, /<div class="p-main">/);
  assert.match(html, /href="#detail=renewal" data-detail-link="renewal">Read more: <strong>Renewal<\/strong>/);
  assert.match(html, /<section class="p-detail" data-detail="alerting" data-parent="renewal" hidden>/);
  assert.match(html, /data-detail-back aria-label="Back to Renewal \(Esc\)"/);
  assert.match(html, /<li><span aria-current="page">Alerting<\/span><\/li>/);
  assert.match(html, /DETAIL|data-detail-open/);
  // a page without details gets neither the sections nor the script
  const plain = page({ details: undefined });
  plain.blocks[0] = { type: 'text', body: 'x' };
  assert.doesNotMatch(renderPage(plain), /p-detail"|data-detail-open/);
});

test('details: the Markdown export links to the details, appended one level down', () => {
  const md = pageToMarkdown(page());
  assert.match(md, /→ Read more: \[Renewal\]\(#detail-renewal\)/);
  assert.match(md, /<a id="detail-renewal"><\/a>\n\n\*Detail\*\n\n(<a id="d1"><\/a>\n\n)?## Renewal/);
  assert.ok(md.indexOf('## Renewal') < md.indexOf('## Alerting'));
});

test('details: book chapters keep their own details, keyed by chapter', () => {
  const book = { kind: 'book', meta: { title: 'Handbook' }, chapters: [page(), page()] };
  assert.deepEqual(codes(lintBook(book)), []);
  const html = renderBook(book);
  assert.match(html, /data-detail="c1-renewal"/);
  assert.match(html, /data-detail="c2-alerting" data-parent="c2-renewal"/);
  assert.match(html, /href="#c2" data-detail-home/);
});
