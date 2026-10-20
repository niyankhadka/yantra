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
import { renderChart, renderGantt, renderMatrix, sparkline, isSimpleBars, chartMarkdown, CHART_CSS, CHART_STRINGS } from './charts.js';

export const BLOCK_TYPES = ['text', 'points', 'steps', 'metrics', 'table', 'compare', 'callout', 'diagram', 'chart', 'code', 'sources', 'timeline', 'faq', 'checklist', 'quote', 'image', 'kv', 'gantt', 'matrix'];
const TONES = { info: 'blue', good: 'green', warn: 'amber', bad: 'rose', neutral: 'slate' };
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
const tone = (t) => (own(TONES, t) ? TONES[t] : own(HUES, t) ? t : 'blue');

export const isPage = (p) => p && typeof p === 'object' && p.kind === 'page';

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

/** Stable anchor id from a block title: lower-case ASCII slug. */
export function slug(text) {
  const s = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'section';
}

/** Anchor ids for titled blocks (null when untitled), de-duplicated with -2, -3 suffixes. */
export function blockAnchors(blocks) {
  const used = new Set();
  return list(blocks).map((b) => {
    if (!b?.title) return null;
    const base = slug(b.title);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

/** Escape a whole HTML document for an iframe srcdoc attribute (only & and " matter inside it). */
export const srcdocAttr = (html) => String(html).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Static diagram figure (both themes); SVG ids are suffixed with ctx.uid to stay unique. */
function staticFigure(b, ctx) {
  const scene = computeScene(b.diagram, { modeId: b.mode });
  let highlight = null;
  const steps = b.diagram.scenarios?.[0]?.steps || b.diagram.steps || [];
  const step = Number.isInteger(b.step) ? steps[b.step - 1] : null;
  if (step && (step.highlightNodes || []).length) highlight = { nodes: new Set(step.highlightNodes), edges: new Set(step.highlightEdges || []) };
  const opts = { highlight, header: false, watermark: false, logo: null };
  return `<figure class="p-figure">
      <div class="p-scroll p-only-light">${renderSvg(scene, { ...opts, theme: 'light' })}</div>
      <div class="p-scroll p-only-dark">${renderSvg(scene, { ...opts, theme: 'dark' })}</div>
      ${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}
    </figure>`.replace(/id="(y-title|y-desc|arrow[\w-]*|g\d+)"/g, (_, id) => `id="${id}-${ctx.uid}"`)
    .replace(/url\(#(arrow[\w-]*|g\d+)\)/g, (_, id) => `url(#${id}-${ctx.uid})`)
    .replace(/aria-labelledby="y-title y-desc"/g, `aria-labelledby="y-title-${ctx.uid} y-desc-${ctx.uid}"`);
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

  metrics: (b) =>
    `<div class="p-metrics">${list(b.items)
      .map((it) => `<div class="p-metric" data-hue="${tone(it.tone)}"><span>${inline(it.label || '')}</span><strong>${h(it.value ?? '')}</strong>${it.note ? `<em>${inline(it.note)}</em>` : ''}${Array.isArray(it.trend) ? sparkline(it.trend, tone(it.tone)) : ''}</div>`)
      .join('')}</div>`,

  table: (b) =>
    `<div class="p-scroll"><table><thead><tr>${list(b.columns).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${list(b.rows)
      .map((r) => `<tr>${list(r).map((c) => `<td>${inline(c ?? '')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`,

  compare: (b) =>
    `<div class="p-compare">${list(b.options)
      .map(
        (o) => `<div class="p-option${o.recommended ? ' is-pick' : ''}">
          <div class="p-option-head"><h4>${inline(o.name || '')}</h4>${o.recommended ? '<span class="p-chip">Recommended</span>' : ''}</div>
          ${o.summary ? `<p class="p-muted">${inline(o.summary)}</p>` : ''}
          ${list(o.pros).length ? `<ul class="p-pros">${o.pros.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
          ${list(o.cons).length ? `<ul class="p-cons">${o.cons.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
          ${o.verdict ? `<p class="p-verdict">${inline(o.verdict)}</p>` : ''}
        </div>`
      )
      .join('')}</div>`,

  callout: (b) => `<div class="p-callout" data-hue="${tone(b.tone || 'info')}">${b.label ? `<strong>${inline(b.label)}</strong>` : ''}${md(b.body)}</div>`,

  diagram: (b, ctx) => {
    if (!b.diagram || typeof b.diagram !== 'object') return '<p class="p-muted">Diagram missing.</p>';
    const fig = staticFigure(b, ctx);
    const viewer = b.interactive && typeof ctx.viewerHtml === 'function' ? ctx.viewerHtml(b.diagram, b) : null;
    if (!viewer) return fig;
    // Live viewer on screen, the static figure on paper
    const height = Number.isFinite(b.height) && b.height >= 240 ? Math.round(b.height) : 560;
    const label = b.diagram.meta?.title || b.title || 'Diagram';
    return `<figure class="p-figure p-live p-screen-only"><iframe class="p-frame" title="${h(label)} (interactive)" sandbox="allow-scripts allow-popups" style="height:${height}px" srcdoc="${srcdocAttr(viewer)}"></iframe>${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>
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

  checklist: (b) =>
    `<ul class="p-checklist">${list(b.items)
      .map(
        (it) =>
          `<li class="${it.done ? 'is-done' : 'is-open'}"><span class="p-box" aria-hidden="true"></span><div><span class="p-sr">${it.done ? 'Done: ' : 'To do: '}</span>${inline(it.text || '')}${it.note ? `<em>${inline(it.note)}</em>` : ''}</div></li>`
      )
      .join('')}</ul>`,

  quote: (b) =>
    `<figure class="p-quote"><blockquote>${md(b.text)}</blockquote>${
      b.by || b.source ? `<figcaption>${b.by ? inline(b.by) : ''}${b.by && b.source ? ', ' : ''}${b.source ? `<cite>${inline(b.source)}</cite>` : ''}</figcaption>` : ''
    }</figure>`,

  image: (b) => {
    if (!isSafeImageSrc(b.src)) return '<p class="p-muted">Image omitted: only https: and data:image/ sources are allowed.</p>';
    const w = Number.isFinite(b.width) && b.width > 0 ? ` style="max-width:min(100%,${Math.round(b.width)}px)"` : '';
    return `<figure class="p-figure p-image"><img src="${h(b.src.trim())}" alt="${h(b.alt || '')}"${w}>${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
  },

  kv: (b) => `<dl class="p-kv">${list(b.items).map((it) => `<div><dt>${inline(it.k ?? '')}</dt><dd>${inline(it.v ?? '')}</dd></div>`).join('')}</dl>`,

  // Single-series bars without negatives keep the HTML bar list; every other chart is inline SVG (charts.js)
  chart: (b, ctx) => {
    if (!isSimpleBars(b)) return renderChart(b, { half: ctx.half, caption: b.caption ? inline(b.caption) : '' });
    const data = list(b.data).filter((d) => typeof d.value === 'number');
    const max = Math.max(1e-9, ...data.map((d) => Math.abs(d.value)));
    const unit = b.unit ? h(b.unit) : '';
    return `<div class="p-bars" role="list">${data
      .map(
        (d) => `<div class="p-bar" role="listitem" data-hue="${tone(d.tone)}"><span>${inline(d.label || '')}</span><div><i style="width:${((Math.abs(d.value) / max) * 100).toFixed(1)}%"></i></div><b>${h(d.value)}${unit}</b></div>`
      )
      .join('')}</div>`;
  },

  gantt: (b, ctx) => renderGantt(b, { half: ctx.half, caption: b.caption ? inline(b.caption) : '' }),

  matrix: (b, ctx) => renderMatrix(b, { half: ctx.half, caption: b.caption ? inline(b.caption) : '' }),

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
 */
export function renderBlock(b, uid = 'b', { anchor = null, viewerHtml = null } = {}) {
  const render = BLOCKS[b?.type];
  if (!render) return '';
  const body = render(b, { uid, viewerHtml, half: b.span === 'half' });
  return `<section class="p-block p-block--${b.type}${b.span === 'half' ? ' is-half' : ''}"${anchor ? ` id="${h(anchor)}"` : ''}>${b.title ? `<h3>${inline(b.title)}</h3>` : ''}${body}</section>`;
}

/** Contents are shown when meta.toc is true, or automatically from this many titled blocks (meta.toc: false hides them). */
export const TOC_MIN_BLOCKS = 6;

/**
 * @param page    page payload (diagram `src` references must already be resolved)
 * @param options { logos: { light, dark } (raw SVG strings, optional),
 *                  viewerHtml: (diagramPayload, block) => standalone viewer HTML, for
 *                  diagram blocks with `interactive: true` (without it they stay static) }
 */
export function renderPage(page, { logos = {}, viewerHtml = null } = {}) {
  const meta = page.meta || {};
  const answer = page.answer || {};
  const toData = (svg) => (svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null);
  const logoLight = toData(logos.light || logos.dark);
  const logoDark = toData(logos.dark || logos.light);
  const mark = (cls) =>
    logoLight
      ? `<img class="${cls} p-only-light" src="${logoLight}" alt=""><img class="${cls} p-only-dark" src="${logoDark}" alt="">`
      : `<span class="${cls} p-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l7 8 7-8M12 13v7"/></svg></span>`;
  const watermark = meta.watermark === false ? '' : `<a class="p-badge" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="Yantra on GitHub"><span class="p-badge-face">${mark('p-badge-logo')}<span>${h(typeof meta.watermark === 'string' ? meta.watermark : 'Made with Yantra')}</span></span><span class="p-badge-face p-badge-github" aria-hidden="true">${GITHUB_MARK}<span>GitHub</span></span></a>`;
  const byline = [meta.author, meta.date, meta.updated ? `Updated ${meta.updated}` : null].filter(Boolean).map(h).join(' · ');

  const all = list(page.blocks);
  const anchors = blockAnchors(all);
  let uid = 0;
  const blocks = all.map((b, i) => renderBlock(b, `b${++uid}`, { anchor: anchors[i], viewerHtml })).join('\n');
  const titled = all.map((b, i) => (anchors[i] && BLOCKS[b?.type] ? { id: anchors[i], title: b.title } : null)).filter(Boolean);
  const showToc = meta.toc === true ? titled.length > 0 : meta.toc !== false && titled.length >= TOC_MIN_BLOCKS;
  const toc = showToc
    ? `<nav class="p-toc" aria-label="Contents"><span class="p-label">Contents</span><ol>${titled.map((t) => `<li><a href="#${h(t.id)}">${inline(t.title)}</a></li>`).join('')}</ol></nav>`
    : '';

  return `<!DOCTYPE html>
<html lang="${h(meta.lang || 'en')}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(meta.title || 'Answer')}</title>
${meta.description || answer.headline ? `<meta name="description" content="${h(meta.description || answer.headline)}">` : ''}
${logoLight ? `<link rel="icon" href="${logoLight}">` : ''}
<script>(function(){var m=/theme=(light|dark)/.exec(location.hash),s=null;try{s=localStorage.getItem('yantra:theme')}catch(e){}var d=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',m?m[1]:s||(d?'dark':'light'))})();</script>
<style>
${themeCss()}
${BLOCK_CSS}
${PAGE_CSS}
</style>
</head>
<body>
<article class="p-page">
  <header class="p-head">
    <div class="p-brand">${mark('p-logo')}${meta.kicker || meta.question ? `<span class="p-kicker">${h(meta.kicker || 'Question')}</span>` : ''}</div>
    <button class="p-theme" type="button" aria-label="Toggle light or dark theme" onclick="var r=document.documentElement,n=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',n);try{localStorage.setItem('yantra:theme',n)}catch(e){}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
    </button>
  </header>
  <h1>${inline(meta.question || meta.title || '')}</h1>
  ${meta.question && meta.title && meta.title !== meta.question ? `<p class="p-subtitle">${inline(meta.title)}</p>` : ''}
  ${byline ? `<p class="p-byline">${byline}</p>` : ''}
  <section class="p-answer" aria-label="Answer">
    <span class="p-label">Answer</span>
    <p class="p-headline">${inline(answer.headline || '')}</p>
    ${answer.text ? md(answer.text) : ''}
    ${list(answer.points).length ? `<ul class="p-keypoints">${answer.points.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
  </section>
  ${toc}
  <div class="p-grid">
${blocks}
  </div>
  <footer class="p-foot">
    <span>${h(meta.footer || '')}</span>
    ${watermark}
  </footer>
</article>
<script>
// Print on paper in the light theme, with every FAQ answer open
(function(){var r=document.documentElement,prev,shut=[];addEventListener('beforeprint',function(){prev=r.getAttribute('data-theme');r.setAttribute('data-theme','light');shut=[].filter.call(document.querySelectorAll('.p-faq details'),function(d){return !d.open});shut.forEach(function(d){d.open=true})});addEventListener('afterprint',function(){if(prev)r.setAttribute('data-theme',prev);shut.forEach(function(d){d.open=false});shut=[]})})();
${FRAME_SCRIPT}
${SCROLL_SCRIPT}
</script>
</body>
</html>
`;
}

/** Markdown version of a page (for chat, docs or tickets). */
export function pageToMarkdown(page) {
  const meta = page.meta || {};
  const answer = page.answer || {};
  const out = [`# ${mi(meta.question || meta.title || 'Answer')}`, ''];
  if (answer.headline) out.push(`**${mi(answer.headline)}**`, '');
  if (answer.text) out.push(mdBlock(answer.text), '');
  list(answer.points).forEach((p) => out.push(`- ${mi(p)}`));
  if (list(answer.points).length) out.push('');
  for (const b of list(page.blocks)) {
    if (!b || typeof b !== 'object') continue;
    if (b.title) out.push(`## ${mi(b.title)}`, '');
    switch (b.type) {
      case 'text':
        out.push(mdBlock(b.body), '');
        break;
      case 'points':
      case 'steps':
        list(b.items).forEach((it, i) => out.push(`${b.type === 'steps' ? `${i + 1}.` : '-'} **${mi(it?.title)}**${it?.text ? ` - ${mi(it.text)}` : ''}`));
        out.push('');
        break;
      case 'metrics':
        list(b.items).forEach((it) => out.push(`- **${mi(it?.label)}:** ${mi(it?.value)}${it?.note ? ` (${mi(it.note)})` : ''}${Array.isArray(it?.trend) ? `; ${CHART_STRINGS.trend} ${it.trend.map((v) => mi(v)).join(' → ')}` : ''}`));
        out.push('');
        break;
      case 'table':
        out.push(`| ${list(b.columns).map(cell).join(' | ')} |`, `|${list(b.columns).map(() => '---').join('|')}|`);
        list(b.rows).forEach((r) => out.push(`| ${list(r).map(cell).join(' | ')} |`));
        out.push('');
        break;
      case 'compare':
        list(b.options).forEach((o) => {
          out.push(`### ${mi(o?.name)}${o?.recommended ? ' (recommended)' : ''}`, '');
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
        out.push(`*Diagram: ${mi(b.diagram?.meta?.title || b.caption || 'see the HTML page')}*`, '');
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
        if (isSafeImageSrc(b.src)) out.push(/^data:/i.test(b.src.trim()) ? `*Image: ${mi(b.alt || b.caption || '')}*` : `![${mi(b.alt || '')}](${mdUrl(b.src)})`);
        if (b.caption) out.push(`*${mi(b.caption)}*`);
        out.push('');
        break;
      case 'kv':
        list(b.items).forEach((it) => out.push(`- **${mi(it?.k)}:** ${mi(it?.v)}`));
        out.push('');
        break;
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/** Keep embedded viewers (sandboxed, opaque origin) on the page's theme via postMessage. */
const FRAME_SCRIPT = `(function(){var r=document.documentElement,fs=document.querySelectorAll('iframe.p-frame');if(!fs.length)return;
function send(f){try{f.contentWindow.postMessage({yantraTheme:r.getAttribute('data-theme')},'*')}catch(e){}}
fs.forEach(function(f){f.addEventListener('load',function(){send(f)});send(f)});
new MutationObserver(function(){fs.forEach(send)}).observe(r,{attributes:true,attributeFilter:['data-theme']})})();`;

/** Drag / shift-wheel scrolling with edge fades for wide tables and figures on pages. */
const SCROLL_SCRIPT = `(function(){document.querySelectorAll('.p-scroll').forEach(function(el){
function u(){var m=el.scrollWidth-el.clientWidth;el.classList.toggle('can-prev',m>1&&el.scrollLeft>1);el.classList.toggle('can-next',m>1&&el.scrollLeft<m-1)}
el.addEventListener('scroll',u,{passive:true});addEventListener('resize',u);u();
el.addEventListener('wheel',function(e){if(e.shiftKey&&el.scrollWidth>el.clientWidth){el.scrollLeft+=e.deltaY;e.preventDefault()}},{passive:false});
var d=null;el.addEventListener('pointerdown',function(e){if(e.pointerType==='mouse'&&e.button===0&&el.scrollWidth>el.clientWidth)d={x:e.clientX,l:el.scrollLeft,m:false,id:e.pointerId}});
el.addEventListener('pointermove',function(e){if(!d)return;var dx=e.clientX-d.x;if(!d.m){if(Math.abs(dx)<5)return;d.m=true;el.setPointerCapture(d.id);el.classList.add('is-dragging')}el.scrollLeft=d.l-dx});
function end(){if(d&&d.m)el.classList.remove('is-dragging');d=null}el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end)})})();`;

/** Block styles: shared by answer pages and inspector panels. */
export const BLOCK_CSS = `
:root[data-theme="dark"] .p-only-light,:root:not([data-theme="dark"]) .p-only-dark{display:none!important}
.p-block,.p-answer{min-width:0}
.p-block p,.p-answer p{margin:0 0 10px}
.p-block ul,.p-block ol,.p-answer ul{margin:0 0 10px;padding-left:20px}
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
.p-steps li:not(:last-child)::after{content:"";position:absolute;left:13px;top:30px;bottom:2px;width:2px;background:var(--y-border)}
.p-steps p{color:var(--y-ink-2);margin:0}
.p-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.p-metric{display:flex;flex-direction:column;padding:14px 16px;border:1px solid var(--y-border);border-radius:10px;background:var(--y-surface)}
.p-metric span{color:var(--y-ink-3);font-size:12.5px}
.p-metric strong{margin:4px 0 2px;color:var(--y-hue);font-size:26px;line-height:1.1;letter-spacing:-.02em}
.p-metric em{color:var(--y-ink-3);font-size:12.5px;font-style:normal}
.p-scroll{overflow-x:auto;scrollbar-width:none;--fl:0px;--fr:0px;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 var(--fl),#000 calc(100% - var(--fr)),transparent 100%)}
.p-scroll::-webkit-scrollbar{display:none}
.p-scroll.can-prev{--fl:32px}
.p-scroll.can-next{--fr:32px}
.p-scroll.can-prev,.p-scroll.can-next{cursor:grab}
.p-scroll.is-dragging{cursor:grabbing;user-select:none}
.p-block table{width:100%;border-collapse:collapse;font-size:14px}
.p-block th,.p-block td{padding:9px 12px;border-bottom:1px solid var(--y-border);text-align:left;vertical-align:top}
.p-block th{color:var(--y-ink-3);font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.p-compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.p-option{padding:16px;border:1px solid var(--y-border);border-radius:10px;background:var(--y-surface)}
.p-option.is-pick{border:2px solid var(--y-accent);box-shadow:0 0 0 4px var(--y-accent-soft)}
.p-option-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.p-chip{padding:2px 8px;border-radius:999px;background:var(--y-accent);color:var(--y-accent-ink);font-size:11px;font-weight:700;white-space:nowrap}
.p-pros,.p-cons{padding:0!important;list-style:none;font-size:14px}
.p-pros li,.p-cons li{position:relative;padding-left:20px}
.p-pros li::before{content:"+";position:absolute;left:3px;color:var(--y-hue-green);font-weight:800}
.p-cons li::before{content:"\\2212";position:absolute;left:3px;color:var(--y-hue-rose);font-weight:800}
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
.p-timeline li::before{content:"";position:absolute;left:104px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--y-hue);box-shadow:0 0 0 3px var(--y-bg)}
.p-timeline li:not(:last-child)::after{content:"";position:absolute;left:108px;top:19px;bottom:3px;width:2px;background:var(--y-border)}
.p-timeline li>div{padding-left:30px}
.p-date{padding-top:1px;color:var(--y-ink-3);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.p-timeline p{color:var(--y-ink-2);margin:0;font-size:14px}
.p-faq{border-top:1px solid var(--y-border)}
.p-faq details{border-bottom:1px solid var(--y-border)}
.p-faq summary{position:relative;padding:11px 32px 11px 2px;font-weight:600;cursor:pointer;list-style:none}
.p-faq summary::-webkit-details-marker{display:none}
.p-faq summary::after{content:"";position:absolute;right:8px;top:16px;width:8px;height:8px;border-right:2px solid var(--y-ink-3);border-bottom:2px solid var(--y-ink-3);transform:rotate(45deg);transition:transform .15s}
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
.p-quote{margin:0;padding:4px 0 4px 20px;border-left:4px solid var(--y-accent)}
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
h1{margin:0 0 8px;font-size:clamp(26px,4vw,36px);line-height:1.15;letter-spacing:-.02em;font-weight:700}
.p-subtitle{margin:0 0 6px;color:var(--y-ink-2);font-size:17px}
.p-byline{margin:0;color:var(--y-ink-3);font-size:13px}
.p-answer{margin:26px 0 30px;padding:22px 24px;border:1px solid var(--y-border);border-left:4px solid var(--y-accent);border-radius:12px;background:var(--y-surface)}
.p-label{display:inline-block;margin-bottom:8px;color:var(--y-accent);font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.p-headline{margin:0 0 10px;font-size:20px;line-height:1.4;font-weight:650;letter-spacing:-.01em}
.p-answer>p:not(.p-headline){color:var(--y-ink-2)}
.p-keypoints{margin:12px 0 0!important;padding:0!important;list-style:none;display:grid;gap:6px}
.p-keypoints li{position:relative;padding-left:24px}
.p-keypoints li::before{content:"";position:absolute;left:2px;top:.45em;width:12px;height:7px;border-left:2px solid var(--y-accent);border-bottom:2px solid var(--y-accent);transform:rotate(-45deg)}
.p-toc{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin:-8px 0 28px}
.p-toc .p-label{margin:0 4px 0 0}
.p-toc ol{display:contents;list-style:none}
.p-toc li{display:block}
.p-toc a{display:inline-block;padding:3px 10px;border:1px solid var(--y-border);border-radius:999px;background:var(--y-surface);color:var(--y-ink-2);font-size:13px;text-decoration:none}
.p-toc a:hover,.p-toc a:focus-visible{border-color:var(--y-accent);color:var(--y-accent)}
.p-grid>.p-block{scroll-margin-top:16px}
.p-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 24px}
.p-grid>.p-block{grid-column:1/-1}
.p-grid>.p-block.is-half{grid-column:span 1}
.p-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:36px;padding-top:16px;border-top:1px solid var(--y-border);color:var(--y-ink-3);font-size:12.5px}
.p-badge{display:inline-grid;padding:4px 10px 4px 5px;border:1px solid var(--y-border);border-radius:999px;background:var(--y-surface);color:var(--y-ink-2);font-size:12px;font-weight:600;text-decoration:none;transition:border-color .15s,color .15s}
.p-badge:hover,.p-badge:focus-visible{border-color:var(--y-ink-3);color:var(--y-ink)}
.p-badge-face{grid-area:1/1;display:flex;align-items:center;justify-content:center;gap:7px;transition:opacity .15s}
.p-badge-github,.p-badge:hover .p-badge-face:first-child,.p-badge:focus-visible .p-badge-face:first-child{opacity:0}
.p-badge:hover .p-badge-github,.p-badge:focus-visible .p-badge-github{opacity:1}
.p-badge-github svg{display:block;width:16px;height:16px}
.p-badge-logo{width:18px;height:18px;border-radius:5px;display:block}
.p-badge .p-mark svg{width:11px;height:11px}
@media (max-width:760px){.p-grid{grid-template-columns:1fr}.p-grid>.p-block.is-half{grid-column:1/-1}body{padding:24px 16px 40px}.p-answer{padding:18px}}
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
