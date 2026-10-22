/**
 * Single-file HTML assembly from a viewer shell (the app with every asset inlined
 * and an empty payload slot). Pure string functions, no DOM and no file access:
 * lib/build.js passes the shell it builds from dist/, and the browser playground
 * passes the shell it was built with, so a file made in either place is the same.
 */
import { renderPage, srcdocAttr, walkBlocks } from './page.js';
import { renderBook } from './book.js';
import { localeOf, stringsFor } from './i18n.js';

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

const PAYLOAD_OPEN = '<script type="application/json" id="yantra-payload">';
const STRINGS_OPEN = '<script type="application/json" id="yantra-strings">';

/** JSON text that is safe inside a <script> element (no `</` or `<!--`). */
export const scriptJson = (value) => JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');

/**
 * Embed a payload in the app shell. The shell carries English interface strings
 * only; the tables for `langs` (default: the payload's languages) go in a JSON
 * script that the viewer registers at load, so a file holds just what it shows.
 */
export function embedPayload(html, payload, langs = payloadLangs(payload)) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const title = String(payload?.meta?.title || 'Yantra').replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  // The slot is the last occurrence: inlined app code may precede it
  const start = html.lastIndexOf(PAYLOAD_OPEN);
  const end = start < 0 ? -1 : html.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('Payload slot not found in app shell');
  const tables = stringsFor([...langs]);
  const strings = Object.keys(tables).length ? `${STRINGS_OPEN}${scriptJson(tables)}</script>\n  ` : '';
  const out = html.slice(0, start) + strings + html.slice(start, start + PAYLOAD_OPEN.length) + json + html.slice(end);
  // Language and direction before the first paint (the viewer sets them again at load)
  const { lang, dir } = localeOf(payload?.meta);
  return out
    .replace(/<html lang="[^"]*"/, () => `<html lang="${lang}" dir="${dir}"`)
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
}

/**
 * Runs first inside an embedded viewer (sandboxed iframe, opaque origin): the
 * hash mirror must not throw, and the host page sends its theme by postMessage.
 */
export const EMBED_PRELUDE = `<script>(function(){var h=history,r=h.replaceState;h.replaceState=function(){try{return r.apply(h,arguments)}catch(e){}};
addEventListener('message',function(e){var t=e.data&&e.data.yantraTheme;if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)})})();</script>`;

/** The embed prelude placed first in <head>. */
export function withPrelude(html) {
  const m = /<head[^>]*>/i.exec(html);
  if (!m) return EMBED_PRELUDE + html;
  const end = m.index + m[0].length;
  return html.slice(0, end) + EMBED_PRELUDE + html.slice(end);
}

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

function shareViewer(html, payloads, shell) {
  if (!payloads.length) return html;
  payloads.forEach((_, i) => {
    html = html.replace(`srcdoc="${srcdocAttr(EMBED_MARK(i))}"`, () => `data-yantra-embed="${i}"`);
  });
  const langs = new Set();
  for (const p of payloads) payloadLangs(p, langs);
  const viewer = withPrelude(embedPayload(shell(), '__yantra_embed_payload__', langs));
  if (!viewer.includes(EMBED_SLOT)) throw new Error('Embed payload slot not found in viewer shell');
  const data = [
    `<script type="application/json" id="yantra-viewer-shell">${scriptJson(viewer)}</script>`,
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

/** A book whose chapters are already resolved: as pageHtml, one shared viewer for every chapter's embeds. */
export function bookHtml(book, { shell, logos = {} }) {
  let live = false;
  for (const ch of Array.isArray(book.chapters) ? book.chapters : []) walkBlocks(ch?.blocks, (b) => (live ||= b?.type === 'diagram' && !!b.interactive && !!b.diagram));
  const payloads = [];
  const viewerHtml = live ? (diagram) => EMBED_MARK(payloads.push(diagram) - 1) : null;
  const html = renderBook(book, { logos, viewerHtml });
  return shareViewer(dedupeDataUris(html), payloads, shell);
}

/**
 * A page whose diagram blocks are already resolved. Blocks with `interactive: true`
 * embed the full viewer: one shared copy of `shell()` (called only when needed) for
 * every embed, with the static SVG kept for print and no-JS.
 */
export function pageHtml(page, { shell, logos = {} }) {
  let live = false;
  walkBlocks(page.blocks, (b) => (live ||= b?.type === 'diagram' && !!b.interactive && !!b.diagram));
  const payloads = [];
  const viewerHtml = live ? (diagram) => EMBED_MARK(payloads.push(diagram) - 1) : null;
  const html = renderPage(page, { logos, viewerHtml });
  return shareViewer(dedupeDataUris(html), payloads, shell);
}
