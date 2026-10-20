import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '../src/core/index.js';
import { renderPage, renderBlock, pageToMarkdown, blockAnchors, slug, srcdocAttr, isSafeImageSrc } from '../src/core/page.js';
import { resolvePage } from '../lib/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EX = path.join(ROOT, 'examples');
const loadPage = (f) => resolvePage(JSON.parse(fs.readFileSync(path.join(EX, f), 'utf-8')), EX);
const page = (blocks, meta = {}) => ({ kind: 'page', meta: { question: 'Q?', ...meta }, answer: { headline: 'A.' }, blocks });
const codes = (r) => [...r.errors, ...r.warnings].map((f) => f.code);

test('timeline renders dates as written, tones and markdown text', () => {
  const html = renderBlock({ type: 'timeline', items: [{ date: '14/10/2026', title: 'Alert <fires>', text: '**paged**', tone: 'bad' }] });
  assert.match(html, /<ol class="p-timeline"><li data-hue="rose"><span class="p-date">14\/10\/2026<\/span>/);
  assert.match(html, /Alert &lt;fires&gt;/);
  assert.match(html, /<strong>paged<\/strong>/);
});

test('faq uses native details/summary and opens every answer for print', () => {
  const html = renderBlock({ type: 'faq', items: [{ q: 'Why?', a: 'Because.' }, { q: 'How?', a: '- one\n- two' }] });
  assert.equal(html.match(/<details><summary>/g).length, 2);
  assert.match(html, /<ul><li>one<\/li>/);
  assert.match(renderPage(page([{ type: 'faq', items: [{ q: 'a', a: 'b' }] }])), /beforeprint[^\n]*\.p-faq details[^\n]*d\.open=true/);
});

test('checklist marks done and open items, with screen-reader text', () => {
  const html = renderBlock({ type: 'checklist', items: [{ text: 'Ship', done: true, note: 'Done 14/10/2026' }, { text: 'Test' }] });
  assert.match(html, /<li class="is-done">.*Done: <\/span>Ship<em>Done 14\/10\/2026<\/em>/);
  assert.match(html, /<li class="is-open">.*To do: <\/span>Test/);
});

test('quote, kv and image render', () => {
  assert.match(renderBlock({ type: 'quote', text: 'Pick joins.', by: 'Lead', source: 'Review' }), /<blockquote><p>Pick joins\.<\/p><\/blockquote><figcaption>Lead, <cite>Review<\/cite><\/figcaption>/);
  assert.match(renderBlock({ type: 'kv', items: [{ k: 'Owner', v: 'Platform' }, { k: 'Count', v: 3 }] }), /<dl class="p-kv"><div><dt>Owner<\/dt><dd>Platform<\/dd><\/div><div><dt>Count<\/dt><dd>3<\/dd>/);
  const img = renderBlock({ type: 'image', src: 'https://example.com/a.png', alt: 'A "chart"', width: 400, caption: 'Fig' });
  assert.match(img, /<img src="https:\/\/example\.com\/a\.png" alt="A &quot;chart&quot;" style="max-width:min\(100%,400px\)">/);
});

test('image URLs are allow-listed: javascript:, http: and non-image data: are rejected', () => {
  assert.ok(isSafeImageSrc('https://example.com/x.png'));
  assert.ok(isSafeImageSrc('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(isSafeImageSrc('data:image/svg+xml,%3Csvg%3E'));
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'http://example.com/x.png', 'data:text/html,<script>', 'file:///etc/passwd', 'https://x.com/a" onerror="x', ''])
    assert.ok(!isSafeImageSrc(bad), bad);
  const html = renderBlock({ type: 'image', src: 'javascript:alert(1)', alt: 'x' });
  assert.doesNotMatch(html, /<img|javascript:/);
  const r = lint(page([{ type: 'image', src: 'javascript:alert(1)' }]));
  assert.ok(codes(r).includes('page/image-src'));
  assert.ok(codes(r).includes('page/image-alt'));
  assert.deepEqual(codes(lint(page([{ type: 'image', src: 'https://example.com/a.png', alt: 'Chart' }]))), []);
});

test('new blocks report page/block-invalid with the expected shape', () => {
  const bad = [
    { type: 'timeline', items: [{ title: 'no date' }] },
    { type: 'faq', items: [{ q: 'no answer' }] },
    { type: 'checklist', items: [{ done: true }] },
    { type: 'quote' },
    { type: 'image' },
    { type: 'kv', items: [{ k: 'no value' }] }
  ];
  const r = lint(page(bad));
  assert.equal(r.errors.filter((f) => f.code === 'page/block-invalid').length, bad.length);
  assert.match(r.errors[0].message, /date, title/);
});

test('page/heavy-embed warns above two interactive diagrams', () => {
  const d = loadPage('answer-how-to-choose-database.json').blocks.find((b) => b.type === 'diagram').diagram;
  const live = { type: 'diagram', diagram: d, interactive: true };
  assert.ok(!codes(lint(page([live, live]))).includes('page/heavy-embed'));
  const r = lint(page([live, live, live]));
  assert.ok(r.valid);
  assert.ok(r.warnings.some((f) => f.code === 'page/heavy-embed'));
  assert.ok(codes(lint(page([{ ...live, height: 50 }]))).includes('page/bad-height'));
});

test('anchors are stable slugs, de-duplicated; contents shown on request or from 6 titled blocks', () => {
  assert.equal(slug('Follow-up actions!'), 'follow-up-actions');
  assert.equal(slug('Café & Crème'), 'cafe-creme');
  assert.equal(slug('***'), 'section');
  assert.deepEqual(blockAnchors([{ title: 'Risks' }, {}, { title: 'Risks' }, { title: 'Risks 2' }, { title: 'risks' }]), ['risks', null, 'risks-2', 'risks-2-2', 'risks-3']);

  const t = (title) => ({ type: 'text', title, body: 'x' });
  const five = [t('A'), t('B'), t('C'), t('D'), t('E')];
  assert.doesNotMatch(renderPage(page(five)), /class="p-toc"/);
  const forced = renderPage(page(five, { toc: true }));
  assert.match(forced, /<nav class="p-toc" aria-label="Contents">/);
  assert.match(forced, /<a href="#a">A<\/a>/);
  assert.match(forced, /<section class="p-block p-block--text" id="a">/);
  assert.match(renderPage(page([...five, t('A')])), /href="#a-2"/);
  assert.doesNotMatch(renderPage(page([...five, t('F')], { toc: false })), /class="p-toc"/);
});

test('byline shows meta.updated', () => {
  assert.match(renderPage(page([], { author: 'Ops', date: '16/10/2026', updated: '20/10/2026' })), /Ops · 16\/10\/2026 · Updated 20\/10\/2026/);
});

test('interactive diagram embeds the viewer as an escaped, sandboxed srcdoc with a static print fallback', () => {
  const d = loadPage('answer-how-to-choose-database.json').blocks.find((b) => b.type === 'diagram').diagram;
  const block = { type: 'diagram', title: 'Flow', diagram: d, interactive: true, height: 480 };
  const nasty = '<!DOCTYPE html><html><head><title>Tom & "Jerry"</title></head><body><script>var s="</script>";</script></body></html>';
  let got;
  const html = renderPage(page([block]), { viewerHtml: (dg, b) => ((got = [dg, b]), nasty) });
  assert.equal(got[0], d);
  const m = /<iframe class="p-frame"[^>]*sandbox="allow-scripts allow-popups" style="height:480px" srcdoc="([^"]*)"><\/iframe>/.exec(html);
  assert.ok(m, 'iframe with srcdoc');
  assert.equal(m[1], srcdocAttr(nasty));
  assert.doesNotMatch(m[1], /"|&(?!amp;|quot;)/);
  assert.equal(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'), nasty);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.match(html, /class="p-print-only"><figure class="p-figure">/);
  assert.match(html, /\.p-screen-only,\.p-toc\{display:none!important\}/);

  // Without a viewer builder (pure render) or without the flag, the figure stays static
  assert.doesNotMatch(renderPage(page([block])), /<iframe/);
  assert.doesNotMatch(renderPage(page([{ ...block, interactive: false }]), { viewerHtml: () => nasty }), /<iframe/);
});

test('markdown export covers the new blocks', () => {
  const out = pageToMarkdown(
    page([
      { type: 'timeline', title: 'When', items: [{ date: '14/10/2026', title: 'Expired', text: 'TLS' }] },
      { type: 'faq', items: [{ q: 'Why?', a: 'Because.' }] },
      { type: 'checklist', items: [{ text: 'Ship', done: true }, { text: 'Test', note: 'Fri' }] },
      { type: 'quote', text: 'Joins.', by: 'Lead', source: 'Review' },
      { type: 'image', src: 'https://example.com/a.png', alt: 'Chart', caption: 'Fig 1' },
      { type: 'image', src: 'javascript:alert(1)', alt: 'Bad' },
      { type: 'kv', items: [{ k: 'Owner', v: 'Ops' }] }
    ])
  );
  assert.match(out, /## When\n\n- \*\*14\/10\/2026\*\* - Expired: TLS/);
  assert.match(out, /\*\*Why\?\*\*\n\nBecause\./);
  assert.match(out, /- \[x\] Ship\n- \[ \] Test \(Fri\)/);
  assert.match(out, /> Joins\.\n>\n> - Lead, \*Review\*/);
  assert.match(out, /!\[Chart\]\(https:\/\/example\.com\/a\.png\)\n\*Fig 1\*/);
  assert.doesNotMatch(out, /javascript:/);
  assert.match(out, /- \*\*Owner:\*\* Ops/);
});

test('new page examples validate with zero errors and warnings', () => {
  for (const f of ['answer-incident-review.json', 'answer-how-to-choose-database.json', 'answer-quarterly-review.json', 'answer-launch-plan.json']) {
    const r = lint(loadPage(f));
    assert.deepEqual([...r.errors, ...r.warnings], [], f);
  }
});
