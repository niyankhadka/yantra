// Interaction tests in a real headless browser (Chrome, Edge or Chromium; YANTRA_BROWSER picks
// one). Skipped, with a message, when none is installed. Only Node built-ins: the DevTools
// protocol runs over a pipe (tests/support.js startBrowser).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findBrowser } from '../lib/browser.js';
import { buildAny, resolveAny, ensureAppBuilt, ROOT } from '../lib/build.js';
import { REPO_URL } from '../src/core/icons.js';
import { startBrowser, tempDir, removeDir } from './support.js';

const executable = findBrowser();
const skip = executable ? false : 'no Chrome, Edge or Chromium found (set YANTRA_BROWSER to run the browser tests)';
let browser = null;
let dir = null;

/** Build an example (or a payload) to a standalone HTML file and open it. */
async function open(name, { payload, hash = '' } = {}) {
  const file = path.join(ROOT, 'examples', `${name}.json`);
  const data = payload || resolveAny(JSON.parse(fs.readFileSync(file, 'utf-8')), path.dirname(file));
  const out = path.join(dir, `${name}.html`);
  fs.writeFileSync(out, buildAny(data, path.dirname(file)));
  const page = await browser.open(`${pathToFileURL(out).href}${hash ? `#${hash}` : ''}`);
  // The new tab starts on about:blank, which is already "complete": wait for this file
  await page.waitFor(`location.protocol === "file:" && document.readyState === "complete" && ${data.kind === 'page' ? 'true' : '!!window.yantra'}`);
  return page;
}

before(async () => {
  if (skip) return;
  dir = tempDir('yantra-browser-');
  browser = await startBrowser(executable);
});

after(async () => {
  if (browser) await browser.close();
  if (dir) removeDir(dir);
});

test('drill-down: double-click opens a level, Esc and Back return', { skip }, async () => {
  const page = await open('platform-overview');
  assert.equal(await page.eval('document.getElementById("crumbs").hidden'), true);
  await page.eval(`document.querySelector('.y-node.has-drill[data-id="payments"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await page.waitFor('/level=payments/.test(location.hash)');
  assert.equal(await page.eval('document.getElementById("crumbs").hidden'), false, 'breadcrumb shown');
  assert.match(await page.eval('document.getElementById("crumbs").textContent'), /Payments/);

  // Esc (nothing selected) goes up one level
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await page.waitFor('!/level=/.test(location.hash)');
  assert.equal(await page.eval('window.yantra.levels.depth'), 0);

  // The $ref level loaded from its own file opens too; the browser's Back returns
  await page.eval(`document.querySelector('.y-node.has-drill[data-id="search"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await page.waitFor('/level=search/.test(location.hash)');
  assert.equal(await page.eval('window.yantra.engine.model.meta.title'), 'Search service');
  await page.eval('history.back()');
  await page.waitFor('window.yantra.levels.depth === 0');
});

test('fold button hides a subtree and the URL remembers it', { skip }, async () => {
  const page = await open('org-chart');
  const before = await page.eval('document.querySelectorAll(".y-node").length');
  await page.eval(`document.querySelector('.y-toggle:not(.is-folded)').click()`);
  await page.waitFor('/collapsed=/.test(location.hash)');
  const after = await page.eval('document.querySelectorAll(".y-node").length');
  assert.ok(after < before, `cards ${before} -> ${after}`);
  assert.ok(await page.eval('!!document.querySelector(".y-toggle.is-folded")'));
});

test('right-to-left payloads set dir="rtl"; the watermark links to the repository', { skip }, async () => {
  const page = await open('order-fulfilment-arabic');
  assert.equal(await page.eval('document.documentElement.dir'), 'rtl');
  assert.equal(await page.eval('document.documentElement.lang'), 'ar');
  const ltr = await open('oauth-login');
  assert.equal(await ltr.eval('document.documentElement.dir'), 'ltr');
  const mark = await ltr.eval(`(() => { const a = document.getElementById('watermark'); return { href: a.href, hidden: a.hidden, target: a.target, rel: a.rel }; })()`);
  assert.equal(mark.href.replace(/\/$/, ''), REPO_URL.replace(/\/$/, ''));
  assert.equal(mark.hidden, false);
  assert.equal(mark.target, '_blank');
  assert.match(mark.rel, /noopener/);
});

test('chart legends toggle series and slices on answer pages', { skip }, async () => {
  const page = await open('answer-quarterly-review');
  const donut = 'document.querySelector(".p-chart--donut")';
  assert.equal(await page.eval(`${donut}.querySelector(".p-legend").classList.contains("is-live")`), true);
  const total = () => page.eval(`${donut}.querySelector("text.c-total").textContent`);
  const before = await total();
  await page.eval(`${donut}.querySelector('.p-legend li[data-i="0"]').click()`);
  assert.notEqual(await total(), before, 'the total drops without the first slice');
  assert.equal(await page.eval(`${donut}.querySelectorAll(".p-chart-svg [data-i]").length`), 3);
  assert.equal(await page.eval(`${donut}.querySelector('.p-legend li[data-i="0"]').getAttribute('aria-pressed')`), 'false');
  await page.eval(`${donut}.querySelector('.p-legend li[data-i="0"]').click()`);
  assert.equal(await total(), before, 'and comes back');

  const series = 'document.querySelector(".p-chart--line")';
  await page.eval(`${series}.querySelector('.p-legend li[data-i="1"]').click()`);
  assert.equal(await page.eval(`${series}.querySelector('.p-chart-svg [data-s="1"]').style.display`), 'none');
});

test('? opens the shortcuts side panel; Esc closes it and focus returns', { skip }, async () => {
  const page = await open('platform-overview');
  const key = (k) => page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  await page.eval(`document.getElementById('btn-fit').focus()`);
  await key('?');
  await page.waitFor(`document.getElementById('help').classList.contains('is-open')`);
  const state = await page.eval(`(() => {
    const help = document.getElementById('help');
    return {
      tag: help.tagName, inert: help.inert, label: help.getAttribute('aria-labelledby'),
      focused: help.contains(document.activeElement),
      pressed: document.getElementById('btn-help').getAttribute('aria-pressed'),
      groups: [...help.querySelectorAll('[data-group]')].map((g) => g.dataset.group),
      kbd: help.querySelectorAll('kbd').length,
      dock: getComputedStyle(help).position, visible: getComputedStyle(help).visibility
    };
  })()`);
  assert.equal(state.tag, 'ASIDE');
  assert.equal(state.inert, false);
  assert.equal(state.label, 'help-title');
  assert.equal(state.focused, true, 'focus moves into the panel');
  assert.equal(state.pressed, 'true');
  assert.deepEqual(state.groups, ['walk', 'nav', 'view', 'drill', 'pointer'], 'no fold keys on a diagram without nested groups');
  assert.ok(state.kbd > 15);
  assert.equal(state.dock, 'absolute');

  // The inspector replaces it, and back
  await key('i');
  await page.waitFor(`document.getElementById('inspector').classList.contains('is-open')`);
  assert.equal(await page.eval(`document.getElementById('help').classList.contains('is-open')`), false);
  await key('?');
  await page.waitFor(`document.getElementById('help').classList.contains('is-open')`);
  assert.equal(await page.eval(`document.getElementById('inspector').classList.contains('is-open')`), false);

  await key('Escape');
  await page.waitFor(`!document.getElementById('help').classList.contains('is-open')`);
  assert.equal(await page.eval('document.getElementById("help").inert'), true);
  assert.equal(await page.eval('window.yantra.levels.depth'), 0, 'Esc only closed the panel');
  assert.equal(await page.eval('document.activeElement.id'), 'btn-fit', 'focus returns to where it was');
});

/** Serve dist/ (the gallery viewer, examples included) over HTTP: module scripts do not load from file:. */
async function serveGallery() {
  ensureAppBuilt({ log: () => {} });
  const dist = path.join(ROOT, 'dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dist, rel);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const phone = (page) => page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });

test('phones (390px): the More menu lists the gallery sections, switches to an answer page and opens the shortcuts', { skip }, async () => {
  const server = await serveGallery();
  try {
    const page = await browser.open(`${server.url}#example=platform-overview`);
    await phone(page);
    await page.waitFor(`location.protocol === "http:" && document.readyState === "complete" && !!window.yantra`);
    const shown = (id) => page.eval(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).display !== 'none'`);
    assert.equal(await shown('more'), true, 'the More button shows on phones');
    assert.equal(await shown('btn-help'), false);
    assert.equal(await shown('example-select'), false);
    const bar = await page.eval(`(() => { const b = document.querySelector('.y-bar').getBoundingClientRect(); const m = document.getElementById('btn-more').getBoundingClientRect(); return m.right <= b.right && m.left >= b.left; })()`);
    assert.equal(bar, true, 'the More button fits inside the toolbar');

    // Keyboard: ArrowDown opens the menu on the current example
    await page.eval(`document.getElementById('btn-more').focus(); document.getElementById('btn-more').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    await page.waitFor(`!document.getElementById('more-menu').hidden`);
    const menuState = await page.eval(`(() => {
      const m = document.getElementById('more-menu');
      return {
        expanded: document.getElementById('btn-more').getAttribute('aria-expanded'),
        groups: [...m.querySelectorAll('[role="group"]')].map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent),
        focused: document.activeElement.dataset.example, checked: document.activeElement.getAttribute('aria-checked'),
        help: !!m.querySelector('[data-more="help"]')
      };
    })()`);
    assert.equal(menuState.expanded, 'true');
    assert.deepEqual(menuState.groups, ['Diagrams', 'Answer pages (Q&A)', 'Charts & dashboards']);
    assert.equal(menuState.focused, 'platform-overview');
    assert.equal(menuState.checked, 'true');
    assert.equal(menuState.help, true);

    // An answer page from the list opens in its frame; the menu still switches from there
    await page.eval(`document.querySelector('#more-menu [data-example="answer-launch-plan"]').click()`);
    await page.waitFor(`document.querySelector('.y-app').classList.contains('is-page') && !!document.getElementById('page-frame')`);
    assert.match(await page.eval('location.hash'), /example=answer-launch-plan/);
    assert.equal(await page.eval(`document.getElementById('more-menu').hidden`), true, 'choosing closes the menu');
    assert.equal(await page.eval('document.activeElement.id'), 'btn-more', 'and focus returns to its button');
    assert.equal(await shown('more'), true, 'the More menu stays on answer pages');
    assert.equal(await page.eval(`document.querySelector('#more-menu [data-more="help"]')`), null, 'no shortcuts over an answer page');
    await page.eval(`document.getElementById('btn-more').click()`);
    assert.equal(await page.eval(`document.activeElement.dataset.example`), 'answer-launch-plan');
    await page.eval(`document.querySelector('#more-menu [data-example="platform-overview"]').click()`);
    await page.waitFor(`!document.querySelector('.y-app').classList.contains('is-page')`);

    // Keyboard shortcuts from the menu; Esc closes the panel and focus returns to More
    await page.eval(`document.getElementById('btn-more').click()`);
    await page.eval(`document.querySelector('#more-menu [data-more="help"]').click()`);
    await page.waitFor(`document.getElementById('help').classList.contains('is-open')`);
    assert.equal(await page.eval(`document.getElementById('help').contains(document.activeElement)`), true);
    await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await page.waitFor(`!document.getElementById('help').classList.contains('is-open')`);
    assert.equal(await page.eval('document.activeElement.id'), 'btn-more');
  } finally {
    await server.close();
  }
});

test('phones (390px): a built diagram has no gallery, so its More menu holds only the shortcuts', { skip }, async () => {
  const page = await open('platform-overview');
  await phone(page);
  await page.waitFor(`getComputedStyle(document.getElementById('more')).display !== 'none'`);
  const items = await page.eval(`[...document.querySelectorAll('#more-menu [role^="menuitem"]')].map((b) => b.dataset.more || b.dataset.example)`);
  assert.deepEqual(items, ['help']);
});
