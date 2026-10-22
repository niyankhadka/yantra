/**
 * Standalone HTML builder: inlines the Vite app bundle and embeds a payload,
 * producing one offline file with no external requests.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPage, isBook, walkBlocks } from '../src/core/page.js';
import { payloadLangs, embedPayload, withPrelude, pageHtml, bookHtml } from '../src/core/standalone.js';
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

export { payloadLangs, embedPayload };

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
  // Copies of the blocks, and of the blocks inside sections, so loading never touches the caller's page
  const copy = (b) => (b && typeof b === 'object' ? { ...b, ...(b.type === 'section' && Array.isArray(b.blocks) ? { blocks: b.blocks.map(copy) } : {}) } : b);
  const out = { ...page, blocks: (Array.isArray(page.blocks) ? page.blocks : []).map(copy) };
  const all = [];
  walkBlocks(out.blocks, (b) => all.push(b));
  for (const b of all) {
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
  for (const b of all) if (b?.type === 'diagram' && b.diagram && typeof b.diagram === 'object' && !b.src) b.diagram = resolveLevels(b.diagram, baseDir);
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

/** Standalone viewer HTML for a diagram embedded in an answer page (`interactive: true`). */
export function buildEmbedHtml(diagram) {
  return withPrelude(buildHtml(diagram));
}

/**
 * Render a page; diagram blocks with `interactive: true` embed the full viewer
 * (one shared shell for all embeds on the page, static SVG for print and no-JS).
 */
export function buildPage(page, baseDir) {
  return pageHtml(resolvePage(page, baseDir), { shell: appShell, logos: readLogos() });
}

/**
 * Load a book's chapter files: every `{ "$ref": "chapter.json" }` in `chapters`
 * becomes that page, relative to the book and inside `root` (default baseDir),
 * with its own diagram `src` files loaded from the chapter's folder. Refs that
 * cannot be loaded stay with `$error` ("unsafe", "missing" or "cycle") for lint.
 */
export function resolveBook(book, baseDir = process.cwd(), { root = baseDir, onLoad = null } = {}) {
  const dir = path.resolve(baseDir);
  const chapters = (Array.isArray(book.chapters) ? book.chapters : []).map((ch) => {
    if (!isRef(ch)) return ch && typeof ch === 'object' && !Array.isArray(ch) ? resolvePage(ch, dir) : ch;
    const file = isUnsafeRefPath(ch.$ref) ? null : safeSrc(dir, ch.$ref, root);
    if (!file) return { $ref: ch.$ref, $error: isUnsafeRefPath(ch.$ref) || existsInside(dir, ch.$ref, root) === false ? 'unsafe' : 'missing' };
    try {
      onLoad?.(fs.realpathSync(file));
      const page = JSON.parse(fs.readFileSync(file, 'utf-8'));
      // a chapter file that is itself a book would nest without end
      if (isBook(page)) return { $ref: ch.$ref, $error: 'cycle' };
      return page && typeof page === 'object' && !Array.isArray(page) ? resolvePage(page, path.dirname(file)) : { $ref: ch.$ref, $error: 'missing' };
    } catch {
      return { $ref: ch.$ref, $error: 'missing' };
    }
  });
  return { ...book, chapters };
}

/** A book's single HTML file (one shared viewer for every interactive diagram in it). */
export function buildBook(book, baseDir) {
  return bookHtml(resolveBook(book, baseDir), { shell: appShell, logos: readLogos() });
}

/** Load a payload's file references: book chapter `$ref`s, page diagram `src` files, or drill-down `$ref`s. */
export function resolveAny(payload, baseDir, { root = baseDir } = {}) {
  if (isBook(payload)) return resolveBook(payload, baseDir, { root });
  return isPage(payload) ? resolvePage(payload, baseDir) : resolveLevels(payload, baseDir, { root });
}

/** HTML for any payload kind: interactive diagram, one-page answer or book. */
export function buildAny(payload, baseDir) {
  if (isBook(payload)) return buildBook(payload, baseDir);
  if (isPage(payload)) return buildPage(payload, baseDir);
  return buildHtml(payload);
}
