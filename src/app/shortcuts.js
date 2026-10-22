/**
 * The keyboard shortcuts panel: one table of every binding the viewer handles
 * (main.js bindKeys and the canvas gestures in interact.js / main.js), grouped,
 * each with a condition so rows that do not apply to the open diagram are left out.
 * Pure: no DOM access, so the table and its HTML are tested in Node.
 *
 * Key tokens: "Shift+1–6" is a combination, "1–9" a range; "→" and "←" swap in
 * right-to-left documents (as the keys themselves do).
 */
import { escapeHtml as h } from '../core/text.js';

/**
 * What the open diagram offers. `shortcutContext` in main.js fills it in;
 * every flag defaults to "offered" so the full table is the fallback.
 * @typedef {{ steps?: boolean, scenarios?: number, modes?: boolean, views?: boolean,
 *   inspector?: boolean, legend?: boolean, fold?: boolean, depth?: number,
 *   drill?: boolean, groups?: boolean, drag?: boolean }} ShortcutContext
 */

const on = (flag) => (c) => c[flag] !== false;
const scenarioKeys = (c) => (c.scenarios ?? 2) > 1;
const depthTop = (c) => Math.max(1, Math.min(c.depth ?? 6, 9));
/** Digit keys 1..n as one token: "1–6", or just "1". */
const digits = (n) => (n > 1 ? `1–${n}` : '1');

/** Groups of rows; `when` hides a row (or a whole group) that does not apply. */
export const SHORTCUT_GROUPS = [
  {
    id: 'walk',
    title: 'help.gWalk',
    when: on('steps'),
    rows: [
      { keys: ['→', 'Space'], text: 'help.next' },
      { keys: ['←'], text: 'help.prev' },
      { keys: ['Home', 'End'], text: 'help.ends' },
      { keys: ['P'], text: 'help.play' },
      { keys: ['C'], text: 'help.follow' },
      { keys: ['S'], text: 'help.story' },
      { keys: ['W'], text: 'help.storyMode' },
      { keys: (c) => [digits(Math.min(c.scenarios ?? 9, 9))], text: 'help.scenario', when: scenarioKeys }
    ]
  },
  {
    id: 'nav',
    title: 'help.gNav',
    rows: [
      { keys: ['+', '-'], text: 'help.zoom' },
      { keys: ['R'], text: 'help.fit' },
      { keys: ['Esc'], text: 'help.clear' }
    ]
  },
  {
    id: 'view',
    title: 'help.gView',
    rows: [
      { keys: ['V'], text: 'help.view', when: on('views') },
      { keys: ['M'], text: 'help.mode', when: on('modes') },
      { keys: ['I'], text: 'help.inspector', when: on('inspector') },
      { keys: ['L'], text: 'help.legend', when: on('legend') },
      { keys: ['T'], text: 'help.theme' },
      { keys: ['F'], text: 'help.fullscreen' },
      { keys: ['?'], text: 'help.panel' }
    ]
  },
  {
    id: 'fold',
    title: 'help.gFold',
    rows: [
      { keys: ['X'], text: 'help.fold', when: on('fold') },
      // Digits switch scenarios when there are several; Shift+digit then still folds
      {
        keys: (c) => [scenarioKeys(c) ? `Shift+${digits(depthTop(c))}` : digits(depthTop(c)), '0'],
        text: 'help.depth',
        when: (c) => (c.depth ?? 6) > 0
      }
    ]
  },
  {
    id: 'drill',
    title: 'help.gDrill',
    rows: [
      { keys: ['D'], text: 'help.drill', when: on('drill') },
      { keys: ['G'], text: 'help.focus', when: on('groups') }
    ]
  },
  {
    id: 'pointer',
    title: 'help.gPointer',
    rows: [
      { gesture: 'help.click', text: 'help.clickDo' },
      { gesture: 'help.dragCard', text: 'help.dragCardDo', when: on('drag') },
      { gesture: 'help.dragBg', text: 'help.dragBgDo' },
      { gesture: 'help.wheel', text: 'help.wheelDo' },
      { gesture: 'help.dblGroup', text: 'help.dblGroupDo', when: on('groups') },
      { gesture: 'help.dblCard', text: 'help.dblCardDo', when: on('drill') }
    ]
  }
];

/** The groups and rows that apply to `ctx`, with keys resolved: [{ id, title, rows: [{ keys | gesture, text }] }]. */
export function shortcutGroups(ctx = {}) {
  return SHORTCUT_GROUPS.filter((g) => !g.when || g.when(ctx))
    .map((g) => ({
      id: g.id,
      title: g.title,
      rows: g.rows
        .filter((r) => !r.when || r.when(ctx))
        .map((r) => (r.gesture ? { gesture: r.gesture, text: r.text } : { keys: typeof r.keys === 'function' ? r.keys(ctx) : r.keys, text: r.text }))
    }))
    .filter((g) => g.rows.length);
}

/** Display names for modifier keys: macOS uses symbols. */
const MAC_KEYS = { Shift: '⇧', Ctrl: '⌃', Alt: '⌥', Meta: '⌘', Cmd: '⌘' };
const MIRROR = { '→': '←', '←': '→' };

/** One key token as <kbd> markup: "Shift+1–6" -> <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>6</kbd>. */
export function keyHtml(token, { mac = false, rtl = false } = {}) {
  const one = (k) => `<kbd>${h((mac && MAC_KEYS[k]) || (rtl && MIRROR[k]) || k)}</kbd>`;
  const range = (k) => (/^.+–.+$/.test(k) ? k.split('–').map(one).join('<span class="y-keys-sep">–</span>') : one(k));
  return token.length > 1 && token.includes('+') ? token.split('+').map(range).join('<span class="y-keys-sep">+</span>') : range(token);
}

/**
 * Panel body: a section per group, a row per shortcut.
 * @param {{ t: (key: string) => string }} L locale
 * @param {ShortcutContext} ctx
 * @param {{ mac?: boolean, rtl?: boolean }} opts
 */
export function shortcutsHtml(L, ctx = {}, opts = {}) {
  return shortcutGroups(ctx)
    .map((g) => {
      const head = `help-g-${g.id}`;
      const rows = g.rows
        .map((r) => {
          const keys = r.gesture ? `<span class="y-gesture">${h(L.t(r.gesture))}</span>` : r.keys.map((k) => keyHtml(k, opts)).join(' ');
          return `<div class="y-keys-row${r.gesture ? ' is-gesture' : ''}"><dt>${keys}</dt><dd>${h(L.t(r.text))}</dd></div>`;
        })
        .join('');
      return `<section class="y-keys-group" data-group="${g.id}" aria-labelledby="${head}"><h4 id="${head}">${h(L.t(g.title))}</h4><dl>${rows}</dl></section>`;
    })
    .join('');
}
