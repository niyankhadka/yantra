import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHORTCUT_GROUPS, shortcutGroups, shortcutsHtml, keyHtml } from '../src/app/shortcuts.js';
import { STRINGS, STRING_KEYS, localeOf } from '../src/core/i18n.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = localeOf({});
const allKeys = (groups) => groups.flatMap((g) => g.rows.flatMap((r) => r.keys || []));
const ids = (groups) => groups.map((g) => g.id);

test('shortcut table: every string is a known key with a translation in every language', () => {
  const used = SHORTCUT_GROUPS.flatMap((g) => [g.title, ...g.rows.flatMap((r) => [r.text, r.gesture].filter(Boolean))]);
  for (const k of used) {
    assert.ok(STRING_KEYS.includes(k), k);
    for (const [lang, table] of Object.entries(STRINGS)) assert.ok(table[k], `${lang}: ${k}`);
  }
  for (const table of Object.values(STRINGS)) assert.ok(table['help.footer'].includes('?'), 'the footer names the ? key');
});

test('shortcut table lists every key the viewer binds', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app', 'main.js'), 'utf-8');
  const block = src.slice(src.indexOf('const map = {'), src.indexOf('const fn = map['));
  const bound = [...block.matchAll(/^\s+('[^']+'|[A-Za-z]+):/gm)].map((m) => m[1].replace(/'/g, ''));
  assert.ok(bound.length > 20, 'found the key map');
  const listed = allKeys(shortcutGroups()).flatMap((k) => (k.length > 1 ? k.split(/[+–]/) : [k]));
  const shown = { ArrowRight: '→', ArrowLeft: '←', ' ': 'Space', Escape: 'Esc', '=': '+' };
  for (const k of bound) {
    const want = shown[k] || (k.length === 1 ? k.toUpperCase() : k);
    assert.ok(listed.includes(want), `key ${k} is in the panel`);
  }
});

test('shortcut groups follow the diagram: keys that do nothing here are left out', () => {
  const full = shortcutGroups();
  assert.deepEqual(ids(full), ['walk', 'nav', 'view', 'fold', 'drill', 'pointer']);
  const bare = shortcutGroups({ steps: false, scenarios: 1, modes: false, views: false, inspector: false, legend: false, fold: false, depth: 0, drill: false, groups: false, drag: false });
  assert.deepEqual(ids(bare), ['nav', 'view', 'pointer'], 'no walkthrough, folding or drill-down groups');
  assert.deepEqual(allKeys(bare), ['+', '-', 'R', 'Esc', 'T', 'F', '?']);
  const texts = bare.find((g) => g.id === 'pointer').rows.map((r) => r.text);
  assert.deepEqual(texts, ['help.clickDo', 'help.dragBgDo', 'help.wheelDo'], 'sequence-like: no card dragging or double-clicks');

  // One scenario: digits fold; several: digits switch scenarios and Shift+digit folds
  const fold = (ctx) => shortcutGroups(ctx).find((g) => g.id === 'fold').rows.find((r) => r.text === 'help.depth').keys;
  assert.deepEqual(fold({ scenarios: 1, depth: 3 }), ['1–3', '0']);
  assert.deepEqual(fold({ scenarios: 1, depth: 1 }), ['1', '0'], 'one level: no range');
  assert.deepEqual(fold({ scenarios: 3, depth: 6 }), ['Shift+1–6', '0']);
  const walk = shortcutGroups({ scenarios: 3 }).find((g) => g.id === 'walk');
  assert.deepEqual(walk.rows.at(-1), { keys: ['1–3'], text: 'help.scenario' });
  assert.ok(!shortcutGroups({ scenarios: 1 }).find((g) => g.id === 'walk').rows.some((r) => r.text === 'help.scenario'));
});

test('keys render as <kbd>, with macOS modifier symbols and mirrored arrows in RTL', () => {
  assert.equal(keyHtml('Shift+1–6'), '<kbd>Shift</kbd><span class="y-keys-sep">+</span><kbd>1</kbd><span class="y-keys-sep">–</span><kbd>6</kbd>');
  assert.match(keyHtml('Shift+0', { mac: true }), /^<kbd>⇧<\/kbd>/);
  assert.equal(keyHtml('+'), '<kbd>+</kbd>');
  assert.equal(keyHtml('→', { rtl: true }), '<kbd>←</kbd>');
  const html = shortcutsHtml(L, { scenarios: 1 });
  assert.equal((html.match(/<section class="y-keys-group"/g) || []).length, 6);
  assert.match(html, /<h4 id="help-g-walk">Walkthrough<\/h4>/);
  assert.match(html, /<dt><span class="y-gesture">Double-click a card<\/span><\/dt><dd>Open its detail diagram<\/dd>/);
  assert.match(shortcutsHtml(localeOf({ lang: 'ar' })), /الجولة التوضيحية/);
});
