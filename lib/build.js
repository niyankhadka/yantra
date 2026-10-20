/**
 * Standalone HTML builder: inlines the Vite app bundle and embeds a payload,
 * producing one offline file with no external requests.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPage, renderPage, srcdocAttr } from '../src/core/page.js';
import { localeOf, stringsFor } from '../src/core/i18n.js';
import { isRef, isUnsafeRefPath } from '../src/core/drill.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SOURCES = ['index.html', 'src', 'examples', 'vite.config.js'];

const BUILD_STAMP = '.yantra-sources';

/** Every source file under p (sorted), for the build fingerprint. */
function sourceFiles(p) {
  if (!fs.existsSync(p)) return [];
  if (!fs.statSync(p).isDirectory()) return [p];
  return fs.readdirSync(p).sort().flatMap((f) => sourceFiles(path.join(p, f)));
}

/** Fingerprint of the viewer sources: content, not mtimes (checkouts and copies change those). */
let memo = null;
export function sourceHash() {
  const files = SOURCES.flatMap((s) => sourceFiles(path.join(ROOT, s)));
  // Re-read the contents only when a file was added, removed or touched since the last call
  const key = files.map((f) => {
    const st = fs.statSync(f);
    return `${f}:${st.size}:${st.mtimeMs}`;
  }).join('|');
  if (memo?.key === key) return memo.hash;
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(ROOT, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  memo = { key, hash: hash.digest('hex') };
  return memo.hash;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * One build at a time across processes (parallel test files, CLI and MCP at once):
 * a lock directory next to dist/; a lock older than 5 minutes is left over from a
 * crash and is taken over.
 */
function withBuildLock(fn) {
  const lock = path.join(ROOT, '.yantra-build.lock');
  const until = Date.now() + 10 * 60 * 1000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 5 * 60 * 1000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        // released meanwhile
      }
      if (Date.now() > until) throw new Error(`Timed out waiting for another Yantra build (remove ${lock} if no build is running)`);
      sleep(100);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

/**
 * Run `vite build` when dist/ is missing or was built from other sources (a
 * content fingerprint in dist/, so a stale dist/ is never used). Without Vite
 * (an installed package) the shipped dist/ is used as is.
 */
export function ensureAppBuilt({ force = false, log = console.error } = {}) {
  const index = path.join(DIST, 'index.html');
  const stamp = path.join(DIST, BUILD_STAMP);
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) {
    // An installed package ships a prebuilt dist/ (built by `prepack`) and no Vite: use it as is
    if (!force && fs.existsSync(index)) return;
    throw new Error('Vite is not installed. Run `npm install` in the Yantra folder first.');
  }
  const fresh = () => {
    if (!fs.existsSync(index) || !fs.existsSync(stamp)) return false;
    return fs.readFileSync(stamp, 'utf-8').trim() === sourceHash();
  };
  if (!force && fresh()) return;
  withBuildLock(() => {
    // Another process may have built it while this one waited
    if (!force && fresh()) return;
    const hash = sourceHash();
    log('Building Yantra app bundle...');
    const res = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    if (res.status !== 0) throw new Error('vite build failed');
    fs.writeFileSync(stamp, `${hash}\n`);
  });
}

/** Single-file app shell with every asset inlined (payload still null). */
export function appShell() {
  ensureAppBuilt();
  let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
  const asset = (ref) => fs.readFileSync(path.join(DIST, ref.replace(/^\.?\//, '')), 'utf-8');

  // Function replacers: asset text must never be read as `$&`-style patterns
  html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g, (_, href) => `<style>\n${asset(href)}\n</style>`);
  html = html.replace(/<script type="module"[^>]*src="([^"]+\.js)"[^>]*><\/script>/g, (_, src) =>
    `<script type="module">\n${asset(src).replace(/<\/(script)/gi, '<\\/$1')}\n</script>`
  );
  if (/<(script|link)[^>]+(src|href)="\/?assets\//.test(html)) throw new Error('Unexpected external asset left in dist/index.html');
  return html;
}

/**
 * Language tags a diagram payload uses: its meta.lang and those of its detail
 * diagrams (drill-down levels, at any depth).
 */
export function payloadLangs(payload, out = new Set()) {
  if (!payload || typeof payload !== 'object') return out;
  if (typeof payload.meta?.lang === 'string') out.add(payload.meta.lang);
  const table = payload.diagrams;
  if (table && typeof table === 'object' && !Array.isArray(table)) for (const sub of Object.values(table)) payloadLangs(sub, out);
  return out;
}

const STRINGS_OPEN = '<script type="application/json" id="yantra-strings">';

/**
 * Embed a payload in the app shell. The shell carries English interface strings
 * only; the tables for `langs` (default: the payload's languages) go in a JSON
 * script that the viewer registers at load, so a file holds just what it shows.
 */
export function embedPayload(html, payload, langs = payloadLangs(payload)) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const title = String(payload?.meta?.title || 'Yantra').replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  // The slot is the last occurrence: inlined app code may precede it
  const open = '<script type="application/json" id="yantra-payload">';
  const start = html.lastIndexOf(open);
  const end = start < 0 ? -1 : html.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('Payload slot not found in app shell');
  const tables = stringsFor([...langs]);
  const strings = Object.keys(tables).length ? `${STRINGS_OPEN}${scriptJson(tables)}</script>\n  ` : '';
  const out = html.slice(0, start) + strings + html.slice(start, start + open.length) + json + html.slice(end);
  // Language and direction before the first paint (the viewer sets them again at load)
  const { lang, dir } = localeOf(payload?.meta);
  return out
    .replace(/<html lang="[^"]*"/, () => `<html lang="${lang}" dir="${dir}"`)
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
}

export function buildHtml(payload) {
  return embedPayload(appShell(), payload);
}

/** Brand logos from src/assets (raw SVG strings; either may be missing). */
export function readLogos() {
  const read = (name) => {
    const p = path.join(ROOT, 'src', 'assets', name);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  };
  return { light: read('logo-light.svg'), dark: read('logo-dark.svg') };
}

/**
 * Load diagram blocks' `src` files. A src must be a relative .json path that
 * stays inside baseDir (symlinks resolved); anything else, or a file that is
 * missing or not valid JSON, is left unresolved and lint reports
 * page/diagram-unresolved.
 */
export function resolvePage(page, baseDir = process.cwd()) {
  const out = { ...page, blocks: (Array.isArray(page.blocks) ? page.blocks : []).map((b) => (b && typeof b === 'object' ? { ...b } : b)) };
  for (const b of out.blocks) {
    if (b?.type !== 'diagram' || b.diagram || !b.src || typeof b.src !== 'string') continue;
    const file = safeSrc(baseDir, b.src);
    if (!file) continue;
    try {
      b.diagram = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      // unreadable or invalid JSON: stays unresolved
      continue;
    }
    b.diagram = resolveLevels(b.diagram, path.dirname(file), { root: baseDir });
  }
  for (const b of out.blocks) if (b?.type === 'diagram' && b.diagram && typeof b.diagram === 'object' && !b.src) b.diagram = resolveLevels(b.diagram, baseDir);
  return out;
}

/**
 * Inline drill-down file references: every `{ "$ref": "./payments.json" }` in a
 * `diagrams` map (at any depth, also inside loaded files) is replaced by that
 * file's payload. A ref is relative to the file that contains it and must stay
 * inside `root` (default baseDir; symlinks resolved). Refs that cannot be loaded
 * stay in place with `$error` ("unsafe", "missing" or "cycle") for lint to report.
 * `onLoad(file)` is called with each file read (the dev server watches them).
 */
export function resolveLevels(payload, baseDir = process.cwd(), { root = baseDir, onLoad = null } = {}) {
  const visit = (owner, dir, chain) => {
    const table = owner && typeof owner === 'object' && !Array.isArray(owner) ? owner.diagrams : null;
    if (!table || typeof table !== 'object' || Array.isArray(table)) return owner;
    const next = {};
    for (const [id, sub] of Object.entries(table)) {
      if (!isRef(sub)) {
        next[id] = visit(sub, dir, chain);
        continue;
      }
      const file = isUnsafeRefPath(sub.$ref) ? null : safeSrc(dir, sub.$ref, root);
      if (!file) {
        next[id] = { $ref: sub.$ref, $error: isUnsafeRefPath(sub.$ref) || existsInside(dir, sub.$ref, root) === false ? 'unsafe' : 'missing' };
        continue;
      }
      const real = fs.realpathSync(file);
      if (chain.includes(real)) {
        next[id] = { $ref: sub.$ref, $error: 'cycle' };
        continue;
      }
      try {
        onLoad?.(real);
        next[id] = visit(JSON.parse(fs.readFileSync(file, 'utf-8')), path.dirname(file), [...chain, real]);
      } catch {
        next[id] = { $ref: sub.$ref, $error: 'missing' };
      }
    }
    return { ...owner, diagrams: next };
  };
  if (!payload || typeof payload !== 'object' || payload.diagrams === undefined) return payload;
  return visit(payload, path.resolve(baseDir), []);
}

/** False when the path leaves root (by its text, or once symlinks are resolved); true inside; null when missing. */
function existsInside(dir, src, root) {
  const file = path.resolve(dir, src);
  const lexical = path.relative(path.resolve(root), file);
  if (lexical.startsWith('..') || path.isAbsolute(lexical)) return false;
  if (!fs.existsSync(file)) return null;
  const rel = path.relative(fs.realpathSync(path.resolve(root)), fs.realpathSync(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function safeSrc(baseDir, src, root = baseDir) {
  if (path.isAbsolute(src) || /^[a-zA-Z]:/.test(src) || path.extname(src).toLowerCase() !== '.json') return null;
  const base = path.resolve(baseDir);
  const file = path.resolve(base, src);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const rel = path.relative(fs.realpathSync(path.resolve(root)), fs.realpathSync(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? file : null;
}

/**
 * Runs first inside an embedded viewer (sandboxed iframe, opaque origin): the
 * hash mirror must not throw, and the host page sends its theme by postMessage.
 */
const EMBED_PRELUDE = `<script>(function(){var h=history,r=h.replaceState;h.replaceState=function(){try{return r.apply(h,arguments)}catch(e){}};
addEventListener('message',function(e){var t=e.data&&e.data.yantraTheme;if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)})})();</script>`;

/** Standalone viewer HTML for a diagram embedded in an answer page (`interactive: true`). */
export function buildEmbedHtml(diagram) {
  return withPrelude(buildHtml(diagram));
}

function withPrelude(html) {
  const m = /<head[^>]*>/i.exec(html);
  if (!m) return EMBED_PRELUDE + html;
  const end = m.index + m[0].length;
  return html.slice(0, end) + EMBED_PRELUDE + html.slice(end);
}

/** JSON text that is safe inside a <script> element (no `</` or `<!--`). */
const scriptJson = (value) => JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');

const EMBED_SLOT = '"__yantra_embed_payload__"';
const EMBED_MARK = (i) => `<!--yantra-embed:${i}-->`;
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const beforeBodyEnd = (html, add) => {
  const end = html.lastIndexOf('</body>');
  return end < 0 ? html + add : `${html.slice(0, end)}${add}\n${html.slice(end)}`;
};

/**
 * Every embedded viewer on a page shares one copy of the viewer shell: the page
 * carries the shell once (as JSON text) plus each diagram's payload, and a small
 * script fills each iframe's srcdoc at load. Without JavaScript the static figure shows.
 */
const SHARE_SCRIPT = `(function(){var s=document.getElementById('yantra-viewer-shell');if(!s)return;var shell=JSON.parse(s.textContent),k='${EMBED_SLOT}',i=shell.indexOf(k);if(i<0)return;
document.querySelectorAll('iframe[data-yantra-embed]').forEach(function(f){var p=document.getElementById('yantra-embed-'+f.getAttribute('data-yantra-embed'));if(!p)return;var t=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
f.srcdoc=(shell.slice(0,i)+p.textContent+shell.slice(i+k.length)).replace('<html','<html data-theme="'+t+'"')})})();`;
const NOSCRIPT = '<noscript><style>.p-live{display:none!important}.p-print-only{display:block!important}</style></noscript>';

function shareViewer(html, payloads) {
  if (!payloads.length) return html;
  payloads.forEach((_, i) => {
    html = html.replace(`srcdoc="${srcdocAttr(EMBED_MARK(i))}"`, () => `data-yantra-embed="${i}"`);
  });
  const langs = new Set();
  for (const p of payloads) payloadLangs(p, langs);
  const shell = withPrelude(embedPayload(appShell(), '__yantra_embed_payload__', langs));
  if (!shell.includes(EMBED_SLOT)) throw new Error('Embed payload slot not found in viewer shell');
  const data = [
    `<script type="application/json" id="yantra-viewer-shell">${scriptJson(shell)}</script>`,
    ...payloads.map((p, i) => `<script type="application/json" id="yantra-embed-${i}">${JSON.stringify(p).replace(/</g, '\\u003c')}</script>`),
    `<script>${SHARE_SCRIPT}</script>`
  ].join('\n');
  html = html.replace(/<\/head>/i, () => `${NOSCRIPT}\n</head>`);
  return beforeBodyEnd(html, data);
}

/**
 * Keep each large data: URI (brand logos) once: the first <img> copy stays inline and
 * every other copy is filled from it by a tiny script (without JavaScript: a blank pixel).
 */
function dedupeDataUris(html) {
  const re = /(<[a-z]+\b[^>]*?\s)(src|href)="(data:[^"]{2048,})"/gi;
  const seen = new Map();
  for (const m of html.matchAll(re)) {
    if (!seen.has(m[3])) seen.set(m[3], []);
    seen.get(m[3]).push({ index: m.index, img: /^<img\b/i.test(m[1]) });
  }
  const repeated = [...seen].filter(([, list]) => list.length > 1);
  if (!repeated.length) return html;
  const keep = new Map(repeated.map(([uri, list], k) => [uri, { k, at: (list.find((o) => o.img) || list[0]).index }]));
  html = html.replace(re, (all, pre, attr, uri, offset) => {
    const d = keep.get(uri);
    if (!d) return all;
    if (offset === d.at) return `${pre}data-yantra-uri-src="${d.k}" ${attr}="${uri}"`;
    return `${pre}data-yantra-uri="${d.k}" data-yantra-uri-attr="${attr}" ${attr}="${PIXEL}"`;
  });
  const script = `<script>(function(){document.querySelectorAll('[data-yantra-uri]').forEach(function(e){var s=document.querySelector('[data-yantra-uri-src="'+e.getAttribute('data-yantra-uri')+'"]');if(s)e.setAttribute(e.getAttribute('data-yantra-uri-attr'),s.getAttribute('src')||s.getAttribute('href'))})})();</script>`;
  return beforeBodyEnd(html, script);
}

/**
 * Render a page; diagram blocks with `interactive: true` embed the full viewer
 * (one shared shell for all embeds on the page, static SVG for print and no-JS).
 */
export function buildPage(page, baseDir) {
  const resolved = resolvePage(page, baseDir);
  const live = (resolved.blocks || []).some((b) => b?.type === 'diagram' && b.interactive && b.diagram);
  const payloads = [];
  const viewerHtml = live ? (diagram) => EMBED_MARK(payloads.push(diagram) - 1) : null;
  const html = renderPage(resolved, { logos: readLogos(), viewerHtml });
  return shareViewer(dedupeDataUris(html), payloads);
}

/** Load a payload's file references: page diagram `src` files, or drill-down `$ref`s. */
export function resolveAny(payload, baseDir, { root = baseDir } = {}) {
  return isPage(payload) ? resolvePage(payload, baseDir) : resolveLevels(payload, baseDir, { root });
}

/** HTML for either payload kind: interactive diagram or one-page answer. */
export function buildAny(payload, baseDir) {
  if (isPage(payload)) return buildPage(payload, baseDir);
  return buildHtml(payload);
}
