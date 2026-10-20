import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STRINGS, STRING_KEYS, LANGUAGES, RTL_LANGS, localeOf, textDir, shippedLang, isPluralKey, registerStrings, stringsFor } from '../src/core/i18n.js';
import { TABLES, LINT_TABLES } from '../src/core/locales/index.js';
import { LINT_EN, LINT_KEYS, LINT_LANGUAGES, localizeFindings, translateMessage } from '../src/core/lintmessages.js';
import { textWidth, wrapText, displayWidth } from '../src/core/text.js';
import { computeScene } from '../src/core/scene.js';
import { renderSvg } from '../src/core/svg.js';
import { renderPage, pageToMarkdown } from '../src/core/page.js';
import { toMarkdown } from '../src/core/markdown.js';
import { lint } from '../src/core/lint.js';
import { buildHtml, buildPage, payloadLangs, ROOT } from '../lib/build.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const diagram = (meta = {}) => ({
  meta: { title: 'T', ...meta },
  nodes: [{ id: 'a', data: { title: 'A' } }, { id: 'b', data: { title: 'B' } }],
  edges: [{ id: 'ab', source: 'a', target: 'b', label: 'calls' }],
  steps: [{ id: 's', title: 'Step', highlightNodes: ['a', 'b'], highlightEdges: ['ab'] }]
});

// --- string table ---------------------------------------------------------------
test('ships en, es, fr, de, pt, it, hi, bn, ne, zh, zh-Hant, ja, ko, id, ar, he, fa, ur', () => {
  for (const l of ['en', 'es', 'fr', 'de', 'pt', 'it', 'hi', 'bn', 'ne', 'zh', 'zh-Hant', 'ja', 'ko', 'id', 'ar', 'he', 'fa', 'ur']) assert.ok(LANGUAGES.includes(l), l);
  assert.deepEqual(Object.keys(STRINGS), LANGUAGES, 'LANGUAGES lists the loaded tables in order');
  assert.deepEqual(Object.keys(TABLES), LANGUAGES.filter((l) => l !== 'en'));
});

for (const lang of LANGUAGES) {
  test(`string table "${lang}" is complete: same keys as English, non-empty, same placeholders`, () => {
    const table = STRINGS[lang];
    assert.deepEqual(Object.keys(table).filter((k) => !isPluralKey(k)).sort(), [...STRING_KEYS].sort());
    for (const k of Object.keys(table).filter(isPluralKey))
      assert.ok(placeholders(table[k]).every((p) => p === 'n'), `${lang} ${k} uses only {n}`);
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

// --- Traditional Chinese, plurals -------------------------------------------------
test('Chinese: zh-TW, zh-HK, zh-MO and zh-Hant use Traditional; zh-CN and zh-Hans use Simplified', () => {
  for (const t of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-hant-CN', 'ZH-tw']) assert.equal(shippedLang(t), 'zh-Hant', t);
  for (const t of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-TW', 'zh-Hans-HK']) assert.equal(shippedLang(t), 'zh', t);
  assert.equal(localeOf({ lang: 'zh-TW' }).ui, 'zh-Hant');
  assert.equal(localeOf({ lang: 'zh-TW' }).lang, 'zh-TW');
  assert.notEqual(localeOf({ lang: 'zh-TW' }).t('export.title'), localeOf({ lang: 'zh-CN' }).t('export.title'), 'Traditional is its own table');
  assert.equal(shippedLang('ko-KR'), 'ko');
  assert.equal(shippedLang('sw'), null);
});

test('counted words follow Intl.PluralRules, with optional zero/two/few/many forms', () => {
  const en = localeOf({});
  assert.equal(en.plural(1, 'chart.day1', 'chart.days', { n: 1 }), '1 day');
  assert.equal(en.plural(0, 'chart.day1', 'chart.days', { n: 0 }), '0 days');
  const fr = localeOf({ lang: 'fr' });
  assert.equal(fr.plural(0, 'chart.day1', 'chart.days', { n: 0 }), '0 jour', 'French: 0 is singular');
  const he = localeOf({ lang: 'he' });
  assert.ok(STRINGS.he['chart.days.two'], 'Hebrew has a dual');
  assert.equal(he.plural(2, 'chart.day1', 'chart.days', { n: 2 }), STRINGS.he['chart.days.two'].replace('{n}', '2'));
  assert.equal(he.plural(5, 'chart.day1', 'chart.days', { n: 5 }), STRINGS.he['chart.days'].replace('{n}', '5'));
  const ar = localeOf({ lang: 'ar' });
  for (const [n, cat] of [[2, 'two'], [3, 'few'], [11, 'many']]) assert.equal(ar.plural(n, 'chart.day1', 'chart.days', { n }), STRINGS.ar[`chart.days.${cat}`].replace('{n}', n), `ar ${n}`);
  assert.equal(ar.plural(100, 'chart.day1', 'chart.days', { n: 100 }), STRINGS.ar['chart.days'].replace('{n}', 100));
  const over = localeOf({ lang: 'en', strings: { 'chart.days.two': 'a couple of days' } });
  assert.equal(over.plural(2, 'chart.day1', 'chart.days', { n: 2 }), '2 days', 'English has no "two" category');
  const gantt = renderPage({ kind: 'page', meta: { title: 'x', lang: 'he' }, answer: { headline: 'h' }, blocks: [{ type: 'gantt', items: [{ title: 'A', start: '02/11/2026', days: 2 }] }] });
  assert.ok(gantt.includes(STRINGS.he['chart.days.two'].replace('{n}', '2')), 'gantt durations use the dual');
  assert.deepEqual(lint(diagram({ strings: { 'chart.days.few': '{n} days' } })).warnings.map((w) => w.code), [], 'plural keys are known keys');
  assert.ok(isPluralKey('chart.points.many') && !isPluralKey('story.next.two') && !isPluralKey('chart.days.other'));
});

// --- built files carry only the languages they use --------------------------------
test('built HTML embeds English plus only the payload languages', () => {
  const marker = (lang) => STRINGS[lang]['help.footer'];
  const en = buildHtml(diagram());
  assert.ok(!en.includes('<script type="application/json" id="yantra-strings">'), 'no table script for English');
  for (const l of ['ar', 'he', 'ja', 'zh-Hant', 'de']) assert.ok(!en.includes(marker(l)), `English build has no ${l} table`);
  const he = buildHtml(diagram({ lang: 'he' }));
  assert.ok(he.includes('<script type="application/json" id="yantra-strings">'));
  assert.ok(he.includes(marker('he')));
  assert.ok(!he.includes(marker('ar')), 'only the payload language');
  assert.ok(he.length - en.length < 40000, 'one table costs a few kB');
  // Detail diagrams in another language bring their table too
  const drill = { ...diagram({ lang: 'ja' }), diagrams: { d: diagram({ lang: 'ko' }) } };
  assert.deepEqual([...payloadLangs(drill)], ['ja', 'ko']);
  const both = buildHtml(drill);
  assert.ok(both.includes(marker('ja')) && both.includes(marker('ko')) && !both.includes(marker('he')));
  assert.deepEqual(Object.keys(stringsFor(['zh-TW', 'en', 'sw', 'pt-BR'])), ['zh-Hant', 'pt']);
});

test('answer pages embed the languages of their interactive diagrams', () => {
  const page = (lang) => ({ kind: 'page', meta: { title: 'x', lang }, answer: { headline: 'h' }, blocks: [{ type: 'diagram', interactive: true, diagram: diagram() }] });
  const inJson = (html, s) => html.includes(JSON.stringify(s).slice(1, -1));
  const fa = buildPage(page('fa'), ROOT);
  assert.ok(inJson(fa, STRINGS.fa['help.footer']), 'the embed inherits the page language');
  const en = buildPage(page('en'), ROOT);
  assert.ok(!inJson(en, STRINGS.fa['help.footer']) && !inJson(en, STRINGS.ur['help.footer']), 'English page: no tables');
});

test('registerStrings adds known languages only', () => {
  registerStrings({ xx: { 'story.next': 'x' }, fr: STRINGS.fr, en: { 'story.next': 'nope' } });
  assert.equal(STRINGS.xx, undefined);
  assert.equal(STRINGS.en['story.next'], 'Next');
});

test('the viewer bundle is built without the locale tables; the gallery loads them all', () => {
  const vite = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf-8');
  assert.match(vite, /'\.\/locales\/index\.js'/);
  const gallery = fs.readFileSync(path.join(ROOT, 'src/app/examples.js'), 'utf-8');
  assert.match(gallery, /registerStrings\(TABLES\)/);
});

// --- width budgets -------------------------------------------------------------
test('displayWidth: CJK counts 2, marks 0, everything else 1', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('订单服务'), 8);
  assert.equal(displayWidth('결제'), 4);
  assert.equal(displayWidth('स्वास्थ्य'), [...'स्वास्थ्य'].filter((c) => !/\p{Mn}/u.test(c)).length);
  assert.equal(displayWidth(''), 0);
});

test('title and label budgets measure display width', () => {
  const one = (title, label = 'x') => ({ meta: { title: 'T' }, nodes: [{ id: 'a', data: { title } }, { id: 'b', data: { title: 'B' } }], edges: [{ id: 'ab', source: 'a', target: 'b', label }], steps: [{ id: 's', title: 'S', highlightNodes: ['a', 'b'] }] });
  const warn = (p, code) => lint(p).warnings.find((w) => w.code === code);
  assert.equal(warn(one('订单服务向支付网关发送请求并等待结果和回调'), 'content/title-too-long'), undefined, '20 Chinese characters fit');
  const long = warn(one('订单服务向支付网关发送请求并等待结果和回调通知客户'), 'content/title-too-long');
  assert.ok(long, '25 Chinese characters (50 columns) are too wide');
  assert.match(long.message, /50 columns wide/);
  assert.match(warn(one('x'.repeat(43)), 'content/title-too-long').message, /is 43 chars; keep titles under 42/, 'Latin wording unchanged');
  assert.equal(warn(one('x'.repeat(42)), 'content/title-too-long'), undefined);
  assert.ok(warn(one('A', '订单服务向支付网关发送请求结果'), 'content/label-too-long'), '15 CJK characters (30 columns) exceed 28');
  assert.equal(warn(one('A', 'आदेश सेवा भुक्तान गेटवे'), 'content/label-too-long'), undefined);
});

// --- translated validation messages ---------------------------------------------
test('every language has every validator message, with the same placeholders', () => {
  assert.deepEqual(LINT_LANGUAGES, LANGUAGES);
  for (const [lang, table] of Object.entries(LINT_TABLES)) {
    assert.deepEqual(Object.keys(table).sort(), [...LINT_KEYS].sort(), lang);
    for (const k of LINT_KEYS) {
      const en = Array.isArray(LINT_EN[k]) ? LINT_EN[k][0] : LINT_EN[k];
      assert.deepEqual(placeholders(table[k]), placeholders(en), `${lang} ${k}`);
    }
  }
});

const messy = () => ({
  meta: { title: 'T', lang: 'xx-notreal', summary: { points: ['1', '2', '3', '4', '5', '6', '7'] } },
  nodes: [
    { id: 'a', data: { title: 'x'.repeat(50), icon: 'nope' } },
    { id: 'a', data: { title: '订单服务向支付网关发送请求并等待结果和回调通知客户', fields: [{ name: 'id' }, { name: 'id' }, { name: 'r', ref: 'zz' }] } },
    { id: 'i', shape: 'initial', data: { title: 'I' } },
    { id: 'c', shape: 'choice', data: { title: 'C' } }
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'ghost' },
    { id: 'e1', source: 'c', target: 'i', label: 'y'.repeat(40) }
  ],
  modes: [{ id: 'm', hideNodes: ['q'], hideEdges: ['r'] }],
  scenarios: [{ id: 's', name: 'Main', steps: [{ id: 's1', title: 'S', highlightNodes: ['a', 'nope'], highlightEdges: ['e1', 'zz'] }] }]
});

test('localizeFindings translates the common codes and keeps codes and English', () => {
  const report = lint(messy());
  const all = [...report.errors, ...report.warnings];
  const covered = all.filter((f) => LINT_KEYS.some((k) => k.split('#')[0] === f.code));
  assert.ok(covered.length >= 12, `exercise many codes (${covered.map((f) => f.code).join(', ')})`);
  for (const lang of LANGUAGES.filter((l) => l !== 'en')) {
    const out = localizeFindings(report, lang);
    assert.equal(out.valid, report.valid);
    const outAll = [...out.errors, ...out.warnings];
    assert.deepEqual(outAll.map((f) => f.code), all.map((f) => f.code), `${lang}: codes unchanged`);
    covered.forEach((c) => {
      const f = outAll[all.indexOf(c)];
      assert.equal(f.messageEn, c.message, `${lang}: ${c.code} translated (${c.message})`);
      assert.notEqual(f.message, c.message);
    });
  }
  assert.equal(localizeFindings(report, 'en'), report);
  assert.equal(localizeFindings(report, 'sw'), report, 'unknown languages stay English');
  const dup = localizeFindings(report, 'ja-JP').errors.find((f) => f.code === 'ref/duplicate-node-id');
  assert.ok(dup.message.includes('"a"') && dup.messageEn, 'values are kept');
});

test('translated messages keep detail-diagram and page-block prefixes', () => {
  const es = translateMessage('content/edge-missing-label', 'diagrams.pay: Edge "x" has no label; say what flows along it.', 'es');
  assert.ok(es.startsWith('diagrams.pay: '), es);
  assert.ok(es.includes('"x"') && !es.includes('say what flows'));
  assert.equal(translateMessage('layout/overlap', 'Nodes overlap.', 'es'), null);
  assert.equal(translateMessage('content/edge-missing-label', 'Something else entirely.', 'es'), null);
});

test('yantra validate --lang translates messages; codes and the --json shape stay', () => {
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests', '.tmp-lang-'));
  try {
    const file = path.join(dir, 'd.json');
    fs.writeFileSync(file, JSON.stringify({ ...diagram({ lang: 'de' }), edges: [{ id: 'ab', source: 'a', target: 'b' }], steps: [{ id: 's', title: 'Step', highlightNodes: ['a', 'b'] }] }));
    const run = (...extra) => JSON.parse(spawnSync(process.execPath, [path.join(ROOT, 'bin/yantra.js'), 'validate', file, '--json', ...extra], { encoding: 'utf-8' }).stdout);
    const w = (r) => r.warnings.find((x) => x.code === 'content/edge-missing-label');
    const plain = run();
    const auto = run('--lang', 'auto');
    const fr = run('--lang', 'fr');
    assert.match(w(plain).message, /has no label/);
    assert.equal(w(plain).messageEn, undefined);
    assert.equal(w(auto).messageEn, w(plain).message);
    assert.equal(w(auto).message, translateMessage('content/edge-missing-label', w(plain).message, 'de'));
    assert.notEqual(w(fr).message, w(auto).message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
