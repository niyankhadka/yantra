/**
 * Script for every site page except the playground: theme toggle, copy buttons, the
 * landing page's lazy live demo, and the docs drawer, "On this page" highlight and search
 * (search.js and its index load only when the search box is used).
 */
import 'virtual:yantra-theme.css';
import './site.css';

const root = document.documentElement;
const media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
const THEME_KEY = 'yantra:theme';
const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const LABEL = { system: 'system', light: 'light', dark: 'dark' };

// --- theme ---------------------------------------------------------------------
const pref = () => root.getAttribute('data-theme-pref') || 'system';
const resolved = (p) => (p === 'system' ? (media?.matches ? 'dark' : 'light') : p);

function applyTheme(p, save) {
  root.setAttribute('data-theme-pref', p);
  root.setAttribute('data-theme', resolved(p));
  if (save) {
    try {
      if (p === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, p);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  }
  for (const b of document.querySelectorAll('[data-theme-toggle]')) {
    const label = `Colour theme: ${LABEL[p]} (switch to ${LABEL[NEXT[p]]})`;
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  document.dispatchEvent(new CustomEvent('site:theme', { detail: resolved(p) }));
}

for (const b of document.querySelectorAll('[data-theme-toggle]')) b.addEventListener('click', () => applyTheme(NEXT[pref()], true));
media?.addEventListener?.('change', () => pref() === 'system' && applyTheme('system', false));
// Another tab (or the playground) changed it
addEventListener('storage', (e) => {
  if (e.key === THEME_KEY) applyTheme(e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system', false);
});
applyTheme(pref(), false);

// --- copy buttons ------------------------------------------------------------------
const COPY_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
let live = null;
function announce(msg) {
  if (!live) {
    live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    document.body.append(live);
  }
  live.textContent = '';
  setTimeout(() => (live.textContent = msg), 30);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    t.remove();
    return ok;
  }
}

for (const block of document.querySelectorAll('.code')) {
  const code = block.querySelector('code');
  if (!code) continue;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'copy';
  b.innerHTML = `${COPY_ICON}<span>Copy</span>`;
  b.setAttribute('aria-label', 'Copy code');
  b.addEventListener('click', async () => {
    const ok = await copyText(code.textContent);
    b.querySelector('span').textContent = ok ? 'Copied' : 'Press Ctrl+C';
    b.classList.toggle('is-done', ok);
    announce(ok ? 'Copied to the clipboard' : 'Copy failed: select the code and copy it');
    clearTimeout(b._t);
    b._t = setTimeout(() => {
      b.querySelector('span').textContent = 'Copy';
      b.classList.remove('is-done');
    }, 1800);
  });
  block.append(b);
}

// --- tabs and the "How it works" stepper (landing page); without JS every panel shows
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
for (const box of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...box.querySelectorAll('[role="tab"]')];
  const vertical = box.querySelector('[role="tablist"]').getAttribute('aria-orientation') === 'vertical';
  let current = 0;
  const select = (i, focus) => {
    current = i;
    tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i));
      t.tabIndex = k === i ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = k !== i;
    });
    if (focus) tabs[i].focus();
  };
  // Autoplay (the stepper): advance while on screen, stop for good once the reader takes over
  const delay = Number(box.dataset.autoplay) || 0;
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; box.classList.remove('is-auto'); };
  const takeOver = () => { stop(); box.dataset.autoplay = ''; };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => { takeOver(); select(i, false); });
    tab.addEventListener('keydown', (e) => {
      const keys = vertical ? { ArrowDown: i + 1, ArrowUp: i - 1 } : { ArrowRight: i + 1, ArrowLeft: i - 1 };
      const to = { ...keys, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      takeOver();
      select((to + tabs.length) % tabs.length, true);
    });
  });
  select(Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')), false);
  box.classList.add('is-ready');
  if (delay && !calm && 'IntersectionObserver' in window) {
    box.style.setProperty('--autoplay', `${delay}ms`);
    const start = () => {
      if (timer || !box.dataset.autoplay) return;
      box.classList.add('is-auto');
      timer = setInterval(() => select((current + 1) % tabs.length, false), delay);
    };
    new IntersectionObserver((entries) => (entries[0].isIntersecting ? start() : stop()), { threshold: 0.4 }).observe(box);
    box.addEventListener('focusin', takeOver);
  }
}

// --- teaser player: a large play button over the poster, then the native controls
for (const player of document.querySelectorAll('[data-player]')) {
  const video = player.querySelector('video');
  const play = player.querySelector('.player-play');
  video.controls = false;
  play.hidden = false;
  play.addEventListener('click', () => {
    play.hidden = true;
    video.controls = true;
    video.play();
    video.focus();
  });
  video.addEventListener('ended', () => {
    video.controls = false;
    play.querySelector('strong').textContent = 'Watch again';
    play.hidden = false;
  });
}

// --- live demo (landing page) -----------------------------------------------------
const stage = document.querySelector('[data-demo]');
if (stage) {
  let frame = null;
  const src = () => `${stage.dataset.demo}#theme=${root.getAttribute('data-theme')}`;
  const load = () => {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.title = 'Live Yantra viewer: cloud architecture walkthrough';
    frame.className = 'demo-iframe';
    frame.src = src();
    frame.addEventListener('load', () => stage.classList.add('is-live'), { once: true });
    stage.append(frame);
    stage.classList.add('is-loading');
  };
  stage.querySelector('.demo-load')?.addEventListener('click', load);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        load();
      }
    }, { rootMargin: '200px 0px' });
    io.observe(stage);
  }
  // The viewer reads its theme from the hash when it opens: reopen it in the new theme
  document.addEventListener('site:theme', () => {
    if (!frame) return;
    let shown = null;
    try {
      shown = frame.contentDocument?.documentElement.getAttribute('data-theme');
    } catch {
      // not readable: reload
    }
    if (shown === root.getAttribute('data-theme')) return; // toggled inside the demo itself
    stage.classList.remove('is-live');
    frame.addEventListener('load', () => stage.classList.add('is-live'), { once: true });
    frame.src = `${stage.dataset.demo}?t=${root.getAttribute('data-theme')}#theme=${root.getAttribute('data-theme')}`;
  });
}

// --- docs: drawer -------------------------------------------------------------------
const menu = document.querySelector('.docs-menu');
const nav = document.getElementById('docs-nav');
const scrim = document.querySelector('.docs-scrim');
if (menu && nav) {
  const setOpen = (open) => {
    menu.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
    if (scrim) scrim.hidden = !open;
    document.body.classList.toggle('drawer-open', open);
    if (open) nav.querySelector('a[aria-current="page"], input, a')?.focus();
  };
  menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
  scrim?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      menu.focus();
    }
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a') && nav.classList.contains('is-open')) setOpen(false);
  });
}

// --- docs: "On this page" highlight ----------------------------------------------------
const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(tocLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  const heads = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  const visible = new Set();
  const mark = () => {
    // The first heading on screen, else the last one above the viewport
    let current = heads.find((h) => visible.has(h));
    if (!current) current = [...heads].reverse().find((h) => h.getBoundingClientRect().top < 120) || heads[0];
    for (const a of tocLinks) a.classList.toggle('is-active', byId.get(current?.id) === a);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
    mark();
  }, { rootMargin: '-72px 0px -55% 0px' });
  for (const h of heads) io.observe(h);
  mark();
}

// --- docs: search ------------------------------------------------------------------------
const input = document.getElementById('docs-search');
if (input) {
  let ready = null;
  const start = () => (ready ||= import('./search.js').then((m) => m.attach(input, document.getElementById('search-results'))));
  input.addEventListener('focus', start, { once: true });
  input.addEventListener('input', start, { once: true });
  // /docs/?q=term opens the docs with that search (the site's SearchAction in its structured data)
  const q = new URLSearchParams(location.search).get('q');
  if (q && q.trim()) {
    input.value = q.trim().slice(0, 100);
    if (menu && getComputedStyle(menu).display !== 'none' && !nav.classList.contains('is-open')) menu.click();
    start();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    if (menu && getComputedStyle(menu).display !== 'none' && !nav.classList.contains('is-open')) menu.click();
    input.focus();
  });
}
