/**
 * Drill-down navigation for the viewer: the overview plus a stack of detail
 * diagrams (see core/drill.js), the breadcrumb and the `level=` hash key.
 * No DOM access here; main.js wires it to the UI.
 */
import { collectDiagrams, levelPath, drillOf, replaceLevel } from '../core/drill.js';
import { escapeHtml as h } from '../core/text.js';

/**
 * UI strings of the drill-down and link features (English defaults);
 * setDrillLocale() refills them from src/core/i18n.js (drill.* keys).
 */
export const DRILL_TEXT = {
  crumbs: 'Diagram levels',
  back: (title) => `Back to ${title} (Esc)`,
  open: (title) => `Open detail: ${title}`,
  cardHint: 'opens a detail diagram (D)',
  opened: (title) => `Opened ${title}`,
  details: 'Detail diagrams',
  link: 'Open link',
  newTab: '(opens in a new tab)',
  edgeLink: (label) => `Open link for ${label}`,
  overview: 'Overview'
};

/** Switch DRILL_TEXT to a locale (localeOf() result). */
export function setDrillLocale(L) {
  Object.assign(DRILL_TEXT, {
    crumbs: L.t('drill.crumbs'),
    back: (title) => `${L.t('drill.back', { title })} (Esc)`,
    open: (title) => L.t('drill.open', { title }),
    cardHint: `${L.t('drill.cardHint')} (D)`,
    opened: (title) => L.t('drill.opened', { title }),
    details: L.t('drill.details'),
    link: L.t('drill.link'),
    newTab: L.t('drill.newTab'),
    edgeLink: (label) => L.t('drill.edgeLink', { label }),
    overview: L.t('drill.overview')
  });
}

const BACK_ICON = '<svg class="y-flip" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

export class Levels {
  constructor(root) {
    this.reset(root);
  }

  reset(root) {
    this.root = root;
    this.map = collectDiagrams(root).map;
    this.path = []; // diagram ids below the overview
    this.saved = []; // saved[i]: viewer state of level i when its child was opened (may be missing)
  }

  get any() {
    return this.map.size > 0;
  }

  get depth() {
    return this.path.length;
  }

  currentId() {
    return this.path[this.path.length - 1] || null;
  }

  current() {
    return this.depth ? this.map.get(this.currentId()) : this.root;
  }

  title(id) {
    const p = id ? this.map.get(id) : this.root;
    return p?.meta?.title || id || DRILL_TEXT.overview;
  }

  /** Diagram id a card opens, or null (unknown target, or already on the path: no loops). */
  target(node) {
    const t = drillOf(node);
    return t && this.map.has(t) && !this.path.includes(t) ? t : null;
  }

  push(id, state) {
    this.saved = [...this.saved.slice(0, this.depth), state];
    this.path.push(id);
  }

  /** Back to depth n (0 = overview); returns the state saved when that level was left. */
  popTo(depth) {
    const state = this.saved[depth] || null;
    this.path = this.path.slice(0, depth);
    this.saved = this.saved.slice(0, depth);
    return state;
  }

  /** Jump to a path (deep link, browser history); invalid paths are repaired by levelPath. */
  setPath(ids) {
    const old = this.path;
    this.path = levelPath(this.root, ids);
    // States saved along the shared part of the old path stay valid (Back, then Forward)
    let same = 0;
    while (same < this.path.length && same < old.length && this.path[same] === old[same]) same++;
    this.saved = this.saved.slice(0, same + 1);
  }

  /** `level=` hash value: ids URI-encoded and joined with "/" (null at the overview). */
  hashValue() {
    return this.depth ? this.path.map(encodeURIComponent).join('/') : null;
  }

  static parseHash(raw) {
    return String(raw || '')
      .split('/')
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
  }

  /** Root payload with the current level replaced (for "Standalone HTML" with positions). */
  exportRoot(sub) {
    const id = this.currentId();
    return id ? replaceLevel(this.root, id, sub) : sub;
  }

  /** Breadcrumb: back button, then Overview › … › current (the last one is not a link). */
  crumbsHtml() {
    if (!this.depth) return '';
    const trail = [null, ...this.path];
    const items = trail.map((id, i) =>
      i === trail.length - 1
        ? `<li><span aria-current="page">${h(this.title(id))}</span></li>`
        : `<li><button class="y-crumb" data-level="${i}">${h(this.title(id))}</button></li>`
    );
    const up = this.title(trail[trail.length - 2]);
    return `<button class="y-crumb-back" data-level="${this.depth - 1}" data-tip="${h(DRILL_TEXT.back(up))}" aria-label="${h(DRILL_TEXT.back(up))}">${BACK_ICON}</button><ol>${items.join('')}</ol>`;
  }
}
