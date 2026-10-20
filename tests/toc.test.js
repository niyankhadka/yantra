// Contents row on answer pages: anchors, markup, Markdown export, and (in a real headless
// browser, skipped when none is installed) clicking a link in a built page and in a page
// framed the way the viewer's gallery frames it (srcdoc).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderPage, pageToMarkdown, pageContents, blockAnchors, slug, srcdocAttr } from '../src/core/page.js';
import { findBrowser } from '../lib/browser.js';
import { buildAny, resolveAny, ROOT } from '../lib/build.js';
import { startBrowser, tempDir, removeDir } from './support.js';

const page = (blocks, meta = {}) => ({ kind: 'page', meta: { question: 'Q?', ...meta }, answer: { headline: 'A.' }, blocks });
const t = (title, extra = {}) => ({ type: 'text', title, body: 'x', ...extra });

test('slugs keep non-Latin titles readable and unique; Latin anchors are unchanged', () => {
  assert.equal(slug('Follow-up actions!'), 'follow-up-actions');
  assert.equal(slug('Café & Crème'), 'cafe-creme');
  assert.equal(slug('مسار الطلب'), 'مسار-الطلب');
  assert.equal(slug('概要と背景'), '概要と背景');
  assert.equal(slug('परिचय और सारांश'), 'परिचय-और-सारांश', 'Devanagari keeps its vowel signs');
  assert.equal(slug('개요'), '개요', 'Hangul stays composed');
  assert.equal(slug('—'), 'section');
  assert.ok(Array.from(slug('長'.repeat(80))).length <= 60, 'long titles are cut by characters, not code units');
  assert.deepEqual(blockAnchors([{ title: 'البدائل' }, { title: 'البدائل' }, { title: 'أسباب' }]), ['البدائل', 'البدائل-2', 'أسباب']);
  assert.deepEqual(blockAnchors([{ title: '***' }, { title: '!!!' }]), ['section', 'section-2']);
});

test('contents: threshold, meta.toc, untitled and unknown blocks', () => {
  const five = ['A', 'B', 'C', 'D', 'E'].map((x) => t(x));
  assert.equal(pageContents(page(five)).items.length, 0);
  assert.equal(pageContents(page([...five, t('F')])).items.length, 6);
  assert.equal(pageContents(page([...five, t('F')], { toc: false })).items.length, 0);
  assert.equal(pageContents(page([t('A')], { toc: true })).items.length, 1);
  assert.equal(pageContents(page([{ type: 'text', body: 'x' }], { toc: true })).items.length, 0, 'no titled block, no contents');
  // An unknown block type renders nothing, so it gets no link (but still reserves its slug)
  const odd = pageContents(page([t('A'), { type: 'nope', title: 'A' }, t('A')], { toc: true }));
  assert.deepEqual(odd.items.map((i) => i.id), ['a', 'a-3']);
  assert.deepEqual(odd.anchors, ['a', 'a-2', 'a-3']);
});

test('contents markup: tooltips with the full title, a hidden duplicate label, half blocks keep anchors', () => {
  const long = 'A very long section title that will certainly not fit inside one contents chip';
  const html = renderPage(page([t(long), t('**Bold** and `code`', { span: 'half' }), t('Risks', { span: 'half' })], { toc: true }));
  assert.match(html, /<nav class="p-toc" aria-label="Contents"><span class="p-label" aria-hidden="true">Contents<\/span><ol>/);
  assert.match(html, new RegExp(`<a href="#a-very-long-section-title[^"]*" title="${long}">`));
  assert.match(html, /<a href="#bold-and-code" title="Bold and code"><strong>Bold<\/strong> and <code>code<\/code><\/a>/);
  assert.match(html, /<section class="p-block p-block--text is-half" id="risks">/);
  // Chips truncate with an ellipsis; sections clear a sticky row; print leaves the row out
  assert.match(html, /\.p-toc a\{[^}]*text-overflow:ellipsis/);
  assert.match(html, /scroll-margin-top:calc\(var\(--p-toc-h,0px\) \+ 16px\)/);
  assert.match(html, /\.p-screen-only,\.p-toc\{display:none!important\}/);
  // The script scrolls in place (never navigates a srcdoc frame) and marks the active chip
  assert.match(html, /aria-current/);
  assert.match(html, /IntersectionObserver/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /\/\^\(https\?\|file\):\$\/\.test\(location\.protocol\)/);
  // RTL pages get Unicode anchors that match their links
  const ar = renderPage(page([t('مسار الطلب'), t('البدائل')], { toc: true, lang: 'ar' }));
  assert.match(ar, /<html lang="ar" dir="rtl">/);
  assert.match(ar, /<a href="#مسار-الطلب" title="مسار الطلب">/);
  assert.match(ar, /id="مسار-الطلب"/);
  assert.match(ar, /aria-label="المحتويات"/);
});

test('Markdown export lists the contents with anchors that match the HTML page', () => {
  const p = page([...['Impact', 'What happened', 'Impact'].map((x) => t(x)), t('Follow-up actions')], { toc: true });
  const md = pageToMarkdown(p);
  assert.match(md, /\*\*Contents\*\*\n\n- \[Impact\]\(#impact\)\n- \[What happened\]\(#what-happened\)\n- \[Impact\]\(#impact-2\)\n- \[Follow-up actions\]\(#follow-up-actions\)\n/);
  assert.match(md, /<a id="impact-2"><\/a>\n\n## Impact/);
  const html = renderPage(p);
  for (const id of ['impact', 'what-happened', 'impact-2', 'follow-up-actions']) assert.match(html, new RegExp(`id="${id}"`));
  // Without contents the Markdown stays as it was
  const plain = pageToMarkdown(page([t('Impact')]));
  assert.doesNotMatch(plain, /Contents|<a id=/);
  assert.match(plain, /## Impact/);
});

// --- In a real browser ---------------------------------------------------------------

const executable = findBrowser();
const skip = executable ? false : 'no Chrome, Edge or Chromium found (set YANTRA_BROWSER to run the browser tests)';
let browser = null;
let dir = null;
// The viewer's gallery frame (src/app/main.js GALLERY_SANDBOX)
const GALLERY_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';

before(async () => {
  if (skip) return;
  dir = tempDir('yantra-toc-');
  browser = await startBrowser(executable);
});

after(async () => {
  if (browser) await browser.close();
  if (dir) removeDir(dir);
});

function built(name) {
  const file = path.join(ROOT, 'examples', `${name}.json`);
  return buildAny(resolveAny(JSON.parse(fs.readFileSync(file, 'utf-8')), path.dirname(file)), path.dirname(file));
}

/** Click the n-th contents link in `doc` (an expression) and report where the page ended up. */
async function clickChip(tab, doc, win, n) {
  return tab.eval(`(() => {
    const d = ${doc}, w = ${win}, a = d.querySelectorAll('.p-toc a')[${n}], id = a.getAttribute('href').slice(1);
    a.click();
    const sec = d.getElementById(id), toc = d.querySelector('.p-toc');
    return { id, scrollY: w.scrollY, top: sec.getBoundingClientRect().top, tocBottom: toc.getBoundingClientRect().bottom,
      sticky: toc.classList.contains('is-sticky'), current: d.querySelector('.p-toc a[aria-current="true"]')?.getAttribute('href'),
      focused: d.activeElement === sec.querySelector('h3'), url: w.location.href };
  })()`);
}

test('built page: a contents link scrolls below the sticky row, focuses the heading and updates the hash', { skip }, async () => {
  const out = path.join(dir, 'incident.html');
  fs.writeFileSync(out, built('answer-incident-review'));
  const tab = await browser.open(pathToFileURL(out).href);
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await tab.waitFor('location.protocol === "file:" && document.readyState === "complete"');
  assert.equal(await tab.eval('document.querySelectorAll(".p-toc a[aria-current]").length'), 0, 'nothing is active above the first section');
  const r = await clickChip(tab, 'document', 'window', 2);
  assert.ok(r.scrollY > 200, `scrolled (${r.scrollY})`);
  assert.equal(r.sticky, true, 'the row sticks on a wide screen');
  assert.ok(r.top >= r.tocBottom - 1 && r.top <= r.tocBottom + 40, `section starts just below the row (${r.top} vs ${r.tocBottom})`);
  assert.equal(r.current, `#${r.id}`);
  assert.equal(r.focused, true, 'focus moves to the section heading');
  assert.ok(r.url.endsWith(`#${r.id}`), r.url);
  // Scrolling to the end moves the highlight to the last section
  await tab.eval('dispatchEvent(new WheelEvent("wheel")); scrollTo(0, document.documentElement.scrollHeight)');
  await tab.waitFor('document.querySelector(".p-toc a[aria-current]") === [...document.querySelectorAll(".p-toc a")].pop()');
  // Back to the top: nothing is active again
  await tab.eval('scrollTo(0, 0)');
  await tab.waitFor('!document.querySelector(".p-toc a[aria-current]")');
});

test('gallery frame (srcdoc): a contents link scrolls inside the frame and never navigates it', { skip }, async () => {
  const host = path.join(dir, 'host.html');
  fs.writeFileSync(host, `<!DOCTYPE html><html><body style="margin:0"><iframe id="page-frame" sandbox="${GALLERY_SANDBOX}" style="border:0;width:100%;height:800px" srcdoc="${srcdocAttr(built('answer-how-to-choose-database'))}"></iframe></body></html>`);
  const tab = await browser.open(pathToFileURL(host).href);
  const F = 'document.getElementById("page-frame")';
  await tab.waitFor(`location.protocol === "file:" && ${F}.contentDocument?.readyState === "complete" && !!${F}.contentDocument.querySelector(".p-toc")`);
  const r = await clickChip(tab, `${F}.contentDocument`, `${F}.contentWindow`, 3);
  // Smooth scrolling (motion is not reduced here): wait for it to settle
  await tab.waitFor(`(() => { const d = ${F}.contentDocument, s = d.getElementById(${JSON.stringify(r.id)}); return Math.abs(s.getBoundingClientRect().top - d.querySelector('.p-toc').getBoundingClientRect().bottom) < 40; })()`);
  assert.equal(r.url, 'about:srcdoc', 'the frame stays on its page');
  assert.equal(await tab.eval(`${F}.contentWindow.location.href`), 'about:srcdoc');
  assert.ok(await tab.eval(`${F}.contentWindow.scrollY`) > 200);
  assert.equal(await tab.eval('window.scrollY'), 0, 'the host does not scroll');
  assert.equal(await tab.eval('location.hash'), '', "the host's URL is untouched");
  assert.equal(await tab.eval(`${F}.contentDocument.querySelector('.p-toc a[aria-current="true"]')?.getAttribute('href')`), `#${r.id}`);
  assert.equal(r.focused, true);
  // The interactive diagram embed is still there
  assert.equal(await tab.eval(`${F}.contentDocument.querySelectorAll('iframe.p-frame').length`), 1);
});
