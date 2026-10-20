/**
 * Yantra app controller: wires engine, renderer and interactions to the UI.
 */
import '../styles/app.css';
import '../styles/diagram.css';

import { themeCss } from '../core/theme.js';
import { renderSvg } from '../core/svg.js';
import { toMarkdown } from '../core/markdown.js';
import { escapeHtml as h } from '../core/text.js';
import { renderBlock, BLOCK_CSS } from '../core/page.js';
import { safeUrl } from '../core/drill.js';
import { LINK_ICON, DRILL_ICON } from '../core/icons.js';
import { YantraEngine } from './engine.js';
import { getMode } from '../core/model.js';
import { isEntity, members, memberKey, memberName, memberType } from '../core/entity.js';
import { notationText } from '../core/notation.js';
import { REPO_URL, GITHUB_MARK } from '../core/icons.js';
import { localeOf } from '../core/i18n.js';
import { hscroll, menu, tooltips } from './ui.js';
import { hashParams } from './hash.js';
import { Renderer } from './renderer.js';
import { InteractionManager } from './interact.js';
import { Levels, DRILL_TEXT, setDrillLocale } from './levels.js';
// The example gallery is loaded only when no payload is embedded, so built
// files (always embedded) do not carry it: `vite build` puts it in its own chunk.
let EXAMPLES = [];

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
    style.textContent = `${themeCss()}\n${BLOCK_CSS}`;
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

    const initial = this.embedded || this.exampleFromHash() || EXAMPLES[0].data;
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
    this.legendMenu = menu($('btn-legend'), $('legend-list'), { canOpen: () => !$('legend').hidden });

    this.bindEngine();
    this.bindUi();
    this.bindKeys();
    this.bindPrint();
    this.inspectorTab = null;
    this.applyHashState();
    this.applyLogo();
    this.renderSpeed();
    this.renderFollow();
    this.loadPayloadUi();
    this.setInspector(/inspector=/.test(location.hash) && this.inspectorTabs().length > 0);
    this.hashReady = true; // deep links are applied; from now on the URL follows the UI
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
    const e = this.engine;
    const params = hashParams(location.hash, false);
    const set = (key, value) => (value == null ? params.delete(key) : params.set(key, encodeURIComponent(value)));
    const defaultMode = getMode(e.model, e.model.meta.defaultMode)?.id;
    set('mode', e.modeId && e.modeId !== defaultMode ? e.modeId : null);
    const defaultView = e.model.meta.view === 'sequence' ? 'sequence' : 'flow';
    set('view', e.canSequence() && e.view !== defaultView ? e.view : null);
    set('scenario', e.scenarioIndex > 0 ? e.scenarioIndex + 1 : null);
    set('step', e.stepIndex > 0 ? e.stepIndex + 1 : null);
    set('role', this.roleFilter);
    set('inspector', this.inspectorOpen ? this.currentTab() : null);
    // Folded subtrees / groups, when they differ from meta.layout.collapsed (ids encoded one by one)
    if (e.isDefaultCollapse()) params.delete('collapsed');
    else params.set('collapsed', [...e.collapsed].map(encodeURIComponent).join(','));
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
    this.renderLegend();
    this.renderWatermark();
    this.redraw();
    this.renderStory();
    this.renderInspectorTabs();
    if (this.inspectorOpen && !this.inspectorTabs().length) this.setInspector(false);
    this.renderInspector();
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
      roleFilter: this.roleFilter
    });
  }

  /** Camera follows the walkthrough: frame the step's nodes, or everything. */
  followStep({ animate = true, force = false } = {}) {
    if (!this.followCamera && !force) return;
    if (this.engine.getView() === 'sequence') return this.followRow({ animate });
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
      this.syncHash();
    });
    e.on('viewChanged', (view) => {
      this.renderView();
      this.redraw();
      if (this.hashReady) this.toast(this.L.t(view === 'sequence' ? 'view.sequenceToast' : 'view.flowToast'));
      requestAnimationFrame(() => this.followStep({ animate: false, force: true }));
      this.syncHash();
    });
    e.on('modeChanged', (mode) => {
      // The new mode may hide every card of the filtered role
      if (this.roleFilter && !this.roleInUse(this.roleFilter)) this.roleFilter = null;
      this.renderModes();
      this.renderLegend();
      this.redraw();
      this.renderInspector();
      this.toast(`${mode.name}`);
      requestAnimationFrame(() => this.followStep({ animate: false, force: true }));
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
      this.renderLegend();
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
    const current = EXAMPLES.find((x) => x.data === this.levels.root);
    fillSelect(sel, EXAMPLES.map((x) => [x.id, x.name]), current?.id);
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

  /** Flow / Sequence toggle: shown when the scenario has messages to sequence. */
  renderView() {
    const box = $('view-switch');
    const view = this.engine.getView();
    box.hidden = !this.engine.canSequence();
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
      .map((m) => `<button role="radio" aria-checked="${m.id === this.engine.modeId}" data-mode="${h(m.id)}" title="${h(m.description || m.name)}">${h(m.badge || m.name)}</button>`)
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
        return d.description || d.tech || d.runtime || d.ports || d.status || d.sourceFile || Object.keys(d.metadata || {}).length || this.levels.target(n) || safeUrl(d.url) || isEntity(d);
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
    const body = blocks.length
      ? blocks.map((b, i) => renderBlock({ ...b, span: 'full' }, `${panel.id}-${i}`, { pageMeta: meta, locale: L })).join('')
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
      ${tables}
      <h4>${h(L.t('node.connections'))}</h4>
      ${conns.length ? `<ul class="y-conns">${conns.join('')}</ul>` : `<p class="y-empty">${h(L.t('node.noConnections'))}</p>`}`;
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
    this.setHelp(false);
  }

  toggleRole(type) {
    this.roleFilter = !type || this.roleFilter === type ? null : type;
    this.engine.clearSelection();
    this.renderLegend();
    this.applyState();
    this.syncHash();
  }

  /** Shortcuts dialog: focus moves in on open and back to where it was on close. */
  setHelp(open) {
    const help = $('help');
    if (open === !help.hidden) return;
    help.hidden = !open;
    if (open) {
      this.helpReturn = document.activeElement;
      help.focus();
    } else if (help.contains(document.activeElement) || document.activeElement === document.body) {
      this.helpReturn?.focus?.();
      this.helpReturn = null;
    }
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
    const side = this.inspectorOpen && window.innerWidth > 720 ? $('inspector').getBoundingClientRect().width + 16 : 16;
    return { top: bar.bottom - vp.top + 8, bottom, left: isRtl() ? side : 16, right: isRtl() ? 16 : side };
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
      this.levels.reset(ex.data);
      this.engine.load(ex.data);
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
    $('btn-help').onclick = () => this.setHelp($('help').hidden);
    $('btn-close-help').onclick = () => this.setHelp(false);
    $('help').onkeydown = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      this.setHelp(false);
    };
    document.addEventListener('click', (ev) => {
      if (!$('help').hidden && !ev.target.closest?.('#help, #btn-help')) this.setHelp(false);
    });
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
    $('crumbs').onclick = (ev) => {
      const at = ev.target.closest('[data-level]')?.dataset.level;
      if (at !== undefined) this.goUp(Number(at));
    };
    $('viewport').addEventListener('dblclick', (ev) => {
      const id = ev.target.closest?.('.y-node')?.dataset.id;
      if (id) this.drillInto(id);
    });
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.interact.fit(), 150);
    });
  }

  bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target.closest?.('input, textarea, select') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key;
      if (/^[1-9]$/.test(k) && Number(k) <= this.engine.getScenarios().length) return this.engine.setScenario(Number(k) - 1);
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
        d: () => this.drillInto(this.engine.selectedNodeId || document.activeElement?.closest?.('.y-node')?.dataset.id),
        l: () => this.legendMenu.toggle(),
        s: () => this.setStoryCollapsed(!this.storyCollapsed),
        r: () => this.interact.fit(),
        t: () => this.toggleTheme(),
        f: () => this.togglePresent(),
        '+': () => this.interact.zoomBy(1.2),
        '=': () => this.interact.zoomBy(1.2),
        '-': () => this.interact.zoomBy(1 / 1.2),
        '?': () => this.setHelp($('help').hidden),
        // Esc closes help, then clears the selection or filter, then goes up a level
        Escape: () => (!$('help').hidden ? this.setHelp(false) : this.engine.selectedNodeId || this.roleFilter || !this.levels.depth ? this.clearFocus() : this.goUp(this.levels.depth - 1))
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

  /** Deep links: #mode=<id>&view=sequence&collapsed=<id,id>&scenario=<n>&step=<n> (1-based). */
  applyHashState() {
    const params = hashParams(location.hash);
    const get = (k) => params.get(k) || undefined;
    if (get('mode')) this.engine.setMode(get('mode'));
    if (get('view')) this.engine.setView(get('view'));
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
    // An unknown role (stale link, other diagram) would dim every card
    if (get('role') && this.roleInUse(get('role'))) this.roleFilter = get('role');
    if (get('inspector')) this.inspectorTab = get('inspector');
  }

  /** True when a card of this role is visible in the current mode. */
  roleInUse(type) {
    return this.engine.getScene().nodes.some((n) => (n.node.type || 'node') === type);
  }

  exampleFromHash() {
    const id = hashParams(location.hash).get('example');
    return id ? EXAMPLES.find((x) => x.id === id)?.data : null;
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
 * the customizable select (`appearance: base-select`).
 */
function fillSelect(sel, items, value) {
  sel.querySelectorAll('option').forEach((o) => o.remove());
  for (const [v, label] of items) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
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

async function boot() {
  const embedded = readEmbeddedPayload();
  if (!embedded) EXAMPLES = (await import('./examples.js')).EXAMPLES;
  new App(embedded);
}

boot();
