/**
 * Charts in diagrams. A card's `data.chart` draws a chart inside the card,
 * under the subtitle:
 *
 *   - on an ordinary card, a mini chart: a sparkline (`line`, `area`), mini
 *     columns (`column`), labelled bars (`bar`), a share donut (`donut`), a
 *     progress ring (`ring`) or a bullet bar against a target (`bullet`);
 *   - on a chart card (`shape: "chart"`), a full chart block as on answer
 *     pages (column, bar, line, area, pie, donut; series, stacking, legend),
 *     drawn at card scale by src/core/charts.js.
 *
 * Everything is measured here, so the layout, the HTML card, the SVG export
 * and the validator agree on the card height. Drawings are theme-neutral SVG
 * strings (classes and data-hue); the viewer styles them with CARD_CHART_CSS
 * and the export inlines the same rules as attributes (inlineChart), so both
 * themes, every zoom level and PNG export look the same. Pure strings, no DOM.
 */
import { chartDrawing, fmtValue, withChartLocale, chartWords, chartMarkdown, checkChartBlock, CHART_KINDS, CHART_NEEDS, CHART_SHAPES, SERIES_HUES, toneHue, niceTicks } from './charts.js';
import { escapeHtml as h, textWidth, truncate } from './text.js';
import { HUES } from './theme.js';

/** Mini chart metrics (px). The card grows by `gap` + the chart's height. */
export const MINI = { gap: 10, head: 16, plot: 30, row: 16, ring: 44, bullet: 10, legendRow: 14 };
export const MINI_KINDS = ['line', 'area', 'column', 'bar', 'donut', 'ring', 'bullet'];
/** Points a mini chart reads well with; above these the validator warns (chart/too-many-points). */
export const MINI_LIMITS = { line: 48, area: 48, column: 16, bar: 5, donut: 5 };

/** Chart card metrics: default width (card `width` overrides, 240-480), plot height, pie size and legend rows. */
export const CHART_CARD = { width: 360, minWidth: 240, maxWidth: 480, gap: 10, plot: 170, pie: 140, legendRow: 16, pieRow: 18 };
/** Chart card limits (smaller than a page chart's: the card is a third of the width). */
export const CHART_CARD_LIMITS = { series: 4, bandPoints: 12, linePoints: 60, slices: 6 };
/** Per diagram: chart cards and mini charts beyond these are a budget warning. */
export const CHART_BUDGET = { chartCards: 6, miniCharts: 12 };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);

/** True when the node draws a chart (a mini chart, or a chart card's chart). */
export const hasChart = (node) => isObj(node?.data?.chart);
export const isChartCard = (node) => node?.shape === 'chart';

/** Series hue of a mini chart: its `tone` (good, warn, bad, info, neutral or a hue), else the card's colour. */
const toneOf = (c) => (c.tone !== undefined ? toneHue(c.tone, null) : null);

/**
 * A mini chart, normalised: { kind, values, labels, hues, value, max, target, label, unit, prefix, hue }.
 * `values` (numbers, null for a gap) or `data: [{ label, value, tone? }]`; ring and bullet take `value`.
 */
export function miniModel(c) {
  const data = Array.isArray(c.data) ? c.data.filter(isObj) : null;
  const values = Array.isArray(c.values) ? c.values.map((v) => (isNum(v) ? v : null)) : data ? data.map((d) => (isNum(d.value) ? d.value : null)) : [];
  const labels = Array.isArray(c.labels) ? c.labels.map((l) => String(l ?? '')) : data ? data.map((d) => String(d.label ?? '')) : [];
  const hues = data ? data.map((d) => (d.tone !== undefined ? toneHue(d.tone, null) : null)) : [];
  const kind = c.kind === undefined ? (isNum(c.value) && !values.length ? 'ring' : 'line') : MINI_KINDS.includes(c.kind) ? c.kind : null;
  const value = isNum(c.value) ? c.value : [...values].reverse().find(isNum) ?? null;
  const target = isNum(c.target) ? c.target : null;
  let max = isNum(c.max) && c.max > 0 ? c.max : null;
  if (max === null && kind === 'ring') max = 100;
  if (max === null && kind === 'bullet') max = niceTicks(0, Math.max(value ?? 0, target ?? 0, 1e-9), 4).max;
  return { kind, values, labels, hues, value, max, target, label: typeof c.label === 'string' ? c.label : '', unit: c.unit, prefix: c.prefix, hue: toneOf(c) };
}

const fmt = (v, m) => fmtValue(v, m, { compact: Math.abs(v) >= 1e4 });
const txt = (x, y, s, cls, { size = 11, anchor = 'start' } = {}) =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} class="${cls}">${h(s)}</text>`;
/** data-hue for a mark: a named hue, or nothing (the mark takes the card's colour). */
const hueAttr = (hue) => (hue && own(HUES, hue) ? ` data-hue="${hue}"` : '');

/** Words a screen reader hears for a chart (the card's aria-label adds it after the title). */
function miniLabel(m) {
  const S = chartWords();
  const head = `${S.kinds[m.kind] || S.kinds.line}${m.label ? `: ${m.label}` : ''}`;
  if (m.kind === 'ring') return `${head}, ${fmt(m.value ?? 0, m)} / ${fmt(m.max, m)}${m.target !== null ? `, ${S.target} ${fmt(m.target, m)}` : ''}`;
  if (m.kind === 'bullet') return `${head}, ${fmt(m.value ?? 0, m)}${m.target !== null ? `, ${S.target} ${fmt(m.target, m)}` : ''}`;
  const pairs = m.values.map((v, i) => (v === null ? null : `${m.labels[i] ? `${m.labels[i]} ` : ''}${fmt(v, m)}`)).filter(Boolean);
  return `${head}, ${pairs.join(', ')}${m.target !== null ? `; ${S.target} ${fmt(m.target, m)}` : ''}`;
}

/** Caption on the left, the current value on the right (bold), on one 16px line. */
function headRow(W, left, right) {
  const rw = right ? Math.ceil(textWidth(right, 11.5, { weight: 600 })) : 0;
  const lt = left ? truncate(left, Math.max(20, W - rw - 8), 11) : '';
  return `${lt ? txt(0, 12, lt, 'm-label') : ''}${right ? txt(W, 12, right, 'm-value', { size: 11.5, anchor: 'end' }) : ''}`;
}

/** Mini chart drawing at width W: { svg, h, label } or null when there is nothing to draw. */
function miniSvg(c, W) {
  const m = miniModel(c);
  if (!m.kind) return null;
  const out = [];
  let H;
  const nums = m.values.filter(isNum);
  if (m.kind === 'line' || m.kind === 'area' || m.kind === 'column') {
    if (!nums.length || (m.kind !== 'column' && nums.length < 2)) return null;
    out.push(headRow(W, m.label, m.value !== null ? fmt(m.value, m) : ''));
    const top = MINI.head + 2;
    const ph = MINI.plot;
    const all = m.target !== null ? [...nums, m.target] : nums;
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (m.kind === 'column') [lo, hi] = [Math.min(0, lo), Math.max(0, hi)];
    if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
    const y = (v) => top + 2 + (1 - (v - lo) / (hi - lo)) * (ph - 4);
    const n = m.values.length;
    if (m.kind === 'column') {
      const slot = W / n;
      const bw = Math.max(2, Math.min(18, slot * 0.68));
      const zero = y(Math.min(Math.max(0, lo), hi));
      m.values.forEach((v, i) => {
        if (v === null) return;
        const [a, b] = [Math.min(y(v), zero), Math.max(y(v), zero)];
        out.push(`<rect class="m-bar"${hueAttr(m.hues[i] || m.hue)} x="${r1(slot * i + (slot - bw) / 2)}" y="${r1(a)}" width="${r1(bw)}" height="${r1(Math.max(1, b - a))}" rx="1.5"><title>${h(`${m.labels[i] ? `${m.labels[i]}: ` : ''}${fmt(v, m)}`)}</title></rect>`);
      });
      if (lo < 0) out.push(`<line class="m-zero" x1="0" x2="${W}" y1="${r1(zero)}" y2="${r1(zero)}"/>`);
    } else {
      const x = (i) => 2 + (n === 1 ? 0 : (i / (n - 1)) * (W - 5));
      const runs = [];
      let cur = [];
      m.values.forEach((v, i) => (v === null ? (cur.length && runs.push(cur), (cur = [])) : cur.push(i)));
      if (cur.length) runs.push(cur);
      const g = [];
      const base = y(Math.max(lo, Math.min(hi, m.kind === 'area' ? Math.max(0, lo) : lo)));
      for (const run of runs) {
        const d = run.map((i, k) => `${k ? 'L' : 'M'}${r1(x(i))} ${r1(y(m.values[i]))}`).join('');
        g.push(`<path class="${m.kind === 'area' ? 'm-area' : 'm-fill'}" d="${d}L${r1(x(run[run.length - 1]))} ${r1(base)}L${r1(x(run[0]))} ${r1(base)}Z"/>`);
        if (run.length > 1) g.push(`<path class="m-line" d="${d}"/>`);
      }
      const last = [...m.values.keys()].reverse().find((i) => m.values[i] !== null);
      g.push(`<circle class="m-dot" cx="${r1(x(last))}" cy="${r1(y(m.values[last]))}" r="2.6"/>`);
      out.push(`<g${hueAttr(m.hue)}>${g.join('')}</g>`);
    }
    if (m.target !== null) out.push(`<line class="m-target" x1="0" x2="${W}" y1="${r1(y(m.target))}" y2="${r1(y(m.target))}"><title>${h(`${chartWords().target}: ${fmt(m.target, m)}`)}</title></line>`);
    H = top + ph;
  } else if (m.kind === 'bar') {
    const rows = m.values.map((v, i) => ({ v, l: m.labels[i] || '', hue: m.hues[i] || m.hue })).filter((r) => r.v !== null).slice(0, MINI_LIMITS.bar);
    if (!rows.length) return null;
    let top = 0;
    if (m.label) {
      out.push(headRow(W, m.label, ''));
      top = MINI.head;
    }
    const vals = rows.map((r) => fmt(r.v, m));
    const vw = Math.ceil(Math.max(...vals.map((s) => textWidth(s, 11, { weight: 600 }))));
    const lw = Math.min(Math.ceil(Math.max(...rows.map((r) => textWidth(r.l, 11)))), Math.round(W * 0.42));
    const x0 = lw ? lw + 8 : 0;
    const x1 = W - vw - 6;
    const max = Math.max(m.max ?? 0, ...rows.map((r) => Math.abs(r.v))) || 1;
    rows.forEach((r, i) => {
      const yy = top + i * MINI.row;
      if (lw) out.push(txt(0, yy + 11.5, truncate(r.l, lw, 11), 'm-name'));
      const bw = Math.max(1.5, ((x1 - x0) * Math.abs(r.v)) / max);
      out.push(`<g${hueAttr(r.hue)}><rect class="m-track" x="${x0}" y="${yy + 4}" width="${r1(x1 - x0)}" height="8" rx="2"/><rect class="m-bar" x="${x0}" y="${yy + 4}" width="${r1(bw)}" height="8" rx="2"><title>${h(`${r.l ? `${r.l}: ` : ''}${vals[i]}`)}</title></rect></g>`);
      out.push(txt(W, yy + 11.5, vals[i], 'm-value', { anchor: 'end' }));
    });
    H = top + rows.length * MINI.row;
  } else if (m.kind === 'donut') {
    const items = m.values.map((v, i) => ({ v, l: m.labels[i] || '', hue: m.hues[i] || SERIES_HUES[i % SERIES_HUES.length] })).filter((d) => d.v !== null && d.v > 0);
    const total = items.reduce((a, d) => a + d.v, 0);
    if (!(total > 0)) return null;
    const D = MINI.ring;
    const [c, r, ir] = [D / 2, D / 2, D / 2 - 9];
    const at = (a, rad) => `${r1(c + rad * Math.cos(a))} ${r1(c + rad * Math.sin(a))}`;
    let a = -Math.PI / 2;
    for (const d of items) {
      const f = d.v / total;
      const b = a + f * 2 * Math.PI;
      const big = f > 0.5 ? 1 : 0;
      const tip = `<title>${h(`${d.l ? `${d.l}: ` : ''}${fmt(d.v, m)} (${Math.round(f * 100)}%)`)}</title>`;
      out.push(f > 0.9999
        ? `<circle class="m-ring"${hueAttr(d.hue)} cx="${c}" cy="${c}" r="${(r + ir) / 2}" stroke-width="${r - ir}">${tip}</circle>`
        : `<path class="m-slice"${hueAttr(d.hue)} d="M${at(a, r)}A${r} ${r} 0 ${big} 1 ${at(b, r)}L${at(b, ir)}A${ir} ${ir} 0 ${big} 0 ${at(a, ir)}Z">${tip}</path>`);
      a = b;
    }
    const shown = items.slice(0, MINI_LIMITS.donut);
    const lx = D + 10;
    const pw = Math.ceil(textWidth('100%', 11));
    shown.forEach((d, i) => {
      const yy = (D - shown.length * MINI.legendRow) / 2 + i * MINI.legendRow;
      const top = Math.max(0, yy);
      out.push(`<rect class="m-key"${hueAttr(d.hue)} x="${lx}" y="${r1(top + 3)}" width="8" height="8" rx="2"/>`);
      out.push(txt(lx + 13, top + 10.5, truncate(d.l, Math.max(16, W - lx - 13 - pw - 6), 11), 'm-name'));
      out.push(txt(W, top + 10.5, `${Math.round((d.v / total) * 100)}%`, 'm-label', { anchor: 'end' }));
    });
    H = Math.max(D, shown.length * MINI.legendRow);
  } else if (m.kind === 'ring') {
    if (m.value === null) return null;
    const D = MINI.ring;
    const [c, r, sw] = [D / 2, D / 2 - 4, 7];
    const f = Math.max(0, Math.min(1, m.value / m.max));
    const pt = (fr) => `${r1(c + r * Math.cos(-Math.PI / 2 + fr * 2 * Math.PI))} ${r1(c + r * Math.sin(-Math.PI / 2 + fr * 2 * Math.PI))}`;
    const g = [`<circle class="m-ring-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${sw}"/>`];
    if (f >= 0.9999) g.push(`<circle class="m-ring" cx="${c}" cy="${c}" r="${r}" stroke-width="${sw}"/>`);
    else if (f > 0) g.push(`<path class="m-ring" d="M${pt(0)}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${pt(f)}" stroke-width="${sw}"/>`);
    if (m.target !== null) {
      const ft = Math.max(0, Math.min(1, m.target / m.max));
      const ang = -Math.PI / 2 + ft * 2 * Math.PI;
      const [cos, sin] = [Math.cos(ang), Math.sin(ang)];
      g.push(`<line class="m-tick" x1="${r1(c + (r - 6) * cos)}" y1="${r1(c + (r - 6) * sin)}" x2="${r1(c + (r + 6) * cos)}" y2="${r1(c + (r + 6) * sin)}"/>`);
    }
    out.push(`<g${hueAttr(m.hue)}>${g.join('')}</g>`);
    const tx = D + 12;
    // "47 / 52": the scale is said unless the ring is a plain percentage
    const of = m.unit === '%' && m.max === 100 ? '' : ` / ${fmt(m.max, m)}`;
    out.push(`<text x="${tx}" y="21" font-size="16" class="m-big">${h(fmt(m.value, m))}${of ? `<tspan class="m-of" font-size="11.5">${h(of)}</tspan>` : ''}</text>`);
    const sub = [m.label, m.target !== null ? `${chartWords().target} ${fmt(m.target, m)}` : ''].filter(Boolean).join(' · ');
    if (sub) out.push(txt(tx, 37, truncate(sub, W - tx, 11), 'm-label'));
    H = D;
  } else {
    // bullet: value against a target on one bar
    if (m.value === null) return null;
    const right = `${fmt(m.value, m)}${m.target !== null ? ` / ${fmt(m.target, m)}` : ''}`;
    out.push(headRow(W, m.label, right));
    const top = MINI.head + 4;
    const x = (v) => Math.max(0, Math.min(W, (v / m.max) * W));
    out.push(`<g${hueAttr(m.hue)}><rect class="m-track" x="0" y="${top}" width="${W}" height="${MINI.bullet}" rx="2"/><rect class="m-bar" x="0" y="${top}" width="${r1(Math.max(1.5, x(m.value)))}" height="${MINI.bullet}" rx="2"/></g>`);
    if (m.target !== null) out.push(`<rect class="m-tick-bar" x="${r1(Math.min(W - 2, Math.max(0, x(m.target) - 1)))}" y="${top - 3}" width="2" height="${MINI.bullet + 6}" rx="1"><title>${h(`${chartWords().target}: ${fmt(m.target, m)}`)}</title></rect>`);
    H = top + MINI.bullet + 3;
  }
  H = Math.ceil(H);
  const label = miniLabel(m);
  return { svg: `<svg class="y-cc" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(label)}" direction="ltr">${out.join('')}</svg>`, h: H, label };
}

/** Legend items laid out in rows across W: [{ x, y }] per item and the height used. */
function flowLegend(items, W, row) {
  const pos = [];
  let x = 0;
  let y = 0;
  for (const it of items) {
    const w = Math.min(W, 16 + Math.ceil(textWidth(it.name, 11.5)) + 14);
    if (x > 0 && x + w > W) [x, y] = [0, y + row];
    pos.push({ x, y, w });
    x += w;
  }
  return { pos, h: items.length ? y + row : 0 };
}

/** A chart card's chart (a page chart block) at width W: { svg, h, label } or null. */
function cardSvg(c, W) {
  const b = { ...c, type: 'chart' };
  if (!CHART_NEEDS.chart(b)) return null;
  const S = chartWords();
  const kind = CHART_KINDS.includes(b.kind) ? b.kind : 'bar';
  const label = `${S.kinds[kind]}${b.title ? `: ${b.title}` : ''}`;
  const out = [];
  let H;
  if (kind === 'pie' || kind === 'donut') {
    const size = Math.min(CHART_CARD.pie, Math.floor(W * 0.45));
    const d = chartDrawing(b, { size });
    if (!d) return null;
    out.push(d.svg);
    const shown = d.items.slice(0, CHART_CARD_LIMITS.slices);
    const lx = size + 16;
    const rows = shown.length * CHART_CARD.pieRow;
    const y0 = Math.max(0, (size - rows) / 2);
    const pw = Math.ceil(textWidth('100%', 11.5, { weight: 600 }));
    shown.forEach((it, i) => {
      const y = y0 + i * CHART_CARD.pieRow;
      out.push(`<rect class="l-key" data-hue="${it.hue}" x="${lx}" y="${r1(y + 4)}" width="10" height="10" rx="2.5"/>`);
      out.push(txt(lx + 16, y + 13, truncate(it.label, Math.max(20, W - lx - 16 - pw - 8), 11.5), 'l-text', { size: 11.5 }));
      out.push(txt(W, y + 13, d.pct(it.value), 'c-val', { size: 11.5, anchor: 'end' }));
    });
    H = Math.max(size, rows);
  } else {
    const series = chartDrawing(b, { width: W, height: 10 })?.model.series || [];
    const multi = series.length > 1;
    const lg = multi ? flowLegend(series, W, CHART_CARD.legendRow) : { pos: [], h: 0 };
    const top = lg.h ? lg.h + 4 : 0;
    const d = chartDrawing(b, { width: W, height: CHART_CARD.plot, y: top, hue: 'card' });
    if (!d) return null;
    const line = kind === 'line';
    series.forEach((s, i) => {
      if (!multi) return;
      const p = lg.pos[i];
      out.push(line
        ? `<rect class="l-key" data-hue="${s.hue}" x="${p.x}" y="${p.y + 6}" width="12" height="3" rx="1.5"/>`
        : `<rect class="l-key" data-hue="${s.hue}" x="${p.x}" y="${p.y + 2.5}" width="10" height="10" rx="2.5"/>`);
      out.push(txt(p.x + 16, p.y + 12, truncate(s.name, p.w - 30, 11.5), 'l-text', { size: 11.5 }));
    });
    out.push(d.svg.replace(/ data-hue="card"/g, ''));
    H = top + d.h;
  }
  H = Math.ceil(H);
  return { svg: `<svg class="y-cc is-card" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(label)}" direction="ltr"><title>${h(label)}</title>${out.join('')}</svg>`, h: H, label };
}

/**
 * The chart a card draws at inner width W (px inside its padding), or null.
 * `L` (localeOf) sets the number format and the words a screen reader hears.
 * @returns { svg, h, label, mini }
 */
export function measureChart(node, W, L = null) {
  if (!hasChart(node)) return null;
  const card = isChartCard(node);
  const draw = () => (card ? cardSvg(node.data.chart, W) : miniSvg(node.data.chart, W));
  const r = L ? withChartLocale(L, draw) : draw();
  return r ? { ...r, mini: !card } : null;
}

/** Chart card width: node.width (240-480), default 360, a multiple of 20. */
export const chartCardWidth = (node) => Math.ceil(Math.min(CHART_CARD.maxWidth, Math.max(CHART_CARD.minWidth, isNum(node.width) && node.width > 0 ? node.width : CHART_CARD.width)) / 20) * 20;

// --- full-size equivalents: inspector and Markdown ----------------------------

/**
 * The chart a card carries as a page chart block, for the inspector's Details
 * tab (drawn at the panel's width with its data table) and the Markdown export.
 * A ring becomes a donut of the value and what remains; a bullet a bar chart of
 * the value and its target. Null when there is nothing to show.
 */
export function chartBlock(node) {
  if (!hasChart(node)) return null;
  const c = node.data.chart;
  if (isChartCard(node)) return CHART_NEEDS.chart({ ...c, type: 'chart' }) ? { ...c, type: 'chart' } : null;
  const m = miniModel(c);
  if (!m.kind) return null;
  const S = chartWords();
  const base = { type: 'chart', title: m.label || undefined, unit: m.unit, prefix: m.prefix };
  const tone = m.hue || undefined;
  if (m.kind === 'ring') {
    if (m.value === null) return null;
    return { ...base, kind: 'donut', data: [{ label: m.label || S.value, value: Math.max(0, m.value), tone }, { label: S.remaining, value: Math.max(0, m.max - m.value), tone: 'neutral' }] };
  }
  if (m.kind === 'bullet') {
    if (m.value === null) return null;
    return { ...base, kind: 'bar', data: [{ label: m.label || S.value, value: m.value, tone }, ...(m.target !== null ? [{ label: S.target, value: m.target, tone: 'neutral' }] : [])] };
  }
  const labels = m.values.map((_, i) => m.labels[i] || String(i + 1));
  if (m.kind === 'donut' || m.kind === 'bar') {
    const data = m.values.map((v, i) => (v === null ? null : { label: labels[i], value: v, ...(m.hues[i] ? { tone: m.hues[i] } : m.kind === 'bar' && tone ? { tone } : {}) })).filter(Boolean);
    return data.length ? { ...base, kind: m.kind, data } : null;
  }
  if (!m.values.some(isNum)) return null;
  return { ...base, kind: m.kind, categories: labels, series: [{ name: m.label || S.value, values: m.values, ...(tone ? { tone } : {}) }] };
}

/** Markdown lines for a card's chart (a list or table, as for page charts). */
export function chartMarkdownLines(node, L = null) {
  const b = chartBlock(node);
  if (!b) return [];
  const run = () => {
    if (isChartCard(node)) return chartMarkdown(b);
    const m = miniModel(node.data.chart);
    const S = chartWords();
    const v = (x) => fmtValue(x, m, { ascii: true });
    const name = m.label || S.value;
    const target = m.target !== null ? [`- **${S.target}:** ${v(m.target)}`] : [];
    if (m.kind === 'ring') return [`- ${name}: ${v(m.value)} / ${v(m.max)}`, ...target];
    if (m.kind === 'bullet') return [`- ${name}: ${v(m.value)}`, ...target];
    if ((m.kind === 'line' || m.kind === 'area' || m.kind === 'column') && !m.labels.some(Boolean))
      return [`- ${name}: ${m.values.map((x) => (x === null ? '-' : v(x))).join(', ')}`, ...target];
    const lines = chartMarkdown(b);
    return target.length ? [...lines, '', ...target] : lines;
  };
  return L ? withChartLocale(L, run) : run();
}

// --- validation ----------------------------------------------------------------

/**
 * Findings for one node's chart: { level, code, message }. Codes:
 * chart/missing (a chart card without data.chart), chart/invalid (not an
 * object, or no numbers to draw), chart/unknown-kind, chart/mismatch (labels or
 * series of a different length), chart/negative (ring, donut or pie values
 * below 0), chart/out-of-range (ring or bullet value beyond max; warning),
 * chart/too-many-points and chart/too-many-series (warnings).
 */
export function checkCardChart(node) {
  const out = [];
  const add = (level, code, message) => out.push({ level, code, message });
  const id = node.id;
  const c = node.data?.chart;
  if (c === undefined) {
    if (isChartCard(node)) add('error', 'chart/missing', `Chart card "${id}" needs data.chart: { kind, data } or { kind, categories, series }, as for a page chart.`);
    return out;
  }
  if (!isObj(c)) return add('error', 'chart/invalid', `Node "${id}" data.chart must be an object.`), out;
  if (isChartCard(node)) {
    const b = { ...c, type: 'chart' };
    const kind = b.kind ?? 'bar';
    if (!CHART_KINDS.includes(kind)) return add('error', 'chart/unknown-kind', `Chart card "${id}" kind "${kind}" is not a chart kind; use one of: ${CHART_KINDS.join(', ')} (ring and bullet are mini charts for ordinary cards).`), out;
    if (!CHART_NEEDS.chart(b)) return add('error', 'chart/invalid', `Chart card "${id}" data.chart needs ${CHART_SHAPES.chart}.`), out;
    for (const f of checkChartBlock(b)) {
      if (f.code === 'page/chart-too-many-points' || f.code === 'page/chart-too-many-series') continue; // card limits below
      add(f.level, f.code.replace(/^page\/chart-/, 'chart/'), `Chart card "${id}": ${f.message}`);
    }
    const multi = Array.isArray(b.series);
    const n = multi ? b.categories.length : b.data.length;
    const pie = kind === 'pie' || kind === 'donut';
    const cap = pie ? CHART_CARD_LIMITS.slices : kind === 'line' || kind === 'area' ? CHART_CARD_LIMITS.linePoints : CHART_CARD_LIMITS.bandPoints;
    if (n > cap) add('warning', 'chart/too-many-points', `Chart card "${id}" has ${n} ${pie ? 'slices' : 'points'}; a ${kind} chart on a card reads well with ${cap} or fewer (group the rest as "Other", or move the chart to a panel).`);
    if (multi && b.series.length > CHART_CARD_LIMITS.series) add('warning', 'chart/too-many-series', `Chart card "${id}" has ${b.series.length} series; keep to ${CHART_CARD_LIMITS.series} on a card.`);
    return out;
  }
  if (c.kind !== undefined && !MINI_KINDS.includes(c.kind))
    return add('error', 'chart/unknown-kind', `Node "${id}" mini chart kind "${c.kind}" is not one of ${MINI_KINDS.join(', ')} (for pie, stacked or several series use a chart card: shape "chart").`), out;
  const m = miniModel(c);
  const badNum = (k) => c[k] !== undefined && !isNum(c[k]);
  for (const k of ['value', 'target', 'max']) if (badNum(k)) add('error', 'chart/invalid', `Node "${id}" data.chart.${k} must be a number.`);
  if (c.values !== undefined && (!Array.isArray(c.values) || !c.values.every((v) => v === null || isNum(v)))) add('error', 'chart/invalid', `Node "${id}" data.chart.values must be a list of numbers (null for a gap).`);
  if (c.data !== undefined && (!Array.isArray(c.data) || !c.data.every((d) => isObj(d) && isNum(d.value)))) add('error', 'chart/invalid', `Node "${id}" data.chart.data must be a list of { label, value (number) }.`);
  if (out.length) return out;
  if (m.kind === 'ring' || m.kind === 'bullet') {
    if (!isNum(c.value)) return add('error', 'chart/invalid', `Node "${id}" ${m.kind} needs value (a number)${m.kind === 'ring' ? ' and max (default 100)' : ' and usually a target'}.`), out;
    if (m.kind === 'ring' && c.value < 0) add('error', 'chart/negative', `Node "${id}" ring value must be 0 or more.`);
    if (c.value > m.max || (m.target !== null && m.target > m.max)) add('warning', 'chart/out-of-range', `Node "${id}" ${m.kind} value or target is above max ${m.max}; it is drawn at the end.`);
    return out;
  }
  const nums = m.values.filter(isNum);
  if (!nums.length || (nums.length < 2 && (m.kind === 'line' || m.kind === 'area'))) return add('error', 'chart/invalid', `Node "${id}" ${m.kind} chart needs ${m.kind === 'line' || m.kind === 'area' ? 'at least 2 numbers' : 'numbers'} in values (or data).`), out;
  if (Array.isArray(c.labels) && Array.isArray(c.values) && c.labels.length !== c.values.length) add('error', 'chart/mismatch', `Node "${id}" data.chart has ${c.labels.length} labels for ${c.values.length} values.`);
  if (m.kind === 'donut' && nums.some((v) => v < 0)) add('error', 'chart/negative', `Node "${id}" donut values must be 0 or more.`);
  else if (m.kind === 'donut' && !nums.some((v) => v > 0)) add('error', 'chart/negative', `Node "${id}" donut values add up to 0.`);
  const cap = MINI_LIMITS[m.kind];
  if (m.values.length > cap) add('warning', 'chart/too-many-points', `Node "${id}" mini ${m.kind} chart has ${m.values.length} ${m.kind === 'donut' ? 'slices' : m.kind === 'bar' ? 'bars' : 'points'}; keep to ${cap} on a card${m.kind === 'bar' || m.kind === 'donut' ? ' (only the first ' + cap + ' are listed)' : ''}, or use a chart card.`);
  return out;
}

// --- styles: one table for the viewer (CSS) and the SVG export (attributes) ----

/**
 * [selector, props(palette)] in cascade order. A selector is `tag`, `.class`,
 * `tag.class` or `.a.b`. `p` holds ink, ink2, ink3, border, surface, surface2:
 * CSS variables in the viewer, theme colours in the export.
 */
const RULES = [
  ['text', (p) => ({ fill: p.ink3 })],
  ['.c-grid', (p) => ({ stroke: p.border, 'stroke-width': 1 })],
  ['.c-zero', (p) => ({ stroke: p.ink3, 'stroke-width': 1.2 })],
  ['text.c-val', (p) => ({ fill: p.ink2, 'font-weight': 600 })],
  ['text.c-cat', (p) => ({ fill: p.ink })],
  ['text.c-total', (p) => ({ fill: p.ink, 'font-weight': 700 })],
  ['text.c-pct', (p) => ({ fill: p.surface, 'font-weight': 700 })],
  ['.c-line', () => ({ fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })],
  ['.c-area', () => ({ fill: 'currentColor', 'fill-opacity': 0.14, stroke: 'none' })],
  ['.c-area.is-stacked', () => ({ 'fill-opacity': 0.55 })],
  ['.c-mark', (p) => ({ fill: 'currentColor', stroke: p.surface, 'stroke-width': 1.5 })],
  ['.c-slice', (p) => ({ stroke: p.surface, 'stroke-width': 2, 'stroke-linejoin': 'round' })],
  ['.c-ring', () => ({ fill: 'none', stroke: 'currentColor' })],
  ['.l-key', () => ({ fill: 'currentColor' })],
  ['text.l-text', (p) => ({ fill: p.ink2 })],
  ['text.m-label', (p) => ({ fill: p.ink3 })],
  ['text.m-value', (p) => ({ fill: p.ink, 'font-weight': 600 })],
  ['text.m-name', (p) => ({ fill: p.ink2 })],
  ['text.m-big', (p) => ({ fill: p.ink, 'font-weight': 700 })],
  ['tspan.m-of', (p) => ({ fill: p.ink3, 'font-weight': 500 })],
  ['.m-line', () => ({ fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })],
  ['.m-fill', () => ({ fill: 'currentColor', 'fill-opacity': 0.1, stroke: 'none' })],
  ['.m-area', () => ({ fill: 'currentColor', 'fill-opacity': 0.24, stroke: 'none' })],
  ['.m-dot', (p) => ({ fill: 'currentColor', stroke: p.surface, 'stroke-width': 1.5 })],
  ['.m-bar', () => ({ fill: 'currentColor' })],
  ['.m-key', () => ({ fill: 'currentColor' })],
  ['.m-track', () => ({ fill: 'currentColor', 'fill-opacity': 0.16 })],
  ['.m-slice', (p) => ({ fill: 'currentColor', stroke: p.surface, 'stroke-width': 1.5, 'stroke-linejoin': 'round' })],
  ['.m-ring', () => ({ fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round' })],
  ['.m-ring-track', () => ({ fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.18 })],
  ['.m-tick', (p) => ({ stroke: p.ink, 'stroke-width': 2, 'stroke-linecap': 'round' })],
  ['.m-tick-bar', (p) => ({ fill: p.ink })],
  ['.m-target', (p) => ({ stroke: p.ink2, 'stroke-width': 1, 'stroke-dasharray': '3 2' })],
  ['.m-zero', (p) => ({ stroke: p.ink3, 'stroke-width': 1 })]
];

const VARS = { ink: 'var(--y-ink)', ink2: 'var(--y-ink-2)', ink3: 'var(--y-ink-3)', border: 'var(--y-border)', surface: 'var(--y-surface)', surface2: 'var(--y-surface-2)' };

/** Viewer styles for card charts (the export inlines the same RULES). */
export const CARD_CHART_CSS = [
  '.y-node-chart{margin-top:10px;overflow:visible}',
  '.y-node-chart .y-cc{display:block;overflow:visible;color:var(--y-hue,var(--y-ink-3));font-variant-numeric:tabular-nums}',
  '.y-cc [data-hue]{color:var(--y-hue)}',
  '.y-cc text{font-family:inherit}',
  ...RULES.map(([sel, f]) => `.y-cc ${sel}{${Object.entries(f(VARS)).map(([k, v]) => `${k}:${v}`).join(';')}}`)
].join('\n');

const parsed = RULES.map(([sel, f]) => {
  const [, tag, cls] = /^(\w+)?((?:\.[\w-]+)*)$/.exec(sel);
  return { tag: tag || null, cls: cls ? cls.slice(1).split('.') : [], f };
});

/**
 * A card chart with its styles written as SVG attributes (theme colours from
 * `p`, hues through `hue(name)`), for the static export: no CSS, no classes.
 * `color` is the card's colour, used by marks without a hue of their own.
 */
export function inlineChart(svg, p, hue, color) {
  return svg.replace(/<(\w+)((?:\s[^<>]*?)?)(\/?)>/g, (all, tag, attrs, self) => {
    const cm = / class="([^"]*)"/.exec(attrs);
    const hm = / data-hue="([^"]*)"/.exec(attrs);
    const classes = cm ? cm[1].split(/\s+/) : [];
    const props = {};
    for (const r of parsed) if ((!r.tag || r.tag === tag) && r.cls.every((c) => classes.includes(c)) && (r.tag || r.cls.length)) Object.assign(props, r.f(p));
    let rest = attrs.replace(/ class="[^"]*"/, '').replace(/ data-hue="[^"]*"/, '').replace(/ data-[si]="[^"]*"/g, '');
    if (hm) props.color = hue(hm[1]);
    if (tag === 'svg' && classes.includes('y-cc')) props.color = color;
    // as in CSS, the rules win over the element's own presentation attributes
    for (const k of Object.keys(props)) rest = rest.replace(new RegExp(` ${k}="[^"]*"`), '');
    const extra = Object.entries(props).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${tag}${rest}${extra}${self}>`;
  });
}
