import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPage, buildHtml, ROOT } from '../lib/build.js';

const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));
const scriptText = (html, id) => {
  const open = `<script type="application/json" id="${id}">`;
  const a = html.lastIndexOf(open);
  return a < 0 ? null : html.slice(a + open.length, html.indexOf('</script>', a));
};

test('interactive embeds share one viewer shell and keep a static print figure', () => {
  const diagram = example('research-paper-lifecycle');
  const page = {
    kind: 'page',
    meta: { title: 'Two embeds' },
    answer: { headline: 'Shared shell' },
    blocks: [
      { type: 'diagram', title: 'One', diagram, interactive: true },
      { type: 'diagram', title: 'Two', diagram: example('oauth-login'), interactive: true }
    ]
  };
  const html = buildPage(page, ROOT);
  assert.equal(html.match(/id="yantra-viewer-shell"/g).length, 1, 'one shell');
  assert.equal(html.match(/<iframe [^>]*data-yantra-embed="\d"/g).length, 2);
  assert.ok(!/srcdoc=/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline srcdoc copies');
  assert.equal(html.match(/class="p-print-only"/g).length, 2, 'static fallback per diagram');
  assert.match(html, /<noscript><style>\.p-live\{display:none!important\}/);

  // What the page script does at load: splice each payload into the shell
  const shell = JSON.parse(scriptText(html, 'yantra-viewer-shell'));
  const slot = '"__yantra_embed_payload__"';
  assert.equal(shell.split(slot).length, 2, 'exactly one payload slot');
  const doc = shell.replace(slot, () => scriptText(html, 'yantra-embed-0'));
  const embedded = JSON.parse(scriptText(doc, 'yantra-payload'));
  assert.equal(embedded.meta.title, diagram.meta.title);
  assert.ok(doc.includes("addEventListener('message'"), 'theme prelude present');

  // Two embeds cost about one shell, not two
  const one = buildPage({ ...page, blocks: page.blocks.slice(0, 1) }, ROOT);
  assert.ok(html.length - one.length < shell.length / 2, 'second embed does not repeat the shell');
});

test('large data: URIs (logos) appear once per page', () => {
  const html = buildPage(example('answer-explain-photosynthesis'), path.join(ROOT, 'examples'));
  const uris = html.match(/(?:src|href)="data:[^"]{2048,}"/g) || [];
  assert.equal(new Set(uris).size, uris.length, 'no duplicated large data: URI');
});

test('built diagrams do not carry the example gallery', () => {
  const html = buildHtml(example('oauth-login'));
  assert.ok(!html.includes('Research paper lifecycle'), 'gallery examples are not inlined');
});

test('closed inspector is hidden and inert', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'app.css'), 'utf-8');
  const closed = /\.y-inspector \{[^}]*\}/.exec(css)[0];
  assert.match(closed, /visibility: hidden/);
  assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8'), /<aside id="inspector"[^>]*\binert\b/);
});
