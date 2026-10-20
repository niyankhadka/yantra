import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STRINGS, STRING_KEYS, LANGUAGES, RTL_LANGS, localeOf, textDir } from '../src/core/i18n.js';
import { textWidth, wrapText } from '../src/core/text.js';
import { computeScene } from '../src/core/scene.js';
import { renderSvg } from '../src/core/svg.js';
import { renderPage, pageToMarkdown } from '../src/core/page.js';
import { toMarkdown } from '../src/core/markdown.js';
import { lint } from '../src/core/lint.js';
import { buildHtml, ROOT } from '../lib/build.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const diagram = (meta = {}) => ({
  meta: { title: 'T', ...meta },
  nodes: [{ id: 'a', data: { title: 'A' } }, { id: 'b', data: { title: 'B' } }],
  edges: [{ id: 'ab', source: 'a', target: 'b', label: 'calls' }],
  steps: [{ id: 's', title: 'Step', highlightNodes: ['a', 'b'], highlightEdges: ['ab'] }]
});

// --- string table ---------------------------------------------------------------
test('ships at least en, es, fr, de, pt, hi, ne, zh, ja, ar', () => {
  for (const l of ['en', 'es', 'fr', 'de', 'pt', 'hi', 'ne', 'zh', 'ja', 'ar']) assert.ok(LANGUAGES.includes(l), l);
});

for (const lang of LANGUAGES) {
  test(`string table "${lang}" is complete: same keys as English, non-empty, same placeholders`, () => {
    const table = STRINGS[lang];
    assert.deepEqual(Object.keys(table).sort(), [...STRING_KEYS].sort());
    for (const key of STRING_KEYS) {
      assert.equal(typeof table[key], 'string', `${lang} ${key}`);
      assert.ok(table[key].trim(), `${lang} ${key} is empty`);
      assert.deepEqual(placeholders(table[key]), placeholders(STRINGS.en[key]), `${lang} ${key} placeholders`);
    }
    // Brand names stay as they are
    assert.match(table['watermark.text'], /Yantra/);
    assert.match(table['watermark.title'], /GitHub/);
  });
}

test('every string key used by the viewer shell exists in the table', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  const keys = [...html.matchAll(/data-i18n(?:-label|-tip)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 40, 'index.html marks its strings');
  for (const k of keys) assert.ok(STRING_KEYS.includes(k), k);
  for (const file of ['src/app/main.js', 'src/app/levels.js', 'src/app/renderer.js', 'src/core/page.js', 'src/core/svg.js', 'src/core/markdown.js', 'src/core/charts.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    for (const [, k] of src.matchAll(/\bt(?:Html)?\('([a-z]+\.[A-Za-z]+)'/g)) assert.ok(STRING_KEYS.includes(k), `${file}: ${k}`);
  }
});

test('localeOf: region subtags, unknown and malformed tags fall back to English strings', () => {
  assert.equal(localeOf({ lang: 'pt-BR' }).ui, 'pt');
  assert.equal(localeOf({ lang: 'pt-BR' }).lang, 'pt-BR');
  const sw = localeOf({ lang: 'sw' });
  assert.equal(sw.ui, 'en');
  assert.equal(sw.lang, 'sw', 'the content language is kept for <html lang>');
  assert.equal(sw.t('story.next'), 'Next');
  assert.equal(localeOf({ lang: 'not a tag!' }).lang, 'en');
  assert.equal(localeOf({}).t('story.stepOf', { n: 2, total: 5, title: 'Pay' }), 'Step 2 of 5: Pay');
  assert.equal(localeOf({ lang: 'es' }).t('story.next'), 'Siguiente');
  assert.equal(localeOf({ lang: 'ne' }).t('tab.summary'), 'सारांश');
});

test('meta.strings overrides one key and leaves the rest of the table', () => {
  const L = localeOf({ lang: 'fr', strings: { 'story.next': 'Continuer', 'watermark.text': 'Fait maison' } });
  assert.equal(L.t('story.next'), 'Continuer');
  assert.equal(L.t('story.back'), 'Retour');
  assert.match(renderSvg(computeScene(diagram({ lang: 'fr', strings: { 'watermark.text': 'Fait maison' } }))), /Fait maison/);
});

test('number formatting follows the language', () => {
  assert.equal(localeOf({ lang: 'de' }).num(1234.5), '1.234,5');
  assert.equal(localeOf({ lang: 'en' }).num(1234.5), '1,234.5');
  assert.equal(localeOf({ lang: 'de' }).num('12 min'), '12 min', 'text passes through');
  const page = { kind: 'page', meta: { title: 'x', lang: 'de' }, answer: { headline: 'h' }, blocks: [{ type: 'chart', data: [{ label: 'a', value: 42.5 }] }, { type: 'metrics', items: [{ label: 'n', value: 38520 }] }] };
  const html = renderPage(page);
  assert.match(html, /<b>42,5<\/b>/);
  assert.match(html, /<strong>38\.520<\/strong>/);
});

test('charts, entity cards and relationship text follow the language', () => {
  const page = (lang) => ({ kind: 'page', meta: { title: 'x', lang }, answer: { headline: 'h' }, blocks: [{ type: 'chart', kind: 'column', title: 'Q', categories: ['a', 'b'], series: [{ name: 's', values: [1234.5, 2] }] }] });
  const de = renderPage(page('de'));
  assert.match(de, /aria-label="Säulendiagramm: Q"/);
  assert.match(de, /1.234,5/);
  assert.match(renderPage(page('en')), /aria-label="Column chart: Q"/, 'English wording unchanged');
  const ja = renderPage({ kind: 'page', meta: { title: 'x', lang: 'ja' }, answer: { headline: 'h' }, blocks: [{ type: 'gantt', items: [{ title: 'A', start: '02/11/2026', days: 400 }] }] });
  assert.match(ja, /ガントチャート/);
  assert.match(ja, />2月</, 'month names from Intl');
  const er = { meta: { title: 'ER', lang: 'es' }, nodes: [{ id: 'a', data: { title: 'A', fields: [{ name: 'id', type: 'uuid', pk: true }] } }, { id: 'b', data: { title: 'B' } }], edges: [{ id: 'ab', source: 'a', target: 'b', label: 'tiene', sourceEnd: 'one', targetEnd: 'zero-or-many' }] };
  const md = toMarkdown(er);
  assert.match(md, /## Campos/);
  assert.match(md, /| Desde | Hacia | Etiqueta | Relación |/);
  assert.match(md, /exactamente uno a cero o más/);
  assert.match(renderSvg(computeScene({ ...er, meta: { title: 'ER', lang: 'ar' } })), /direction="rtl"/);
});

// --- direction ----------------------------------------------------------------
test('RTL languages and meta.dir', () => {
  for (const l of ['ar', 'he', 'fa', 'ur', 'ar-EG']) assert.equal(textDir(l), 'rtl', l);
  for (const l of ['en', 'ne', 'zh', 'ja']) assert.equal(textDir(l), 'ltr', l);
  assert.equal(textDir('en', 'rtl'), 'rtl');
  assert.equal(textDir('ar', 'ltr'), 'ltr');
  assert.ok(RTL_LANGS.includes('ar'));
});

test('pages carry <html lang dir>; diagrams inside inherit the page language', () => {
  const html = renderPage({ kind: 'page', meta: { title: 'x', lang: 'ar' }, answer: { headline: 'h' }, blocks: [{ type: 'diagram', diagram: diagram() }] });
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<span class="p-label">الإجابة<\/span>/);
  assert.match(html, /<svg [^>]*xml:lang="ar" direction="rtl"/, 'static figure inherits lang and dir');
  assert.match(html, /class="p-scroll p-only-light" dir="ltr"/, 'figures keep their layout direction');
  assert.match(renderPage({ kind: 'page', meta: { title: 'x' }, answer: { headline: 'h' } }), /<html lang="en" dir="ltr">/);
});

test('SVG export sets xml:lang and direction; RTL mirrors card text, not the layout', () => {
  const ltr = renderSvg(computeScene(diagram({ lang: 'ja' })));
  assert.match(ltr, /<svg [^>]*xml:lang="ja" direction="ltr"/);
  assert.match(ltr, /Yantra で作成/);
  const ar = computeScene(diagram({ lang: 'ar' }));
  const en = computeScene(diagram());
  assert.deepEqual(ar.nodes.map((n) => [n.x, n.y]), en.nodes.map((n) => [n.x, n.y]), 'LR stays LR');
  const svg = renderSvg(ar);
  assert.match(svg, /direction="rtl"/);
  const a = ar.nodes.find((n) => n.id === 'a');
  assert.ok(svg.includes(`<text x="${a.w - 14}"`), 'card text is anchored at the right padding');
});

test('built viewer HTML gets lang and dir before the first paint', () => {
  const html = buildHtml(diagram({ lang: 'ar' }));
  assert.match(html, /<html lang="ar" dir="rtl"/);
  assert.match(buildHtml(diagram({ lang: 'ne' })), /<html lang="ne" dir="ltr"/);
});

test('Markdown exports use the payload language', () => {
  const md = toMarkdown(diagram({ lang: 'es' }));
  assert.match(md, /## Componentes/);
  assert.match(md, /\| Componente \| Rol \| Tecnología \| Descripción \|/);
  assert.match(md, /## Recorrido/);
  assert.match(toMarkdown(diagram()), /## Walkthrough/);
  const page = pageToMarkdown({ kind: 'page', meta: { title: 'x', lang: 'de' }, answer: { headline: 'h' }, blocks: [{ type: 'compare', options: [{ name: 'A', recommended: true }, { name: 'B' }] }] });
  assert.match(page, /### A \(Empfohlen\)/);
});

// --- text measurement ----------------------------------------------------------
test('CJK glyphs are full width; combining marks have no width', () => {
  assert.equal(textWidth('中文', 14), 28);
  assert.equal(textWidth('カナ', 10), 20);
  assert.ok(textWidth('中文', 14) > textWidth('ab', 14) * 1.8);
  assert.equal(textWidth('े', 14), 0, 'Devanagari vowel sign e above');
  assert.equal(textWidth('َ', 14), 0, 'Arabic fatha');
  assert.ok(textWidth('क', 14) > textWidth('n', 14), 'a Devanagari letter is wider than a Latin one');
  assert.ok(textWidth('مرحبا', 12) > 0);
});

test('CJK text without spaces wraps between characters, within width, with kinsoku', () => {
  const text = '注文サービスは決済ゲートウェイに支払い要求を送信し、結果を受け取ります。';
  const lines = wrapText(text, 120, 14);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), text, 'no characters lost or spaces added');
  for (const l of lines) {
    assert.ok(textWidth(l, 14) <= 120, l);
    assert.ok(!/^[、。，）」]/.test(l), `line starts with closing punctuation: ${l}`);
  }
  const zh = wrapText('订单服务向支付网关发送请求并等待结果', 100, 14, {}, 2);
  assert.equal(zh.length, 2);
  assert.ok(zh[1].endsWith('…'));
  // Mixed scripts keep their spaces
  assert.deepEqual(wrapText('API ゲートウェイ', 400, 14), ['API ゲートウェイ']);
});

test('Devanagari and Arabic wrap at spaces and keep marks with their letters', () => {
  const ne = wrapText('भुक्तानी गेटवेले अनुरोध प्रमाणित गर्छ', 150, 14, { weight: 600 });
  assert.equal(ne.join(' '), 'भुक्तानी गेटवेले अनुरोध प्रमाणित गर्छ');
  const long = wrapText('स्वास्थ्यस्वास्थ्यस्वास्थ्यस्वास्थ्य', 60, 14);
  for (const l of long) assert.ok(!/^[ा-्]/.test(l), `piece starts with a mark: ${l}`);
  assert.equal(wrapText('بوابة الدفع تتحقق من الطلب', 120, 14).join(' '), 'بوابة الدفع تتحقق من الطلب');
});

// --- lint ----------------------------------------------------------------------
test('lint: unknown language falls back with a warning; bad dir and unknown string keys warn', () => {
  const codes = (meta) => lint(diagram(meta)).warnings.map((w) => w.code);
  assert.deepEqual(codes({ lang: 'ne' }), []);
  assert.deepEqual(codes({ lang: 'pt-BR', dir: 'ltr', strings: { 'story.next': 'Seguir' } }), []);
  assert.ok(codes({ lang: 'sw' }).includes('i18n/unknown-lang'));
  assert.ok(codes({ lang: 'english please' }).includes('i18n/bad-lang'));
  assert.ok(codes({ dir: 'up' }).includes('i18n/bad-dir'));
  assert.ok(codes({ strings: { 'story.nxt': 'x' } }).includes('i18n/unknown-string'));
  assert.ok(codes({ strings: { 'story.next': 5 } }).includes('i18n/bad-strings'));
  assert.ok(lint(diagram({ lang: 'sw' })).valid, 'warnings only');
  const page = lint({ kind: 'page', meta: { title: 'x', lang: 'xx-invalid-!!' }, answer: { headline: 'h' } });
  assert.ok(page.warnings.some((w) => w.code === 'i18n/bad-lang'));
});
