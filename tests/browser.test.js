// Interaction tests in a real headless browser (Chrome, Edge or Chromium; YANTRA_BROWSER picks
// one). Skipped, with a message, when none is installed. Only Node built-ins: the DevTools
// protocol runs over a pipe (tests/support.js startBrowser).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findBrowser } from '../lib/browser.js';
import { buildAny, resolveAny, ROOT } from '../lib/build.js';
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
