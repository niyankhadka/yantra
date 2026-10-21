/**
 * The website (site/vite.config.js): one build into a temp folder, then checks on the
 * output: every page exists, has a title, description and canonical URL, is in the
 * sitemap, and no internal link (or #fragment) is broken. Links to repository files on
 * GitHub must name files that exist here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { ROOT, tempDir, removeDir, startBrowser } from './support.js';
import { findBrowser } from '../lib/browser.js';
import { lint } from '../src/core/lint.js';
import { isPage } from '../src/core/page.js';
import { lintPage } from '../src/core/lint.js';
import { GUIDES, SITE, galleryIds, referencePages } from '../site/build/content.js';
import { renderMarkdown, slugify } from '../site/build/markdown.js';
import { highlight } from '../site/build/highlight.js';

let OUT;
const file = (rel) => path.join(OUT, rel);
const readOut = (rel) => fs.readFileSync(file(rel), 'utf-8');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Site pages: every HTML file except the built viewer files (demo, viewer shell). */
const pages = () => walk(OUT).filter((f) => f.endsWith('.html') && !f.startsWith('demo/') && !f.endsWith('viewer-shell.html'));
const urlOf = (rel) => (rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`);

before(() => {
  OUT = tempDir('yantra-site-');
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const res = spawnSync(process.execPath, [vite, 'build', '--config', 'site/vite.config.js', '--logLevel', 'warn'], {
    cwd: ROOT,
    env: { ...process.env, YANTRA_SITE_OUT: OUT, YANTRA_SITE_STARS: '0' },
    encoding: 'utf-8'
  });
  assert.equal(res.status, 0, `site build failed:\n${res.stderr}`);
}, { timeout: 300000 });

after(() => OUT && removeDir(OUT));

test('the build has the landing page, every doc and guide, the playground, 404 and the static files', () => {
  const expected = [
    'index.html', 'docs/index.html', '404.html', 'sitemap.xml', 'robots.txt', '.nojekyll', 'sw.js',
    'playground/index.html', 'playground/sw.js', 'playground/viewer-shell.html', 'docs/search-index.json',
    'social-preview.png', 'logo-light.svg', 'logo-dark.svg', 'demo/cloud-architecture.html',
    ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f.slice(0, -3)}/index.html`),
    'docs/changelog/index.html',
    ...fs.readdirSync(path.join(ROOT, 'site', 'guides')).filter((f) => f.endsWith('.md')).map((f) => `docs/guides/${f.slice(0, -3)}/index.html`)
  ];
  for (const f of expected) assert.ok(fs.existsSync(file(f)), `${f} is built`);
  // Every guide file is in the sidebar
  for (const f of fs.readdirSync(path.join(ROOT, 'site', 'guides')).filter((x) => x.endsWith('.md'))) {
    assert.ok(GUIDES.some((g) => g.file === `site/guides/${f}`), `site/guides/${f} is listed in site/build/content.js`);
  }
});

test('every page has a title, a description and its canonical URL; the sitemap lists them', () => {
  const sitemap = readOut('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const rel of pages()) {
    const html = readOut(rel);
    const url = urlOf(rel);
    assert.match(html, /<title>[^<]{3,}<\/title>/, `${rel}: title`);
    const desc = /<meta name="description" content="([^"]*)"/.exec(html);
    assert.ok(desc && desc[1].length >= 30, `${rel}: description`);
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    assert.equal(canonical, `${SITE.url}${url}`, `${rel}: canonical`);
    assert.match(html, /<meta property="og:image" content="https:\/\/yantra\.nbk\.com\.np\/social-preview\.png"/, `${rel}: social card`);
    assert.match(html, /<html lang="[a-z]+/, `${rel}: lang`);
    if (rel !== '404.html') assert.ok(locs.includes(`${SITE.url}${url}`), `${url} is in the sitemap`);
    else assert.match(html, /<meta name="robots" content="noindex">/);
  }
  for (const loc of locs) {
    const rel = loc.slice(SITE.url.length + 1);
    assert.ok(fs.existsSync(file(rel.endsWith('/') || rel === '' ? `${rel}index.html` : rel)), `sitemap entry ${loc} exists`);
  }
  assert.match(readOut('robots.txt'), /Sitemap: https:\/\/yantra\.nbk\.com\.np\/sitemap\.xml/);
});

/** Every JSON-LD node of a page (top-level objects and @graph members). */
function jsonLdOf(html, rel) {
  const nodes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    assert.doesNotThrow(() => (data = JSON.parse(m[1])), `${rel}: JSON-LD parses`);
    assert.equal(data['@context'], 'https://schema.org', `${rel}: JSON-LD context`);
    nodes.push(...(data['@graph'] || [data]));
  }
  return nodes;
}

test('search engines: unique titles and descriptions within limits, one h1, structured data, dated sitemap', () => {
  const titles = new Map();
  const descs = new Map();
  for (const rel of pages()) {
    const html = readOut(rel);
    const title = /<title>([^<]*)<\/title>/.exec(html)[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    assert.ok(title.length <= 60, `${rel}: title is ${title.length} characters (at most 60): ${title}`);
    assert.ok(desc.length <= 155, `${rel}: description is ${desc.length} characters (at most 155)`);
    assert.ok(!titles.has(title), `${rel}: title "${title}" also used by ${titles.get(title)}`);
    assert.ok(!descs.has(desc), `${rel}: description also used by ${descs.get(desc)}`);
    titles.set(title, rel);
    descs.set(desc, rel);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${rel}: one h1`);
    assert.match(html, /<meta property="og:title" content="[^"]+"/, `${rel}: og:title`);
    assert.match(html, /<meta property="og:image:width" content="1280"/, `${rel}: og:image size`);
    assert.match(html, /<meta name="twitter:description" content="[^"]+"/, `${rel}: twitter:description`);
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/, `${rel}: manifest`);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/, `${rel}: apple-touch-icon`);
    for (const img of html.matchAll(/<img\b[^>]*>/g)) assert.match(img[0], /\salt="/, `${rel}: every image has alt`);
    const ld = jsonLdOf(html, rel);
    if (rel === '404.html') {
      assert.match(html, /<meta name="robots" content="noindex">/);
      assert.ok(!/google-site-verification/.test(html));
      continue;
    }
    assert.ok(ld.length, `${rel}: has structured data`);
    const types = ld.map((n) => n['@type']);
    assert.ok(types.includes('BreadcrumbList') || rel === 'index.html', `${rel}: breadcrumbs`);
    for (const b of ld.filter((n) => n['@type'] === 'BreadcrumbList')) {
      b.itemListElement.forEach((it, i) => {
        assert.equal(it.position, i + 1);
        assert.ok(it.name && it.item.startsWith(`${SITE.url}/`), `${rel}: breadcrumb item`);
      });
    }
    if (rel.startsWith('docs/') && rel !== 'docs/index.html') {
      const a = ld.find((n) => n['@type'] === 'TechArticle');
      assert.ok(a, `${rel}: TechArticle`);
      assert.equal(a.url, `${SITE.url}${urlOf(rel)}`);
      assert.ok(a.headline && a.description && a.author?.name, `${rel}: TechArticle fields`);
      assert.ok(!Number.isNaN(Date.parse(a.dateModified)), `${rel}: dateModified`);
      assert.match(html, /<meta property="og:type" content="article">/);
    }
  }

  const home = jsonLdOf(readOut('index.html'), 'index.html');
  const app = home.find((n) => n['@type'] === 'SoftwareApplication');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.equal(app.softwareVersion, pkg.version);
  assert.equal(app.applicationCategory, 'DeveloperApplication');
  assert.equal(app.operatingSystem, 'Windows, macOS, Linux');
  assert.deepEqual(app.offers, { '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  assert.equal(app.license, 'https://opensource.org/licenses/MIT');
  assert.equal(app.downloadUrl, 'https://www.npmjs.com/package/@niyankhadka/yantra');
  assert.ok(!('aggregateRating' in app) && !('review' in app), 'no ratings or reviews');
  const person = home.find((n) => n['@type'] === 'Person');
  assert.deepEqual(person.sameAs, ['https://github.com/niyankhadka']);
  const site = home.find((n) => n['@type'] === 'WebSite');
  assert.equal(site.potentialAction.target.urlTemplate, `${SITE.url}/docs/?q={search_term_string}`);
  // FAQ structured data matches the questions shown on the page
  const faq = home.find((n) => n['@type'] === 'FAQPage');
  const shown = [...readOut('index.html').matchAll(/<summary>([^<]+)<\/summary>/g)].map((m) => m[1].replace(/&#39;/g, "'"));
  assert.deepEqual(faq.mainEntity.map((q) => q.name), shown);
  for (const q of faq.mainEntity) assert.ok(q.acceptedAnswer.text.length > 20 && !/<\w/.test(q.acceptedAnswer.text));
  const pg = jsonLdOf(readOut('playground/index.html'), 'playground').find((n) => n['@type'] === 'WebApplication');
  assert.equal(pg.url, `${SITE.url}/playground/`);

  // Sitemap: every indexable page, each with a lastmod date
  const sitemap = readOut('sitemap.xml');
  const urls = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)];
  assert.equal(urls.length, (sitemap.match(/<url>/g) || []).length, 'every sitemap entry has a lastmod');
  assert.equal(urls.length, pages().length - 1, 'every page but the 404 is in the sitemap');
  const manifest = JSON.parse(readOut('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(file(icon.src.slice(1))), `${icon.src} exists`);
});

test('verification meta tags come only from the build environment', async () => {
  const { siteFiles } = await import('../site/build/pages.js');
  const assets = { js: '/x.js', css: [] };
  const stars = process.env.YANTRA_SITE_STARS;
  process.env.YANTRA_SITE_STARS = '0';
  const statics = { files: {}, thumbs: new Proxy({}, { get: () => ({ w: 1, h: 1 }) }) };
  const before = await siteFiles({ assets, statics });
  assert.ok(!/google-site-verification|msvalidate/.test(before['index.html']), 'none by default');
  process.env.YANTRA_SITE_GOOGLE_VERIFICATION = 'test-google-code';
  process.env.YANTRA_SITE_BING_VERIFICATION = 'TESTBINGCODE';
  try {
    const files = await siteFiles({ assets, statics });
    assert.match(files['index.html'], /<meta name="google-site-verification" content="test-google-code">/);
    assert.match(files['index.html'], /<meta name="msvalidate\.01" content="TESTBINGCODE">/);
    assert.ok(!/google-site-verification/.test(files['404.html']), 'not on the noindex 404');
  } finally {
    delete process.env.YANTRA_SITE_GOOGLE_VERIFICATION;
    delete process.env.YANTRA_SITE_BING_VERIFICATION;
    if (stars === undefined) delete process.env.YANTRA_SITE_STARS;
    else process.env.YANTRA_SITE_STARS = stars;
  }
});

test('no broken internal links, fragments or repository links', () => {
  const ids = new Map();
  const idsOf = (rel) => {
    if (!ids.has(rel)) ids.set(rel, new Set([...readOut(rel).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    return ids.get(rel);
  };
  const gallery = galleryIds();
  const repoPrefix = `${SITE.repo}/`;
  const broken = [];
  let checked = 0;
  for (const rel of pages()) {
    const html = readOut(rel).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (s) => (/\ssrc=/.test(s) ? s : ''));
    const base = `${SITE.url}${urlOf(rel)}`;
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const raw = m[1].replace(/&amp;/g, '&');
      if (/^(mailto:|data:)/.test(raw)) continue;
      const u = new URL(raw, base);
      if (u.origin === SITE.url) {
        checked++;
        let target = decodeURIComponent(u.pathname).slice(1);
        if (target === '' || target.endsWith('/')) target += 'index.html';
        if (!fs.existsSync(file(target))) {
          broken.push(`${rel}: ${raw} (no ${target})`);
          continue;
        }
        const hash = decodeURIComponent(u.hash.slice(1));
        if (!hash) continue;
        if (target === 'playground/index.html') {
          const ex = /^example=([\w-]+)$/.exec(hash);
          if (!ex || !gallery.has(ex[1])) broken.push(`${rel}: ${raw} (no gallery example)`);
        } else if (target.endsWith('.html') && !target.startsWith('demo/') && !idsOf(target).has(hash)) {
          broken.push(`${rel}: ${raw} (no #${hash} in ${target})`);
        }
      } else if (u.href.startsWith(repoPrefix)) {
        const m2 = /^(?:blob|tree|edit)\/main\/(.+)$/.exec(u.pathname.slice(new URL(repoPrefix).pathname.length));
        if (m2 && !fs.existsSync(path.join(ROOT, decodeURIComponent(m2[1])))) broken.push(`${rel}: ${raw} (no ${m2[1]} in the repository)`);
      } else if (!/^https?:$/.test(u.protocol)) {
        broken.push(`${rel}: ${raw} (unexpected scheme)`);
      }
    }
  }
  assert.deepEqual(broken, []);
  assert.ok(checked > 500, `checked ${checked} internal links`);
});

test('the playground keeps its features under /playground/ and the old root forwards there', () => {
  const pg = readOut('playground/index.html');
  assert.match(pg, /<script type="module"[^>]*src="\/assets\/playground-[\w-]+\.js"/);
  assert.match(pg, /<link rel="canonical" href="https:\/\/yantra\.nbk\.com\.np\/playground\/"/);
  const sw = readOut('playground/sw.js');
  const files = JSON.parse(/const FILES = (\[[^\n]*\]);/.exec(sw)[1]);
  assert.ok(files.includes('/playground/') && files.includes('/playground/viewer-shell.html'));
  for (const f of files) assert.ok(fs.existsSync(file(f.endsWith('/') ? `${f.slice(1)}index.html` : f.slice(1))), `precached ${f} exists`);
  assert.ok(files.some((f) => /\/assets\/examples-[\w-]+\.js$/.test(f)), 'gallery chunk is precached');
  assert.ok(!files.some((f) => /\/assets\/site-/.test(f)), 'the site script is not part of the playground cache');
  // The old root-level service worker is retired, not left serving stale files
  assert.match(readOut('sw.js'), /registration\.unregister\(\)/);
  // Landing page: /#example=... and /?lang=... go to the playground
  const home = readOut('index.html');
  assert.match(home, /example=\/\.test\(l\.hash\)/);
  assert.match(home, /l\.replace\('\/playground\/'\+l\.search\+l\.hash\)/);
  assert.match(readOut('demo/cloud-architecture.html'), /id="yantra-payload"/, 'the live demo is the real viewer with a payload');
});

test('the docs search index covers every page and section', () => {
  const index = JSON.parse(readOut('docs/search-index.json'));
  const urls = index.map((p) => p.u);
  for (const r of referencePages()) assert.ok(urls.includes(`/docs/${r.slug}/`), r.slug);
  for (const g of GUIDES) assert.ok(urls.includes(`/docs/guides/${g.slug}/`), g.slug);
  for (const p of index) {
    assert.ok(p.t && p.s.length > 0, p.u);
    const html = readOut(`${p.u.slice(1)}index.html`);
    for (const s of p.s) if (s.i) assert.ok(html.includes(` id="${s.i}"`), `${p.u}#${s.i}`);
  }
});

test('guide JSON examples are valid payloads', () => {
  let n = 0;
  for (const g of GUIDES) {
    const text = fs.readFileSync(path.join(ROOT, g.file), 'utf-8');
    for (const m of text.matchAll(/```json\n([\s\S]*?)```/g)) {
      const value = JSON.parse(m[1]);
      if (!value.nodes && value.kind !== 'page') continue; // fragments (a single block)
      const r = isPage(value) ? lintPage(value) : lint(value);
      assert.deepEqual(r.errors.map((f) => `${f.code} ${f.message}`), [], g.file);
      n++;
    }
  }
  assert.ok(n >= 2, 'the guides show a full diagram and a full page');
});

test('markdown: raw HTML is escaped, links are rewritten, headings get GitHub ids', () => {
  const r = renderMarkdown('# T\n\n<script>alert(1)</script>\n\nSee [authoring](authoring.md#groups), [ex](../examples/oauth-login.json), [src](../src/core/lint.js) and <kbd>V</kbd>.\n\n## draw.io / diagrams.net\n', 'docs/x.md');
  assert.ok(!/<script/i.test(r.html), 'no script element');
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /href="\/docs\/authoring\/#groups"/);
  assert.match(r.html, /href="\/playground\/#example=oauth-login"/);
  assert.match(r.html, /href="https:\/\/github\.com\/niyankhadka\/yantra\/blob\/main\/src\/core\/lint\.js"/);
  assert.match(r.html, /<kbd>V<\/kbd>/);
  assert.match(r.html, /id="drawio--diagramsnet"/);
  assert.equal(slugify('Charts and plans (answer pages)'), 'charts-and-plans-answer-pages');
  assert.deepEqual(renderMarkdown('[x](missing.md)', 'docs/x.md').broken.length, 1, 'a link to a missing file is reported');
  assert.equal(highlight('<b> "a": 1', 'json'), '&lt;b&gt; <span class="t-key">&quot;a&quot;</span>: <span class="t-num">1</span>');
});

test('chat packs and the README point to the playground at /playground/', () => {
  for (const f of ['chat/prompt.md', 'chat/chatgpt/instructions.md', 'chat/claude-skill/yantra/SKILL.md', 'docs/chat.md', 'README.md']) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    assert.ok(text.includes('https://yantra.nbk.com.np/playground/'), `${f} links the playground`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.equal(pkg.homepage, 'https://yantra.nbk.com.np/');
  assert.match(fs.readFileSync(path.join(ROOT, 'python', 'pyproject.toml'), 'utf-8'), /^Homepage = "https:\/\/yantra\.nbk\.com\.np\/"$/m);
});

/** Serve the built site on a free local port; resolves to { base, close }. */
function serveOut() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let f = path.join(OUT, decodeURIComponent(req.url.split(/[?#]/)[0]));
    if (f.endsWith(path.sep) || f.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(OUT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

const browserPath = findBrowser();
test('playground: Copy prompt follows the editor (empty, valid example, findings)', { skip: browserPath ? false : 'no Chrome, Edge or Chromium found', timeout: 120000 }, async () => {
  const srv = await serveOut();
  const browser = await startBrowser(browserPath);
  try {
    const page = await browser.open(`${srv.base}/playground/#example=oauth-login`);
    await page.waitFor(`location.href.startsWith(${JSON.stringify(srv.base)}) && document.readyState === "complete" && document.getElementById('src').value.includes('OAuth')`);
    // Capture the clipboard instead of writing to it
    await page.eval(`Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); true`);
    const copy = async () => {
      await page.eval(`window.__copied = null; document.getElementById('copy-prompt').click(); true`);
      return page.waitFor('window.__copied');
    };
    await page.waitFor(`document.getElementById('copy-label').textContent === 'Copy prompt with this diagram'`);
    let text = await copy();
    assert.match(text, /^You can draw with Yantra\./, 'starts with chat/prompt.md');
    assert.match(text, /## My current diagram\n\n```json\n\{/);
    assert.match(text, /Change this diagram: <your request here>/);
    assert.match(await page.eval(`document.getElementById('toast').textContent`), /kB/);

    // The request box replaces the placeholder
    await page.eval(`document.getElementById('copy-request').value = 'Add a logout step'; true`);
    assert.match(await copy(), /Change this diagram: Add a logout step/);

    // Findings: an edge to a missing node
    await page.eval(`const e = document.getElementById('src'); e.value = JSON.stringify({ meta: { title: 'X' }, nodes: [{ id: 'a', data: { title: 'A' } }], edges: [{ id: 'e', source: 'a', target: 'zz' }] }); e.dispatchEvent(new Event('input')); true`);
    await page.waitFor(`document.getElementById('copy-label').textContent === 'Copy prompt to fix this'`);
    text = await copy();
    assert.match(text, /- error `ref\/edge-unknown-target` \(edge e\):/);
    assert.match(text, /Fix these problems and return the full corrected JSON/);
    assert.match(text, /Also: Add a logout step/);

    // Empty editor
    await page.eval(`document.getElementById('copy-request').value = ''; document.getElementById('btn-clear').click(); true`);
    await page.waitFor(`document.getElementById('copy-label').textContent === 'Copy prompt for your chat'`);
    assert.ok((await copy()).trimEnd().endsWith('Describe what you want: <your request here>'));
  } finally {
    await browser.close();
    await srv.close();
  }
});
