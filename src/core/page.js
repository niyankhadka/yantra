/**
 * Answer pages ("one paper"): a question answered on a single printable page.
 * Conclusion first (answer), then typed blocks. Pure string rendering, so it
 * runs in Node; the output is one self-contained HTML file.
 */
import { computeScene } from './scene.js';
import { renderSvg } from './svg.js';
import { themeCss, HUES } from './theme.js';
import { escapeHtml as h, mdInline as mi, mdBlock } from './text.js';
import { REPO_URL, GITHUB_MARK } from './icons.js';
import { renderChart, renderGantt, renderMatrix, sparkline, isSimpleBars, chartMarkdown, CHART_CSS, withChartLocale, enhanceCharts } from './charts.js';
import { getLevel } from './drill.js';
import { localeOf } from './i18n.js';
import { READER_CSS, READING_MODES, readerControls, readerScript, readerWords } from './reader.js';
import { detailsOf, detailPage, detailTitle, detailTree, detailTrail } from './details.js';

export const BLOCK_TYPES = ['text', 'points', 'steps', 'metrics', 'table', 'compare', 'callout', 'diagram', 'chart', 'code', 'sources', 'timeline', 'faq', 'checklist', 'quote', 'image', 'kv', 'gantt', 'matrix', 'section'];
/** Block widths: the whole row, half of it or a third (side by side on wide screens). */
export const SPANS = ['full', 'half', 'third'];
/** Design width (px) of a chart in a third-width block. */
const THIRD_WIDTH = 260;
const TONES = { info: 'blue', good: 'green', warn: 'amber', bad: 'rose', neutral: 'slate' };
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
const tone = (t) => (own(TONES, t) ? TONES[t] : own(HUES, t) ? t : 'blue');

/** Sandbox flags of an embedded live viewer: scripts and new-tab links only (opaque origin). */
export const FRAME_SANDBOX = 'allow-scripts allow-popups';

export const isPage = (p) => p && typeof p === 'object' && p.kind === 'page';
/** A book: chapters (answer pages) read in order, in one file. */
export const isBook = (p) => p && typeof p === 'object' && p.kind === 'book';

/** Inline markdown: **bold**, *italic*, `code`, [text](https://...). Input is escaped first. */
export function inline(text) {
  return h(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
}

/** Block markdown: paragraphs separated by blank lines, "- " bullet lists, "1. " numbered lists. */
export function md(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((chunk) => {
      const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return '';
      if (lines.every((l) => /^[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      if (lines.every((l) => /^\d+[.)] /.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+[.)] /, ''))}</li>`).join('')}</ol>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

const list = (v) => (Array.isArray(v) ? v : []);
// Link targets: bare when safe, else in <...> with spaces and angle brackets encoded
const mdUrl = (u) => {
  const t = String(u).trim();
  return /[\s()<>]/.test(t) ? `<${t.replace(/[<>\s]/g, encodeURIComponent)}>` : t;
};
const cell = (v) => mi(v).replace(/\|/g, '\\|');

/** Image sources allowed on pages: https URLs and data:image URIs (never javascript:, http: or file:). */
export const isSafeImageSrc = (src) =>
  typeof src === 'string' && (/^https:\/\/[^\s"'<>]+$/i.test(src.trim()) || /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(src.trim()));

/**
 * Stable anchor id from a block title: lower-case letters and digits joined by "-".
 * Latin accents are dropped (Café -> cafe); other scripts (Arabic, CJK, Devanagari…)
 * keep their letters and combining marks, so their anchors stay readable and distinct.
 */
export function slug(text) {
  const s = Array.from(
    String(text ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
  )
    .slice(0, 60)
    .join('')
    .replace(/-+$/, '');
  return s || 'section';
}

/** A title as plain text (light markdown removed), for title attributes and tooltips. */
const plain = (text) =>
  String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Every block in reading order, the blocks of a `section` after it (one level:
 * a section inside a section is not rendered): calls fn(block, { index, parent, depth }).
 */
export function walkBlocks(blocks, fn) {
  list(blocks).forEach((b, index) => {
    fn(b, { index, parent: null, depth: 0 });
    if (b?.type === 'section') list(b.blocks).forEach((c, i) => c?.type !== 'section' && fn(c, { index: i, parent: b, depth: 1 }));
  });
}

/**
 * Anchor ids for titled blocks: `top` (one per block, null when untitled) and
 * `inner` (for a section, one per block inside it; else null), de-duplicated
 * across the page with -2, -3 suffixes.
 */
export function pageAnchors(blocks, prefix = '') {
  const used = new Set();
  const id = (b) => {
    if (!b?.title) return null;
    const base = `${prefix}${slug(b.title)}`;
    let a = base;
    for (let n = 2; used.has(a); n++) a = `${base}-${n}`;
    used.add(a);
    return a;
  };
  const top = [];
  const inner = [];
  for (const b of list(blocks)) {
    top.push(id(b));
    inner.push(b?.type === 'section' ? list(b.blocks).map((c) => (c?.type === 'section' ? null : id(c))) : null);
  }
  return { top, inner };
}

/** Anchor ids for top-level titled blocks (null when untitled), de-duplicated with -2, -3 suffixes. */
export const blockAnchors = (blocks) => pageAnchors(blocks).top;

/** Escape a whole HTML document for an iframe srcdoc attribute (only & and " matter inside it). */
export const srcdocAttr = (html) => String(html).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * A diagram block's payload with the page language filled in: a diagram
 * without meta.lang inherits the page's lang and dir (its own strings stay).
 */
export function withPageLang(diagram, pageMeta) {
  const m = pageMeta && typeof pageMeta === 'object' ? pageMeta : {};
  if (!diagram || typeof diagram !== 'object' || !m.lang || diagram.meta?.lang) return diagram;
  return { ...diagram, meta: { lang: m.lang, ...(m.dir ? { dir: m.dir } : {}), ...(diagram.meta || {}) } };
}

/**
 * Static diagram figure (both themes); SVG ids are suffixed with ctx.uid and the theme to stay unique.
 * The scrollers are dir="ltr": a diagram keeps its layout direction on RTL pages.
 */
function staticFigure(b, ctx) {
  // `level` shows one of the diagram's detail diagrams (drill-down) instead of its overview
  const diagram = withPageLang((b.level && getLevel(b.diagram, b.level)) || b.diagram, ctx.pageMeta);
  const scene = computeScene(diagram, { modeId: b.mode });
  let highlight = null;
  const steps = diagram.scenarios?.[0]?.steps || diagram.steps || [];
  const step = Number.isInteger(b.step) ? steps[b.step - 1] : null;
  if (step && (step.highlightNodes || []).length) highlight = { nodes: new Set(step.highlightNodes), edges: new Set(step.highlightEdges || []) };
  const opts = { highlight, header: false, watermark: false, logo: null };
  // Each copy gets its own ids: a copy must never use the other theme's (hidden) markers
  return `<figure class="p-figure">
      <div class="p-scroll p-only-light" dir="ltr">${renderSvg(scene, { ...opts, theme: 'light', idSuffix: `${ctx.uid}-light` })}</div>
      <div class="p-scroll p-only-dark" dir="ltr">${renderSvg(scene, { ...opts, theme: 'dark', idSuffix: `${ctx.uid}-dark` })}</div>
      ${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}
    </figure>`;
}

const BLOCKS = {
  text: (b) => md(b.body),

  points: (b) =>
    `<div class="p-cards">${list(b.items)
      .map((it) => `<div class="p-card" data-hue="${tone(it.tone)}"><h4>${inline(it.title || '')}</h4>${it.text ? md(it.text) : ''}</div>`)
      .join('')}</div>`,

  steps: (b) =>
    `<ol class="p-steps">${list(b.items)
      .map((it) => `<li><div><h4>${inline(it.title || '')}</h4>${it.text ? md(it.text) : ''}</div></li>`)
      .join('')}</ol>`,

  metrics: (b, { L }) =>
    `<div class="p-metrics">${list(b.items)
      .map((it) => `<div class="p-metric" data-hue="${tone(it.tone)}"><span>${inline(it.label || '')}</span><strong>${h(L.num(it.value) ?? '')}</strong>${it.note ? `<em>${inline(it.note)}</em>` : ''}${Array.isArray(it.trend) ? sparkline(it.trend, tone(it.tone)) : ''}</div>`)
      .join('')}</div>`,

  table: (b) =>
    `<div class="p-scroll"><table><thead><tr>${list(b.columns).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${list(b.rows)
      .map((r) => `<tr>${list(r).map((c) => `<td>${inline(c ?? '')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`,

  compare: (b, { L }) =>
    `<div class="p-compare">${list(b.options)
      .map(
        (o) => `<div class="p-option${o.recommended ? ' is-pick' : ''}">
          <div class="p-option-head"><h4>${inline(o.name || '')}</h4>${o.recommended ? `<span class="p-chip">${h(L.t('page.recommended'))}</span>` : ''}</div>
          ${o.summary ? `<p class="p-muted">${inline(o.summary)}</p>` : ''}
          ${list(o.pros).length ? `<ul class="p-pros">${o.pros.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
          ${list(o.cons).length ? `<ul class="p-cons">${o.cons.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
          ${o.verdict ? `<p class="p-verdict">${inline(o.verdict)}</p>` : ''}
        </div>`
      )
      .join('')}</div>`,

  callout: (b) => `<div class="p-callout" data-hue="${tone(b.tone || 'info')}">${b.label ? `<strong>${inline(b.label)}</strong>` : ''}${md(b.body)}</div>`,

  diagram: (b, ctx) => {
    if (!b.diagram || typeof b.diagram !== 'object') return `<p class="p-muted">${h(ctx.L.t('page.diagramMissing'))}</p>`;
    const fig = staticFigure(b, ctx);
    // A live viewer gets the whole diagram (every level); `level` only picks where it opens
    const live = withPageLang(b.level ? { ...b.diagram, meta: { ...(b.diagram.meta || {}), startLevel: b.level } } : b.diagram, ctx.pageMeta);
    const viewer = b.interactive && typeof ctx.viewerHtml === 'function' ? ctx.viewerHtml(live, b) : null;
    if (!viewer) return fig;
    // Live viewer on screen, the static figure on paper
    const height = Number.isFinite(b.height) && b.height >= 240 ? Math.round(b.height) : 560;
    const label = ((b.level && getLevel(b.diagram, b.level)) || b.diagram).meta?.title || b.title || ctx.L.t('page.diagram');
    return `<figure class="p-figure p-live p-screen-only"><iframe class="p-frame" title="${h(ctx.L.t('page.interactive', { title: label }))}" sandbox="${h(ctx.frameSandbox || FRAME_SANDBOX)}" style="height:${height}px" srcdoc="${srcdocAttr(viewer)}"></iframe>${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>
    <div class="p-print-only">${fig}</div>`;
  },

  timeline: (b) =>
    `<ol class="p-timeline">${list(b.items)
      .map((it) => `<li data-hue="${tone(it.tone || 'neutral')}"><span class="p-date">${h(it.date ?? '')}</span><div><h4>${inline(it.title || '')}</h4>${it.text ? md(it.text) : ''}</div></li>`)
      .join('')}</ol>`,

  faq: (b) =>
    `<div class="p-faq">${list(b.items)
      .map((it) => `<details><summary>${inline(it.q || '')}</summary><div class="p-faq-a">${md(it.a)}</div></details>`)
      .join('')}</div>`,

  checklist: (b, { L }) =>
    `<ul class="p-checklist">${list(b.items)
      .map(
        (it) =>
          `<li class="${it.done ? 'is-done' : 'is-open'}"><span class="p-box" aria-hidden="true"></span><div><span class="p-sr">${h(L.t(it.done ? 'page.done' : 'page.todo'))} </span>${inline(it.text || '')}${it.note ? `<em>${inline(it.note)}</em>` : ''}</div></li>`
      )
      .join('')}</ul>`,

  quote: (b) =>
    `<figure class="p-quote"><blockquote>${md(b.text)}</blockquote>${
      b.by || b.source ? `<figcaption>${b.by ? inline(b.by) : ''}${b.by && b.source ? ', ' : ''}${b.source ? `<cite>${inline(b.source)}</cite>` : ''}</figcaption>` : ''
    }</figure>`,

  image: (b, { L }) => {
    if (!isSafeImageSrc(b.src)) return `<p class="p-muted">${h(L.t('page.imageOmitted'))}</p>`;
    const w = Number.isFinite(b.width) && b.width > 0 ? ` style="max-width:min(100%,${Math.round(b.width)}px)"` : '';
    return `<figure class="p-figure p-image"><img src="${h(b.src.trim())}" alt="${h(b.alt || '')}"${w}>${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
  },

  kv: (b) => `<dl class="p-kv">${list(b.items).map((it) => `<div><dt>${inline(it.k ?? '')}</dt><dd>${inline(it.v ?? '')}</dd></div>`).join('')}</dl>`,

  // Single-series bars without negatives keep the HTML bar list; every other chart is inline SVG (charts.js)
  chart: (b, ctx) => {
    if (!isSimpleBars(b)) return renderChart(b, { half: ctx.half, width: ctx.width, fit: true, caption: b.caption ? inline(b.caption) : '' });
    const { L } = ctx;
    const data = list(b.data).filter((d) => typeof d.value === 'number');
    const max = Math.max(1e-9, ...data.map((d) => Math.abs(d.value)));
    const unit = b.unit ? h(b.unit) : '';
    return `<div class="p-bars" role="list">${data
      .map(
        (d) => `<div class="p-bar" role="listitem" data-hue="${tone(d.tone)}"><span>${inline(d.label || '')}</span><div><i style="width:${((Math.abs(d.value) / max) * 100).toFixed(1)}%"></i></div><b>${h(L.num(d.value))}${unit}</b></div>`
      )
      .join('')}</div>`;
  },

  // A heading over a group of blocks in their own grid (one level: no section in a section)
  section: (b, ctx) =>
    `<div class="p-grid p-subgrid">${list(b.blocks)
      .map((c, i) => (c?.type === 'section' ? '' : renderBlock(c, `${ctx.uid}-${i + 1}`, { anchor: ctx.childAnchors?.[i] || null, viewerHtml: ctx.viewerHtml, pageMeta: ctx.pageMeta, locale: ctx.L, frameSandbox: ctx.frameSandbox, details: ctx.details, detailKey: ctx.detailKey })))
      .join('')}</div>`,

  gantt: (b, ctx) => renderGantt(b, { half: ctx.half, width: ctx.width, fit: true, caption: b.caption ? inline(b.caption) : '' }),

  matrix: (b, ctx) => renderMatrix(b, { half: ctx.half, width: ctx.width, fit: true, caption: b.caption ? inline(b.caption) : '' }),

  code: (b) => `<pre class="p-code"${b.language ? ` data-lang="${h(b.language)}"` : ''}><code>${h(b.code || '')}</code></pre>`,

  sources: (b) =>
    `<ol class="p-sources">${list(b.items)
      .map((s) => {
        const title = inline(s.title || s.url || '');
        const link = /^https?:\/\//.test(s.url || '') ? `<a href="${h(s.url)}" rel="noopener noreferrer">${title}</a>` : title;
        return `<li>${link}${s.note ? ` <span class="p-muted">- ${inline(s.note)}</span>` : ''}</li>`;
      })
      .join('')}</ol>`
};

/**
 * One block as a <section>. `uid` keeps SVG ids unique when several diagrams
 * share a document. Used by answer pages and by inspector panels in the viewer.
 * `pageMeta` gives fixed strings and number formats their language (meta.lang,
 * meta.strings); diagram blocks inherit its lang and dir. `width` (px): the
 * container's measured width, so charts fit it (inspector panels).
 */
export function renderBlock(b, uid = 'b', { anchor = null, childAnchors = null, viewerHtml = null, pageMeta = null, locale = null, width = null, frameSandbox = null, details = null, detailKey = null } = {}) {
  const render = BLOCKS[b?.type];
  if (!render) return '';
  const L = locale || localeOf(pageMeta);
  const third = b.span === 'third';
  // Charts draw their words and numbers in the page language too
  const content = withChartLocale(L, () => render(b, { uid, viewerHtml, half: b.span === 'half', pageMeta, L, width: width ?? (third ? THIRD_WIDTH : null), frameSandbox, childAnchors, details, detailKey }));
  // "detail": a link to a deeper page of this page's details
  const target = typeof b.detail === 'string' && details && Object.hasOwn(details, b.detail) ? details[b.detail] : null;
  const key = target && (detailKey ? detailKey(b.detail) : b.detail);
  const body = target
    ? `${content}<p class="p-detail-link"><a href="#detail=${h(encodeURIComponent(key))}" data-detail-link="${h(key)}">${h(L.t('page.detailMore'))}: <strong>${h(detailTitle(target, b.detail))}</strong><svg class="p-flip" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></p>`
    : content;
  const span = b.span === 'half' ? ' is-half' : third ? ' is-third' : '';
  // A section's title heads its blocks (h2, with its intro); every other block's title is a label (h3)
  const head =
    b.type === 'section'
      ? b.title || b.intro
        ? `<div class="p-section-head">${b.title ? `<h2>${inline(b.title)}</h2>` : ''}${b.intro ? md(b.intro) : ''}</div>`
        : ''
      : b.title
        ? `<h3>${inline(b.title)}</h3>`
        : '';
  return `<section class="p-block p-block--${b.type}${span}"${anchor ? ` id="${h(anchor)}"` : ''}>${head}${body}</section>`;
}

/** Contents are shown when meta.toc is true, or automatically from this many titled blocks (meta.toc: false hides them). */
export const TOC_MIN_BLOCKS = 6;

/**
 * The page's contents: `anchors` (one per block, null when untitled) and `items`
 * ({ id, title } for every titled block that renders), empty when the contents row
 * is not shown. Shared by the HTML page and its Markdown export, so links match.
 */
export function pageContents(page, prefix = '') {
  const meta = page?.meta || {};
  const all = list(page?.blocks);
  const { top: anchors, inner } = pageAnchors(all, prefix);
  const titled = all.map((b, i) => (anchors[i] && own(BLOCKS, b?.type) ? { id: anchors[i], title: b.title } : null)).filter(Boolean);
  const show = meta.toc === true ? titled.length > 0 : meta.toc !== false && titled.length >= TOC_MIN_BLOCKS;
  return { anchors, inner, items: show ? titled : [] };
}

/**
 * The parts of a page's body: the lead (title, byline, answer), the contents row
 * and the blocks. `prefix` keeps anchors and SVG ids unique when several pages
 * share a document (book chapters); `kicker` adds a line above the title, and
 * `level` is the title's heading level (1 on a page, 2 for a chapter).
 */
export function pageParts(page, { viewerHtml = null, frameSandbox = null, prefix = '', level = 1, kicker = null, details = null, detailKey = null } = {}) {
  const meta = page.meta || {};
  const answer = page.answer || {};
  const L = localeOf(meta);
  const byline = [meta.author, meta.date, meta.updated ? L.t('page.updated', { date: meta.updated }) : null].filter(Boolean).map(h).join(' · ');
  const all = list(page.blocks);
  const { anchors, inner, items } = pageContents(page, prefix);
  let uid = 0;
  const blocks = all.map((b, i) => renderBlock(b, `${prefix}b${++uid}`, { anchor: anchors[i], childAnchors: inner[i], viewerHtml, pageMeta: meta, locale: L, frameSandbox, details, detailKey })).join('\n');
  // Chips truncate long titles; the full title is in the tooltip
  const toc = items.length
    ? `<nav class="p-toc" aria-label="${h(L.t('page.contents'))}"><span class="p-label" aria-hidden="true">${h(L.t('page.contents'))}</span><ol>${items.map((t) => `<li><a href="#${h(t.id)}" title="${h(plain(t.title))}">${inline(t.title)}</a></li>`).join('')}</ol></nav>`
    : '';
  const hx = `h${level}`;
  const lead = `<div class="p-lead">
    <div class="p-lead-head">
    ${kicker ? `<p class="p-chapter-kicker">${h(kicker)}</p>` : ''}
    <${hx} class="p-title">${inline(meta.question || meta.title || '')}</${hx}>
    ${meta.question && meta.title && meta.title !== meta.question ? `<p class="p-subtitle">${inline(meta.title)}</p>` : ''}
    ${byline ? `<p class="p-byline">${byline}</p>` : ''}
    </div>
    <section class="p-answer" aria-label="${h(L.t('page.answer'))}">
      <span class="p-label">${h(L.t('page.answer'))}</span>
      <p class="p-headline">${inline(answer.headline || '')}</p>
      ${answer.text ? md(answer.text) : ''}
      ${list(answer.points).length ? `<ul class="p-keypoints">${answer.points.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
    </section>
  </div>`;
  return { lead, toc, grid: `<div class="p-grid">\n${blocks}\n  </div>`, anchors, inner, items };
}

/**
 * A page's detail pages as hidden sections, shown one at a time by DETAIL_SCRIPT
 * (`#detail=key`): a back bar (back to the parent, Esc), the path from the page,
 * then the detail's own lead and blocks. `keyPrefix` keeps keys unique per book
 * chapter; `homeHref` and `homeTitle` are the page the path starts from.
 */
export function detailSections(page, { viewerHtml = null, frameSandbox = null, prefix = '', keyPrefix = '', homeHref = '#', homeTitle = '' } = {}) {
  const map = detailsOf(page);
  const tree = detailTree(page);
  if (!tree.length) return '';
  const meta = page.meta || {};
  const L = localeOf(meta);
  const keyOf = (id) => `${keyPrefix}${id}`;
  const hrefOf = (id) => `#detail=${encodeURIComponent(keyOf(id))}`;
  const titleOf = (id) => detailTitle(map[id], id);
  const arrow = '<svg class="p-flip" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
  return tree
    .map((d, i) => {
      const trail = detailTrail(tree, d.id);
      const up = d.parent ? titleOf(d.parent) : homeTitle;
      const items = [`<li><a href="${h(homeHref)}" data-detail-home>${h(homeTitle)}</a></li>`, ...trail.slice(0, -1).map((id) => `<li><a href="${h(hrefOf(id))}">${h(titleOf(id))}</a></li>`), `<li><span aria-current="page">${h(titleOf(d.id))}</span></li>`];
      // Long paths keep the page, the parent and the current detail; the levels between fold into "…"
      const hidden = items.length > 4 ? trail.slice(0, -2).map(titleOf) : [];
      const path = (hidden.length ? [items[0], `<li><span class="p-detail-gap" title="${h(hidden.join(' › '))}">…</span></li>`, ...items.slice(-2)] : items).join('');
      const parts = pageParts(detailPage(d.page, meta), { viewerHtml, frameSandbox, prefix: `${prefix}d${i + 1}-`, level: 1, kicker: L.t('page.detailKicker'), details: map, detailKey: keyOf });
      return `<section class="p-detail" data-detail="${h(keyOf(d.id))}" data-parent="${h(d.parent ? keyOf(d.parent) : '')}" hidden>
  <nav class="p-detail-bar" aria-label="${h(L.t('page.detailPath'))}">
    <button type="button" class="p-detail-back" data-detail-back aria-label="${h(L.t('page.detailBack', { title: up }))} (Esc)" title="${h(L.t('page.detailBack', { title: up }))} (Esc)">${arrow}<span>${h(L.t('story.back'))}</span><kbd aria-hidden="true">Esc</kbd></button>
    <ol class="p-detail-path">${path}</ol>
  </nav>
  ${parts.lead}
  ${parts.toc}
  ${parts.grid}
</section>`;
    })
    .join('\n');
}

/** A short stable key for the reader's saved place (FNV-1a of the text). */
export function readKey(text) {
  let x = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0).toString(36);
}

/**
 * The HTML document around a page or book body: theme, header (brand, kicker,
 * reading controls, theme toggle), footer with the badge, the reader's bottom bar
 * and the scripts. `contents` (books): [{ id, title, items }] for the contents menu.
 */
export function pageDocument({ meta = {}, L, logos = {}, body, title, description = '', kicker = '', start = 'scroll', key, contents = null, book = false, css = '' }) {
  const toData = (svg) => (svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null);
  const logoLight = toData(logos.light || logos.dark);
  const logoDark = toData(logos.dark || logos.light);
  const mark = (cls) =>
    logoLight
      ? `<img class="${cls} p-only-light" src="${logoLight}" alt=""><img class="${cls} p-only-dark" src="${logoDark}" alt="">`
      : `<span class="${cls} p-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l7 8 7-8M12 13v7"/></svg></span>`;
  const markText = typeof meta.watermark === 'string' ? meta.watermark : L.t('watermark.text');
  const watermark = meta.watermark === false ? '' : `<a class="p-badge" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="${h(L.t('watermark.title'))}" aria-label="${h(L.t('watermark.label', { text: markText }))}"><span class="p-badge-face">${mark('p-badge-logo')}<span>${h(markText)}</span></span><span class="p-badge-face p-badge-github" aria-hidden="true">${GITHUB_MARK}<span>GitHub</span></span></a>`;
  const reader = readerControls(L, { contents });
  const startMode = READING_MODES.includes(start) ? start : 'scroll';

  return `<!DOCTYPE html>
<html lang="${h(L.lang)}" dir="${L.dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)}</title>
${description ? `<meta name="description" content="${h(description)}">` : ''}
${logoLight ? `<link rel="icon" href="${logoLight}">` : ''}
<script>(function(){var m=/theme=(light|dark)/.exec(location.hash),s=null;try{s=localStorage.getItem('yantra:theme')}catch(e){}var d=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',m?m[1]:s||(d?'dark':'light'))})();</script>
<style>
${themeCss()}
${BLOCK_CSS}
${PAGE_CSS}
${READER_CSS}
${body.includes('class="p-detail"') ? DETAIL_CSS : ''}
${css}
</style>
</head>
<body>
<article class="p-page${book ? ' p-book' : ''}">
  <header class="p-head">
    <div class="p-brand">${mark('p-logo')}${kicker ? `<span class="p-kicker">${h(kicker)}</span>` : ''}</div>
    ${reader.tools}
      <button class="p-theme" type="button" aria-label="${h(L.t('page.theme'))}" onclick="var r=document.documentElement,n=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',n);try{localStorage.setItem('yantra:theme',n)}catch(e){}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
      </button>
    </div>
  </header>
  ${reader.list}
  ${body}
  <footer class="p-foot">
    <span>${h(meta.footer || '')}</span>
    ${watermark}
  </footer>
</article>
${reader.bar}
<script>
// Print on paper in the light theme, with every FAQ answer open
(function(){var r=document.documentElement,prev,shut=[];addEventListener('beforeprint',function(){prev=r.getAttribute('data-theme');r.setAttribute('data-theme','light');shut=[].filter.call(document.querySelectorAll('.p-faq details'),function(d){return !d.open});shut.forEach(function(d){d.open=true})});addEventListener('afterprint',function(){if(prev)r.setAttribute('data-theme',prev);shut.forEach(function(d){d.open=false});shut=[]})})();
${FRAME_SCRIPT}
${SCROLL_SCRIPT}
${TOC_SCRIPT}
${CHART_SCRIPT}
${body.includes('class="p-detail"') ? DETAIL_SCRIPT : ''}
${readerScript({ start: startMode, key, book, words: readerWords(L) })}
</script>
</body>
</html>
`;
}

/**
 * @param page    page payload (diagram `src` references must already be resolved)
 * @param options { logos: { light, dark } (raw SVG strings, optional),
 *                  viewerHtml: (diagramPayload, block) => standalone viewer HTML, for
 *                  diagram blocks with `interactive: true` (without it they stay static),
 *                  frameSandbox: sandbox flags for those frames (default FRAME_SANDBOX; the
 *                  viewer's gallery adds allow-same-origin so its module scripts load) }
 */
export function renderPage(page, { logos = {}, viewerHtml = null, frameSandbox = null } = {}) {
  const meta = page.meta || {};
  const answer = page.answer || {};
  const L = localeOf(meta);
  const details = detailsOf(page);
  const parts = pageParts(page, { viewerHtml, frameSandbox, details });
  const extra = detailSections(page, { viewerHtml, frameSandbox, homeHref: '#', homeTitle: meta.title || meta.question || L.t('page.answer') });
  return pageDocument({
    meta,
    L,
    logos,
    body: `<div class="p-main">\n  ${parts.lead}\n  ${parts.toc}\n  ${parts.grid}\n  </div>\n  ${extra}`,
    title: meta.title || L.t('page.answer'),
    description: meta.description || answer.headline || '',
    kicker: meta.kicker || meta.question ? meta.kicker || L.t('page.question') : '',
    start: meta.reading,
    key: readKey(`${meta.question || meta.title || ''}\n${answer.headline || ''}`)
  });
}

/** Markdown version of a page (for chat, docs or tickets). */
export function pageToMarkdown(page, opts = {}) {
  return withChartLocale(localeOf(page?.meta), () => pageMarkdown(page, opts));
}

/** `base` shifts every heading down (1: a book chapter's title is ##); `prefix` matches the HTML anchors. */
function pageMarkdown(page, { base = 0, prefix = '', kicker = '', details: detailMap = null, detailKey = null, isDetail = false } = {}) {
  const meta = page.meta || {};
  const details = detailMap || detailsOf(page);
  const answer = page.answer || {};
  const { t } = localeOf(meta);
  const out = [];
  if (kicker) out.push(`*${mi(kicker)}*`, '');
  if (prefix) out.push(`<a id="${h(prefix.replace(/-$/, ''))}"></a>`, '');
  out.push(`${'#'.repeat(1 + base)} ${mi(meta.question || meta.title || t('page.answer'))}`, '');
  if (answer.headline) out.push(`**${mi(answer.headline)}**`, '');
  if (answer.text) out.push(mdBlock(answer.text), '');
  list(answer.points).forEach((p) => out.push(`- ${mi(p)}`));
  if (list(answer.points).length) out.push('');
  // Contents with the page's own anchors: an explicit <a id> before each heading keeps
  // the links working whatever slugs the Markdown renderer makes up
  const { anchors, items } = pageContents(page, prefix);
  if (items.length) out.push(`**${mi(t('page.contents'))}**`, '', ...items.map((it) => `- [${mi(plain(it.title))}](#${it.id})`), '');
  // depth 1: a block inside a section, one heading level down
  const emit = (b, anchor, depth) => {
    if (!b || typeof b !== 'object') return;
    const hx = '#'.repeat(2 + base + depth);
    if (b.title && items.length && anchor) out.push(`<a id="${h(anchor)}"></a>`, '');
    if (b.title) out.push(`${hx} ${mi(b.title)}`, '');
    switch (b.type) {
      case 'section':
        if (b.intro) out.push(mdBlock(b.intro), '');
        list(b.blocks).forEach((c) => c?.type !== 'section' && emit(c, null, depth + 1));
        break;
      case 'text':
        out.push(mdBlock(b.body), '');
        break;
      case 'points':
      case 'steps':
        list(b.items).forEach((it, i) => out.push(`${b.type === 'steps' ? `${i + 1}.` : '-'} **${mi(it?.title)}**${it?.text ? ` - ${mi(it.text)}` : ''}`));
        out.push('');
        break;
      case 'metrics':
        list(b.items).forEach((it) => out.push(`- **${mi(it?.label)}:** ${mi(it?.value)}${it?.note ? ` (${mi(it.note)})` : ''}${Array.isArray(it?.trend) ? `; ${t('chart.trend')} ${it.trend.map((v) => mi(v)).join(' → ')}` : ''}`));
        out.push('');
        break;
      case 'table':
        out.push(`| ${list(b.columns).map(cell).join(' | ')} |`, `|${list(b.columns).map(() => '---').join('|')}|`);
        list(b.rows).forEach((r) => out.push(`| ${list(r).map(cell).join(' | ')} |`));
        out.push('');
        break;
      case 'compare':
        list(b.options).forEach((o) => {
          out.push(`${hx}# ${mi(o?.name)}${o?.recommended ? ` (${mi(t('page.recommended'))})` : ''}`, '');
          if (o?.summary) out.push(mdBlock(o.summary), '');
          list(o?.pros).forEach((x) => out.push(`- + ${mi(x)}`));
          list(o?.cons).forEach((x) => out.push(`- − ${mi(x)}`));
          if (o?.verdict) out.push('', `*${mi(o.verdict)}*`);
          out.push('');
        });
        break;
      case 'callout':
        out.push(`> ${b.label ? `**${mi(b.label)}** ` : ''}${mdBlock(b.body).replace(/\n/g, '\n> ')}`, '');
        break;
      case 'chart':
        if (isSimpleBars(b)) list(b.data).forEach((d) => out.push(`- ${mi(d?.label)}: ${mi(d?.value)}${mi(b.unit || '')}`));
        else out.push(...chartMarkdown(b));
        if (b.caption) out.push('', `*${mi(b.caption)}*`);
        out.push('');
        break;
      case 'gantt':
      case 'matrix':
        out.push(...chartMarkdown(b));
        if (b.caption) out.push('', `*${mi(b.caption)}*`);
        out.push('');
        break;
      case 'code':
        {
        const src = String(b.code ?? '');
        const fence = '`'.repeat(Math.max(3, ...[...src.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));
        out.push(`${fence}${String(b.language || '').replace(/[^\w+#.-]/g, '')}`, src, fence, '');
        }
        break;
      case 'sources':
        list(b.items).forEach((s, i) => out.push(`${i + 1}. ${s?.url ? `[${mi(s.title || s.url)}](${mdUrl(s.url)})` : mi(s?.title)}${s?.note ? ` - ${mi(s.note)}` : ''}`));
        out.push('');
        break;
      case 'diagram':
        out.push(`*${mi(t('page.diagramNote', { title: b.diagram?.meta?.title || b.caption || t('page.seeHtml') }))}*`, '');
        break;
      case 'timeline':
        list(b.items).forEach((it) => out.push(`- **${mi(it?.date)}** - ${mi(it?.title)}${it?.text ? `: ${mi(it.text)}` : ''}`));
        out.push('');
        break;
      case 'faq':
        list(b.items).forEach((it) => out.push(`**${mi(it?.q)}**`, '', mdBlock(it?.a), ''));
        break;
      case 'checklist':
        list(b.items).forEach((it) => out.push(`- [${it?.done ? 'x' : ' '}] ${mi(it?.text)}${it?.note ? ` (${mi(it.note)})` : ''}`));
        out.push('');
        break;
      case 'quote':
        out.push(`> ${mdBlock(b.text).replace(/\n/g, '\n> ')}`);
        if (b.by || b.source) out.push('>', `> - ${[b.by ? mi(b.by) : null, b.source ? `*${mi(b.source)}*` : null].filter(Boolean).join(', ')}`);
        out.push('');
        break;
      case 'image':
        if (isSafeImageSrc(b.src)) out.push(/^data:/i.test(b.src.trim()) ? `*${mi(t('page.image', { alt: b.alt || b.caption || '' }))}*` : `![${mi(b.alt || '')}](${mdUrl(b.src)})`);
        if (b.caption) out.push(`*${mi(b.caption)}*`);
        out.push('');
        break;
      case 'kv':
        list(b.items).forEach((it) => out.push(`- **${mi(it?.k)}:** ${mi(it?.v)}`));
        out.push('');
        break;
    }
    // A link to the block's detail page (written after the page, under its anchor)
    const target = typeof b?.detail === 'string' && Object.hasOwn(details, b.detail) ? details[b.detail] : null;
    if (target) out.push(`→ ${mi(t('page.detailMore'))}: [${mi(detailTitle(target, b.detail))}](#detail-${slug(detailKey ? detailKey(b.detail) : b.detail)})`, '');
  };
  list(page.blocks).forEach((b, i) => emit(b, anchors[i], 0));
  // The page's detail pages, one heading level down, in the order a reader meets them
  if (!isDetail) {
    const tree = detailTree(page);
    const keyOf = (id) => (detailKey ? detailKey(id) : id);
    tree.forEach((d, i) => {
      out.push(`<a id="detail-${slug(keyOf(d.id))}"></a>`, '');
      out.push(pageMarkdown(detailPage(d.page, meta), { base: base + 1, prefix: `${prefix}d${i + 1}-`, kicker: t('page.detailKicker'), details, detailKey, isDetail: true }).trim(), '');
    });
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/** Legend toggles on charts (charts.js enhanceCharts, inlined as source). */
const CHART_SCRIPT = `(${enhanceCharts.toString()})(document);`;

/** Keep embedded viewers (sandboxed, opaque origin) on the page's theme via postMessage. */
const FRAME_SCRIPT = `(function(){var r=document.documentElement,fs=document.querySelectorAll('iframe.p-frame');if(!fs.length)return;
function send(f){try{f.contentWindow.postMessage({yantraTheme:r.getAttribute('data-theme')},'*')}catch(e){}}
fs.forEach(function(f){f.addEventListener('load',function(){send(f)});send(f)});
new MutationObserver(function(){fs.forEach(send)}).observe(r,{attributes:true,attributeFilter:['data-theme']})})();`;

/**
 * In-page links and the contents row. Clicks on "#id" links scroll this window only
 * (smooth unless reduced motion is preferred) and move focus to the section heading:
 * in a srcdoc or blob frame (the viewer's gallery) "#id" would resolve against the
 * parent's URL and navigate the frame, so the hash is only written on http(s) and file
 * pages. The row sticks to the top on long pages when it fits in a few lines (its height
 * feeds the sections' scroll-margin-top), and the chip of the section being read gets
 * aria-current (IntersectionObserver, plus scroll for the end of the page).
 */
const TOC_SCRIPT = `(function(){var r=document.documentElement,toc=document.querySelector('.p-toc'),own=/^(https?|file):$/.test(location.protocol);
function byId(href){var id=href.slice(1);try{id=decodeURIComponent(id)}catch(e){}return id&&document.getElementById(id)}
function reduce(){return !!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)}
var links=toc?[].slice.call(toc.querySelectorAll('a[href^="#"]')):[],secs=links.map(function(a){return byId(a.getAttribute('href'))}),pin=null,cur=-1,tocH=0,sticky=false;
function mark(i){if(i===cur)return;cur=i;links.forEach(function(a,k){if(k===i)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current')})}
function go(sec,smooth){var m=parseFloat(getComputedStyle(sec).scrollMarginTop)||0;scrollTo({top:Math.max(0,sec.getBoundingClientRect().top+scrollY-m),behavior:smooth&&!reduce()?'smooth':'auto'})}
document.addEventListener('click',function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;var sec=byId(a.getAttribute('href'));
if(!sec){if(!own)e.preventDefault();return}e.preventDefault();go(sec,true);var hd=sec.querySelector('h3')||sec;if(!hd.hasAttribute('tabindex'))hd.setAttribute('tabindex','-1');hd.focus({preventScroll:true});
var i=secs.indexOf(sec);if(i>=0){pin=i;mark(i)}if(own&&byId(location.hash)!==sec){try{history.pushState(null,'',a.getAttribute('href'))}catch(x){}}});
if(!toc||!links.length)return;
function fit(){toc.classList.remove('is-sticky','is-stuck');var h=toc.offsetHeight;sticky=innerWidth>760&&h<=Math.max(60,innerHeight*.14)&&r.scrollHeight>innerHeight*1.8;toc.classList.toggle('is-sticky',sticky);tocH=sticky?toc.offsetHeight:0;r.style.setProperty('--p-toc-h',tocH+'px');update()}
function update(){if(sticky)toc.classList.toggle('is-stuck',toc.getBoundingClientRect().top<=1);if(pin!==null)return;var line=tocH+Math.min(140,innerHeight*.25),best=-1,top=-Infinity;
if(innerHeight+scrollY>=r.scrollHeight-2){for(var j=secs.length-1;j>=0;j--)if(secs[j]&&secs[j].getBoundingClientRect().top<innerHeight){best=j;break}}
else secs.forEach(function(s,k){if(!s)return;var t=s.getBoundingClientRect().top;if(t<=line&&t>top+1){best=k;top=t}});mark(best)}
// The reader takes over (a click on a chip re-pins right after)
['wheel','touchstart','keydown','pointerdown'].forEach(function(n){addEventListener(n,function(){if(pin!==null){pin=null;requestAnimationFrame(update)}},{passive:true})});
var q=false;addEventListener('scroll',function(){if(q)return;q=true;requestAnimationFrame(function(){q=false;update()})},{passive:true});
addEventListener('resize',fit);addEventListener('popstate',function(){pin=null;update()});
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(){update()},{threshold:[0,1]});secs.forEach(function(s){if(s)io.observe(s)})}
fit();addEventListener('load',function(){fit();var s=own&&location.hash&&byId(location.hash);if(s&&secs.indexOf(s)>=0){go(s,false);pin=secs.indexOf(s);mark(pin)}})})();`;

/** Drag / shift-wheel scrolling with edge fades for wide tables and figures on pages (RTL scrollLeft runs negative). */
// Detail pages: `#detail=key` shows that detail instead of the page (the reading modes stay
// with the page). Opening one from a link remembers where you were; Back, Esc or the browser's
// back button return there. Details opened from a link go back with history; others to their parent.
const DETAIL_SCRIPT = `(function(){var r=document.documentElement,main=document.querySelector('.p-main'),secs=[].slice.call(document.querySelectorAll('.p-detail'));if(!main||!secs.length)return;
var cur=null,ys={},from={};
function want(){var m=/(?:^#|&)detail=([^&]*)/.exec(location.hash);if(!m)return '';try{return decodeURIComponent(m[1])}catch(e){return m[1]}}
function find(k){for(var i=0;i<secs.length;i++)if(secs[i].getAttribute('data-detail')===k)return secs[i];return null}
function keyOf(s){return s?s.getAttribute('data-detail'):''}
function show(){var s=find(want());if(s===cur)return;cur=s;var k=keyOf(s);
secs.forEach(function(x){x.hidden=x!==s});main.hidden=!!s;if(s)r.setAttribute('data-detail-open','');else r.removeAttribute('data-detail-open');
if(from[k]){var y=ys[k]||0,a=from[k];delete from[k];scrollTo(0,y);try{a.focus({preventScroll:true})}catch(e){}return}
scrollTo(0,0);var t=s&&s.querySelector('.p-title');if(t){t.setAttribute('tabindex','-1');try{t.focus({preventScroll:true})}catch(e){}}}
function home(){history.pushState(null,'',location.pathname+location.search);show()}
function back(){if(!cur)return;var p=cur.getAttribute('data-parent')||'';if(from[p])history.back();else if(p)location.hash='detail='+encodeURIComponent(p);else home()}
document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
var a=t.closest('a[data-detail-link]');if(a){var k=keyOf(cur);from[k]=a;ys[k]=scrollY;return}
if(t.closest('[data-detail-back]')){e.preventDefault();back();return}
if(t.closest('a[data-detail-home]')){e.preventDefault();home()}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&cur&&!e.defaultPrevented&&!(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))){e.preventDefault();back()}});
addEventListener('hashchange',show);show()})();`;

const DETAIL_CSS = `
.p-detail .p-chapter-kicker{margin:0 0 6px;color:var(--y-accent);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
:root[dir="rtl"] .p-detail .p-chapter-kicker{letter-spacing:0}
.p-detail-link{margin:16px 0 0}
.p-detail-link a{display:inline-flex;align-items:center;gap:8px;max-width:100%;padding:8px 14px;border:1px solid var(--y-border);border-radius:10px;background:var(--y-surface);color:var(--y-accent);font-size:14px;font-weight:600;text-decoration:none;transition:border-color .15s,box-shadow .15s}
.p-detail-link a:hover{border-color:var(--y-accent);box-shadow:0 4px 14px -6px var(--y-accent)}
.p-detail-link strong{overflow:hidden;color:var(--y-ink);white-space:nowrap;text-overflow:ellipsis}
.p-detail-bar{position:sticky;top:8px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 26px;padding:6px;padding-inline-end:14px;border:1px solid var(--y-border);border-radius:12px;background:var(--y-overlay);box-shadow:0 6px 20px rgba(0,0,0,.07);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.p-detail-back{display:inline-flex;align-items:center;gap:8px;max-width:100%;min-height:34px;padding:0 12px;border:0;border-radius:9px;background:var(--y-accent);color:var(--y-accent-ink);font:inherit;font-size:14px;font-weight:650;cursor:pointer}
.p-detail-back:hover{filter:brightness(1.08)}
.p-detail-back:focus-visible{outline:2px solid var(--y-accent);outline-offset:2px}
.p-detail-back span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.p-detail-back kbd{padding:0 5px;border-radius:4px;background:color-mix(in srgb,var(--y-accent-ink) 22%,transparent);font:600 11px/16px ui-monospace,monospace}
.p-detail-path{display:flex;flex-wrap:wrap;align-items:center;min-width:0;margin:0;padding:0;list-style:none;color:var(--y-ink-3);font-size:13px}
.p-detail-path li+li::before{content:'\\203A';padding:0 6px}
:root[dir="rtl"] .p-detail-path li+li::before{content:'\\2039'}
.p-detail-path a{color:var(--y-ink-2);text-decoration:none}
.p-detail-path a:hover{color:var(--y-accent);text-decoration:underline}
.p-detail-path [aria-current]{color:var(--y-ink);font-weight:650}
:root[dir="rtl"] .p-flip{transform:scaleX(-1)}
:root[data-detail-open] .p-reader,:root[data-detail-open] .p-mode{display:none!important}
@media (max-width:560px){.p-detail-back kbd,.p-detail-path{display:none}}
@media print{.p-main,.p-detail{display:block!important}.p-detail{break-before:page}.p-detail-bar,.p-detail-link{display:none}}
`;

const SCROLL_SCRIPT = `(function(){document.querySelectorAll('.p-scroll').forEach(function(el){
function u(){var m=el.scrollWidth-el.clientWidth,s=Math.abs(el.scrollLeft);el.classList.toggle('can-prev',m>1&&s>1);el.classList.toggle('can-next',m>1&&s<m-1)}
el.addEventListener('scroll',u,{passive:true});addEventListener('resize',u);u();
el.addEventListener('wheel',function(e){if(e.shiftKey&&el.scrollWidth>el.clientWidth){el.scrollLeft+=getComputedStyle(el).direction==='rtl'?-e.deltaY:e.deltaY;e.preventDefault()}},{passive:false});
var d=null;el.addEventListener('pointerdown',function(e){if(e.pointerType==='mouse'&&e.button===0&&el.scrollWidth>el.clientWidth)d={x:e.clientX,l:el.scrollLeft,m:false,id:e.pointerId}});
el.addEventListener('pointermove',function(e){if(!d)return;var dx=e.clientX-d.x;if(!d.m){if(Math.abs(dx)<5)return;d.m=true;el.setPointerCapture(d.id);el.classList.add('is-dragging')}el.scrollLeft=d.l-dx});
function end(){if(d&&d.m)el.classList.remove('is-dragging');d=null}el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end)})})();`;

/** Block styles: shared by answer pages and inspector panels. */
export const BLOCK_CSS = `
:root[data-theme="dark"] .p-only-light,:root:not([data-theme="dark"]) .p-only-dark{display:none!important}
.p-block,.p-answer{min-width:0}
.p-block p,.p-answer p{margin:0 0 10px}
.p-block ul,.p-block ol,.p-answer ul{margin:0 0 10px;padding-inline-start:20px}
.p-block li{margin:3px 0}
.p-block a,.p-answer a{color:var(--y-accent)}
.p-block code,.p-answer code{padding:1px 5px;border-radius:4px;background:var(--y-surface-2);font:.88em var(--y-font-mono)}
.p-block h3{margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--y-ink-3)}
.p-block h4{margin:0 0 4px;font-size:15px;line-height:1.35}
.p-muted{color:var(--y-ink-3)}
.p-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.p-card{padding:14px 16px;border:1px solid var(--y-border);border-top:3px solid var(--y-hue);border-radius:10px;background:var(--y-surface)}
.p-card p,.p-card ul{color:var(--y-ink-2);font-size:14px;margin-bottom:0}
.p-steps{margin:0;padding:0!important;list-style:none;counter-reset:s}
.p-steps li{counter-increment:s;position:relative;display:flex;gap:14px;margin:0;padding:0 0 16px}
.p-steps li::before{content:counter(s);flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--y-ink);color:var(--y-bg);font-size:13px;font-weight:700}
.p-steps li:not(:last-child)::after{content:"";position:absolute;inset-inline-start:13px;top:30px;bottom:2px;width:2px;background:var(--y-border)}
.p-steps p{color:var(--y-ink-2);margin:0}
.p-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.p-metric{display:flex;flex-direction:column;padding:14px 16px;border:1px solid var(--y-border);border-radius:10px;background:var(--y-surface)}
.p-metric span{color:var(--y-ink-3);font-size:12.5px}
.p-metric strong{margin:4px 0 2px;color:var(--y-hue);font-size:26px;line-height:1.1;letter-spacing:-.02em}
.p-metric em{color:var(--y-ink-3);font-size:12.5px;font-style:normal}
.p-scroll{overflow-x:auto;scrollbar-width:none;--fl:0px;--fr:0px;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%)}
.p-scroll:dir(rtl){-webkit-mask-image:linear-gradient(to left,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%);mask-image:linear-gradient(to left,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%)}
.p-scroll::-webkit-scrollbar{display:none}
.p-scroll.can-prev{--fl:32px}
.p-scroll.can-next{--fr:32px}
.p-scroll.can-prev,.p-scroll.can-next{cursor:grab}
.p-scroll.is-dragging{cursor:grabbing;user-select:none}
.p-block table{width:100%;border-collapse:collapse;font-size:14px}
.p-block th,.p-block td{padding:9px 12px;border-bottom:1px solid var(--y-border);text-align:start;vertical-align:top}
.p-block th{color:var(--y-ink-3);font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.p-compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.p-option{padding:16px;border:1px solid var(--y-border);border-radius:10px;background:var(--y-surface)}
.p-option.is-pick{border:2px solid var(--y-accent);box-shadow:0 0 0 4px var(--y-accent-soft)}
.p-option-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.p-chip{padding:2px 8px;border-radius:999px;background:var(--y-accent);color:var(--y-accent-ink);font-size:11px;font-weight:700;white-space:nowrap}
.p-pros,.p-cons{padding:0!important;list-style:none;font-size:14px}
.p-pros li,.p-cons li{position:relative;padding-inline-start:20px}
.p-pros li::before{content:"+";position:absolute;inset-inline-start:3px;color:var(--y-hue-green);font-weight:800}
.p-cons li::before{content:"\\2212";position:absolute;inset-inline-start:3px;color:var(--y-hue-rose);font-weight:800}
.p-verdict{margin:8px 0 0!important;padding-top:8px;border-top:1px solid var(--y-border);font-weight:600;font-size:14px}
.p-callout{padding:14px 16px;border:1px solid color-mix(in srgb,var(--y-hue) 35%,var(--y-border));border-radius:10px;background:color-mix(in srgb,var(--y-hue) 9%,var(--y-surface))}
.p-callout>strong:first-child{display:block;margin-bottom:4px;color:var(--y-hue)}
.p-callout p:last-child,.p-callout ul:last-child{margin:0}
.p-figure{margin:0;padding:12px;border:1px solid var(--y-border);border-radius:12px;background:var(--y-bg)}
.p-figure svg{display:block;max-width:100%;height:auto;margin:0 auto}
.p-figure figcaption{margin-top:8px;color:var(--y-ink-3);font-size:13px;text-align:center}
.p-bars{display:grid;gap:8px}
.p-bar{display:grid;grid-template-columns:minmax(80px,30%) 1fr auto;align-items:center;gap:12px;font-size:14px}
.p-bar>div{height:12px;border-radius:6px;background:var(--y-surface-2);overflow:hidden}
.p-bar i{display:block;height:100%;border-radius:6px;background:var(--y-hue)}
.p-bar b{font-variant-numeric:tabular-nums}
.p-code{margin:0;padding:14px 16px;overflow:auto;border-radius:10px;background:var(--y-surface-2);font:13px/1.55 var(--y-font-mono);scrollbar-width:thin;scrollbar-color:var(--y-border-strong) transparent}
.p-code code{padding:0!important;background:none!important}
.p-sources{font-size:14px;color:var(--y-ink-2)}
.p-timeline{margin:0;padding:0!important;list-style:none}
.p-timeline li{position:relative;display:grid;grid-template-columns:100px 1fr;margin:0;padding:0 0 16px}
.p-timeline li::before{content:"";position:absolute;inset-inline-start:104px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--y-hue);box-shadow:0 0 0 3px var(--y-bg)}
.p-timeline li:not(:last-child)::after{content:"";position:absolute;inset-inline-start:108px;top:19px;bottom:3px;width:2px;background:var(--y-border)}
.p-timeline li>div{padding-inline-start:30px}
.p-date{padding-top:1px;color:var(--y-ink-3);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.p-timeline p{color:var(--y-ink-2);margin:0;font-size:14px}
.p-faq{border-top:1px solid var(--y-border)}
.p-faq details{border-bottom:1px solid var(--y-border)}
.p-faq summary{position:relative;padding-block:11px;padding-inline:2px 32px;font-weight:600;cursor:pointer;list-style:none}
.p-faq summary::-webkit-details-marker{display:none}
.p-faq summary::after{content:"";position:absolute;inset-inline-end:8px;top:16px;width:8px;height:8px;border-right:2px solid var(--y-ink-3);border-bottom:2px solid var(--y-ink-3);transform:rotate(45deg);transition:transform .15s}
.p-faq details[open] summary::after{top:20px;transform:rotate(-135deg)}
.p-faq summary:focus-visible{outline:2px solid var(--y-accent);outline-offset:2px;border-radius:4px}
.p-faq-a{padding:0 2px 12px;color:var(--y-ink-2);font-size:14px}
.p-faq-a p:last-child,.p-faq-a ul:last-child{margin-bottom:0}
.p-checklist{padding:0!important;list-style:none;display:grid;gap:2px}
.p-checklist li{display:flex;gap:12px;align-items:flex-start;margin:0;padding:6px 0}
.p-checklist em{display:block;color:var(--y-ink-3);font-size:13px;font-style:normal}
.p-box{flex:none;position:relative;width:18px;height:18px;margin-top:2px;border:2px solid var(--y-border-strong);border-radius:5px}
.is-done>.p-box{border-color:var(--y-hue-green);background:var(--y-hue-green)}
.is-done>.p-box::after{content:"";position:absolute;left:4px;top:0;width:5px;height:10px;border:solid var(--y-bg);border-width:0 2px 2px 0;transform:rotate(45deg)}
.p-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.p-quote{margin:0;padding-block:4px;padding-inline:20px 0;border-inline-start:4px solid var(--y-accent)}
.p-quote blockquote{margin:0;font-size:19px;line-height:1.5;font-weight:500;letter-spacing:-.005em}
.p-quote blockquote p{margin:0 0 8px}
.p-quote figcaption{color:var(--y-ink-3);font-size:13.5px}
.p-quote figcaption::before{content:"\\2014\\00a0"}
.p-quote cite{font-style:italic}
.p-image{text-align:center}
.p-image img{display:block;max-width:100%;height:auto;margin:0 auto;border-radius:6px}
.p-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0 24px;margin:0;font-size:14px}
.p-kv>div{display:grid;grid-template-columns:minmax(90px,40%) 1fr;gap:12px;padding:8px 0;border-bottom:1px solid var(--y-border)}
.p-kv dt{color:var(--y-ink-3);font-weight:600}
.p-kv dd{margin:0}
.p-live{padding:0;overflow:hidden}
.p-frame{display:block;width:100%;border:0;border-radius:11px 11px 0 0;background:var(--y-bg)}
.p-live:not(:has(figcaption)) .p-frame{border-radius:11px}
.p-live figcaption{margin:0;padding:8px 12px;border-top:1px solid var(--y-border)}
.p-print-only{display:none}
${CHART_CSS}`;

const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{background:var(--y-bg);color:var(--y-ink);font:15px/1.6 var(--y-font-sans);-webkit-font-smoothing:antialiased}
body{margin:0;padding:40px 20px 56px}
a{color:var(--y-accent)}
.p-page{max-width:960px;margin:0 auto}
.p-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
.p-brand{display:flex;align-items:center;gap:12px}
.p-logo{width:30px;height:30px;border-radius:7px;display:block}
.p-mark{display:grid;place-items:center;background:var(--y-ink);color:var(--y-bg)}
.p-mark svg{width:16px;height:16px}
.p-kicker{color:var(--y-ink-3);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.p-theme{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--y-border);border-radius:8px;background:var(--y-surface);color:var(--y-ink-2);cursor:pointer}
.p-theme:hover{color:var(--y-ink);border-color:var(--y-border-strong)}
h1,h2.p-title{margin:0 0 8px;font-size:clamp(26px,4vw,36px);line-height:1.15;letter-spacing:-.02em;font-weight:700}
.p-subtitle{margin:0 0 6px;color:var(--y-ink-2);font-size:17px}
.p-byline{margin:0;color:var(--y-ink-3);font-size:13px}
.p-answer{margin:26px 0 30px;padding:22px 24px;border:1px solid var(--y-border);border-inline-start:4px solid var(--y-accent);border-radius:12px;background:var(--y-surface)}
:root[dir="rtl"] .p-label,:root[dir="rtl"] .p-kicker,:root[dir="rtl"] .p-block h3,:root[dir="rtl"] .p-block th{letter-spacing:0}
.p-label{display:inline-block;margin-bottom:8px;color:var(--y-accent);font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.p-headline{margin:0 0 10px;font-size:20px;line-height:1.4;font-weight:650;letter-spacing:-.01em}
.p-answer>p:not(.p-headline){color:var(--y-ink-2)}
.p-keypoints{margin:12px 0 0!important;padding:0!important;list-style:none;display:grid;gap:6px}
.p-keypoints li{position:relative;padding-inline-start:24px}
.p-keypoints li::before{content:"";position:absolute;inset-inline-start:2px;top:.45em;width:12px;height:7px;border-left:2px solid var(--y-accent);border-bottom:2px solid var(--y-accent);transform:rotate(-45deg)}
.p-toc{display:flex;align-items:flex-start;gap:6px 14px;margin:-8px 0 28px}
.p-toc .p-label{flex:none;margin:0;line-height:28px}
.p-toc ol{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 auto;min-width:0;margin:0;padding:0;list-style:none}
.p-toc li{display:block;min-width:0;max-width:min(100%,300px);margin:0}
.p-toc a{display:block;max-width:100%;height:28px;padding:0 11px;border:1px solid var(--y-border);border-radius:999px;background:var(--y-surface);color:var(--y-ink-2);font-size:13px;line-height:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none;transition:border-color .15s,color .15s,background-color .15s}
.p-toc a:hover{border-color:var(--y-accent);color:var(--y-accent)}
.p-toc a:focus-visible{outline:2px solid var(--y-accent);outline-offset:2px}
.p-toc a[aria-current="true"]{border-color:var(--y-accent);background:var(--y-accent-soft);color:var(--y-accent)}
.p-toc.is-sticky{position:sticky;top:0;z-index:5;margin-inline:-12px;padding:8px 12px;background:var(--y-bg);border-bottom:1px solid transparent;transition:border-color .15s}
.p-toc.is-stuck{border-bottom-color:var(--y-border)}
.p-grid>.p-block{scroll-margin-top:calc(var(--p-toc-h,0px) + 16px)}
.p-block>h3[tabindex]:focus{outline:none}
.p-block>h3[tabindex]:focus-visible{color:var(--y-accent)}
@media (prefers-reduced-motion:reduce){.p-toc a,.p-toc.is-sticky{transition:none}}
@media (max-width:520px){.p-toc{flex-direction:column;gap:6px}.p-toc .p-label{line-height:1.4}}
.p-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:22px 24px}
.p-grid>.p-block{grid-column:1/-1}
.p-grid>.p-block.is-half{grid-column:span 3}
.p-grid>.p-block.is-third{grid-column:span 2}
.p-block--section{padding-top:18px;border-top:1px solid var(--y-border)}
.p-section-head h2{margin:0 0 6px;font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-.01em}
.p-section-head>p{margin:0 0 4px;color:var(--y-ink-2)}
.p-subgrid{margin-top:16px}
.p-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:36px;padding-top:16px;border-top:1px solid var(--y-border);color:var(--y-ink-3);font-size:12.5px}
.p-badge{display:inline-grid;padding-block:4px;padding-inline:5px 10px;border:1px solid var(--y-border);border-radius:999px;background:var(--y-surface);color:var(--y-ink-2);font-size:12px;font-weight:600;text-decoration:none;transition:border-color .15s,color .15s}
.p-badge:hover,.p-badge:focus-visible{border-color:var(--y-ink-3);color:var(--y-ink)}
.p-badge-face{grid-area:1/1;display:flex;align-items:center;justify-content:center;gap:7px;transition:opacity .15s}
.p-badge-github,.p-badge:hover .p-badge-face:first-child,.p-badge:focus-visible .p-badge-face:first-child{opacity:0}
.p-badge:hover .p-badge-github,.p-badge:focus-visible .p-badge-github{opacity:1}
.p-badge-github svg{display:block;width:16px;height:16px}
.p-badge-logo{width:18px;height:18px;border-radius:5px;display:block}
.p-badge .p-mark svg{width:11px;height:11px}
@media (max-width:760px){.p-grid{grid-template-columns:1fr}.p-grid>.p-block.is-half,.p-grid>.p-block.is-third{grid-column:1/-1}body{padding:24px 16px 40px}.p-answer{padding:18px}}
@media print{
  @page{size:A4;margin:14mm}
  html{font-size:12.5px;background:#fff}
  body{padding:0}
  .p-theme{display:none}
  .p-scroll{overflow:visible;-webkit-mask-image:none;mask-image:none}
  .p-block,.p-answer,.p-card,.p-option,.p-metric,.p-figure,tr{break-inside:avoid}
  .p-answer,.p-option.is-pick{box-shadow:none}
  .p-screen-only,.p-toc{display:none!important}
  .p-print-only{display:block}
  .p-faq summary::after{display:none}
  .p-timeline li,.p-checklist li,.p-kv>div,.p-faq details,.p-quote{break-inside:avoid}
  a{color:inherit;text-decoration:underline}
}
`;
