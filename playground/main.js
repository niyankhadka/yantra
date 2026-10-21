/**
 * Yantra playground: paste Yantra JSON from any chat, see the findings and the
 * rendered viewer or answer page, and download the result. Everything runs here,
 * in the browser: validation is src/core/lint.js, the single-file HTML is
 * src/core/standalone.js filled with the viewer shell this site was built with
 * (viewer-shell.html, made by lib/build.js appShell()), so a download is the same
 * file `yantra build` writes.
 */
import './style.css';
import { themeCss } from '../src/core/theme.js';
import { lint } from '../src/core/lint.js';
import { localizeFindings } from '../src/core/lintmessages.js';
import { LANGUAGES, localeOf, shippedLang } from '../src/core/i18n.js';
import { isPage, pageToMarkdown } from '../src/core/page.js';
import { toMarkdown } from '../src/core/markdown.js';
import { renderSvg } from '../src/core/svg.js';
import { sceneForView } from '../src/core/sequence.js';
import { embedPayload, pageHtml, withPrelude } from '../src/core/standalone.js';
import PROMPT from '../chat/prompt.md?raw';
import LOGO_LIGHT from '../src/assets/logo-light.svg?raw';
import LOGO_DARK from '../src/assets/logo-dark.svg?raw';

const $ = (id) => document.getElementById(id);
const LOGOS = { light: LOGO_LIGHT, dark: LOGO_DARK };
const DRAFT_KEY = 'yantra:playground';
const STARTER = (() => {
  const m = /```json\n([\s\S]*?)```/.exec(PROMPT); // the prompt's smallest valid diagram
  return m ? m[1].trim() : '';
})();

// --- interface language: ?lang=xx, else the browser's first shipped language ---
const params = new URLSearchParams(location.search);
const uiTag = [params.get('lang'), ...(navigator.languages || [navigator.language])].find((t) => t && shippedLang(t)) || 'en';
const L = localeOf({ lang: uiTag });
document.documentElement.lang = L.lang;
document.documentElement.dir = L.dir;

function translate() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = L.t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', L.t(el.dataset.i18nLabel));
  for (const el of document.querySelectorAll('[data-i18n-tip]')) el.title = L.t(el.dataset.i18nTip);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = L.t(el.dataset.i18nPlaceholder);
  $('frame').title = L.t('play.preview');
}

const style = document.createElement('style');
style.textContent = themeCss();
document.head.prepend(style);
const dataUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
$('brand-logo').innerHTML = `<img class="pg-only-light" src="${dataUri(LOGO_LIGHT)}" alt=""><img class="pg-only-dark" src="${dataUri(LOGO_DARK)}" alt="">`;

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage unavailable (private mode, blocked): nothing is remembered
    }
  }
};

const theme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

// --- state ---------------------------------------------------------------------
const state = {
  payload: null, // last parsed JSON
  report: null, // lint() of it
  good: null, // last payload without errors (what the preview shows)
  shell: null // viewer shell (promise)
};

function loadShell() {
  state.shell ||= fetch(new URL('viewer-shell.html', document.baseURI)).then((r) => {
    if (!r.ok) throw new Error(`viewer-shell.html: HTTP ${r.status}`);
    return r.text();
  });
  return state.shell;
}

/** Parse the editor text; JSON wrapped in chat prose or a ``` fence is taken out of it. */
export function extractJson(text) {
  const t = text.trim();
  if (!t) return { empty: true };
  try {
    return { value: JSON.parse(t) };
  } catch (err) {
    for (const m of t.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g)) {
      try {
        return { value: JSON.parse(m[1]), extracted: m[1].trim() };
      } catch {
        // try the next block
      }
    }
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a && (a > 0 || b < t.length - 1)) {
      try {
        const s = t.slice(a, b + 1);
        return { value: JSON.parse(s), extracted: s };
      } catch {
        // not JSON either
      }
    }
    return { error: err };
  }
}

// --- validation ----------------------------------------------------------------
function lintLang() {
  const v = $('lint-lang').value;
  return v === 'auto' ? state.payload?.meta?.lang || L.lang : v;
}

function showFindings() {
  const list = $('findings');
  list.replaceChildren();
  const status = $('status');
  status.className = 'pg-status';
  if (!state.report) return;
  const r = localizeFindings(state.report, lintLang());
  const items = [...r.errors.map((f) => ['error', f]), ...r.warnings.map((f) => ['warning', f])];
  if (!items.length) {
    status.textContent = `✓ ${L.t('play.valid')}`;
    status.classList.add('is-good');
    const li = document.createElement('li');
    li.className = 'pg-empty';
    li.textContent = L.t('play.noFindings');
    list.append(li);
    return;
  }
  const parts = [];
  if (r.errors.length) parts.push(L.t('play.errors', { n: L.num(r.errors.length) }));
  if (r.warnings.length) parts.push(L.t('play.warnings', { n: L.num(r.warnings.length) }));
  status.textContent = parts.join(' · ');
  status.classList.add(r.errors.length ? 'is-bad' : 'is-warn');
  for (const [kind, f] of items) {
    const li = document.createElement('li');
    li.className = `pg-finding is-${kind}`;
    const code = document.createElement('code');
    code.textContent = f.code;
    const msg = document.createElement('span');
    msg.textContent = f.message;
    msg.dir = 'auto';
    li.append(code, msg);
    list.append(li);
  }
}

function showJsonError(err) {
  state.report = null;
  $('findings').replaceChildren();
  const status = $('status');
  status.className = 'pg-status is-bad';
  status.textContent = L.t('play.jsonError', { message: err.message });
}

let timer = 0;
function scheduleCheck() {
  clearTimeout(timer);
  timer = setTimeout(check, 350);
}

function check() {
  const editor = $('src');
  store.set(DRAFT_KEY, editor.value);
  const parsed = extractJson(editor.value);
  if (parsed.empty) {
    state.payload = state.report = null;
    $('status').textContent = '';
    $('findings').replaceChildren();
    return render();
  }
  if (parsed.error) {
    state.payload = null;
    showJsonError(parsed.error);
    return render();
  }
  if (parsed.extracted !== undefined) {
    editor.value = parsed.extracted;
    store.set(DRAFT_KEY, editor.value);
    toast(L.t('play.extracted'));
  }
  state.payload = parsed.value;
  try {
    state.report = lint(state.payload);
  } catch (err) {
    state.report = { valid: false, errors: [{ code: 'playground/lint-failed', message: String(err?.message || err) }], warnings: [] };
  }
  showFindings();
  if (state.report.valid) state.good = state.payload;
  render();
}

// --- preview -------------------------------------------------------------------
/** The single-file HTML for a payload: what `yantra build` writes. */
async function buildFile(payload) {
  const shell = await loadShell();
  if (isPage(payload)) return pageHtml(payload, { shell: () => shell, logos: LOGOS });
  return embedPayload(shell, payload);
}

/** The built file as the preview frame shows it: in the playground's theme. */
function previewDoc(html, page) {
  const t = theme();
  if (!page) return withPrelude(html).replace(/<html\b/i, `<html data-theme="${t}"`);
  const head = `<script>document.documentElement.setAttribute('data-theme',${JSON.stringify(t)});</script><style>.p-theme{display:none!important}</style>`;
  return html.replace('</head>', () => `${head}\n</head>`);
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const payload = state.report?.valid ? state.payload : state.good;
  const stale = $('stale');
  stale.hidden = !$('src').value.trim() || !!state.report?.valid;
  stale.textContent = L.t('play.stale');
  $('placeholder').hidden = !!payload;
  $('frame').hidden = !payload;
  syncDownloads();
  if (!payload) return;
  if (payload === state.rendered?.payload && state.rendered.theme === theme()) return;
  try {
    const html = await buildFile(payload);
    if (seq !== renderSeq) return;
    state.rendered = { payload, theme: theme() };
    $('frame').srcdoc = previewDoc(html, isPage(payload));
  } catch (err) {
    stale.hidden = false;
    stale.textContent = String(err?.message || err);
  }
}

function syncDownloads() {
  const payload = state.report?.valid ? state.payload : null;
  const page = payload && isPage(payload);
  for (const b of document.querySelectorAll('[data-dl]')) {
    const vector = b.dataset.dl === 'svg' || b.dataset.dl === 'png';
    b.disabled = b.dataset.dl === 'json' ? !state.payload : !payload || (vector && page);
    b.title = vector && page ? L.t('play.diagramOnly') : '';
  }
}

// --- downloads -----------------------------------------------------------------
const baseName = (p) =>
  String(p?.meta?.title || p?.meta?.question || 'yantra').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'yantra';

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function svgOf(payload) {
  const t = theme();
  return renderSvg(sceneForView(payload, { view: payload.meta?.view }), { theme: t, logo: LOGOS[t] });
}

function pngOf(svg, name) {
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
    canvas.toBlob((blob) => (blob ? download(name, blob, 'image/png') : toast(L.t('toast.pngFailed'))));
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast(L.t('toast.pngFailed'));
  };
  img.src = url;
}

async function onDownload(kind) {
  const payload = state.payload;
  if (!payload) return;
  const base = baseName(payload);
  if (kind === 'json') return download(`${base}.json`, `${JSON.stringify(payload, null, 2)}\n`, 'application/json');
  if (!state.report?.valid) return;
  if (kind === 'html') return download(`${base}.html`, await buildFile(payload), 'text/html');
  if (kind === 'md') return download(`${base}.md`, isPage(payload) ? pageToMarkdown(payload) : toMarkdown(payload), 'text/markdown');
  if (isPage(payload)) return toast(L.t('play.diagramOnly'));
  const svg = svgOf(payload);
  if (kind === 'svg') return download(`${base}.svg`, svg, 'image/svg+xml');
  if (kind === 'png') return pngOf(svg, `${base}.png`);
}

// --- examples ------------------------------------------------------------------
let gallery = null;
function loadGallery() {
  gallery ||= import('../src/app/examples.js').then((m) => m.GALLERY);
  return gallery;
}

async function fillExamples() {
  const sel = $('example');
  const sections = await loadGallery();
  for (const section of sections) {
    const group = document.createElement('optgroup');
    group.label = L.t(section.label);
    for (const item of section.items) {
      const o = document.createElement('option');
      o.value = item.id;
      o.textContent = item.name;
      group.append(o);
    }
    sel.append(group);
  }
}

async function openExample(id) {
  const sections = await loadGallery();
  const item = sections.flatMap((s) => s.items).find((x) => x.id === id);
  if (!item) return false;
  $('src').value = `${JSON.stringify(item.data, null, 2)}\n`;
  check();
  return true;
}

// --- chrome --------------------------------------------------------------------
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-on'), 3200);
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(PROMPT);
    toast(L.t('play.promptCopied'));
  } catch {
    download('yantra-prompt.md', PROMPT, 'text/markdown');
    toast(L.t('play.promptSaved'));
  }
}

function fillLintLanguages() {
  const sel = $('lint-lang');
  let names = null;
  try {
    names = new Intl.DisplayNames([L.lang], { type: 'language' });
  } catch {
    // older browsers: tags only
  }
  const opts = [['auto', L.t('play.auto')], ...LANGUAGES.map((l) => [l, names?.of(l) || l])];
  for (const [v, label] of opts) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.append(o);
  }
  sel.value = 'auto';
}

function bind() {
  const editor = $('src');
  editor.addEventListener('input', scheduleCheck);
  // Tab indents in the editor; Escape then Tab leaves it (keyboard users are never trapped)
  let escaped = false;
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') escaped = true;
    else if (e.key === 'Tab' && !e.shiftKey && !escaped) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    } else escaped = false;
  });
  $('btn-format').addEventListener('click', () => {
    const parsed = extractJson(editor.value);
    if (parsed.value === undefined) return check();
    editor.value = `${JSON.stringify(parsed.value, null, 2)}\n`;
    check();
  });
  $('btn-clear').addEventListener('click', () => {
    editor.value = '';
    check();
    editor.focus();
  });
  $('example').addEventListener('change', async (e) => {
    const id = e.target.value;
    e.target.value = '';
    if (id) await openExample(id);
  });
  $('copy-prompt').addEventListener('click', copyPrompt);
  $('lint-lang').addEventListener('change', showFindings);
  $('btn-theme').addEventListener('click', () => {
    const next = theme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('yantra:theme', next);
    render();
  });
  for (const b of document.querySelectorAll('[data-dl]')) b.addEventListener('click', () => onDownload(b.dataset.dl));
}

async function boot() {
  translate();
  fillLintLanguages();
  bind();
  const fromHash = /(?:^#|&)example=([\w-]+)/.exec(location.hash)?.[1];
  const examples = fillExamples();
  if (fromHash && (await openExample(fromHash))) return examples;
  $('src').value = store.get(DRAFT_KEY) ?? STARTER;
  check();
  loadShell().catch(() => {});
  return examples;
}

boot();

// Offline: a service worker keeps the site's files once it has loaded (built site only)
if (import.meta.env.PROD && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  addEventListener('load', () => navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {}));
}
