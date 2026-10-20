/**
 * Yantra app controller: wires engine, renderer and interactions to the UI.
 */
import '../styles/app.css';
import '../styles/diagram.css';

import { themeCss } from '../core/theme.js';
import { renderSvg } from '../core/svg.js';
import { toMarkdown } from '../core/markdown.js';
import { escapeHtml as h } from '../core/text.js';
import { renderBlock, renderPage, isPage, BLOCK_CSS } from '../core/page.js';
import { enhanceCharts, withChartLocale } from '../core/charts.js';
import { CARD_CHART_CSS, chartBlock } from '../core/cardchart.js';
import { safeUrl } from '../core/drill.js';
import { LINK_ICON, DRILL_ICON } from '../core/icons.js';
import { YantraEngine } from './engine.js';
import { getMode } from '../core/model.js';
import { isEntity, members, memberKey, memberName, memberType } from '../core/entity.js';
import { notationText } from '../core/notation.js';
import { REPO_URL, GITHUB_MARK } from '../core/icons.js';
import { localeOf, registerStrings } from '../core/i18n.js';
import { hscroll, menu, tooltips } from './ui.js';
import { hashParams } from './hash.js';
import { Renderer } from './renderer.js';
import { InteractionManager } from './interact.js';
import { Levels, DRILL_TEXT, setDrillLocale, crumbListHtml } from './levels.js';
import { DEPTH_KEYS, groupTrail } from '../core/nesting.js';
import { shortcutsHtml } from './shortcuts.js';
// The example gallery is loaded only when no payload is embedded, so built
// files (always embedded) do not carry it: `vite build` puts it in its own chunk.
// GALLERY holds the dropdown sections; EXAMPLES is every entry, diagrams first.
let GALLERY = [];
let EXAMPLES = [];

/** Sandbox of the gallery's page frame and its live diagram embeds: same origin, so the viewer's module scripts load in them. */
const GALLERY_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';

// Optional brand logos: src/assets/logo-light.svg (for light theme) and
// src/assets/logo-dark.svg (for dark theme). Missing files fall back to the default mark.
const LOGOS = import.meta.glob('../assets/logo-*.svg', { query: '?raw', import: 'default', eager: true });
const LOGO_LIGHT = LOGOS['../assets/logo-light.svg'] || LOGOS['../assets/logo-dark.svg'] || null;
const LOGO_DARK = LOGOS['../assets/logo-dark.svg'] || LOGO_LIGHT;

// Capture the untouched document so "Standalone HTML" can re-emit it
const PRISTINE = `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;

const $ = (id) => document.getElementById(id);

/** Autoplay speeds: factor -> ms per step. */
const SPEEDS = [
  [0.5, 9000],
  [1, 4500],
  [1.5, 3000],
  [2, 2250]
];

/** Arrow keys swap meaning in right-to-left documents. */
const MIRROR_KEY = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft', '←': '→', '→': '←' };
const isRtl = () => document.documentElement.dir === 'rtl';
const logicalKey = (key) => (isRtl() && MIRROR_KEY[key]) || key;

/**
 * Printable area in CSS px for a landscape page with 10mm margins (fits both
 * A4 and US Letter), minus a strip at the bottom for the watermark badge.
 */
const PRINT_PAGE = { w: 980, h: 660 };

/** Built-in inspector tabs (string keys); each appears only when the payload has content for it. */
const BUILTIN_TABS = { summary: 'tab.summary', step: 'tab.step', node: 'tab.node' };

const pref = (key, fallback) => {
  try {
    return localStorage.getItem(`yantra:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
};
const savePref = (key, value) => {
  try {
    localStorage.setItem(`yantra:${key}`, value);
  } catch {
    // storage unavailable
  }
};

class App {
  constructor(embedded) {
    const style = document.createElement('style');
    style.textContent = `${themeCss()}\n${BLOCK_CSS}\n${CARD_CHART_CSS}`;
    document.head.prepend(style);

    this.embedded = embedded;
    this.standalone = !document.querySelector('script[type="module"][src]');
    this.roleFilter = null;
    // Small frames (answer-page embeds, short windows) start with a one-row storyboard
    this.storyCollapsed = window.self !== window.top || window.innerHeight < 560;
    this.followCamera = pref('follow', '1') === '1';
    this.stepsScroller = hscroll($('story-steps'));
    this.tabsScroller = hscroll($('inspector-tabs'));
    tooltips(document.querySelector('.y-app'));

    // A gallery answer page (#example=<page id>) opens over the first diagram
    const fromHash = this.embedded ? null : this.exampleFromHash();
    const initial = this.embedded || (fromHash && !isPage(fromHash.data) ? fromHash.data : null) || EXAMPLES.find((x) => !isPage(x.data))?.data;
    // Drill-down: the engine shows one level; #level= (else meta.startLevel) picks which
    this.levels = new Levels(initial);
    this.levels.setPath(this.levelFromHash() ?? initial?.meta?.startLevel);
    this.engine = new YantraEngine(this.levels.current());
    this.L = localeOf(this.localeMeta());
    this.engine.setSpeed(Number(pref('speed', 4500)) || 4500);
    this.renderer = new Renderer($('world'));
    this.interact = new InteractionManager($('viewport'), $('world'), {
      getScene: () => this.engine.getScene(),
      getInsets: () => this.insets(),
      onNodeMove: (id, x, y) => this.moveNode(id, x, y),
      onNodeMoveEnd: () => this.engine.commitMoves(),
      onNodeClick: (id, how) => (how?.drill ? this.drillInto(id) : this.select(id)),
      onBackgroundClick: () => this.clearFocus(),
      onZoom: (z) => ($('zoom-label').textContent = this.L.num(Math.round(z * 100) / 100, { style: 'percent' }))
    });

    this.exportMenu = menu($('btn-export'), $('export-menu'));
    this.depthMenu = menu($('btn-depth'), $('depth-menu'));
    this.focusId = null; // group the camera is zoomed to (double-click a title, key G, step.focusGroup)
    this.focusFromStep = false;
    this.crumbTrails = {}; // nav id -> breadcrumb items, for the "…" menu of hidden levels
    this.legendMenu = menu($('btn-legend'), $('legend-list'), { canOpen: () => !$('legend').hidden });

    this.bindEngine();
    this.bindUi();
    this.bindKeys();
    this.bindPrint();
    this.inspectorTab = null;
    this.applyHashState();
    if (!this.focusId) this.stepFocus();
    this.applyLogo();
    this.renderSpeed();
    this.renderFollow();
    this.loadPayloadUi();
    this.setInspector(/inspector=/.test(location.hash) && this.inspectorTabs().length > 0);
    this.hashReady = true; // deep links are applied; from now on the URL follows the UI
    if (fromHash && isPage(fromHash.data)) this.showPage(fromHash);
    addEventListener('popstate', () => this.onHistory());

    const report = this.engine.validate();
    if (!report.valid) console.warn('[yantra] validation errors:', report.errors);
    window.yantra = this;
  }

  /**
   * Mirror the walkthrough in location.hash (keys read by applyHashState).
   * Defaults are omitted and unrelated keys such as example= are kept.
   */
  syncHash() {
    if (!this.hashReady) return;
    if (this.page) return this.syncPageHash();
    const e = this.engine;
    const params = hashParams(location.hash, false);
    const set = (key, value) => (value == null ? params.delete(key) : params.set(key, encodeURIComponent(value)));
    const defaultMode = getMode(e.model, e.model.meta.defaultMode)?.id;
    set('mode', e.modeId && e.modeId !== defaultMode ? e.modeId : null);
    const defaultView = e.model.meta.view === 'sequence' ? 'sequence' : 'flow';
    set('view', e.canSwitchView() && e.view !== defaultView ? e.view : null);
    set('scenario', e.scenarioIndex > 0 ? e.scenarioIndex + 1 : null);
    set('step', e.stepIndex > 0 ? e.stepIndex + 1 : null);
    set('role', this.roleFilter);
    set('inspector', this.inspectorOpen ? this.currentTab() : null);
    // Folded subtrees / groups, when they differ from meta.layout.collapsed (ids encoded one by one)
    // (or depth=n when they are exactly "fold to depth n")
    const depth = e.isDefaultCollapse() ? null : e.foldDepth();
    if (e.isDefaultCollapse() || depth !== null) params.delete('collapsed');
    else params.set('collapsed', [...e.collapsed].map(encodeURIComponent).join(','));
    if (depth === null) params.delete('depth');
    else params.set('depth', e.collapsed.size ? String(depth) : 'all');
    set('focus', this.focusId && !this.focusFromStep ? this.focusId : null);
    if (params.has('theme')) set('theme', document.documentElement.getAttribute('data-theme'));
    if (this.levels.depth) params.set('level', this.levels.hashValue());
    else params.delete('level');
    const hash = [...params].map(([k, v]) => `${k}=${v}`).join('&');
    if (hash === location.hash.slice(1)) return;
    // Absolute URL: in an embedded viewer (about:srcdoc) a relative path would
    // resolve against the host page and throw. Sandboxed frames may refuse anyway.
    const url = `${location.href.split('#')[0]}${hash ? `#${hash}` : ''}`;
    // Changing level adds a history entry (browser Back returns), except inside an
    // embed, where it would take over the host page's Back button
    if (this.pushLevel && window.self === window.top) {
      try {
        return history.pushState(null, '', url);
      } catch {
        // fall back to replacing the entry
      }
    }
    try {
      history.replaceState(history.state, '', url);
    } catch {
      // the URL simply does not mirror the state here
    }
  }

  // --- Lifecycle ----------------------------------------------------------
  loadPayloadUi() {
    const meta = this.engine.model.meta;
    this.applyLocale();
    $('doc-title').textContent = meta.title || this.L.t('app.untitled');
    $('doc-desc').textContent = meta.description || '';
    $('doc-desc').title = meta.description || '';
    document.title = meta.title ? `${meta.title} · Yantra` : 'Yantra';
    this.renderCrumbs();
    this.renderExamples();
    this.renderScenarios();
    this.renderSpeed();
    this.renderModes();
    this.renderView();
    this.renderDepth();
    this.renderFocusCrumbs();
    this.renderLegend();
    this.renderWatermark();
    this.redraw();
    this.renderStory();
    this.renderInspectorTabs();
    if (this.inspectorOpen && !this.inspectorTabs().length) this.setInspector(false);
    this.renderInspector();
    this.renderHelp();
    requestAnimationFrame(() => this.followStep({ animate: false, force: true }));
  }

  /**
   * Language and direction from meta.lang / meta.dir (and meta.strings):
   * sets <html lang dir> and relabels the static chrome marked with
   * data-i18n (text), data-i18n-label (aria-label) and data-i18n-tip (tooltip,
   * plus its data-kbd key hint).
   */
  applyLocale() {
    const L = (this.L = localeOf(this.localeMeta()));
    setDrillLocale(L);
    this.renderer.L = L;
    const root = document.documentElement;
    root.lang = L.lang;
    root.dir = L.dir;
    document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = L.t(el.dataset.i18n)));
    document.querySelectorAll('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', L.t(el.dataset.i18nLabel)));
    document.querySelectorAll('[data-i18n-tip]').forEach((el) => setTip(el, L.t(el.dataset.i18nTip) + (el.dataset.kbd ? ` (${logicalKey(el.dataset.kbd)})` : '')));
    document.querySelectorAll('[data-arrow]').forEach((el) => (el.textContent = logicalKey(el.dataset.arrow === 'next' ? '→' : '←')));
    this.setStoryCollapsed(this.storyCollapsed, false);
  }

  /** Language settings come from the overview: detail diagrams inherit its lang, dir and strings unless they set a lang. */
  localeMeta() {
    if (this.page) return this.page.meta || {};
    const root = this.levels?.root?.meta || {};
    const here = this.engine?.model.meta || {};
    return here.lang ? here : root;
  }

  redraw() {
    this.renderer.render(this.engine.getScene());
    this.applyState();
  }

  applyState() {
    this.renderer.applyState({
      highlight: this.engine.getHighlight(),
      step: this.engine.stepIndex,
      selectedId: this.engine.selectedNodeId,
      roleFilter: this.roleFilter,
      focusGroup: this.focusId
    });
  }

  /** Camera follows the walkthrough: frame the step's nodes, or everything. */
  followStep({ animate = true, force = false } = {}) {
    if (!this.followCamera && !force) return;
    if (this.engine.getView() === 'sequence') return this.followRow({ animate });
    if (this.focusId && this.fitGroup(this.focusId, { animate })) return;
    const hl = this.engine.getHighlight();
    if (hl.overview) return this.interact.fit(null, { animate });
    const scene = this.engine.getScene();
    const boxes = [
      ...scene.nodes.filter((n) => hl.nodes.has(n.id)),
      ...scene.edges.filter((e) => hl.edges.has(e.id)).flatMap((e) => e.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))
    ];
    if (!boxes.length) return this.interact.fit(null, { animate });
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    this.interact.fit({ x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 }, { animate });
  }

  /**
   * Sequence view: frame the participant headers down to the current row;
   * when that would get too small, centre the row instead.
   */
  followRow({ animate = true } = {}) {
    const scene = this.engine.getScene();
    const row = scene.rows[this.engine.stepIndex];
    if (!row) return this.interact.fit(null, { animate });
    const top = Math.min(...scene.participants.map((p) => p.y), row.y);
    const region = { x: scene.bounds.x, y: top - 20, w: scene.bounds.w, h: row.y + row.h - top + 40 };
    const vp = $('viewport').getBoundingClientRect();
    const inset = this.insets();
    const availH = vp.height - inset.top - inset.bottom - 64;
    const availW = vp.width - inset.left - inset.right - 64;
    // Keep the headers in frame unless that would shrink the text below ~60%
    if (Math.min(availW / region.w, availH / region.h) >= 0.6) return this.interact.fit(region, { animate });
    this.interact.fit({ x: region.x, y: row.y - 120, w: region.w, h: row.h + 240 }, { animate });
  }

  /**
   * Fold or unfold a subtree or group, keeping the clicked card (or the group,
   * which becomes its summary card) where it was on screen.
   */
  toggleCollapse(id) {
    const anchor = (scene) => {
      const n = scene.nodes.find((m) => m.id === id) || (scene.groups || []).find((g) => g.id === id);
      return n ? { x: n.x, y: n.y } : null;
    };
    const before = anchor(this.engine.getScene());
    const folding = !this.engine.collapsed.has(id);
    this.engine.toggleCollapse(id);
    const after = anchor(this.engine.getScene());
    if (before && after) this.interact.panBy((before.x - after.x) * this.interact.zoom, (before.y - after.y) * this.interact.zoom);
    this.toast(this.L.t(folding ? 'fold.folded' : 'fold.expanded'));
    requestAnimationFrame(() => this.renderer.toggles.get(id)?.focus({ preventScroll: true }));
  }

  /** Key X: fold or unfold the selected card's subtree (or a folded group card). */
  foldSelected() {
    const n = this.engine.getSelected();
    if (n?.toggle) this.toggleCollapse(n.id);
  }

  // --- Depth and group focus ------------------------------------------------
  /** Fold to depth: n levels of boxes (or tree levels) stay open; 'all' unfolds everything. */
  setDepth(n) {
    const info = this.engine.foldLevels();
    if (!info.kind || this.engine.getView() === 'sequence') return;
    this.engine.foldToDepth(n === 'all' ? null : n);
    this.toast(this.depthText(n));
    requestAnimationFrame(() => this.followStep({ force: true }));
  }

  /** Menu and toast text for a depth: "2 levels open", "Everything folded", "Everything open". */
  depthText(n) {
    if (n === 'all') return this.L.t('depth.all');
    if (!n) return this.L.t('depth.none');
    return this.L.plural(n, 'depth.level1', 'depth.level', { n: this.L.num(n) });
  }

  /** Toolbar menu "Fold to depth": shown when boxes (or tree levels) nest two or more deep. */
  renderDepth() {
    const e = this.engine;
    const info = e.foldLevels();
    const show = !!info.kind && info.levels >= 2 && e.getView() !== 'sequence';
    $('depth').hidden = !show;
    if (!show) return this.depthMenu.close();
    const current = e.collapsed.size ? e.foldDepth() : 'all';
    const top = Math.min(info.levels - 1, DEPTH_KEYS);
    const items = [];
    // trees: depth 0 and 1 both leave only the roots
    for (let d = info.kind === 'tree' ? 1 : 0; d <= top; d++) items.push([d, String(d)]);
    items.push(['all', '0']);
    const list = $('depth-menu');
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.depth : null;
    list.innerHTML = items
      .map(([d, key]) => `<button role="menuitemradio" tabindex="-1" data-depth="${d}" aria-checked="${current === d}"><span>${h(this.depthText(d))}</span><kbd>${key}</kbd></button>`)
      .join('');
    if (focused !== null) this.depthMenu.focusItem(list.querySelector(`[data-depth="${focused}"]`));
  }

  /** Box of a group on screen, or null (folded away, or not drawn in this view). */
  groupBox(id) {
    const scene = this.engine.getScene();
    return scene.kind === 'sequence' ? null : (scene.groups || []).find((g) => g.id === id) || null;
  }

  /** Point the camera at a group's box; false when it is not on screen. */
  fitGroup(id, { animate = true } = {}) {
    const g = this.groupBox(id);
    if (!g) return false;
    this.interact.fit({ x: g.x - 24, y: g.y - 24, w: g.w + 48, h: g.h + 48 }, { animate });
    return true;
  }

  /**
   * Zoom to a group: unfold it and the boxes around it, frame its box and
   * show the path of boxes around it. `fromStep`: the walkthrough asked for it
   * (the next step without focusGroup lets go).
   */
  setFocus(id, { fromStep = false, animate = true, toast = true } = {}) {
    if (!id) return this.clearGroupFocus();
    if (!this.engine.model.groups.some((g) => g.id === id) || this.engine.getView() === 'sequence') return;
    this.focusId = id;
    this.focusFromStep = fromStep;
    this.engine.revealGroup(id);
    this.renderFocusCrumbs();
    this.applyState();
    requestAnimationFrame(() => this.fitGroup(id, { animate }));
    if (toast) this.toast(this.L.t('focus.focused', { title: this.groupTitle(id) }));
    this.syncHash();
  }

  clearGroupFocus({ fit = true } = {}) {
    if (!this.focusId) return;
    this.focusId = null;
    this.focusFromStep = false;
    this.renderFocusCrumbs();
    this.applyState();
    if (fit) requestAnimationFrame(() => this.followStep({ force: true }));
    this.syncHash();
  }

  /** Esc while zoomed to a group: zoom out to the box around it (or the whole diagram). */
  focusOut() {
    const trail = groupTrail(this.engine.payload, this.focusId);
    const up = trail[trail.length - 2];
    if (up) this.setFocus(up.id, { toast: false });
    else this.clearGroupFocus();
  }

  /** Key G: zoom to the innermost group around the selected card (or out a level when nothing is selected). */
  focusSelected() {
    const id = this.engine.selectedNodeId;
    if (!id) return this.focusId ? this.focusOut() : undefined;
    const around = (this.engine.getScene().groups || []).filter((g) => !g.region && g.members.includes(id));
    const inner = around.sort((a, b) => b.depth - a.depth)[0];
    if (inner) this.setFocus(inner.id);
  }

  groupTitle(id) {
    return this.engine.model.groups.find((g) => g.id === id)?.title || id;
  }

  /** A step's focusGroup takes the camera; a step without one lets go of a step's focus. */
  stepFocus() {
    const id = this.engine.getStep()?.focusGroup;
    if (typeof id === 'string' && this.engine.model.groups.some((g) => g.id === id)) {
      this.focusId = id;
      this.focusFromStep = true;
    } else if (this.focusId) {
      this.focusId = null;
      this.focusFromStep = false;
    }
    this.renderFocusCrumbs();
  }

  /** Drop the focus when its group is no longer drawn (folded, another mode). */
  checkFocus() {
    if (this.focusId && !this.groupBox(this.focusId)) this.clearGroupFocus({ fit: false });
  }

  /** "Whole diagram › City › North district › Transport" under the toolbar while zoomed to a group. */
  renderFocusCrumbs() {
    const nav = $('focus-crumbs');
    if (!this.focusId || this.engine.getView() === 'sequence') {
      nav.hidden = true;
      nav.textContent = '';
      return;
    }
    const trail = groupTrail(this.engine.payload, this.focusId).map((g) => ({ title: g.title, attr: `data-focus="${h(g.id)}"` }));
    const items = [{ title: this.L.t('focus.whole'), attr: 'data-focus=""' }, ...trail];
    this.crumbTrails['focus-crumbs'] = items;
    nav.innerHTML = crumbListHtml(items, DRILL_TEXT.more);
    nav.hidden = false;
  }

  /** The "…" of a long breadcrumb: a menu of the levels it hides. */
  openCrumbMenu(btn) {
    const list = $('crumb-menu');
    if (this.crumbMenuFrom === btn && !list.hidden) return this.closeCrumbMenu(true);
    this.closeCrumbMenu();
    const items = this.crumbTrails[btn.closest('nav')?.id] || [];
    list.innerHTML = btn.dataset.crumbMore
      .split(',')
      .map(Number)
      .filter((i) => items[i])
      .map((i) => `<button role="menuitem" tabindex="-1" ${items[i].attr}>${h(items[i].title)}</button>`)
      .join('');
    list.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = list.offsetWidth;
    list.style.top = `${Math.round(r.bottom + 6)}px`;
    list.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, isRtl() ? r.right - w : r.left)))}px`;
    btn.setAttribute('aria-expanded', 'true');
    this.crumbMenuFrom = btn;
    const first = list.querySelector('button');
    if (first) {
      first.tabIndex = 0;
      first.focus();
    }
  }

  closeCrumbMenu(restoreFocus = false) {
    const list = $('crumb-menu');
    if (list.hidden) return false;
    list.hidden = true;
    this.crumbMenuFrom?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && this.crumbMenuFrom?.isConnected) this.crumbMenuFrom.focus();
    this.crumbMenuFrom = null;
    return true;
  }

  /** A breadcrumb item was chosen (in a nav or in the "…" menu). */
  crumbPick(el) {
    if (el.dataset.level !== undefined) return this.goUp(Number(el.dataset.level));
    if (el.dataset.focus !== undefined) return el.dataset.focus ? this.setFocus(el.dataset.focus, { toast: false }) : this.clearGroupFocus();
  }

  /** Pan (without zooming) so a card is not hidden behind the panels. */
  keepInView(id) {
    const n = this.engine.getScene().nodes.find((m) => m.id === id);
    if (!n) return;
    const vp = $('viewport').getBoundingClientRect();
    const inset = this.insets();
    const z = this.interact.zoom;
    const left = this.interact.x + n.x * z;
    const top = this.interact.y + n.y * z;
    const pad = 24;
    let dx = 0;
    let dy = 0;
    if (left + n.w * z > vp.width - inset.right - pad) dx = vp.width - inset.right - pad - (left + n.w * z);
    if (left + dx < inset.left + pad) dx = inset.left + pad - left;
    if (top + n.h * z > vp.height - inset.bottom - pad) dy = vp.height - inset.bottom - pad - (top + n.h * z);
    if (top + dy < inset.top + pad) dy = inset.top + pad - top;
    if (dx || dy) this.interact.panBy(dx, dy);
  }

  moveNode(id, x, y) {
    this.engine.moveNode(id, x, y);
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.renderer.update(this.engine.getScene());
    });
  }

  bindEngine() {
    const e = this.engine;
    e.on('stepChanged', () => {
      this.updateStory();
      this.announceStep();
      this.stepFocus();
      this.applyState();
      this.followStep();
      if (this.currentTab() === 'step') this.renderInspector();
      this.syncHash();
    });
    e.on('scenarioChanged', () => {
      this.engine.pause();
      this.renderScenarios();
      this.renderStory();
      this.renderView();
      // The sequence is drawn from the scenario's steps
      if (this.engine.getView() === 'sequence') {
        this.redraw();
        requestAnimationFrame(() => this.followStep({ animate: false, force: true }));
      }
      this.renderHelp();
      this.syncHash();
    });
    e.on('viewChanged', (view) => {
      this.renderView();
      this.renderDepth();
      this.renderFocusCrumbs();
      this.redraw();
      if (this.hashReady) this.toast(this.L.t(view === 'sequence' ? 'view.sequenceToast' : 'view.flowToast'));
      requestAnimationFrame(() => this.followStep({ animate: false, force: true }));
      this.renderHelp();
      this.syncHash();
    });
    e.on('modeChanged', (mode) => {
      // The new mode may hide every card of the filtered role
      if (this.roleFilter && !this.roleInUse(this.roleFilter)) this.roleFilter = null;
      this.renderModes();
      this.renderLegend();
      this.redraw();
      this.renderDepth();
      this.checkFocus();
      this.renderInspector();
      this.toast(`${mode.name}`);
      requestAnimationFrame(() => this.followStep({ animate: false, force: true }));
      this.renderHelp();
      this.syncHash();
    });
    e.on('selectionChanged', (id) => {
      this.applyState();
      const target = id && this.nodeClickTarget();
      if (target) {
        this.inspectorTab = target;
        this.setInspector(true);
      }
      this.renderInspector();
      if (id) requestAnimationFrame(() => this.keepInView(id));
    });
    e.on('playChanged', (playing) => {
      const btn = $('btn-play');
      btn.classList.toggle('is-on', playing);
      btn.setAttribute('aria-pressed', String(playing));
      btn.querySelector('span').textContent = this.L.t(playing ? 'story.pause' : this.engine.isLastStep() ? 'story.replay' : 'story.play');
      $('story').classList.toggle('is-playing', playing);
      this.updateStory();
    });
    // Restart the dwell bar on the active step chip
    e.on('tick', (ms) => {
      const bar = $('story-steps').querySelector('[aria-selected="true"] .y-step-progress');
      if (!bar) return;
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = `y-dwell ${ms}ms linear forwards`;
    });
    e.on('collapseChanged', () => {
      this.redraw();
      this.renderDepth();
      this.checkFocus();
      this.renderLegend();
      this.renderHelp();
      this.syncHash();
    });
    e.on('layoutReset', () => {
      this.redraw();
      requestAnimationFrame(() => this.followStep({ animate: false, force: true }));
    });
  }

  // --- Header -------------------------------------------------------------
  renderExamples() {
    const sel = $('example-select');
    sel.hidden = !!this.embedded;
    if (this.embedded) return;
    const current = EXAMPLES.find((x) => x.data === (this.page || this.levels.root));
    fillSelect(sel, GALLERY.map((g) => ({ label: this.L.t(g.label), items: g.items.map((x) => [x.id, x.name]) })), current?.id);
  }

  // --- Answer pages in the gallery -------------------------------------------
  /**
   * Show a gallery answer page (`"kind": "page"`) in a frame over the canvas.
   * The diagram stays loaded underneath; canvas-only controls are hidden (app.css .is-page).
   */
  showPage(ex) {
    this.engine.pause();
    this.page = ex.data;
    const meta = ex.data.meta || {};
    document.querySelector('.y-app').classList.add('is-page');
    this.setInspector(false);
    this.setHelp(false);
    // Keep a #theme= deep link; the diagram's walkthrough keys do not apply here
    const theme = hashParams(location.hash, false).has('theme') ? `&theme=${document.documentElement.getAttribute('data-theme')}` : '';
    try {
      history.replaceState(null, '', `#example=${ex.id}${theme}`);
    } catch {
      // the URL simply does not mirror the choice here
    }
    this.applyLocale();
    const title = meta.title || meta.question || this.L.t('page.answer');
    $('doc-title').textContent = title;
    $('doc-desc').textContent = meta.kicker || '';
    $('doc-desc').title = meta.kicker || '';
    document.title = `${title} · Yantra`;
    $('crumbs').hidden = true;
    this.renderExamples();
    let frame = $('page-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'page-frame';
      frame.className = 'y-page-frame';
      frame.setAttribute('sandbox', GALLERY_SANDBOX);
      frame.addEventListener('load', () => this.syncPageTheme());
      $('viewport').after(frame);
    }
    frame.title = title;
    frame.srcdoc = this.pageHtml(ex.data);
  }

  /** Back to the canvas (a diagram was picked). */
  hidePage() {
    if (!this.page) return;
    this.page = null;
    document.querySelector('.y-app').classList.remove('is-page');
    $('page-frame')?.remove();
  }

  /**
   * The page as `yantra build` would render it, in the viewer's theme: its own theme
   * button is hidden (the toolbar has one), web links open a new tab, and live
   * diagram embeds are this viewer with the diagram as its payload.
   */
  pageHtml(page) {
    const logos = LOGO_LIGHT ? { light: LOGO_LIGHT, dark: LOGO_DARK } : {};
    const html = renderPage(page, { logos, viewerHtml: (diagram) => embedHtml(diagram), frameSandbox: GALLERY_SANDBOX });
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const head = `<script>document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="http"]');if(a)a.target='_blank'},true);</script>
<style>.p-theme{display:none!important}</style>`;
    return html.replace('</head>', () => `${head}\n</head>`);
  }

  /** The page frame follows the toolbar's theme (its embeds follow the page). */
  syncPageTheme() {
    const root = $('page-frame')?.contentDocument?.documentElement;
    if (root) root.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }

  /** On a page only example= and theme= are kept in the URL. */
  syncPageHash() {
    const params = hashParams(location.hash, false);
    if (!params.has('theme')) return;
    params.set('theme', document.documentElement.getAttribute('data-theme'));
    try {
      history.replaceState(history.state, '', `#${[...params].map(([k, v]) => `${k}=${v}`).join('&')}`);
    } catch {
      // ignore
    }
  }

  /** Scenario picker lives in the storyboard; shown only with 2+ scenarios. */
  renderScenarios() {
    const sel = $('scenario-select');
    const scenarios = this.engine.getScenarios();
    sel.hidden = scenarios.length < 2;
    fillSelect(sel, scenarios.map((s, i) => [String(i), s.name || this.L.t('story.scenarioN', { n: this.L.num(i + 1) })]), String(this.engine.scenarioIndex));
  }

  renderSpeed() {
    fillSelect($('speed-select'), SPEEDS.map(([factor, ms]) => [String(ms), `${this.L.num(factor)}×`]), String(this.engine.playSpeed));
  }

  renderFollow() {
    $('btn-follow').setAttribute('aria-pressed', String(this.followCamera));
  }

  setFollow(on) {
    this.followCamera = on;
    savePref('follow', on ? '1' : '0');
    this.renderFollow();
    this.toast(this.L.t(on ? 'story.follow' : 'story.followOff'));
    if (on) this.followStep();
  }

  /** Flow / Sequence toggle: shown when the scenario has messages to sequence and both views are offered. */
  renderView() {
    const box = $('view-switch');
    const view = this.engine.getView();
    box.hidden = !this.engine.canSwitchView();
    box.querySelectorAll('[data-view]').forEach((b) => {
      const on = b.dataset.view === view;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('world').classList.toggle('is-sequence', view === 'sequence');
  }

  renderModes() {
    const box = $('mode-switch');
    const modes = this.engine.getModes();
    box.hidden = modes.length < 2;
    box.innerHTML = modes
      .map((m) => `<button role="radio" aria-checked="${m.id === this.engine.modeId}" data-mode="${h(m.id)}" title="${h(m.description || m.name)} (M)">${h(m.badge || m.name)}</button>`)
      .join('');
  }

  /** Round legend button; its menu filters the canvas to one role. */
  renderLegend() {
    const scene = this.engine.getScene();
    const used = new Set(scene.nodes.map((n) => n.node.type || 'node'));
    const roles = Object.entries(this.engine.model.roles).filter(([type]) => used.has(type));
    // Mind maps colour by branch: a roles legend would not match the cards
    $('legend').hidden = roles.length < 2 || !!scene.branchColors;
    const active = roles.find(([type]) => type === this.roleFilter);
    const fab = $('btn-legend');
    fab.classList.toggle('is-filtered', !!active);
    if (active) fab.dataset.hue = active[1].hue;
    else delete fab.dataset.hue;
    const L = this.L;
    setTip(fab, `${active ? L.t('legend.showing', { role: active[1].label }) : L.t('legend.title')} (L)`);
    fab.setAttribute('aria-label', active ? L.t('legend.labelShowing', { role: active[1].label }) : L.t('legend.label'));
    const list = $('legend-list');
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.role : null;
    list.innerHTML =
      `<button role="menuitemradio" tabindex="-1" data-role="" aria-checked="${!this.roleFilter}"><i class="y-all"></i>${h(L.t('legend.all'))}</button>` +
      roles
        .map(([type, r]) => {
          const count = scene.nodes.filter((n) => (n.node.type || 'node') === type).length;
          return `<button role="menuitemradio" tabindex="-1" data-role="${h(type)}" data-hue="${r.hue}" aria-checked="${this.roleFilter === type}"><i></i>${h(r.label)}<em>${L.num(count)}</em></button>`;
        })
        .join('');
    // Re-rendering must not drop keyboard focus out of an open menu
    if (focused !== null && focused !== undefined) this.legendMenu.focusItem(list.querySelector(`[data-role="${CSS.escape(focused)}"]`));
  }

  setLegendOpen(open) {
    if (open) this.legendMenu.open();
    else this.legendMenu.close();
  }

  // --- Story --------------------------------------------------------------
  /** Rebuild the step strip (on load / scenario change), then sync state. */
  renderStory() {
    const steps = this.engine.getSteps();
    const story = $('story');
    story.hidden = !this.engine.getScenarios().some((s) => s.steps?.length);
    // Chips start in their final state: no colour transition on first paint
    const at = this.engine.stepIndex;
    $('story-steps').innerHTML = steps
      .map(
        (s, k) =>
          `<button role="tab" class="y-step${k < at ? ' is-done' : ''}" data-step="${k}" aria-selected="${k === at}" tabindex="${k === at ? 0 : -1}"><b>${this.L.num(k + 1)}</b><span>${h(s.title || this.L.t('story.step', { n: this.L.num(k + 1) }))}</span><i class="y-step-progress"></i></button>`
      )
      .join('');
    this.stepsScroller.update();
    const multi = steps.length > 1;
    for (const id of ['btn-play', 'speed-select', 'btn-restart']) $(id).hidden = !multi;
    story.classList.toggle('is-collapsed', this.storyCollapsed);
    this.updateStory(false);
  }

  /** Per-step update: text, active chip, button states. */
  updateStory(smooth = true) {
    const steps = this.engine.getSteps();
    const L = this.L;
    if (!steps.length) {
      $('story-title').textContent = L.t('story.empty');
      $('story-desc').textContent = '';
      $('story-count').textContent = '';
      return;
    }
    const i = Math.min(this.engine.stepIndex, steps.length - 1);
    const step = steps[i];
    const two = { minimumIntegerDigits: 2, useGrouping: false };
    $('story-count').textContent = `${L.num(i + 1, two)} / ${L.num(steps.length, two)}`;
    $('story-title').textContent = step.title || L.t('story.step', { n: L.num(i + 1) });
    const desc = $('story-desc');
    desc.textContent = step.description || '';
    desc.classList.remove('is-expanded');
    $('btn-story-more').textContent = L.t('story.more');
    requestAnimationFrame(() => ($('btn-story-more').hidden = this.storyCollapsed || desc.scrollHeight <= desc.clientHeight + 1));

    const chips = $('story-steps').querySelectorAll('.y-step');
    chips.forEach((c, k) => {
      c.setAttribute('aria-selected', String(k === i));
      c.classList.toggle('is-done', k < i);
      c.tabIndex = k === i ? 0 : -1;
    });
    this.stepsScroller.reveal(chips[i], smooth);

    $('btn-prev').disabled = i === 0;
    $('btn-next').disabled = i === steps.length - 1;
    $('btn-restart').disabled = i === 0;
    if (!this.engine.playing) $('btn-play').querySelector('span').textContent = L.t(i === steps.length - 1 ? 'story.replay' : 'story.play');
  }

  /**
   * One polite announcement per step change. Silent during autoplay and when
   * focus is on a step chip (the screen reader already reads the tab).
   */
  announceStep() {
    const live = $('story-live');
    const step = this.engine.getStep();
    if (!live || !step || this.engine.playing || document.activeElement?.closest?.('#story-steps')) return;
    const total = this.engine.getSteps().length;
    live.textContent = this.L.t('story.stepOf', { n: this.L.num(this.engine.stepIndex + 1), total: this.L.num(total), title: step.title || '' });
  }

  setStoryCollapsed(v, update = true) {
    this.storyCollapsed = v;
    $('story').classList.toggle('is-collapsed', v);
    $('btn-story-toggle').setAttribute('aria-expanded', String(!v));
    setTip($('btn-story-toggle'), `${this.L.t(v ? 'story.expand' : 'story.collapse')} (S)`);
    if (update) this.updateStory(false);
  }

  // --- Inspector ----------------------------------------------------------
  /**
   * Tabs come from the payload: a built-in tab appears only when there is
   * content for it, `panels` add custom tabs, and `meta.inspector.tabs` picks
   * and orders them explicitly.
   */
  inspectorTabs() {
    const { meta, scenarios, nodes, panels, inspector } = this.engine.model;
    const has = {
      summary: !!(meta.summary && typeof meta.summary === 'object'),
      step: scenarios.some((s) => (s.steps || []).some((st) => (st.payload && typeof st.payload === 'object') || safeUrl(st.url))),
      node: nodes.some((n) => {
        const d = n.data || {};
        return d.description || d.tech || d.runtime || d.ports || d.status || d.sourceFile || Object.keys(d.metadata || {}).length || this.levels.target(n) || safeUrl(d.url) || isEntity(d) || chartBlock(n);
      })
    };
    const labels = { ...Object.fromEntries(Object.entries(BUILTIN_TABS).map(([id, key]) => [id, this.L.t(key)])), ...(inspector.labels || {}) };
    const all = [
      ...Object.keys(BUILTIN_TABS).map((id) => ({ id, label: labels[id], show: has[id] })),
      ...panels.filter((p) => p.id && p.title).map((p) => ({ id: p.id, label: p.title, panel: p, show: true }))
    ];
    if (Array.isArray(inspector.tabs)) return inspector.tabs.map((id) => all.find((t) => t.id === id)).filter(Boolean);
    return all.filter((t) => t.show);
  }

  currentTab() {
    const tabs = this.inspectorTabs();
    return tabs.find((t) => t.id === this.inspectorTab)?.id || tabs[0]?.id || null;
  }

  renderInspectorTabs() {
    const tabs = this.inspectorTabs();
    $('btn-inspector').hidden = tabs.length === 0;
    const box = $('inspector-tabs');
    box.innerHTML = tabs.map((t) => `<button role="tab" data-tab="${h(t.id)}" aria-selected="false" tabindex="-1">${h(t.label)}</button>`).join('');
    this.tabsScroller.update();
  }

  setInspector(open, tab) {
    if (open && !this.inspectorTabs().length) open = false;
    if (tab) this.inspectorTab = tab;
    if (open) this.setHelp(false);
    this.inspectorOpen = open;
    $('inspector').classList.toggle('is-open', open);
    $('inspector').inert = !open;
    $('btn-inspector').setAttribute('aria-pressed', String(open));
    if (open) this.renderInspector();
    this.syncHash();
  }

  setInspectorTab(tab) {
    this.inspectorTab = tab;
    this.renderInspector();
    this.syncHash();
  }

  renderInspector() {
    if (!this.inspectorOpen) return;
    const tab = this.currentTab();
    const tabs = $('inspector-tabs').querySelectorAll('[data-tab]');
    tabs.forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) this.tabsScroller.reveal(b);
    });
    const panel = this.inspectorTabs().find((t) => t.id === tab)?.panel;
    $('inspector-body').innerHTML =
      tab === 'node' ? this.nodeHtml()
      : tab === 'step' ? this.stepHtml()
      : tab === 'summary' ? this.summaryHtml()
      : panel ? this.panelHtml(panel)
      : '';
    enhanceCharts($('inspector-body'));
    $('inspector-body').scrollTop = 0;
  }

  /**
   * Tab a card click opens, from meta.inspector.onNodeClick:
   * "node" (default) - Details; "stay" - highlight only, the panel keeps its
   * tab; a panel id - that panel, filtered to the clicked card. Returns null
   * when the target tab is not available.
   */
  nodeClickTarget() {
    const want = this.engine.model.inspector.onNodeClick || 'node';
    if (want === 'stay') return null;
    return this.inspectorTabs().some((t) => t.id === want) ? want : null;
  }

  /**
   * Custom panel: the same blocks as answer pages, stacked in one column.
   * Blocks with `nodes: [...]` show only while one of those cards is selected;
   * blocks without it always show.
   */
  panelHtml(panel) {
    const L = this.L;
    const sel = this.engine.getSelected();
    const blocks = (panel.blocks || []).filter((b) => !Array.isArray(b.nodes) || (sel && b.nodes.includes(sel.id)));
    const scoped = (panel.blocks || []).some((b) => Array.isArray(b.nodes));
    const head = scoped
      ? sel
        ? `<div class="y-panel-scope" data-hue="${sel.hue}"><i></i><span>${L.tHtml('panel.for', { name: `<strong>${h(sel.node.data?.title || sel.id)}</strong>` })}</span><button class="y-link" data-clear-selection>${h(L.t('panel.showAll'))}</button></div>`
        : `<p class="y-panel-hint">${h(L.t('panel.hint'))}</p>`
      : '';
    const meta = this.engine.model.meta;
    // Charts are drawn at the panel's width, so they fit instead of scrolling sideways
    const box = $('inspector-body');
    const pad = box ? parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight) : 0;
    const width = box && box.clientWidth ? box.clientWidth - pad : 300;
    const body = blocks.length
      ? blocks.map((b, i) => renderBlock({ ...b, span: 'full' }, `${panel.id}-${i}`, { pageMeta: meta, locale: L, width })).join('')
      : `<p class="y-empty">${h(L.t('panel.empty'))}</p>`;
    return `<div class="y-panel">${head}${body}</div>`;
  }

  /** Summary card: what the diagram explains, key points, facts and counts. */
  summaryHtml() {
    const { meta, roles, scenarios } = this.engine.model;
    const L = this.L;
    const scene = this.engine.getFlowScene();
    const summary = meta.summary && typeof meta.summary === 'object' ? meta.summary : {};
    const steps = scenarios.reduce((n, s) => n + (s.steps?.length || 0), 0);
    const stats = [
      ['summary.components', scene.nodes.length],
      ['summary.connections', scene.edges.length],
      ['summary.steps', steps],
      ...(this.engine.getModes().length > 1 ? [['summary.modes', this.engine.getModes().length]] : [])
    ];
    const used = Object.entries(roles)
      .map(([type, r]) => [type, r, scene.nodes.filter((n) => (n.node.type || 'node') === type).length])
      .filter(([, , count]) => count);
    const facts = Object.entries(summary.facts || {});
    return `
      <div class="y-summary">
        <span class="y-kicker">${h(L.t('tab.summary'))}</span>
        <h3>${h(meta.title || L.t('app.untitled'))}</h3>
        ${summary.headline ? `<p class="y-summary-headline">${h(summary.headline)}</p>` : ''}
        ${meta.description ? `<p class="y-muted">${h(meta.description)}</p>` : ''}
        <div class="y-stats">${stats.map(([k, v]) => `<div><strong>${L.num(v)}</strong><span>${h(L.t(k))}</span></div>`).join('')}</div>
        ${(summary.points || []).length ? `<h4>${h(L.t('summary.points'))}</h4><ul class="y-points">${summary.points.map((p) => `<li>${h(p)}</li>`).join('')}</ul>` : ''}
        ${facts.length ? `<h4>${h(L.t('summary.facts'))}</h4><dl class="y-fields">${facts.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>` : ''}
        ${used.length > 1 ? `<h4>${h(L.t('summary.roles'))}</h4><ul class="y-role-list">${used.map(([type, r, count]) => `<li><button data-filter-role="${h(type)}" data-hue="${r.hue}"><i></i>${h(r.label)}<em>${L.num(count)}</em></button></li>`).join('')}</ul>` : ''}
        ${this.detailsHtml(scene)}
        ${scenarios.length > 1 ? `<h4>${h(L.t('summary.scenarios'))}</h4><ul class="y-points">${scenarios.map((s) => `<li>${h(s.name || s.id)}${s.description ? ` <span class="y-muted">- ${h(s.description)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  stepHtml() {
    const step = this.engine.getStep();
    if (!step) return `<p class="y-empty">${h(this.L.t('step.none'))}</p>`;
    const p = step.payload;
    let html = `<h3>${h(step.title || '')}</h3>${step.description ? `<p class="y-muted">${h(step.description)}</p>` : ''}${linkHtml(step.url)}`;
    if (!p || typeof p !== 'object') return html;
    const chips = ['method', 'status', 'latency', 'protocol'].filter((k) => p[k]).map((k) => `<span class="y-chip" data-k="${k}">${h(p[k])}</span>`);
    if (chips.length) html += `<div class="y-chips">${chips.join('')}</div>`;
    if (p.endpoint) html += `<code class="y-endpoint">${h(p.endpoint)}</code>`;
    const rest = Object.fromEntries(Object.entries(p).filter(([k]) => !['method', 'status', 'latency', 'protocol', 'endpoint'].includes(k)));
    const body = Object.keys(rest).length === 1 && rest.body !== undefined ? rest.body : rest;
    if (body !== undefined && Object.keys(rest).length) {
      html += `<div class="y-code-head"><span>${h(this.L.t('step.payload'))}</span><button class="y-link" data-copy="payload">${h(this.L.t('step.copy'))}</button></div><pre class="y-code">${h(JSON.stringify(body, null, 2))}</pre>`;
    }
    return html;
  }

  nodeHtml() {
    const sel = this.engine.getSelected();
    const L = this.L;
    if (!sel) return `<p class="y-empty">${h(L.t('node.none'))}</p>`;
    const d = sel.node.data || {};
    const role = this.engine.model.roles[sel.node.type || 'node'];
    const fields = [
      [L.t('node.tech'), d.tech],
      [L.t('node.runtime'), d.runtime],
      [L.t('node.ports'), d.ports],
      [L.t('node.status'), d.status],
      [L.t('node.source'), d.sourceFile],
      ...Object.entries(d.metadata || {})
    ].filter(([, v]) => v !== undefined && v !== null && v !== '');
    const conns = this.engine.edgesOf(sel.id).map((e) => {
      const out = e.edge.source === sel.id;
      const other = out ? e.edge.target : e.edge.source;
      const url = safeUrl(e.edge.url);
      const link = url ? `<a class="y-conn-link" href="${h(url)}" target="_blank" rel="noopener noreferrer" data-tip="${h(DRILL_TEXT.link)}" aria-label="${h(`${DRILL_TEXT.edgeLink(e.edge.label || e.id)} ${DRILL_TEXT.newTab}`)}">${icon(LINK_ICON, 13)}</a>` : '';
      // ↻ self-loop, ↔ both ways, — undirected, else → out / ← in
      const glyph = e.edge.source === e.edge.target ? '↻' : e.arrow === 'both' ? '↔' : e.arrow === 'none' ? '—' : logicalKey(out ? '→' : '←');
      return `<li${url ? ' class="has-link"' : ''}><button class="y-conn" data-node="${h(other)}"><span>${glyph}</span>${h(this.engine.nodeTitle(other))}<em>${h(e.edge.label || notationText(e.edge, L))}</em></button>${link}</li>`;
    });
    // Columns (ER) or attributes and methods (class): key / visibility, name, type, notes
    const memberRows = (kind) =>
      members(d[kind])
        .map((m) => {
          const notes = [m.ref && `→ ${m.ref}`, m.nullable && L.t('md.nullable'), m.static && L.t('md.static'), m.abstract && L.t('md.abstract'), m.note].filter(Boolean).join(' · ');
          return `<tr><td class="y-member-key">${h(memberKey(m, kind))}</td><td>${h(memberName(m, kind))}${notes ? `<small>${h(notes)}</small>` : ''}</td><td class="y-member-type">${h(memberType(m))}</td></tr>`;
        })
        .join('');
    const tables = ['fields', 'methods']
      .filter((kind) => members(d[kind]).length)
      .map((kind) => `<h4>${h(L.t(kind === 'fields' ? 'md.fields' : 'md.methods'))}</h4><table class="y-members"><tbody>${memberRows(kind)}</tbody></table>`)
      .join('');
    return `
      <div class="y-kicker" data-hue="${sel.hue}">${h(sel.kicker || role?.label || '')}</div>
      <h3>${h(d.title || sel.id)}</h3>
      ${d.subtitle ? `<p class="y-muted">${h(d.subtitle)}</p>` : ''}
      ${d.description ? `<p>${h(d.description)}</p>` : ''}
      ${this.drillButton(sel.node)}${linkHtml(d.url)}
      ${fields.length ? `<dl class="y-fields">${fields.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>` : ''}
      ${tables}${this.nodeChartHtml(sel.node)}
      <h4>${h(L.t('node.connections'))}</h4>
      ${conns.length ? `<ul class="y-conns">${conns.join('')}</ul>` : `<p class="y-empty">${h(L.t('node.noConnections'))}</p>`}`;
  }

  /** A card's chart (data.chart) at full size, drawn at the panel's width with its data table. */
  nodeChartHtml(node) {
    const L = this.L;
    const b = withChartLocale(L, () => chartBlock(node));
    if (!b) return '';
    const box = $('inspector-body');
    const pad = box ? parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight) : 0;
    const width = box && box.clientWidth ? box.clientWidth - pad : 300;
    return `<h4>${h(b.title || L.t('node.chart'))}</h4>${renderBlock({ ...b, title: undefined, span: 'full' }, `node-chart-${node.id}`, { pageMeta: this.engine.model.meta, locale: L, width })}`;
  }

  // --- Levels (drill-down) ---------------------------------------------------
  levelFromHash() {
    const raw = hashParams(location.hash, false).get('level');
    return raw ? Levels.parseHash(raw) : null;
  }

  /** What to restore when coming back up to a level. */
  levelState() {
    const e = this.engine;
    return { modeId: e.modeId, view: e.view, scenarioIndex: e.scenarioIndex, stepIndex: e.stepIndex, selected: e.selectedNodeId, collapsed: [...e.collapsed] };
  }

  /** Open the detail diagram of a card (no-op when it has none). */
  drillInto(id) {
    const n = this.engine.getScene().nodes.find((m) => m.id === id);
    const target = n && this.levels.target(n.node);
    if (!target) return;
    this.levels.push(target, this.levelState());
    this.showLevel(null, true);
    this.toast(DRILL_TEXT.opened(this.levels.title(target)));
  }

  /** Back up to depth n (0 = overview), restoring that level's step and selection. */
  goUp(depth) {
    if (depth < 0 || depth >= this.levels.depth) return;
    this.showLevel(this.levels.popTo(depth), true);
  }

  /** Load the current level into the engine and rebuild the UI. */
  showLevel(state, push) {
    const ready = this.hashReady;
    this.hashReady = false; // one history entry per level change, written below
    this.engine.load(this.levels.current());
    this.roleFilter = null;
    this.inspectorTab = null;
    this.focusId = null;
    this.focusFromStep = false;
    if (state) {
      this.engine.setMode(state.modeId);
      this.engine.setView(state.view);
      this.engine.setScenario(state.scenarioIndex);
      if (state.collapsed) this.engine.setCollapsed(state.collapsed); // folds survive a drill down and back
      this.engine.goToStep(state.stepIndex);
    }
    this.loadPayloadUi();
    if (state?.selected) this.engine.selectNode(state.selected);
    this.hashReady = ready;
    this.pushLevel = push;
    this.syncHash();
    this.pushLevel = false;
  }

  /** Browser Back / Forward: follow the level in the URL, then its step and view. */
  onHistory() {
    if (this.page) return;
    const want = this.levelFromHash() || [];
    const same = want.length === this.levels.depth && want.every((id, i) => id === this.levels.path[i]);
    if (same) return;
    this.levels.setPath(want);
    this.hashReady = false;
    this.showLevel(null, false);
    this.applyHashState();
    this.hashReady = true;
    this.renderLegend();
    this.applyState();
    this.renderInspector();
  }

  renderCrumbs() {
    const nav = $('crumbs');
    nav.hidden = !this.levels.depth;
    nav.innerHTML = this.levels.crumbsHtml();
    this.crumbTrails.crumbs = this.levels.crumbItems();
    $('doc-desc').hidden = this.levels.depth > 0;
    document.querySelector('[data-action="md-all"]').hidden = !this.levels.any;
  }

  /** Inspector button that opens a card's detail diagram. */
  drillButton(node) {
    const target = this.levels.target(node);
    if (!target) return '';
    return `<button class="y-btn y-drill-open" data-drill-open="${h(node.id)}">${icon(DRILL_ICON, 14)}<span>${h(DRILL_TEXT.open(this.levels.title(target)))}</span></button>`;
  }

  /** Summary tab: the detail diagrams this level opens, one button each. */
  detailsHtml(scene) {
    const items = scene.nodes.filter((n) => this.levels.target(n.node));
    if (!items.length) return '';
    return `<h4>${h(DRILL_TEXT.details)}</h4><ul class="y-role-list">${items
      .map((n) => `<li><button data-drill-open="${h(n.id)}" data-hue="${n.hue}"><i></i>${h(this.levels.title(this.levels.target(n.node)))}</button></li>`)
      .join('')}</ul>`;
  }

  // --- Focus --------------------------------------------------------------
  select(id) {
    this.engine.selectNode(id);
  }

  clearFocus() {
    this.engine.clearSelection();
    if (this.roleFilter) {
      this.roleFilter = null;
      this.renderLegend();
      this.applyState();
      this.syncHash();
    }
    this.legendMenu.close();
    this.exportMenu.close();
  }

  toggleRole(type) {
    this.roleFilter = !type || this.roleFilter === type ? null : type;
    this.engine.clearSelection();
    this.renderLegend();
    this.applyState();
    this.syncHash();
  }

  /**
   * Keyboard shortcuts side panel: docks where the inspector does and replaces
   * it while open. Focus moves in on open and back to the trigger on close.
   */
  setHelp(open, { refocus = true } = {}) {
    const help = $('help');
    if (open === !!this.helpOpen) return;
    if (open && this.page) return;
    this.helpOpen = open;
    if (open) {
      if (this.inspectorOpen) this.setInspector(false);
      this.helpReturn = document.activeElement;
      this.renderHelp();
    }
    help.classList.toggle('is-open', open);
    help.inert = !open;
    $('btn-help').setAttribute('aria-pressed', String(open));
    if (open) help.focus({ preventScroll: true });
    else {
      const back = this.helpReturn;
      this.helpReturn = null;
      if (refocus && (help.contains(document.activeElement) || document.activeElement === document.body)) (back?.isConnected ? back : $('btn-help')).focus?.();
    }
  }

  /** What the open diagram offers, so the panel lists only the keys that do something here. */
  shortcutContext() {
    const e = this.engine;
    const scene = e.getScene();
    const sequence = scene.kind === 'sequence';
    const info = e.foldLevels();
    return {
      steps: e.getSteps().length > 0,
      scenarios: e.getScenarios().length,
      modes: e.getModes().length > 1,
      views: e.canSwitchView(),
      inspector: this.inspectorTabs().length > 0,
      legend: !$('legend').hidden,
      fold: !sequence && scene.nodes.some((n) => n.toggle),
      depth: $('depth').hidden ? 0 : Math.min(info.levels - 1, DEPTH_KEYS),
      drill: this.levels.depth > 0 || e.model.nodes.some((n) => this.levels.target(n)),
      groups: !sequence && (scene.groups || []).some((g) => !g.region),
      drag: !sequence
    };
  }

  renderHelp() {
    const L = this.L;
    const foot = h(L.t('help.footer')).replace('?', '<kbd>?</kbd>');
    $('help-foot').innerHTML = foot;
    if (!this.helpOpen) return;
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '');
    $('help-body').innerHTML = shortcutsHtml(L, this.shortcutContext(), { mac, rtl: isRtl() });
  }

  /** Space covered by floating chrome, so fit-to-view keeps cards visible. */
  insets() {
    const vp = $('viewport').getBoundingClientRect();
    const bar = document.querySelector('.y-bar').getBoundingClientRect();
    const story = $('story');
    let bottom = 16;
    if (!story.hidden) bottom = Math.max(bottom, vp.bottom - story.getBoundingClientRect().top + 8);
    const fab = $('btn-legend').getBoundingClientRect();
    if (!$('legend').hidden && fab.top > vp.top + vp.height / 2) bottom = Math.max(bottom, vp.bottom - fab.top + 8);
    const panel = this.inspectorOpen ? $('inspector') : this.helpOpen ? $('help') : null;
    const side = panel && window.innerWidth > 720 ? panel.getBoundingClientRect().width + 16 : 16;
    // the group path sits under the toolbar while zoomed to a group
    const crumbs = $('focus-crumbs');
    const top = crumbs.hidden ? bar.bottom : Math.max(bar.bottom, crumbs.getBoundingClientRect().bottom);
    return { top: top - vp.top + 8, bottom, left: isRtl() ? side : 16, right: isRtl() ? 16 : side };
  }

  // --- UI events ----------------------------------------------------------
  bindUi() {
    $('btn-next').onclick = () => this.engine.next();
    $('btn-prev').onclick = () => this.engine.prev();
    $('btn-play').onclick = () => this.engine.togglePlay();
    $('btn-restart').onclick = () => this.engine.restart();
    $('btn-story-toggle').onclick = () => this.setStoryCollapsed(!this.storyCollapsed);
    $('btn-follow').onclick = () => this.setFollow(!this.followCamera);
    $('btn-present').onclick = () => this.togglePresent();
    $('btn-story-more').onclick = () => {
      const open = $('story-desc').classList.toggle('is-expanded');
      $('btn-story-more').textContent = this.L.t(open ? 'story.less' : 'story.more');
    };
    $('story-steps').onclick = (ev) => {
      const k = ev.target.closest('[data-step]')?.dataset.step;
      if (k !== undefined) this.engine.goToStep(Number(k));
    };
    $('story-steps').onkeydown = (ev) => rovingKeys(ev, '[data-step]', (el) => this.engine.goToStep(Number(el.dataset.step)));
    $('scenario-select').onchange = (ev) => this.engine.setScenario(Number(ev.target.value));
    $('speed-select').onchange = (ev) => {
      this.engine.setSpeed(Number(ev.target.value));
      savePref('speed', ev.target.value);
    };
    $('mode-switch').onclick = (ev) => {
      const m = ev.target.closest('[data-mode]')?.dataset.mode;
      if (m) this.engine.setMode(m);
    };
    $('view-switch').onclick = (ev) => {
      const v = ev.target.closest('[data-view]')?.dataset.view;
      if (v) this.engine.setView(v);
    };
    $('view-switch').onkeydown = (ev) => rovingKeys(ev, '[data-view]', (el) => this.engine.setView(el.dataset.view));
    $('legend-list').onclick = (ev) => {
      const item = ev.target.closest('[data-role]');
      if (item) this.toggleRole(item.dataset.role);
    };
    $('example-select').onchange = (ev) => {
      const ex = EXAMPLES.find((x) => x.id === ev.target.value);
      if (!ex) return;
      if (isPage(ex.data)) return this.showPage(ex);
      this.hidePage();
      this.levels.reset(ex.data);
      this.engine.load(ex.data);
      this.focusId = null;
      this.focusFromStep = false;
      this.engine.setSpeed(Number(pref('speed', 4500)) || 4500);
      this.roleFilter = null;
      this.inspectorTab = null;
      history.replaceState(null, '', `#example=${ex.id}`);
      this.loadPayloadUi();
    };

    // Fold buttons on cards and group boxes
    $('world').addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('.y-toggle');
      if (!btn) return;
      ev.stopPropagation();
      this.toggleCollapse(btn.dataset.toggle);
    });

    $('btn-zoom-in').onclick = () => this.interact.zoomBy(1.2);
    $('btn-zoom-out').onclick = () => this.interact.zoomBy(1 / 1.2);
    $('btn-fit').onclick = () => this.interact.fit();
    $('btn-theme').onclick = () => this.toggleTheme();
    $('btn-help').onclick = () => this.setHelp(!this.helpOpen);
    $('btn-close-help').onclick = () => this.setHelp(false);
    $('btn-inspector').onclick = () => this.toggleInspector();
    $('btn-close-inspector').onclick = () => this.setInspector(false);
    $('inspector-tabs').onclick = (ev) => {
      const t = ev.target.closest('[data-tab]')?.dataset.tab;
      if (t) this.setInspectorTab(t);
    };
    $('inspector-tabs').onkeydown = (ev) => rovingKeys(ev, '[data-tab]', (el) => this.setInspectorTab(el.dataset.tab));
    $('inspector-body').onclick = (ev) => {
      const node = ev.target.closest('[data-node]')?.dataset.node;
      if (node) this.select(node);
      const drill = ev.target.closest('[data-drill-open]')?.dataset.drillOpen;
      if (drill) this.drillInto(drill);
      const role = ev.target.closest('[data-filter-role]')?.dataset.filterRole;
      if (role) this.toggleRole(role);
      if (ev.target.closest('[data-clear-selection]')) this.engine.clearSelection();
      if (ev.target.closest('[data-copy]')) {
        const pre = $('inspector-body').querySelector('pre');
        this.copy(pre?.textContent || '', this.L.t('toast.payloadCopied'));
      }
    };

    $('export-menu').onclick = (ev) => {
      const action = ev.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      this.exportMenu.close(true);
      this.exportAs(action);
    };
    // Breadcrumbs (levels and group focus): an item, or the "…" that lists the hidden ones
    const crumbClick = (ev) => {
      const more = ev.target.closest('[data-crumb-more]');
      if (more) return this.openCrumbMenu(more);
      const item = ev.target.closest('[data-level], [data-focus]');
      if (item) this.crumbPick(item);
    };
    $('crumbs').onclick = crumbClick;
    $('focus-crumbs').onclick = crumbClick;
    $('crumb-menu').onclick = (ev) => {
      const item = ev.target.closest('[data-level], [data-focus]');
      if (!item) return;
      this.closeCrumbMenu();
      this.crumbPick(item);
    };
    $('crumb-menu').onkeydown = (ev) => {
      const items = [...$('crumb-menu').querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[ev.key];
      if (to !== undefined) {
        const el = items[(to + items.length) % items.length];
        items.forEach((b) => (b.tabIndex = b === el ? 0 : -1));
        el.focus();
      } else if (ev.key === 'Escape') this.closeCrumbMenu(true);
      else if (ev.key === 'Tab') return this.closeCrumbMenu();
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest?.('#crumb-menu, [data-crumb-more]')) this.closeCrumbMenu();
    });
    $('depth-menu').onclick = (ev) => {
      const d = ev.target.closest('[data-depth]')?.dataset.depth;
      if (d === undefined) return;
      this.depthMenu.close(true);
      this.setDepth(d === 'all' ? 'all' : Number(d));
    };
    // Double-click: a group title zooms to the group, a card opens its detail diagram
    $('viewport').addEventListener('dblclick', (ev) => {
      const group = ev.target.closest?.('.y-group-title')?.dataset.group;
      if (group) return this.setFocus(group);
      const id = ev.target.closest?.('.y-node')?.dataset.id;
      if (id) this.drillInto(id);
    });
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.page || this.interact.fit(), 150);
    });
  }

  bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target.closest?.('input, textarea, select') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key;
      // An answer page has no canvas: only the theme key applies
      if (this.page && k.toLowerCase() !== 't') return;
      // Digits: switch scenario (when there are several) or fold to depth (0 opens everything; Shift+digit always folds)
      const digit = /^Digit([0-9])$/.exec(ev.code || '')?.[1] ?? (/^[0-9]$/.test(k) ? k : null);
      if (digit !== null) {
        const n = Number(digit);
        const scenarios = this.engine.getScenarios().length;
        const scenario = !ev.shiftKey && n >= 1 && n <= scenarios;
        const depth = n <= DEPTH_KEYS && !$('depth').hidden;
        if (scenario && (scenarios > 1 || !depth)) return this.engine.setScenario(n - 1);
        if (depth) {
          ev.preventDefault();
          return this.setDepth(n === 0 ? 'all' : n);
        }
      }
      if ((k === 'Enter' || k === ' ') && ev.target.classList?.contains('y-node')) {
        ev.preventDefault();
        return this.select(ev.target.dataset.id);
      }
      if (ev.target.closest?.('button') && (k === 'Enter' || k === ' ')) return;
      const map = {
        ArrowRight: () => this.engine.next(),
        ' ': () => this.engine.next(),
        ArrowLeft: () => this.engine.prev(),
        Home: () => this.engine.restart(),
        End: () => this.engine.goToStep(this.engine.getSteps().length - 1),
        p: () => this.engine.togglePlay(),
        c: () => this.setFollow(!this.followCamera),
        m: () => this.engine.cycleMode(),
        v: () => this.engine.cycleView(),
        i: () => this.toggleInspector(),
        x: () => this.foldSelected(),
        g: () => this.focusSelected(),
        d: () => this.drillInto(this.engine.selectedNodeId || document.activeElement?.closest?.('.y-node')?.dataset.id),
        l: () => this.legendMenu.toggle(),
        s: () => this.setStoryCollapsed(!this.storyCollapsed),
        r: () => this.interact.fit(),
        t: () => this.toggleTheme(),
        f: () => this.togglePresent(),
        '+': () => this.interact.zoomBy(1.2),
        '=': () => this.interact.zoomBy(1.2),
        '-': () => this.interact.zoomBy(1 / 1.2),
        '?': () => this.setHelp(!this.helpOpen),
        // Esc closes the shortcuts panel and menus, then clears the selection or filter, then zooms out of a group, then goes up a level
        Escape: () => {
          if (this.helpOpen) return this.setHelp(false);
          if (this.closeCrumbMenu(true)) return;
          if (this.engine.selectedNodeId || this.roleFilter) return this.clearFocus();
          if (this.focusId) return this.focusOut();
          return this.levels.depth ? this.goUp(this.levels.depth - 1) : this.clearFocus();
        }
      };
      const fn = map[logicalKey(k)] || map[k.toLowerCase()];
      if (fn) {
        ev.preventDefault();
        fn();
      }
    });
  }

  /**
   * Printing: the print stylesheet hides the chrome; here the light theme is
   * forced and the whole diagram is fitted to the page, then both are restored.
   */
  bindPrint() {
    let saved = null;
    addEventListener('beforeprint', () => {
      if (saved) return;
      const root = document.documentElement;
      saved = { theme: root.getAttribute('data-theme'), view: this.interact.view() };
      root.setAttribute('data-theme', 'light');
      this.applyLogo();
      this.interact.fitBox(PRINT_PAGE.w, PRINT_PAGE.h);
    });
    addEventListener('afterprint', () => {
      if (!saved) return;
      document.documentElement.setAttribute('data-theme', saved.theme);
      this.applyLogo();
      this.interact.setView(saved.view);
      saved = null;
    });
  }

  /** Toolbar button: open on the selected node's details, else the first tab. */
  toggleInspector() {
    if (this.inspectorOpen) return this.setInspector(false);
    const target = this.engine.selectedNodeId && this.nodeClickTarget();
    this.setInspector(true, target || this.inspectorTabs()[0]?.id);
  }

  /** Full screen with the walkthrough expanded: a presentation mode. */
  togglePresent() {
    if (document.fullscreenElement) return document.exitFullscreen?.();
    this.setStoryCollapsed(false);
    document.documentElement.requestFullscreen?.().catch(() => this.toast(this.L.t('toast.noFullscreen')));
  }

  /**
   * Toolbar mark, watermark badge and favicon follow the current theme.
   * Logos are <img> data URIs so their internal SVG ids never collide.
   */
  applyLogo() {
    if (!LOGO_LIGHT) return;
    const uri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
    const pair = `<img class="y-logo-light" src="${uri(LOGO_LIGHT)}" alt=""><img class="y-logo-dark" src="${uri(LOGO_DARK)}" alt="">`;
    for (const holder of [$('brand-logo'), $('watermark-logo')]) {
      if (holder.classList.contains('has-image')) continue;
      holder.classList.add('has-image');
      holder.innerHTML = pair;
    }
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = uri(dark ? LOGO_DARK : LOGO_LIGHT);
  }

  /** meta.watermark: false hides the badge, a string replaces its text. */
  renderWatermark() {
    // Detail diagrams inherit the overview's badge setting unless they set their own
    const own = this.engine.model.meta.watermark;
    const mark = own !== undefined ? own : this.levels.root?.meta?.watermark;
    $('watermark').hidden = mark === false;
    $('watermark-text').textContent = typeof mark === 'string' ? mark : this.L.t('watermark.text');
    $('watermark').href = REPO_URL;
    $('watermark').setAttribute('aria-label', this.L.t('watermark.label', { text: $('watermark-text').textContent }));
    if (!$('watermark-github').querySelector('svg')) $('watermark-github').insertAdjacentHTML('afterbegin', GITHUB_MARK);
  }

  toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    this.applyLogo();
    this.syncPageTheme();
    this.syncHash();
    try {
      localStorage.setItem('yantra:theme', next);
    } catch {
      // ignore
    }
  }

  // --- Export -------------------------------------------------------------
  /** File name from the title; letters of any script are kept (no spaces or punctuation). */
  fileBase() {
    return String(this.engine.model.meta.title || 'diagram').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'diagram';
  }

  svgString() {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const hl = this.engine.getHighlight();
    const logo = theme === 'dark' ? LOGO_DARK : LOGO_LIGHT;
    return renderSvg(this.engine.getScene(), { theme, highlight: hl.overview ? null : hl, step: this.engine.stepIndex, logo, locale: this.L });
  }

  exportAs(action) {
    const base = this.fileBase();
    if (action === 'svg') download(`${base}.svg`, this.svgString(), 'image/svg+xml');
    else if (action === 'png') this.exportPng(base);
    else if (action === 'md') download(`${base}.md`, toMarkdown(this.engine.payload), 'text/markdown');
    else if (action === 'md-all') download(`${base}-all-levels.md`, toMarkdown(this.levels.root, { levels: true }), 'text/markdown');
    else if (action === 'json') this.copy(JSON.stringify(this.engine.exportPayload(), null, 2), this.L.t('toast.jsonCopied'));
    else if (action === 'reset-layout') {
      this.engine.resetLayout();
      this.toast(this.L.t('toast.layoutReset'));
    } else if (action === 'html') {
      if (!this.standalone) return this.toast(this.L.t('toast.buildHint'));
      download(`${base}.html`, withPayload(PRISTINE, this.levels.exportRoot(this.engine.exportPayload())), 'text/html');
    }
  }

  exportPng(base) {
    const svg = this.svgString();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => blob && download(`${base}.png`, blob, 'image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.toast(this.L.t('toast.pngFailed'));
      download(`${base}.svg`, svg, 'image/svg+xml');
    };
    img.src = url;
  }

  copy(text, message) {
    const done = () => this.toast(message);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => download('diagram.json', text, 'application/json'));
    else download('diagram.json', text, 'application/json');
  }

  /** Deep links: #mode=<id>&view=sequence&collapsed=<id,id>&depth=<n|all>&scenario=<n>&step=<n> (1-based)&focus=<group id>. */
  applyHashState() {
    const params = hashParams(location.hash);
    const get = (k) => params.get(k) || undefined;
    if (get('mode')) this.engine.setMode(get('mode'));
    if (get('view')) this.engine.setView(get('view'));
    // depth=n (or all): fold to depth; collapsed= (hand-picked folds) wins when both are given
    const depth = get('depth');
    if (depth !== undefined && (depth === 'all' || /^\d+$/.test(depth))) this.engine.foldToDepth(depth === 'all' ? null : Number(depth));
    const folded = hashParams(location.hash, false).get('collapsed');
    if (folded !== undefined)
      this.engine.setCollapsed(folded.split(',').filter(Boolean).map((v) => {
        try {
          return decodeURIComponent(v);
        } catch {
          return v;
        }
      }));
    if (get('scenario')) this.engine.setScenario(Number(get('scenario')) - 1);
    if (get('step')) this.engine.goToStep(Number(get('step')) - 1);
    if (get('focus')) this.setFocus(get('focus'), { animate: false, toast: false });
    // An unknown role (stale link, other diagram) would dim every card
    if (get('role') && this.roleInUse(get('role'))) this.roleFilter = get('role');
    if (get('inspector')) this.inspectorTab = get('inspector');
  }

  /** True when a card of this role is visible in the current mode. */
  roleInUse(type) {
    return this.engine.getScene().nodes.some((n) => (n.node.type || 'node') === type);
  }

  /** The gallery entry named by #example=<id>, if any. */
  exampleFromHash() {
    const id = hashParams(location.hash).get('example');
    return id ? EXAMPLES.find((x) => x.id === id) || null : null;
  }

  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('is-on'), 2400);
  }
}

/** Inline stroke icon (24x24 markup from core/icons.js). */
const icon = (inner, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/** External link from a node or step `url`: http(s) and mailto only, in a new tab. */
function linkHtml(url) {
  const u = safeUrl(url);
  return u ? `<a class="y-ext-link" href="${h(u)}" target="_blank" rel="noopener noreferrer">${icon(LINK_ICON, 13)}<span>${h(DRILL_TEXT.link)}</span><span class="y-sr"> ${h(DRILL_TEXT.newTab)}</span></a>` : '';
}

function readEmbeddedPayload() {
  try {
    const raw = document.getElementById('yantra-payload')?.textContent?.trim();
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : null;
  } catch (err) {
    console.error('[yantra] embedded payload is not valid JSON:', err);
    return null;
  }
}

/**
 * A live viewer for a diagram embedded in a gallery page: this document with the
 * diagram as its payload. Inside the frame the URL mirror must not throw, and the
 * page sends its theme by postMessage (as lib/build.js EMBED_PRELUDE does for built pages).
 */
function embedHtml(diagram) {
  const prelude = `<script>(function(){var h=history,r=h.replaceState;h.replaceState=function(){try{return r.apply(h,arguments)}catch(e){}};
addEventListener('message',function(e){var t=e.data&&e.data.yantraTheme;if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)})})();</script>`;
  return withPayload(PRISTINE, diagram).replace(/<head[^>]*>/i, (m) => m + prelude);
}

/** Replace the embedded payload in a standalone document. */
export function withPayload(html, payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  // Last occurrence: the inlined app code comes before the slot
  const open = '<script type="application/json" id="yantra-payload">';
  const start = html.lastIndexOf(open);
  const end = html.indexOf('</' + 'script>', start);
  return html.slice(0, start + open.length) + json + html.slice(end);
}

/**
 * Replace a <select>'s options, keeping the <button><selectedcontent> used by
 * the customizable select (`appearance: base-select`). An item is
 * `[value, label]`, or `{ label, items }` for a labelled <optgroup>.
 */
function fillSelect(sel, items, value) {
  sel.querySelectorAll('option, optgroup').forEach((o) => o.remove());
  const add = (parent, [v, label]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    parent.appendChild(o);
  };
  for (const item of items) {
    if (Array.isArray(item)) {
      add(sel, item);
      continue;
    }
    if (!item.items.length) continue;
    const group = document.createElement('optgroup');
    group.label = item.label;
    item.items.forEach((x) => add(group, x));
    sel.appendChild(group);
  }
  if (value !== undefined) sel.value = value;
}

/** Tooltip text: the tooltips() helper keeps it in data-tip once it has moved it out of title. */
function setTip(el, text) {
  if (el.dataset.tip !== undefined) el.dataset.tip = text;
  else el.title = text;
}

/** Arrow / Home / End keys move between tabs or step chips (roving tabindex; arrows follow the reading direction). */
function rovingKeys(ev, selector, activate) {
  const items = [...ev.currentTarget.querySelectorAll(selector)];
  const i = items.indexOf(ev.target.closest(selector));
  if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[logicalKey(ev.key)];
  if (next === undefined) return;
  ev.preventDefault();
  ev.stopPropagation();
  const el = items[Math.max(0, Math.min(items.length - 1, next))];
  el.focus();
  activate(el);
}

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Interface tables a built file embeds for its languages (the bundle itself carries English only). */
function readEmbeddedStrings() {
  try {
    const raw = document.getElementById('yantra-strings')?.textContent?.trim();
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('[yantra] embedded strings are not valid JSON:', err);
    return null;
  }
}

async function boot() {
  registerStrings(readEmbeddedStrings());
  const embedded = readEmbeddedPayload();
  if (!embedded) {
    GALLERY = (await import('./examples.js')).GALLERY;
    EXAMPLES = GALLERY.flatMap((g) => g.items);
  }
  new App(embedded);
}

boot();
