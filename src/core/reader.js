/**
 * Reading modes for answer pages and books: scroll (the page as it is),
 * book (one screen at a time, like an e-reader) and present (one row of
 * blocks per slide). The runtime is a self-contained function inlined into
 * the built HTML as source (like enhanceCharts), so it must not use anything
 * from this module's scope.
 *
 * A page is split into units: the lead (title and answer), each block, a
 * section's heading, and the footer. Units in one grid row (half / third
 * blocks) stay together; book pages break between rows, never inside a block,
 * and a block taller than the screen scrolls on its own page.
 */
import { escapeHtml as h } from './text.js';

export const READING_MODES = ['scroll', 'book', 'present'];
/** Text sizes for the A− / A+ buttons (CSS zoom). */
const ZOOMS = [0.85, 0.92, 1, 1.1, 1.22, 1.36];

const ICON = {
  scroll: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 4h12M6 9h12M6 14h12M6 19h8"/></svg>',
  book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z"/></svg>',
  present: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>',
  full: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
  contents: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  prev: '<svg class="p-flip" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  next: '<svg class="p-flip" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
};

/** Words the runtime shows, in the page language. */
export function readerWords(L) {
  return {
    page: L.t('reader.page'),
    slide: L.t('reader.slide'),
    chapter: L.t('reader.chapter'),
    read: L.t('reader.read')
  };
}

/**
 * Header controls (contents for books, the mode switch, full screen) and the
 * bottom bar of the paged modes. `contents`: [{ id, title, items: [{ id, title }] }].
 */
export function readerControls(L, { contents = null } = {}) {
  const mode = (m) =>
    `<button type="button" class="p-mode" data-read="${m}" aria-pressed="false" title="${h(L.t(`reader.${m}Tip`))}">${ICON[m]}<span>${h(L.t(`reader.${m}`))}</span></button>`;
  const list = contents
    ? `<div class="p-contents" id="p-contents" role="dialog" aria-label="${h(L.t('page.contents'))}" hidden><p class="p-label">${h(L.t('page.contents'))}</p><ol>${contents
        .map((c) => `<li><a href="#${h(c.id)}">${h(c.title)}</a>${c.items.length ? `<ol>${c.items.map((s) => `<li><a href="#${h(s.id)}">${h(s.title)}</a></li>`).join('')}</ol>` : ''}</li>`)
        .join('')}</ol></div>`
    : '';
  const tools = `<div class="p-tools">
      ${contents ? `<button type="button" class="p-tool p-contents-btn" aria-label="${h(L.t('page.contents'))}" title="${h(L.t('page.contents'))}" aria-expanded="false" aria-controls="p-contents">${ICON.contents}</button>` : ''}
      <div class="p-modes" role="group" aria-label="${h(L.t('reader.modes'))}">${['scroll', 'book', 'present'].map(mode).join('')}</div>
      <button type="button" class="p-tool p-full" aria-label="${h(L.t('reader.fullscreen'))}" title="${h(L.t('reader.fullscreen'))}">${ICON.full}</button>`;
  const bar = `<nav class="p-reader" aria-label="${h(L.t('reader.label'))}" hidden>
  <button type="button" class="p-tool p-prev" aria-label="${h(L.t('reader.prev'))}" title="${h(L.t('reader.prev'))}">${ICON.prev}</button>
  <div class="p-where"><span class="p-where-text" aria-live="polite"></span><span class="p-progress" aria-hidden="true"><i></i></span></div>
  <button type="button" class="p-tool p-smaller" aria-label="${h(L.t('reader.smaller'))}" title="${h(L.t('reader.smaller'))}"><span aria-hidden="true">A−</span></button>
  <button type="button" class="p-tool p-larger" aria-label="${h(L.t('reader.larger'))}" title="${h(L.t('reader.larger'))}"><span aria-hidden="true">A+</span></button>
  <button type="button" class="p-tool p-next" aria-label="${h(L.t('reader.next'))}" title="${h(L.t('reader.next'))}">${ICON.next}</button>
</nav>`;
  return { tools, bar, list };
}

/**
 * The runtime (inlined as source). cfg: { start: 'scroll'|'book'|'present', key: storage key,
 * book: true for a book, words: readerWords(L), zooms: ZOOMS }.
 */
export function readerRuntime(doc, cfg) {
  var root = doc.documentElement;
  var W = cfg.words;
  // Detail pages (.p-detail) read as plain pages: book and present modes page the main text only
  var mainOnly = function (el) { return !el.closest('.p-detail'); };
  var units = [].slice.call(doc.querySelectorAll('.p-lead-head,.p-lead>.p-answer,.p-cover-list,.p-section-head,.p-grid>.p-block:not(.p-block--section),.p-foot')).filter(mainOnly);
  var holders = [].slice.call(doc.querySelectorAll('.p-lead,.p-block--section,.p-chapter')).filter(mainOnly);
  var bar = doc.querySelector('.p-reader');
  if (!units.length || !bar) return;
  var where = bar.querySelector('.p-where-text');
  var fill = bar.querySelector('.p-progress i');
  var modes = [].slice.call(doc.querySelectorAll('.p-mode'));
  var mode = 'scroll';
  var pages = [];
  var cur = 0;
  var unit = 0;
  var zoom = 1;
  var rtl = function () {
    return root.dir === 'rtl';
  };
  var get = function (k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  var set = function (k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      // the reader works without storage
    }
  };
  var fmt = function (s, o) {
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return k in o ? o[k] : m;
    });
  };
  var chapterOf = function (el) {
    var c = el.closest('.p-chapter');
    return c ? +c.getAttribute('data-chapter') : 0;
  };
  var chapters = doc.querySelectorAll('.p-chapter').length;

  // Rows: units side by side in one grid row move together
  function rows() {
    units.forEach(function (u) {
      u.classList.remove('is-off');
    });
    holders.forEach(function (x) {
      x.classList.remove('is-off');
    });
    var out = [];
    units.forEach(function (u, i) {
      var r = u.getBoundingClientRect();
      var last = out[out.length - 1];
      if (last && u.parentNode === units[last.units[0]].parentNode && Math.abs(r.top - last.top) < 2 && !u.classList.contains('p-foot')) {
        last.units.push(i);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else out.push({ units: [i], top: r.top, bottom: r.bottom, head: u.classList.contains('p-section-head') || u.classList.contains('p-lead-head'), chapter: chapterOf(u) });
    });
    return out;
  }

  function paginate() {
    var rs = rows();
    var out = [];
    if (mode === 'present') {
      // one row per slide; a section heading opens the slide of its first row
      rs.forEach(function (r, i) {
        var prev = rs[i - 1];
        if (prev && prev.head && out.length && out[out.length - 1] === prev.units) out[out.length - 1] = prev.units.concat(r.units);
        else out.push(r.units);
      });
      return out;
    }
    var headEl = doc.querySelector('.p-head');
    var top = headEl ? headEl.getBoundingClientRect().bottom + 22 : 40;
    // below the last row: the body's bottom padding (it keeps clear of the bar), so a page never scrolls
    var pad = parseFloat(getComputedStyle(doc.body).paddingBottom) || 96;
    var avail = Math.max(240, innerHeight - top - Math.max(pad, bar.offsetHeight + 36) - 8);
    var page = null;
    var start = 0;
    rs.forEach(function (r, i) {
      var newChapter = page && r.chapter !== rs[i - 1].chapter;
      if (!page || newChapter || r.bottom - start > avail) {
        // never end a page on a section heading: it moves on with its first row
        if (page && !newChapter && page.rows.length > 1 && rs[i - 1].head) {
          var moved = page.rows.pop();
          page.units = page.units.slice(0, page.units.length - moved.units.length);
          page = { rows: [moved], units: moved.units.slice() };
          out.push(page);
          start = moved.top;
        } else {
          page = { rows: [], units: [] };
          out.push(page);
          start = r.top;
        }
      }
      page.rows.push(r);
      page.units = page.units.concat(r.units);
    });
    return out.map(function (p) {
      return p.units;
    });
  }

  function show(i, focus) {
    cur = Math.max(0, Math.min(pages.length - 1, i));
    var on = {};
    pages[cur].forEach(function (k) {
      on[k] = true;
    });
    units.forEach(function (u, k) {
      u.classList.toggle('is-off', !on[k]);
    });
    holders.forEach(function (x) {
      x.classList.toggle('is-off', !x.querySelector('.p-lead-head:not(.is-off),.p-lead>.p-answer:not(.is-off),.p-cover-list:not(.is-off),.p-section-head:not(.is-off),.p-block:not(.p-block--section):not(.is-off)'));
    });
    unit = pages[cur][0];
    scrollTo(0, 0);
    var n = cur + 1;
    var total = pages.length;
    var pct = Math.round((n / total) * 100);
    var c = chapterOf(units[unit]);
    where.textContent = cfg.book && c ? fmt(W.chapter, { n: c, total: chapters }) + ' · ' + fmt(W.read, { p: pct }) : fmt(mode === 'present' ? W.slide : W.page, { n: n, total: total });
    fill.style.width = pct + '%';
    bar.querySelector('.p-prev').disabled = cur === 0;
    bar.querySelector('.p-next').disabled = cur === total - 1;
    save();
    if (focus) {
      var first = units[unit];
      var hd = first.querySelector('h1,h2,h3') || first;
      if (!hd.hasAttribute('tabindex')) hd.setAttribute('tabindex', '-1');
      hd.focus({ preventScroll: true });
    }
  }

  function save() {
    set('yantra:read:' + cfg.key, JSON.stringify({ mode: mode, unit: unit }));
    var p = new URLSearchParams(location.hash.slice(1));
    if (mode === cfg.start) p.delete('read');
    else p.set('read', mode);
    if (mode === 'scroll' || unit === 0) p.delete('at');
    else p.set('at', String(unit + 1));
    var hash = p.toString();
    if (hash !== location.hash.slice(1)) {
      try {
        history.replaceState(history.state, '', location.href.split('#')[0] + (hash ? '#' + hash : ''));
      } catch (e) {
        // the URL simply does not follow the reader here
      }
    }
  }

  function pageOf(k) {
    for (var i = 0; i < pages.length; i++) if (pages[i].indexOf(k) >= 0) return i;
    return 0;
  }

  function layout() {
    if (mode === 'scroll') return;
    pages = paginate();
    show(pageOf(unit));
  }

  function setMode(m, opts) {
    if (cfg.modes.indexOf(m) < 0) m = 'scroll';
    opts = opts || {};
    // the unit at the top of the screen, when leaving scroll mode
    if (mode === 'scroll' && !opts.keep) {
      for (var i = 0; i < units.length; i++)
        if (units[i].getBoundingClientRect().bottom > 80) {
          unit = i;
          break;
        }
    }
    mode = m;
    root.setAttribute('data-read', m);
    modes.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-read') === m));
    });
    bar.hidden = m === 'scroll';
    if (m === 'scroll') {
      units.forEach(function (u) {
        u.classList.remove('is-off');
      });
      holders.forEach(function (x) {
        x.classList.remove('is-off');
      });
      // back from a paged mode: keep the place; on load, scroll mode leaves the position (and #anchors) alone
      var target = units[unit];
      if (!opts.keep && unit > 0 && target) target.scrollIntoView({ block: 'start' });
      save();
      return;
    }
    layout();
  }

  function step(d) {
    if (mode === 'scroll' || pages.length < 2) return;
    show(cur + d, true);
  }

  function setZoom(z) {
    zoom = z;
    root.style.setProperty('--p-zoom', String(z));
    set('yantra:textsize', String(z));
    var zs = cfg.zooms;
    bar.querySelector('.p-smaller').disabled = z <= zs[0];
    bar.querySelector('.p-larger').disabled = z >= zs[zs.length - 1];
    layout();
  }

  function zoomBy(d) {
    var zs = cfg.zooms;
    var i = zs.indexOf(zoom);
    if (i < 0) i = zs.indexOf(1);
    setZoom(zs[Math.max(0, Math.min(zs.length - 1, i + d))]);
  }

  modes.forEach(function (b) {
    b.addEventListener('click', function () {
      setMode(b.getAttribute('data-read'));
    });
  });
  bar.querySelector('.p-prev').addEventListener('click', function () {
    step(-1);
  });
  bar.querySelector('.p-next').addEventListener('click', function () {
    step(1);
  });
  bar.querySelector('.p-smaller').addEventListener('click', function () {
    zoomBy(-1);
  });
  bar.querySelector('.p-larger').addEventListener('click', function () {
    zoomBy(1);
  });
  var full = doc.querySelector('.p-full');
  if (full) {
    if (!root.requestFullscreen) full.hidden = true;
    full.addEventListener('click', function () {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else root.requestFullscreen().catch(function () {});
    });
  }

  // Contents (books): a panel of chapters and sections; in a paged mode a link opens its page
  var cbtn = doc.querySelector('.p-contents-btn');
  var panel = doc.getElementById('p-contents');
  var openPanel = function (on) {
    if (!panel) return;
    panel.hidden = !on;
    cbtn.setAttribute('aria-expanded', String(on));
    if (on) {
      var a = panel.querySelector('a');
      if (a) a.focus();
    }
  };
  if (cbtn && panel) {
    cbtn.addEventListener('click', function () {
      openPanel(panel.hidden);
    });
    doc.addEventListener('click', function (e) {
      if (!panel.hidden && !panel.contains(e.target) && !cbtn.contains(e.target)) openPanel(false);
    });
  }
  doc.addEventListener(
    'click',
    function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || mode === 'scroll') return;
      var id = a.getAttribute('href').slice(1);
      var el = id && doc.getElementById(decodeURIComponent(id));
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      openPanel(false);
      for (var i = 0; i < units.length; i++)
        if (units[i] === el || units[i].contains(el) || el.contains(units[i])) {
          show(pageOf(i), true);
          return;
        }
    },
    true
  );
  if (panel)
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) openPanel(false);
    });

  doc.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input,textarea,select,summary'))) return;
    var k = e.key;
    if (k === 'Escape') {
      if (panel && !panel.hidden) return openPanel(false);
      if (mode === 'present') return setMode(cfg.start === 'present' ? 'scroll' : cfg.start);
      return;
    }
    if (mode === 'scroll') return;
    var fwd = rtl() ? 'ArrowLeft' : 'ArrowRight';
    var back = rtl() ? 'ArrowRight' : 'ArrowLeft';
    var d = k === fwd || k === 'PageDown' || (k === ' ' && !e.shiftKey) ? 1 : k === back || k === 'PageUp' || (k === ' ' && e.shiftKey) ? -1 : 0;
    if (k === 'Home') d = -cur;
    if (k === 'End') d = pages.length - 1 - cur;
    if (!d) return;
    // a focused button or link keeps Space
    if (k === ' ' && e.target.closest && e.target.closest('button,a')) return;
    e.preventDefault();
    step(d);
  });

  // Tap the outer edges, or swipe, to turn the page
  var touch = null;
  doc.addEventListener('pointerdown', function (e) {
    touch = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY };
  });
  doc.addEventListener('pointerup', function (e) {
    if (mode === 'scroll' || !touch) return;
    var dx = e.clientX - touch.x;
    var dy = e.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) step((dx < 0) !== rtl() ? 1 : -1);
  });
  doc.addEventListener('click', function (e) {
    if (mode === 'scroll' || e.defaultPrevented || (e.target.closest && e.target.closest('a,button,summary,input,iframe,.p-scroll,.p-reader,.p-contents,.p-head'))) return;
    var x = e.clientX / innerWidth;
    if (x < 0.12) step(rtl() ? 1 : -1);
    else if (x > 0.88) step(rtl() ? -1 : 1);
  });

  var q = null;
  addEventListener('resize', function () {
    clearTimeout(q);
    q = setTimeout(layout, 120);
  });
  // Paper gets every block, in order
  addEventListener('beforeprint', function () {
    units.forEach(function (u) {
      u.classList.remove('is-off');
    });
    holders.forEach(function (x) {
      x.classList.remove('is-off');
    });
  });
  addEventListener('afterprint', function () {
    if (mode !== 'scroll') show(cur);
  });

  var saved = null;
  try {
    saved = JSON.parse(get('yantra:read:' + cfg.key) || 'null');
  } catch (e) {
    saved = null;
  }
  var hp = new URLSearchParams(location.hash.slice(1));
  var z = parseFloat(get('yantra:textsize'));
  zoom = cfg.zooms.indexOf(z) >= 0 ? z : 1;
  root.style.setProperty('--p-zoom', String(zoom));
  var startUnit = +hp.get('at') ? +hp.get('at') - 1 : saved && typeof saved.unit === 'number' ? saved.unit : 0;
  unit = Math.max(0, Math.min(units.length - 1, startUnit || 0));
  var start = hp.get('read') || (saved && saved.mode) || cfg.start;
  // fonts and charts settle before the first measure
  var go = function () {
    setMode(start, { keep: true });
    setZoom(zoom);
  };
  if (doc.readyState === 'complete') go();
  else addEventListener('load', go);
}

/** Script tag body: the runtime and its settings. */
export function readerScript(cfg) {
  return `(${readerRuntime.toString()})(document,${JSON.stringify({ zooms: ZOOMS, modes: READING_MODES, ...cfg }).replace(/</g, '\\u003c')});`;
}

export const READER_CSS = `
.p-tools{display:flex;align-items:center;gap:6px}
.p-tool,.p-mode{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;min-width:34px;padding:0 9px;border:1px solid var(--y-border);border-radius:8px;background:var(--y-surface);color:var(--y-ink-2);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.p-tool:hover:not(:disabled),.p-mode:hover{color:var(--y-ink);border-color:var(--y-border-strong)}
.p-tool:disabled{opacity:.4;cursor:default}
.p-tool:focus-visible,.p-mode:focus-visible{outline:2px solid var(--y-accent);outline-offset:2px}
.p-modes{display:inline-flex;padding:2px;border:1px solid var(--y-border);border-radius:9px;background:var(--y-surface)}
.p-modes .p-mode{height:28px;border:0;border-radius:7px;background:none}
.p-mode[aria-pressed="true"]{background:var(--y-ink);color:var(--y-bg)}
.p-mode[aria-pressed="true"]:hover{color:var(--y-bg)}
:root[dir="rtl"] .p-flip{transform:scaleX(-1)}
.p-contents{position:fixed;z-index:30;top:64px;inset-inline-end:max(16px,calc((100vw - 960px)/2));width:min(360px,calc(100vw - 32px));max-height:min(70vh,560px);overflow:auto;padding:14px 16px;border:1px solid var(--y-border);border-radius:12px;background:var(--y-surface);box-shadow:0 18px 40px -12px rgba(0,0,0,.25)}
.p-contents ol{margin:0;padding:0;list-style:none;counter-reset:ch}
.p-contents>ol>li{counter-increment:ch;margin:2px 0}
.p-contents>ol>li>a{font-weight:650}
.p-contents>ol>li>a::before{content:counter(ch) ". ";color:var(--y-ink-3)}
.p-contents ol ol{margin:2px 0 6px;padding-inline-start:18px}
.p-contents a{display:block;padding:5px 8px;border-radius:7px;color:var(--y-ink-2);text-decoration:none;font-size:14px}
.p-contents a:hover,.p-contents a:focus-visible{background:var(--y-accent-soft);color:var(--y-accent);outline:none}
.p-reader{position:fixed;z-index:20;left:50%;bottom:14px;display:flex;align-items:center;gap:6px;width:min(560px,calc(100vw - 24px));padding:7px;border:1px solid var(--y-border);border-radius:12px;background:var(--y-surface);box-shadow:0 14px 34px -14px rgba(0,0,0,.28);transform:translateX(-50%)}
.p-reader[hidden]{display:none}
.p-where{flex:1;display:flex;flex-direction:column;gap:5px;min-width:0;padding:0 6px}
.p-where-text{overflow:hidden;color:var(--y-ink-2);font-size:12.5px;font-weight:600;text-align:center;white-space:nowrap;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.p-progress{display:block;height:3px;border-radius:2px;background:var(--y-border);overflow:hidden}
.p-progress i{display:block;height:100%;width:0;border-radius:2px;background:var(--y-accent);transition:width .2s ease}
.p-page{zoom:var(--p-zoom,1)}
:root[data-read="book"] body,:root[data-read="present"] body{padding-bottom:96px}
:root[data-read="book"] .p-page{max-width:760px}
:root[data-read="present"] .p-page{max-width:1080px}
@media (min-width:900px){:root[data-read="present"] .p-page{zoom:calc(var(--p-zoom,1) * 1.16)}}
:root[data-read="book"] .p-toc,:root[data-read="present"] .p-toc{display:none}
:root[data-read="present"] .p-lead{padding-top:4vh}
:root[data-read="present"] .p-block--section{border-top:0;padding-top:0}
.is-off{display:none!important}
:root:not([data-read="book"]) .p-smaller,:root:not([data-read="book"]) .p-larger{display:none}
@media (prefers-reduced-motion:reduce){.p-progress i{transition:none}}
@media (max-width:640px){.p-mode span{display:none}.p-modes .p-mode{padding:0 7px}.p-tools{gap:4px}}
@media print{.p-tools,.p-reader,.p-contents{display:none!important}.p-page{zoom:1}.is-off{display:revert!important}}
`;
