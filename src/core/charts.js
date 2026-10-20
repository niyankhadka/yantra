/**
 * Charts and plans for answer pages and inspector panels: column, bar, line,
 * area, pie and donut charts, gantt plans, 2x2 and heat-map matrices, and
 * metric sparklines. Pure string rendering to inline SVG (no DOM, no
 * libraries). Colours are theme hues read through CSS custom properties
 * (`data-hue` + `currentColor`), so light, dark and print all follow the page.
 */
import { HUES } from './theme.js';
import { escapeHtml as h, mdInline as mi, textWidth } from './text.js';

/**
 * User-visible words drawn by charts, plans and matrices (English). Rendering
 * reads the active set `S`: withChartLocale() swaps in the page language's
 * words from src/core/i18n.js (chart.* keys) and its number format.
 */
export const CHART_STRINGS = {
  total: 'Total',
  today: 'Today',
  day: 'Day',
  trend: 'trend',
  value: 'Value',
  share: 'Share',
  task: 'Task',
  group: 'Group',
  start: 'Start',
  end: 'End',
  after: 'After',
  milestone: 'Milestone',
  item: 'Item',
  noData: 'No data to chart.',
  target: 'Target',
  remaining: 'Remaining',
  series: (n) => `Series ${n}`,
  more: (n) => `+${n} more`,
  days: (n) => `${n} day${n === 1 ? '' : 's'}`,
  dayN: (n) => `Day ${n}`,
  quadrants: ['Top left', 'Top right', 'Bottom left', 'Bottom right'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  kinds: { bar: 'Bar chart', column: 'Column chart', line: 'Line chart', area: 'Area chart', pie: 'Pie chart', donut: 'Donut chart', gantt: 'Gantt chart', matrix: 'Matrix', heat: 'Heat map', trend: 'Trend', ring: 'Progress ring', bullet: 'Bullet chart' },
  summary: (kind, n, s) => `${kind}, ${n} ${n === 1 ? 'point' : 'points'}${s > 1 ? `, ${s} series` : ''}; values in the table that follows.`
};

let S = CHART_STRINGS;
let NUM_LANG = 'en-GB';

/** The chart words in effect (inside withChartLocale, that language's). */
export const chartWords = () => S;

/** Chart words for a locale (localeOf() result); the English set when none. Months come from Intl. */
export function chartStringsFor(L) {
  // English without chart overrides keeps the original set (and its exact wording)
  if (!L || (L.ui === 'en' && !Object.keys(L.overrides || {}).some((k) => k.startsWith('chart.')))) return CHART_STRINGS;
  const { t, num } = L;
  // Counted words follow the language's plural rules (Intl.PluralRules)
  const count = (n, one, other) => (L.plural ? L.plural(n, one, other, { n: num(n) }) : t(n === 1 ? one : other, { n: num(n) }));
  let months = CHART_STRINGS.months;
  if (L.ui !== 'en') {
    try {
      const f = new Intl.DateTimeFormat(L.lang, { month: 'short', timeZone: 'UTC' });
      months = months.map((_, m) => f.format(Date.UTC(2026, m, 15)));
    } catch {
      // keep English month names
    }
  }
  const kinds = Object.fromEntries(Object.keys(CHART_STRINGS.kinds).map((k) => [k, t(`chart.kind.${k}`)]));
  const words = ['total', 'today', 'value', 'share', 'task', 'group', 'start', 'end', 'after', 'milestone', 'item', 'noData', 'target', 'remaining'];
  return {
    ...Object.fromEntries(words.map((w) => [w, t(`chart.${w}`)])),
    day: t('chart.day', { n: '' }).trim(),
    trend: t('chart.trend'),
    series: (n) => t('chart.series', { n: num(n) }),
    more: (n) => t('chart.more', { n: num(n) }),
    days: (n) => count(n, 'chart.day1', 'chart.days'),
    dayN: (n) => t('chart.day', { n: num(n) }),
    quadrants: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map((q) => t(`chart.${q}`)),
    months,
    kinds,
    summary: (kind, n, s) => t('chart.summary', { kind, points: `${count(n, 'chart.point1', 'chart.points')}${s > 1 ? `, ${t('chart.seriesCount', { n: num(s) })}` : ''}` })
  };
}

/**
 * Render with the chart words and number format of locale L (synchronous; the
 * previous set is restored afterwards, so nested and later renders are unaffected).
 */
export function withChartLocale(L, fn) {
  const prev = [S, NUM_LANG];
  S = chartStringsFor(L);
  NUM_LANG = L && L.ui !== 'en' ? L.lang : 'en-GB';
  try {
    return fn();
  } finally {
    [S, NUM_LANG] = prev;
  }
}

export const CHART_KINDS = ['bar', 'column', 'line', 'area', 'pie', 'donut'];
/** Series colours in order: neighbours stay distinct for common colour-vision deficiencies. */
export const SERIES_HUES = ['blue', 'orange', 'teal', 'violet', 'rose', 'amber', 'green', 'slate'];
/** Soft limits: above these the validator warns (a page chart should read at a glance). */
export const CHART_LIMITS = { series: 6, bandPoints: 24, linePoints: 60, slices: 8, trend: 60, tasks: 40, matrixItems: 20 };

const TONES = { info: 'blue', good: 'green', warn: 'amber', bad: 'rose', neutral: 'slate' };
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
/** Page tone (info, good, warn, bad, neutral) or hue name -> hue name, else `fallback`. */
export const toneHue = (t, fallback = 'blue') => (own(TONES, t) ? TONES[t] : own(HUES, t) ? t : fallback);

const list = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const textW = (s, fs = 12) => textWidth(s, fs);
const clip = (s, max) => {
  const t = String(s ?? '');
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
};
/** Shorten to fit `maxW` px at font size `fs` (measured, so labels that fit are never cut). */
const clipTo = (s, maxW, fs) => {
  const t = String(s ?? '');
  if (textW(t, fs) <= maxW) return t;
  const chars = [...t];
  let n = chars.length - 1;
  while (n > 1 && textW(`${chars.slice(0, n).join('').trimEnd()}…`, fs) > maxW) n--;
  return `${chars.slice(0, n).join('').trimEnd()}…`;
};
const pad2 = (n) => String(n).padStart(2, '0');
const hueOf = (i) => SERIES_HUES[i % SERIES_HUES.length];

// --- numbers -----------------------------------------------------------------

const decimals = (n) => {
  const s = String(+n.toPrecision(12));
  const e = /e-(\d+)$/.exec(s);
  return e ? +e[1] : (s.split('.')[1] || '').length;
};

/** Round axis ticks (1, 2, 2.5 or 5 x 10^n) covering lo..hi. */
export function niceTicks(lo, hi, count = 5) {
  if (!isNum(lo) || !isNum(hi)) [lo, hi] = [0, 1];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) [lo, hi] = lo === 0 ? [0, 1] : [lo - Math.abs(lo) * 0.1, hi + Math.abs(hi) * 0.1];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const dec = decimals(step);
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let i = 0; min + i * step <= max + step * 1e-6 && i < 60; i++) ticks.push(+(min + i * step).toFixed(dec));
  return { min: +min.toFixed(dec), max: +max.toFixed(dec), step, ticks, dec };
}

function fmtNum(v, dec = null, compact = false) {
  const a = Math.abs(v);
  let s;
  if (compact && a >= 1e3) {
    const [d, u] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1e3, 'k'];
    s = `${+(a / d).toFixed(2)}${u}`;
  } else s = a.toLocaleString(NUM_LANG, dec === null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return `${v < 0 && /[1-9]/.test(s) ? '−' : ''}${s}`;
}

/** A value with the block's `prefix` (e.g. £) and `unit` (e.g. " ms", "%"): −£1,200. */
export function fmtValue(v, b = {}, { dec = null, compact = false, ascii = false } = {}) {
  const n = fmtNum(v, dec, compact);
  const neg = n.startsWith('−');
  return `${neg ? (ascii ? '-' : '−') : ''}${b.prefix ?? ''}${neg ? n.slice(1) : n}${b.unit ?? ''}`;
}

// --- dates (gantt, line x axis) ---------------------------------------------

/** Day number (days since 01/01/1970 UTC) from "YYYY-MM-DD" or "DD/MM/YYYY"; null if neither. */
export function parseDay(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(ms / 864e5);
}

const dayParts = (n) => {
  const d = new Date(n * 864e5);
  return { d: d.getUTCDate(), m: d.getUTCMonth(), y: d.getUTCFullYear(), wd: d.getUTCDay() };
};
/** DD/MM/YYYY for a day number. */
export const fmtDay = (n) => {
  const p = dayParts(n);
  return `${pad2(p.d)}/${pad2(p.m + 1)}/${p.y}`;
};
const fmtDayShort = (n) => {
  const p = dayParts(n);
  return `${pad2(p.d)}/${pad2(p.m + 1)}`;
};

// --- shared pieces -----------------------------------------------------------

// Scales with its block, but never below minW (the block scrolls) or far above its design width
const svgOpen = (w, hgt, label, minW, maxScale = 1.25) =>
  `<svg class="p-chart-svg" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="${h(label)}" direction="ltr" style="min-width:${minW}px;max-width:${Math.round(w * maxScale)}px"><title>${h(label)}</title>`;

/** The drawing's root: a page chart's scaling <svg>, or (o.bare) a fixed-size one for nesting in a card. */
const open = (o, w, hgt, lbl, minW) => (o.bare ? `<svg x="${o.x || 0}" y="${o.y || 0}" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">` : svgOpen(w, hgt, lbl, minW));

/** Word-wrap to at most `lines` lines of `chars` characters; the last line is clipped. */
const wrap = (s, chars, lines = 2) => {
  const out = [];
  let cur = '';
  for (const w of String(s ?? '').split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= chars) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out.length > lines ? [...out.slice(0, lines - 1), clip(out.slice(lines - 1).join(' '), chars)] : out.map((l) => clip(l, chars));
};

const label = (kind, b) => `${S.kinds[kind]}${b.title ? `: ${b.title}` : ''}`;

const txt = (x, y, s, { cls = '', anchor = 'start', size = 11, extra = '' } = {}) =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${cls ? ` class="${cls}"` : ''}${extra}>${h(s)}</text>`;

/** Visually hidden data table: the accessible equivalent of a chart (wrapped: a table ignores width:1px and would widen the page). */
function srTable(caption, head, rows) {
  return `<div class="p-sr"><table><caption>${h(caption)}</caption><thead><tr>${head.map((c) => `<th scope="col">${h(c)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr><th scope="row">${h(r[0])}</th>${r.slice(1).map((c) => `<td>${h(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

// data-i links a legend item to its series (data-s) or slice (data-i) for enhanceCharts()
const legendHtml = (series, line) =>
  series.length > 1
    ? `<ul class="p-legend" aria-hidden="true">${series.map((s, k) => `<li data-hue="${s.hue}" data-i="${k}"><i${line ? ' class="is-line"' : ''}></i>${h(s.name)}</li>`).join('')}</ul>`
    : '';

const figure = (kind, inner, caption, attrs = '') => `<figure class="p-chart p-chart--${kind}"${attrs}>${inner}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;

/**
 * Drawing width: the measured container width when the caller knows it
 * (`opts.width`, e.g. an inspector panel), so the chart fits without scrolling;
 * else the design width for full or half-width blocks.
 */
const widthFor = (opts, full, half) =>
  isNum(opts.width) && opts.width > 0 ? Math.max(240, Math.min(full, Math.floor(opts.width))) : opts.half ? half : full;
const empty = () => `<p class="p-muted">${h(S.noData)}</p>`;

/** Narrower drawings a page carries for phones (enhanceCharts swaps in the one that fits). */
export const FIT_WIDTHS = [320, 420, 560];

/**
 * `opts.fit` (answer pages): the same chart drawn at each FIT_WIDTHS width below
 * its design width `W`, as inert templates beside the static SVG. The page script
 * swaps in the widest one that fits a narrow container; without JavaScript, and
 * in print, the static drawing stays.
 */
function fitVariants(render, b, opts, W) {
  if (!opts.fit || (isNum(opts.width) && opts.width > 0)) return '';
  return FIT_WIDTHS.filter((w) => w < W)
    .map((w) => {
      const html = render(b, { width: w });
      const at = html.indexOf('<svg class="p-chart-svg"');
      return at < 0 ? '' : `<template class="p-fit" data-w="${w}">${html.slice(at, html.indexOf('</svg>', at) + 6)}</template>`;
    })
    .join('');
}

// --- chart model -------------------------------------------------------------

/** Categories and series of a chart block, from either form: `data` or `categories` + `series`. */
export function chartSeries(b) {
  if (Array.isArray(b.series) && Array.isArray(b.categories)) {
    const cats = b.categories.map((c) => String(c ?? ''));
    const series = b.series
      .filter((s) => s && typeof s === 'object')
      .map((s, i) => ({
        name: String(s.name ?? S.series(i + 1)),
        hue: toneHue(s.tone, hueOf(i)),
        values: cats.map((_, j) => (isNum(list(s.values)[j]) ? s.values[j] : null))
      }));
    return { cats, series };
  }
  const data = list(b.data).filter((d) => d && isNum(d.value));
  return {
    cats: data.map((d) => String(d.label ?? '')),
    series: [{ name: S.value, hue: 'blue', values: data.map((d) => d.value), hues: data.map((d) => (d.tone ? toneHue(d.tone) : null)) }]
  };
}

/** True when a chart block keeps the original HTML bar list (single series, no negatives). */
export const isSimpleBars = (b) => (b.kind === undefined || b.kind === 'bar') && !Array.isArray(b.series) && list(b.data).every((d) => !(isNum(d?.value) && d.value < 0));

/**
 * A chart block as a figure: inline SVG, a legend for several series and a
 * visually hidden data table. `opts.half` draws a narrower chart for half-width
 * blocks, `opts.width` (px) fits it to a measured container; `opts.caption` is
 * ready HTML for the figcaption.
 */
export function renderChart(b, opts = {}) {
  const kind = CHART_KINDS.includes(b.kind) ? b.kind : 'bar';
  const model = chartSeries(b);
  if (!model.cats.length || !model.series.length) return empty();
  if (kind === 'pie' || kind === 'donut') return pieChart(b, model, kind, opts);
  const W = widthFor(opts, 760, 440);
  // Fitted to a narrow container (an inspector panel), column, line and area charts get shorter too
  const H = isNum(opts.width) && opts.width > 0 ? Math.round(Math.max(190, Math.min(280, W * 0.66))) : undefined;
  const svg = kind === 'line' || kind === 'area' ? lineChart(b, model, kind, W, { H }) : bandChart(b, model, kind, W, { H });
  const many = model.series.length > 1;
  const table = srTable(label(kind, b), ['', ...model.series.map((s) => s.name)], model.cats.map((c, j) => [c, ...model.series.map((s) => (s.values[j] === null ? '' : fmtValue(s.values[j], b)))]));
  return figure(kind, `${many ? legendHtml(model.series, kind === 'line') : ''}<div class="p-scroll">${svg}${fitVariants(renderChart, b, opts, W)}</div>${table}`, opts.caption);
}

/**
 * A chart block drawn at a fixed size for a chart card on a diagram
 * (src/core/cardchart.js): the same drawing as on pages, as a bare <svg> to
 * nest at (o.x, o.y). `o.width` and `o.height` size column, line and area
 * charts (a bar chart's height follows its rows); `o.size` is a pie's
 * diameter. `o.hue` colours a single series that names no tone. Returns
 * { kind, model, svg, h } (pies add items, total, pct), or null when there is
 * nothing to draw.
 */
export function chartDrawing(b, o = {}) {
  const kind = CHART_KINDS.includes(b.kind) ? b.kind : 'bar';
  const model = chartSeries(b);
  if (!model.cats.length || !model.series.length) return null;
  if (kind === 'pie' || kind === 'donut') {
    const r = pieChart(b, model, kind, { bare: true, size: o.size, x: o.x, y: o.y });
    return typeof r === 'string' ? null : { kind, model, ...r, h: o.size || 240 };
  }
  if (o.hue && model.series.length === 1 && !(Array.isArray(b.series) && b.series[0]?.tone)) model.series[0].hue = o.hue;
  const draw = kind === 'line' || kind === 'area' ? lineChart : bandChart;
  const svg = draw(b, model, kind, o.width || 360, { bare: true, H: o.height, x: o.x, y: o.y });
  return { kind, model, svg, h: +/height="([\d.]+)"/.exec(svg)[1] };
}

/** Tag a series mark with its series index (legend toggles hide data-s marks). */
const ofSeries = (k, mark) => mark.replace(/^<(\w+) /, (_, tag) => `<${tag} data-s="${k}" `);

/** Column (vertical) or bar (horizontal) chart: grouped, or stacked with `stacked: true`. */
function bandChart(b, { cats, series }, kind, W, o = {}) {
  const horizontal = kind === 'bar';
  const n = cats.length;
  const s = series.length;
  const stacked = b.stacked === true && s > 1;
  const single = s === 1;
  let lo = 0;
  let hi = 0;
  for (let j = 0; j < n; j++) {
    if (stacked) {
      let p = 0;
      let q = 0;
      for (const se of series) {
        const v = se.values[j] ?? 0;
        if (v >= 0) p += v;
        else q += v;
      }
      hi = Math.max(hi, p);
      lo = Math.min(lo, q);
    } else
      for (const se of series) {
        const v = se.values[j];
        if (v !== null) [hi, lo] = [Math.max(hi, v), Math.min(lo, v)];
      }
  }
  const t = niceTicks(lo, hi, horizontal ? 4 : 5);
  const compact = Math.max(Math.abs(t.min), Math.abs(t.max)) >= 1e4;
  const tick = (v) => fmtValue(v, b, { dec: t.dec, compact });
  const val = (v) => fmtValue(v, b, { compact });
  const showValues = single && n <= (horizontal ? 40 : 16);
  const out = [];
  const tip = (j, se, v) => `<title>${h(`${cats[j]}${single ? '' : ` · ${se.name}`}: ${val(v)}`)}</title>`;
  const hueAt = (se, j) => se.hues?.[j] || se.hue;

  if (!horizontal) {
    const H = o.H || 280;
    const ml = Math.ceil(Math.max(...t.ticks.map((v) => textW(tick(v), 11)))) + 14;
    const [x0, x1, y0, y1] = [ml, W - 12, showValues ? 20 : 10, H - 30];
    const vy = (v) => y1 - ((v - t.min) / (t.max - t.min)) * (y1 - y0);
    const slot = (x1 - x0) / n;
    // Value labels only when each fits over its column (narrow panels drop them; tooltips keep them)
    const labelled = showValues && Math.max(...series[0].values.map((v) => (v === null ? 0 : textW(val(v), 10.5)))) <= slot - 4;
    const gw = Math.min(slot * (single || stacked ? 0.62 : 0.8), single || stacked ? 64 : 28 * s);
    const bw = single || stacked ? gw : gw / s;
    for (const v of t.ticks) out.push(`<line class="${v === 0 ? 'c-zero' : 'c-grid'}" x1="${x0}" x2="${x1}" y1="${r1(vy(v))}" y2="${r1(vy(v))}"/>`, txt(x0 - 6, vy(v) + 4, tick(v), { anchor: 'end' }));
    const bar = (x, w, a, c, hue, title) => {
      const [ya, yb] = [vy(Math.max(a, c)), vy(Math.min(a, c))];
      return `<rect data-hue="${hue}" fill="currentColor" x="${r1(x)}" y="${r1(ya)}" width="${r1(Math.max(1, w))}" height="${r1(Math.max(0.5, yb - ya))}" rx="2">${title}</rect>`;
    };
    for (let j = 0; j < n; j++) {
      const base = x0 + slot * j + (slot - gw) / 2;
      const acc = [0, 0];
      series.forEach((se, k) => {
        const v = se.values[j];
        if (v === null) return;
        if (stacked) {
          const i = v >= 0 ? 0 : 1;
          out.push(ofSeries(k, bar(base, gw, acc[i], acc[i] + v, hueAt(se, j), tip(j, se, v))));
          acc[i] += v;
        } else out.push(ofSeries(k, bar(base + k * bw + (single ? 0 : 0.75), bw - (single ? 0 : 1.5), 0, v, hueAt(se, j), tip(j, se, v))));
        if (labelled) out.push(txt(base + gw / 2, v >= 0 ? vy(v) - 5 : vy(v) + 13, val(v), { anchor: 'middle', size: 10.5, cls: 'c-val' }));
      });
    }
    // Category labels: every k-th when they would collide, clipped to the space they get
    const lw = Math.min(Math.max(...cats.map((c) => textW(c, 11))), 130);
    let k = 1;
    while (k < n && slot * k < lw + 8) k++;
    const chars = Math.max(3, Math.floor((slot * k - 6) / (11 * 0.58)));
    cats.forEach((c, j) => j % k === 0 && out.push(txt(x0 + slot * (j + 0.5), y1 + 17, clip(c, chars), { anchor: 'middle' })));
    return `${open(o, W, H, label(kind, b), Math.round(W * 0.75))}${out.join('')}</svg>`;
  }

  const lw = Math.min(Math.max(...cats.map((c) => textW(c, 12))), W * 0.3);
  const bandH = single || stacked ? 28 : Math.max(28, s * 10 + 12);
  const gh = single || stacked ? 14 : s * 10;
  const vw = showValues ? Math.max(...series[0].values.map((v) => (v === null ? 0 : textW(val(v), 11)))) + 10 : 0;
  const [x0, x1, y0] = [Math.ceil(lw) + 14, W - Math.max(14, vw), 6];
  const y1 = y0 + n * bandH;
  const H = y1 + 24;
  const vx = (v) => x0 + ((v - t.min) / (t.max - t.min)) * (x1 - x0);
  for (const v of t.ticks) out.push(`<line class="${v === 0 ? 'c-zero' : 'c-grid'}" x1="${r1(vx(v))}" x2="${r1(vx(v))}" y1="${y0}" y2="${y1}"/>`, txt(vx(v), y1 + 16, tick(v), { anchor: 'middle' }));
  const bar = (y, hh, a, c, hue, title) => `<rect data-hue="${hue}" fill="currentColor" x="${r1(vx(Math.min(a, c)))}" y="${r1(y)}" width="${r1(Math.max(0.5, vx(Math.max(a, c)) - vx(Math.min(a, c))))}" height="${r1(hh)}" rx="2">${title}</rect>`;
  for (let j = 0; j < n; j++) {
    const top = y0 + bandH * j;
    const base = top + (bandH - gh) / 2;
    out.push(txt(x0 - 8, top + bandH / 2 + 4, clipTo(cats[j], lw, 11.5), { anchor: 'end', size: 11.5, cls: 'c-cat' }));
    const acc = [0, 0];
    series.forEach((se, k) => {
      const v = se.values[j];
      if (v === null) return;
      if (stacked) {
        const i = v >= 0 ? 0 : 1;
        out.push(ofSeries(k, bar(base, gh, acc[i], acc[i] + v, hueAt(se, j), tip(j, se, v))));
        acc[i] += v;
      } else out.push(ofSeries(k, bar(base + k * 10 + (single ? 0 : 0.75), single ? gh : 8.5, 0, v, hueAt(se, j), tip(j, se, v))));
      // Negative values are labelled just right of zero, so they never run into the category names
      if (showValues) out.push(txt(v >= 0 ? vx(v) + 5 : vx(0) + 5, top + bandH / 2 + 4, val(v), { size: 10.5, cls: 'c-val' }));
    });
  }
  return `${open(o, W, H, label(kind, b), Math.round(W * 0.75))}${out.join('')}</svg>`;
}

const MARKS = [
  (x, y, a, c) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="3.6"${a}>${c}</circle>`,
  (x, y, a, c) => `<rect x="${r1(x - 3.4)}" y="${r1(y - 3.4)}" width="6.8" height="6.8"${a}>${c}</rect>`,
  (x, y, a, c) => `<path d="M${r1(x)} ${r1(y - 4.4)}L${r1(x + 4.2)} ${r1(y + 3.2)}H${r1(x - 4.2)}Z"${a}>${c}</path>`,
  (x, y, a, c) => `<path d="M${r1(x)} ${r1(y - 4.6)}L${r1(x + 4.6)} ${r1(y)}L${r1(x)} ${r1(y + 4.6)}L${r1(x - 4.6)} ${r1(y)}Z"${a}>${c}</path>`
];
const DASHES = ['', '7 4', '2 3', '9 3 2 3', '4 4', '1 3'];

/** Line or area chart; x positions follow the dates when every category is one. */
function lineChart(b, { cats, series }, kind, W, o = {}) {
  const area = kind === 'area';
  const n = cats.length;
  const stacked = area && b.stacked === true && series.length > 1;
  const H = o.H || 280;
  const tops = [];
  const bases = [];
  const cum = new Array(n).fill(0);
  for (const se of series) {
    if (stacked) {
      bases.push(cum.slice());
      se.values.forEach((v, j) => (cum[j] += v ?? 0));
      tops.push(cum.slice());
    } else {
      bases.push(new Array(n).fill(0));
      tops.push(se.values);
    }
  }
  const all = tops.flat().filter((v) => v !== null);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (area) [lo, hi] = [Math.min(0, lo), Math.max(0, hi)];
  else if (lo >= 0 && lo <= hi * 0.35) lo = 0;
  else if (hi <= 0 && hi >= lo * 0.35) hi = 0;
  const t = niceTicks(lo, hi, 5);
  const compact = Math.max(Math.abs(t.min), Math.abs(t.max)) >= 1e4;
  const tick = (v) => fmtValue(v, b, { dec: t.dec, compact });

  const days = cats.map(parseDay);
  const dated = n > 1 && days.every((d, j) => d !== null && (j === 0 || d > days[j - 1]));
  const pos = dated ? days : cats.map((_, j) => j);
  const ml = Math.max(Math.ceil(Math.max(...t.ticks.map((v) => textW(tick(v), 11)))) + 14, Math.min(textW(cats[0], 11) / 2 + 6, 60));
  const mr = Math.max(16, Math.min(textW(cats[n - 1], 11) / 2 + 4, 60));
  const [x0, x1, y0, y1] = [ml, W - mr, 10, H - 30];
  const span = pos[n - 1] - pos[0];
  const px = (j) => (n === 1 ? (x0 + x1) / 2 : x0 + ((pos[j] - pos[0]) / span) * (x1 - x0));
  const vy = (v) => y1 - ((v - t.min) / (t.max - t.min)) * (y1 - y0);
  const out = [];
  for (const v of t.ticks) out.push(`<line class="${v === 0 ? 'c-zero' : 'c-grid'}" x1="${x0}" x2="${x1}" y1="${r1(vy(v))}" y2="${r1(vy(v))}"/>`, txt(x0 - 6, vy(v) + 4, tick(v), { anchor: 'end' }));

  const lw = Math.min(Math.max(...cats.map((c) => textW(c, 11))), 110);
  const step = n > 1 ? (x1 - x0) / (n - 1) : x1 - x0;
  let k = 1;
  while (k < n && step * k < lw + 10) k++;
  cats.forEach((c, j) => (j % k === 0 || (j === n - 1 && (n - 1) % k >= k / 2)) && out.push(txt(px(j), y1 + 17, clip(c, 18), { anchor: 'middle' })));

  const marks = n <= 24;
  const pt = (j, v) => `${r1(px(j))} ${r1(vy(v))}`;
  // Runs of consecutive values: a missing value (null) breaks a line
  const runs = (vals) => {
    const rs = [];
    let cur = [];
    vals.forEach((v, j) => (v === null ? (cur.length && rs.push(cur), (cur = [])) : cur.push(j)));
    if (cur.length) rs.push(cur);
    return rs;
  };
  const paths = series.map((se, i) => {
    const top = tops[i];
    const base = bases[i];
    const zero = Math.min(Math.max(0, t.min), t.max);
    let g = '';
    for (const run of stacked ? [cats.map((_, j) => j)] : runs(top)) {
      const line = run.map((j, q) => `${q ? 'L' : 'M'}${pt(j, top[j] ?? 0)}`).join('');
      if (area) {
        const back = run.slice().reverse().map((j) => `L${pt(j, stacked ? base[j] : zero)}`).join('');
        g += `<path class="c-area${stacked ? ' is-stacked' : ''}" d="${line}${back}Z"/>`;
      }
      if (run.length > 1) g += `<path class="c-line" d="${line}"${!marks && DASHES[i % DASHES.length] ? ` stroke-dasharray="${DASHES[i % DASHES.length]}"` : ''}/>`;
    }
    if (marks || top.filter((v) => v !== null).length === 1)
      se.values.forEach((v, j) => v !== null && (g += MARKS[i % MARKS.length](px(j), vy(top[j]), ' class="c-mark"', `<title>${h(`${cats[j]}${series.length > 1 ? ` · ${se.name}` : ''}: ${fmtValue(v, b)}`)}</title>`)));
    return `<g data-hue="${se.hue}" data-s="${i}">${g}</g>`;
  });
  return `${open(o, W, H, label(kind, b), Math.round(W * 0.75))}${out.join('')}${paths.join('')}</svg>`;
}

/** Pie or donut: slices from `data`, a legend with values and shares, the total in a donut's centre. */
function pieChart(b, { cats, series }, kind, opts) {
  const donut = kind === 'donut';
  const items = cats
    .map((c, j) => ({ label: c, value: series[0].values[j], hue: series[0].hues?.[j] || hueOf(j) }))
    .filter((d) => d.value > 0);
  const total = items.reduce((a, d) => a + d.value, 0);
  if (!(total > 0)) return empty();
  const [c, r, ir] = [120, 112, donut ? 72 : 0];
  const pct = (v) => {
    const p = (v / total) * 100;
    return p > 0 && p < 1 ? '<1%' : `${+p.toFixed(p < 10 ? 1 : 0)}%`;
  };
  const at = (a, rad) => `${r1(c + rad * Math.cos(a))} ${r1(c + rad * Math.sin(a))}`;
  const out = [];
  let a = -Math.PI / 2;
  for (const [i, d] of items.entries()) {
    const frac = d.value / total;
    const b2 = a + frac * 2 * Math.PI;
    const big = frac > 0.5 ? 1 : 0;
    const title = `<title>${h(`${d.label}: ${fmtValue(d.value, b)} (${pct(d.value)})`)}</title>`;
    if (frac > 0.9999)
      out.push(donut
        ? `<circle data-hue="${d.hue}" data-i="${i}" class="c-ring" cx="${c}" cy="${c}" r="${(r + ir) / 2}" stroke-width="${r - ir}">${title}</circle>`
        : `<circle data-hue="${d.hue}" data-i="${i}" fill="currentColor" cx="${c}" cy="${c}" r="${r}">${title}</circle>`);
    else
      out.push(`<path data-hue="${d.hue}" data-i="${i}" fill="currentColor" class="c-slice" d="M${at(a, r)}A${r} ${r} 0 ${big} 1 ${at(b2, r)}${
        donut ? `L${at(b2, ir)}A${ir} ${ir} 0 ${big} 0 ${at(a, ir)}` : `L${c} ${c}`
      }Z">${title}</path>`);
    // a card-sized pie (opts.bare) is too small for labels on the slices: its legend lists the shares
    if (!opts.bare && frac >= (donut ? 0.08 : 0.06)) {
      const mid = (a + b2) / 2;
      const rad = donut ? (r + ir) / 2 : r * 0.64;
      out.push(txt(c + rad * Math.cos(mid), c + rad * Math.sin(mid) + 4, pct(d.value), { anchor: 'middle', size: donut ? 11 : 12, cls: 'c-pct' }));
    }
    a = b2;
  }
  if (donut && opts.bare) out.push(txt(c, c + 10, fmtValue(total, b, { compact: total >= 1e4 }), { anchor: 'middle', size: 30, cls: 'c-total' }));
  else if (donut) out.push(txt(c, c + 4, fmtValue(total, b, { compact: total >= 1e5 }), { anchor: 'middle', size: 24, cls: 'c-total' }), txt(c, c + 24, S.total, { anchor: 'middle', size: 11.5 }));
  if (opts.bare) return { svg: `${open(opts, opts.size || 240, opts.size || 240, '', 0).replace(/viewBox="[^"]*"/, 'viewBox="0 0 240 240"')}${out.join('')}</svg>`, items, total, pct };
  const svg = `${svgOpen(240, 240, label(kind, b), 0)}${out.join('')}</svg>`;
  const legend = `<ul class="p-legend p-legend--pie">${items
    .map((d, i) => `<li data-hue="${d.hue}" data-i="${i}" data-v="${d.value}"><i></i><span>${h(d.label)}</span><b>${h(fmtValue(d.value, b))}</b><em>${h(pct(d.value))}</em></li>`)
    .join('')}${donut ? '' : `<li class="is-total"><i></i><span>${h(S.total)}</span><b>${h(fmtValue(total, b))}</b><em>100%</em></li>`}</ul>`;
  // Number format for totals recomputed in the browser when slices are toggled
  const fmt = h(JSON.stringify({ p: b.prefix ?? '', u: b.unit ?? '', l: NUM_LANG }));
  return figure(kind, `<div class="p-pie">${svg}${legend}</div>`, opts.caption, ` data-fmt="${fmt}"`);
}

/** Metric sparkline: a small trend line under the value (no axes). */
export function sparkline(values, hue = 'blue') {
  const vals = list(values).filter(isNum);
  if (vals.length < 2) return '';
  const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
  const [w, hh] = [100, 24];
  const y = (v) => (hi === lo ? hh / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (hh - 4));
  const pts = vals.map((v, i) => `${r1((i / (vals.length - 1)) * w)} ${r1(y(v))}`);
  const desc = `${S.kinds.trend}: ${vals.map((v) => fmtNum(v)).join(', ')}`;
  return `<svg class="p-spark" data-hue="${hue}" viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none" role="img" aria-label="${h(desc)}"><title>${h(desc)}</title><path class="a" d="M${pts.join('L')}L${w} ${hh}L0 ${hh}Z"/><path class="l" d="M${pts.join('L')}"/></svg>`;
}

// --- gantt -------------------------------------------------------------------

/**
 * Resolve a gantt block to day ranges. Dates are "YYYY-MM-DD" or "DD/MM/YYYY";
 * numbers are days from `start` (the plan's first day) or from day 0. A task
 * runs [s, e) in days: `end` is its last day (inclusive), `days` its length.
 * Without `start`, a task begins when its `after` tasks end, else when the task
 * above it ends. Problems are returned for the validator, not thrown.
 */
export function resolveGantt(b) {
  const items = list(b.items).filter((it) => it && typeof it === 'object');
  const problems = [];
  const bad = (code, message, level = 'error') => problems.push({ level, code, message });
  const dateish = (v) => typeof v === 'string';
  const dated = dateish(b.start) || items.some((it) => dateish(it.start) || dateish(it.end) || dateish(it.date));
  let origin = 0;
  if (dated) {
    const first = dateish(b.start) ? parseDay(b.start) : null;
    if (dateish(b.start) && first === null) bad('page/gantt-date', `start "${b.start}" is not a date; use YYYY-MM-DD or DD/MM/YYYY.`);
    const starts = items.map((it) => parseDay(it.start ?? it.date)).filter((d) => d !== null);
    origin = first ?? (starts.length ? Math.min(...starts) : 0);
  }
  // Working days: `workdays: true` skips Saturdays, Sundays and `holidays` in every count of days
  const holidays = new Set();
  if (b.holidays !== undefined) {
    if (!Array.isArray(b.holidays)) bad('page/gantt-date', 'holidays must be a list of dates (YYYY-MM-DD or DD/MM/YYYY).');
    else
      b.holidays.forEach((v, k) => {
        const d = parseDay(v);
        if (d === null) bad('page/gantt-date', `holidays[${k}] "${v}" is not a date; use YYYY-MM-DD or DD/MM/YYYY.`);
        else holidays.add(d);
      });
    if (b.workdays !== true) bad('page/gantt-date', 'holidays only count with workdays: true.', 'warning');
  }
  if (b.workdays !== undefined && typeof b.workdays !== 'boolean') bad('page/gantt-date', 'workdays must be true or false.');
  if (b.workdays === true && !dated) bad('page/gantt-date', 'workdays needs dates to know the weekends: give the plan a start date (YYYY-MM-DD or DD/MM/YYYY).', 'warning');
  const work = b.workdays === true && dated;
  const cal = workCalendar(work, holidays);
  const at = (v, i, field) => {
    // With workdays, a number of days counts working days from the first working day
    if (isNum(v)) return work ? cal.next(cal.add(cal.next(origin), v)) : origin + v;
    const d = parseDay(v);
    if (d === null) bad('page/gantt-date', `items[${i}] "${items[i].title}" ${field} "${v}" is not a date; use YYYY-MM-DD or DD/MM/YYYY, or a number of days.`);
    return d;
  };

  const ids = new Map();
  items.forEach((it, i) => {
    if (it.id === undefined) return;
    const id = String(it.id);
    if (ids.has(id)) bad('page/gantt-dependency', `items[${i}] repeats id "${id}".`);
    else ids.set(id, i);
  });
  const find = (ref) => (ids.has(String(ref)) ? ids.get(String(ref)) : items.findIndex((it) => it.title === ref));
  const deps = items.map((it, i) =>
    (Array.isArray(it.after) ? it.after : it.after !== undefined ? [it.after] : [])
      .map((ref) => {
        const j = find(ref);
        if (j < 0) bad('page/gantt-dependency', `items[${i}] "${it.title}" is after "${ref}", which is not the id or title of a task.`);
        return j;
      })
      .filter((j) => j >= 0)
  );

  const out = items.map(() => null);
  const state = items.map(() => 0);
  const solve = (i) => {
    if (state[i] === 2) return out[i];
    if (state[i] === 1) {
      bad('page/gantt-dependency', `items[${i}] "${items[i].title}" depends on itself through its "after" chain.`);
      return null;
    }
    state[i] = 1;
    const it = items[i];
    const given = it.start ?? it.date;
    let s = null;
    if (given !== undefined) s = at(given, i, it.start !== undefined ? 'start' : 'date');
    else {
      if (deps[i].length) s = Math.max(...deps[i].map((j) => solve(j)?.e ?? -Infinity));
      else s = i > 0 ? solve(i - 1)?.e ?? origin : origin;
      // A task that follows another starts on the next working day (a milestone marks the moment it ends)
      if (isNum(s) && !it.milestone) s = cal.next(s);
    }
    if (!isNum(s)) s = null;
    let e = null;
    if (s !== null) {
      if (it.milestone) e = s;
      else if (isNum(it.days)) e = cal.add(s, it.days);
      else if (it.end !== undefined) {
        const last = at(it.end, i, 'end');
        e = last === null ? null : last + 1;
      } else bad('page/gantt-date', `items[${i}] "${it.title}" needs days or end (or milestone: true).`);
    }
    if (s !== null && e !== null && e < s) {
      bad('page/gantt-order', `items[${i}] "${it.title}" ends before it starts.`);
      e = s;
    }
    if (s !== null && given !== undefined)
      for (const j of deps[i]) {
        const d = solve(j);
        if (d && d.e > s) bad('page/gantt-order', `items[${i}] "${it.title}" starts before "${items[j].title}" (its "after") ends.`, 'warning');
      }
    if (isNum(it.progress) && (it.progress < 0 || it.progress > 100)) bad('page/chart-out-of-range', `items[${i}] "${it.title}" progress must be 0-100.`, 'warning');
    state[i] = 2;
    out[i] = s === null || e === null ? null : { s, e };
    return out[i];
  };
  items.forEach((_, i) => solve(i));

  const groups = [];
  for (const it of items) if (it.group !== undefined && !groups.includes(String(it.group))) groups.push(String(it.group));
  const tasks = items.map((it, i) => ({
    item: it,
    index: i,
    s: out[i]?.s ?? null,
    e: out[i]?.e ?? null,
    deps: deps[i],
    group: it.group === undefined ? null : String(it.group),
    hue: it.tone ? toneHue(it.tone) : it.milestone ? null : groups.length ? hueOf(groups.indexOf(String(it.group ?? ''))) : 'blue'
  }));
  for (const t of tasks) if (t.group === null && groups.length && !t.item.tone && !t.item.milestone) t.hue = 'slate';
  // Length in days as the plan counts them (working days with workdays)
  for (const t of tasks) t.len = t.s === null ? null : cal.count(t.s, t.e);
  return { tasks, groups, mode: dated ? 'date' : 'day', origin, problems, workdays: work, holidays, at: (v) => (isNum(v) ? (work ? cal.next(cal.add(cal.next(origin), v)) : origin + v) : parseDay(v)) };
}

/**
 * Day arithmetic for a gantt: calendar days, or working days (no Saturdays,
 * Sundays or holidays) when `work` is true. Days are day numbers; ranges are [s, e).
 */
function workCalendar(work, holidays) {
  const isWork = (d) => {
    const wd = dayParts(d).wd;
    return wd !== 0 && wd !== 6 && !holidays.has(d);
  };
  // Bounded loops: a year of holidays cannot hang the renderer
  const next = (d) => {
    if (!work) return d;
    for (let k = 0; k < 3700 && !isWork(d); k++) d++;
    return d;
  };
  const add = (s, n) => {
    if (!work || !(n > 0)) return s + n;
    let d = s;
    for (let left = n, k = 0; left > 0 && k < 100000; k++, d++) if (isWork(d)) left--;
    return d;
  };
  const count = (s, e) => {
    if (!work || !(e > s)) return e - s;
    let n = 0;
    for (let d = s; d < e && d - s < 100000; d++) if (isWork(d)) n++;
    return n;
  };
  return { isWork, next, add, count };
}

/** Rows in display order: tasks under their group headings (groups in order of first use). */
function ganttRows(g) {
  if (!g.groups.length) return g.tasks.map((t) => ({ task: t }));
  const rows = [];
  const seen = new Set();
  for (const t of g.tasks) {
    const key = t.group ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    const members = g.tasks.filter((x) => (x.group ?? '') === key);
    if (t.group !== null) rows.push({ group: t.group, members });
    for (const m of members) rows.push({ task: m, indent: t.group !== null });
  }
  return rows;
}

const dayLabel = (g, n) => (g.mode === 'date' ? fmtDay(n) : S.dayN(n));

/** Axis ticks for a gantt: days, weeks (Mondays), fortnights or months, as space allows. */
function dayTicks(g, lo, hi, ppd) {
  const gap = 46;
  const ticks = [];
  if (g.mode === 'day') {
    const step = [1, 2, 5, 7, 14, 28, 56, 91, 182, 364].find((s) => s * ppd >= gap) || 364;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push({ at: v, text: S.dayN(v) });
    return ticks;
  }
  if (ppd >= gap) {
    for (let v = lo; v <= hi; v++) ticks.push({ at: v, text: fmtDayShort(v) });
    return ticks;
  }
  if (7 * ppd >= gap / 1.1 || 14 * ppd >= gap) {
    const every = 7 * ppd >= gap / 1.1 ? 7 : 14;
    let v = lo;
    while (dayParts(v).wd !== 1) v++;
    for (; v <= hi; v += every) ticks.push({ at: v, text: fmtDayShort(v) });
    return ticks;
  }
  const every = [1, 2, 3, 6, 12].find((m) => m * 30.4 * ppd >= gap) || 12;
  let { m, y } = dayParts(lo);
  for (let i = 0; i < 400; i++) {
    const v = Math.round(Date.UTC(y, m, 1) / 864e5);
    if (v > hi) break;
    if (v >= lo && m % every === 0) ticks.push({ at: v, text: m === 0 || !ticks.length ? `${S.months[m]} ${y}` : S.months[m] });
    if (++m === 12) [m, y] = [0, y + 1];
  }
  return ticks;
}

/** Gantt plan: tasks as bars on a time axis, groups, milestones, dependency arrows and an optional today line. */
export function renderGantt(b, opts = {}) {
  const g = resolveGantt(b);
  const placed = g.tasks.filter((t) => t.s !== null);
  if (!placed.length) return empty();
  const W = widthFor(opts, 760, 460);
  let lo = Math.min(...placed.map((t) => t.s));
  let hi = Math.max(...placed.map((t) => Math.max(t.e, t.s + (t.item.milestone ? 1 : 0))));
  if (hi <= lo) hi = lo + 1;
  const todayDay = typeof b.today === 'string' || isNum(b.today) ? g.at(b.today) : null;
  const showToday = todayDay !== null && todayDay >= lo && todayDay <= hi;
  const rows = ganttRows(g);
  const indent = g.groups.length ? 14 : 0;
  const lw = Math.min(Math.max(110, Math.max(...g.tasks.map((t) => textW(t.item.title, 12.5) + indent), ...g.groups.map((x) => textW(x, 12))) + 18), W * (W < 420 ? 0.42 : 0.34));
  const [x0, x1, top, rowH] = [Math.ceil(lw), W - 18, 30, 26];
  const H = top + rows.length * rowH + (showToday ? 22 : 8);
  const ppd = (x1 - x0) / (hi - lo);
  const dx = (d) => x0 + (d - lo) * ppd;
  const out = [];

  // Weekends (and, with workdays, holidays) shaded when days are wide enough to see
  if (g.mode === 'date' && ppd >= 9)
    for (let d = lo; d < hi; d++) {
      const wd = dayParts(d).wd;
      if (wd === 6 || wd === 0 || (g.workdays && g.holidays.has(d))) out.push(`<rect class="c-weekend" x="${r1(dx(d))}" y="${top - 4}" width="${r1(ppd)}" height="${rows.length * rowH + 4}"/>`);
    }
  for (const tk of dayTicks(g, lo, hi, ppd)) out.push(`<line class="c-grid" x1="${r1(dx(tk.at))}" x2="${r1(dx(tk.at))}" y1="${top - 8}" y2="${top + rows.length * rowH}"/>`, txt(dx(tk.at) + 3, top - 12, tk.text, { size: 10.5 }));
  out.push(`<line class="c-zero" x1="${x0}" x2="${x1}" y1="${top - 4}" y2="${top - 4}"/>`);

  const rowOf = new Map();
  rows.forEach((row, i) => row.task && rowOf.set(row.task.index, i));
  const cy = (i) => top + i * rowH + rowH / 2;
  const tipFor = (t) => {
    const it = t.item;
    if (it.milestone) return `${it.title}: ${dayLabel(g, t.s)}`;
    return `${it.title}: ${dayLabel(g, t.s)} – ${dayLabel(g, t.e - 1)} (${S.days(t.len)})${isNum(it.progress) ? `, ${Math.round(it.progress)}%` : ''}`;
  };
  const edge = (t, side) => (t.item.milestone ? dx(t.s) + (side === 'end' ? 7 : -7) : dx(side === 'end' ? t.e : t.s));

  // Dependency arrows, under the bars: finish of each "after" task -> start of this one
  for (const t of g.tasks) {
    if (t.s === null) continue;
    for (const j of t.deps) {
      const p = g.tasks[j];
      if (p.s === null) continue;
      const [ax, ay, bx, by] = [edge(p, 'end'), cy(rowOf.get(p.index)), edge(t, 'start'), cy(rowOf.get(t.index))];
      const path =
        bx - ax >= 12
          ? `M${r1(ax)} ${r1(ay)}H${r1(ax + 6)}V${r1(by)}H${r1(bx - 1)}`
          : `M${r1(ax)} ${r1(ay)}H${r1(ax + 6)}V${r1(by + (by > ay ? -rowH / 2 : rowH / 2))}H${r1(bx - 9)}V${r1(by)}H${r1(bx - 1)}`;
      out.push(`<path class="c-dep" d="${path}"/><path class="c-arrow" d="M${r1(bx)} ${r1(by)}l-5 -3.5v7z"/>`);
    }
  }

  rows.forEach((row, i) => {
    const y = cy(i);
    if (row.group !== undefined) {
      out.push(txt(8, y + 4, clip(row.group, Math.floor((lw - 14) / 7)), { size: 12, cls: 'c-group' }));
      const ms = row.members.filter((t) => t.s !== null);
      if (ms.length) {
        const [a, c] = [dx(Math.min(...ms.map((t) => t.s))), dx(Math.max(...ms.map((t) => t.e)))];
        out.push(`<path class="c-span" d="M${r1(a)} ${r1(y + 5)}V${r1(y - 2)}H${r1(c)}V${r1(y + 5)}"/>`);
      }
      return;
    }
    const t = row.task;
    const it = t.item;
    out.push(txt(8 + (row.indent ? indent : 0), y + 4, clipTo(it.title, lw - 18 - (row.indent ? indent : 0), 12.5), { size: 12.5, cls: 'c-task' }));
    if (t.s === null) return;
    const tip = `<title>${h(tipFor(t))}</title>`;
    const hue = t.hue ? ` data-hue="${t.hue}"` : '';
    if (it.milestone) {
      const x = dx(t.s);
      out.push(`<path${hue} class="${t.hue ? 'c-ms is-hued' : 'c-ms'}"${t.hue ? ' fill="currentColor"' : ''} d="M${r1(x)} ${r1(y - 7)}L${r1(x + 7)} ${r1(y)}L${r1(x)} ${r1(y + 7)}L${r1(x - 7)} ${r1(y)}Z">${tip}</path>`);
      return;
    }
    const [x, w] = [dx(t.s), Math.max(2, (t.e - t.s) * ppd)];
    if (isNum(it.progress)) {
      const p = Math.min(100, Math.max(0, it.progress)) / 100;
      out.push(`<g${hue} fill="currentColor"><rect class="c-track" x="${r1(x)}" y="${r1(y - 7)}" width="${r1(w)}" height="14" rx="3">${tip}</rect>${p > 0 ? `<rect x="${r1(x)}" y="${r1(y - 7)}" width="${r1(w * p)}" height="14" rx="3">${tip}</rect>` : ''}</g>`);
    } else out.push(`<rect${hue} fill="currentColor" x="${r1(x)}" y="${r1(y - 7)}" width="${r1(w)}" height="14" rx="3">${tip}</rect>`);
  });

  if (showToday) {
    const x = dx(todayDay);
    const bottom = top + rows.length * rowH;
    out.push(`<line class="c-today" x1="${r1(x)}" x2="${r1(x)}" y1="${top - 6}" y2="${bottom + 2}"/>`, txt(x, bottom + 15, S.today, { anchor: 'middle', size: 10.5, cls: 'c-today-l' }));
  }

  const title = label('gantt', b);
  const head = [S.task, ...(g.groups.length ? [S.group] : []), S.start, S.end, S.after];
  const table = srTable(title, head, ganttTable(g).map((r) => (g.groups.length ? r : [r[0], ...r.slice(2)])));
  const svg = `${svgOpen(W, H, title, Math.round(W * 0.72))}${out.join('')}</svg>`;
  return figure('gantt', `<div class="p-scroll">${svg}${fitVariants(renderGantt, b, opts, W)}</div>${table}`, opts.caption);
}

/** Gantt rows as text: task, group, start, end (or "Milestone"), after. */
function ganttTable(g) {
  return ganttRows(g)
    .filter((r) => r.task)
    .map(({ task: t }) => [
      String(t.item.title ?? ''),
      t.group ?? '',
      t.s === null ? '' : dayLabel(g, t.s),
      t.s === null ? '' : t.item.milestone ? S.milestone : dayLabel(g, t.e - 1),
      t.deps.map((j) => g.tasks[j].item.title).join(', ')
    ]);
}

// --- matrix ------------------------------------------------------------------

const axisOf = (a, grid) => {
  const o = typeof a === 'string' ? { label: a } : a && typeof a === 'object' ? a : {};
  const [dmin, dmax] = grid === 2 ? [0, 10] : [1, grid];
  return { label: o.label ? String(o.label) : '', low: o.low ?? null, high: o.high ?? null, labels: Array.isArray(o.labels) ? o.labels.map(String) : null, min: isNum(o.min) ? o.min : dmin, max: isNum(o.max) && o.max !== (isNum(o.min) ? o.min : dmin) ? o.max : dmax };
};
const matrixGrid = (b) => (Number.isInteger(b.grid) && b.grid >= 2 && b.grid <= 5 ? b.grid : 2);
const quadrantOf = (b) => (Array.isArray(b.quadrants) ? b.quadrants : []).map((q) => (q && typeof q === 'object' ? q : { title: q }));
/** Heat band of a cell (1-based column and row): low, medium or high by the product of the two. */
const heatHue = (cx, cy, grid) => {
  const p = (cx * cy) / (grid * grid);
  return p <= 0.25 ? 'green' : p < 0.5 ? 'amber' : 'rose';
};

/**
 * Matrix: a 2x2 quadrant with items placed by score (`grid: 2`, x and y on
 * axis.min..axis.max, default 0..10), or a 3x3 to 5x5 heat map with items
 * listed in their cells (x and y are 1-based cell numbers, y counted upwards).
 */
export function renderMatrix(b, opts = {}) {
  const grid = matrixGrid(b);
  const ax = axisOf(b.x, grid);
  const ay = axisOf(b.y, grid);
  const items = list(b.items).filter((it) => it && isNum(it.x) && isNum(it.y));
  const W = widthFor(opts, 680, 440);
  const yTick = grid > 2 ? Math.max(...(ay.labels || []).map((s) => textW(s, 11)), 10) : 0;
  const ml = 30 + Math.min(Math.ceil(yTick), 110) + (grid > 2 ? 8 : 0);
  const [mt, mr, mb] = [8, 10, grid > 2 ? 44 : 40];
  const size = Math.min(W - ml - mr, grid > 2 ? 580 : 460);
  const [x0, y0] = [ml, mt];
  const ph = grid > 2 ? size * 0.8 : size * 0.78;
  const [x1, y1] = [x0 + size, y0 + ph];
  const H = y1 + mb;
  const out = [];
  const cw = size / grid;
  const ch = ph / grid;

  if (grid === 2) {
    const qs = quadrantOf(b);
    const cells = [[0, 0], [1, 0], [0, 1], [1, 1]];
    cells.forEach(([cx, cy], i) => {
      const q = qs[i] || {};
      const x = x0 + cx * cw;
      const y = y0 + cy * ch;
      out.push(`<rect class="c-cell" x="${r1(x)}" y="${r1(y)}" width="${r1(cw)}" height="${r1(ch)}"/>`);
      if (q.tone) out.push(`<rect data-hue="${toneHue(q.tone)}" class="c-heat" x="${r1(x)}" y="${r1(y)}" width="${r1(cw)}" height="${r1(ch)}"/>`);
      if (q.title) out.push(txt(cx ? x + cw - 10 : x + 10, cy ? y + ch - 10 : y + 18, clip(q.title, Math.floor((cw - 20) / 7)), { anchor: cx ? 'end' : 'start', size: 12, cls: 'c-qt' }));
    });
    out.push(`<line class="c-mid" x1="${r1(x0 + cw)}" x2="${r1(x0 + cw)}" y1="${y0}" y2="${r1(y1)}"/><line class="c-mid" x1="${x0}" x2="${r1(x1)}" y1="${r1(y0 + ch)}" y2="${r1(y0 + ch)}"/>`);
    const px = (v) => x0 + ((Math.min(Math.max(v, ax.min), ax.max) - ax.min) / (ax.max - ax.min)) * size;
    const py = (v) => y1 - ((Math.min(Math.max(v, ay.min), ay.max) - ay.min) / (ay.max - ay.min)) * ph;
    // Points first, then labels placed beside them where they do not overlap
    const boxes = items.map((it) => ({ x: px(it.x) - 7, y: py(it.y) - 7, w: 14, h: 14 }));
    const hit = (bx) => boxes.some((o) => bx.x < o.x + o.w && bx.x + bx.w > o.x && bx.y < o.y + o.h && bx.y + bx.h > o.y) || bx.x < x0 || bx.x + bx.w > x1 || bx.y < y0 || bx.y + bx.h > y1;
    const labels = [];
    items.forEach((it) => {
      const [x, y] = [px(it.x), py(it.y)];
      const hue = toneHue(it.tone, 'blue');
      out.push(`<circle data-hue="${hue}" class="c-dot" cx="${r1(x)}" cy="${r1(y)}" r="6.5"><title>${h(`${it.label}: ${ax.label || 'x'} ${it.x}, ${ay.label || 'y'} ${it.y}`)}</title></circle>`);
      const s = clip(it.label, 26);
      const w = textW(s, 12) + 2;
      const tries = [
        { x: x + 10, y: y - 8, a: 'start' },
        { x: x - 10 - w, y: y - 8, a: 'end' },
        { x: x - w / 2, y: y - 26, a: 'middle' },
        { x: x - w / 2, y: y + 10, a: 'middle' },
        { x: x + 10, y: y - 22, a: 'start' },
        { x: x + 10, y: y + 6, a: 'start' }
      ];
      const pick = tries.find((p) => !hit({ x: p.x, y: p.y, w, h: 16 })) || tries[0];
      boxes.push({ x: pick.x, y: pick.y, w, h: 16 });
      const tx = pick.a === 'start' ? pick.x : pick.a === 'end' ? pick.x + w : pick.x + w / 2;
      labels.push(txt(tx, pick.y + 12, s, { anchor: pick.a, size: 12, cls: 'c-pt' }));
    });
    out.push(...labels);
    if (ax.low !== null) out.push(txt(x0, y1 + 16, ax.low, { size: 11 }));
    if (ax.high !== null) out.push(txt(x1, y1 + 16, ax.high, { anchor: 'end', size: 11 }));
    if (ay.low !== null) out.push(txt(x0 - 8, y1, ay.low, { size: 11, extra: ` transform="rotate(-90 ${r1(x0 - 8)} ${r1(y1)})"` }));
    if (ay.high !== null) out.push(txt(x0 - 8, y0, ay.high, { anchor: 'end', size: 11, extra: ` transform="rotate(-90 ${r1(x0 - 8)} ${r1(y0)})"` }));
  } else {
    const heat = b.heat !== false;
    const byCell = new Map();
    for (const it of items) {
      const k = `${Math.min(grid, Math.max(1, Math.round(it.x)))},${Math.min(grid, Math.max(1, Math.round(it.y)))}`;
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(it);
    }
    for (let cx = 1; cx <= grid; cx++)
      for (let cy = 1; cy <= grid; cy++) {
        const x = x0 + (cx - 1) * cw;
        const y = y1 - cy * ch;
        out.push(`<rect class="c-cell" x="${r1(x)}" y="${r1(y)}" width="${r1(cw)}" height="${r1(ch)}"/>`);
        if (heat) out.push(`<rect data-hue="${heatHue(cx, cy, grid)}" class="c-heat" x="${r1(x)}" y="${r1(y)}" width="${r1(cw)}" height="${r1(ch)}"/>`);
        const here = byCell.get(`${cx},${cy}`) || [];
        // Labels wrap to two lines; what does not fit becomes "+n more"
        const fit = Math.max(1, Math.floor((ch - 8) / 14));
        const chars = Math.max(4, Math.floor((cw - 20) / (11 * 0.56)));
        let line = 0;
        let shown = 0;
        for (const it of here) {
          const ls = wrap(it.label, chars, here.length === 1 ? 3 : 2);
          const room = fit - line - (shown < here.length - 1 ? 1 : 0);
          if (ls.length > room && !(shown === here.length - 1 && ls.length <= fit - line)) break;
          const ty = y + 16 + line * 14;
          out.push(`<circle data-hue="${toneHue(it.tone, 'slate')}" fill="currentColor" cx="${r1(x + 9)}" cy="${r1(ty - 4)}" r="3"><title>${h(it.label)}</title></circle>`);
          ls.forEach((l, k) => out.push(txt(x + 16, ty + k * 14, l, { size: 11, cls: 'c-pt' })));
          line += ls.length;
          shown++;
        }
        if (shown < here.length) out.push(txt(x + 16, y + 16 + line * 14, S.more(here.length - shown), { size: 11 }));
      }
    for (let i = 1; i <= grid; i++) {
      out.push(txt(x0 + (i - 0.5) * cw, y1 + 16, clip(ax.labels?.[i - 1] ?? i, Math.floor(cw / 6.4)), { anchor: 'middle', size: 11 }));
      out.push(txt(x0 - 8, y1 - (i - 0.5) * ch + 4, clip(ay.labels?.[i - 1] ?? i, 20), { anchor: 'end', size: 11 }));
    }
  }
  if (ax.label) out.push(txt((x0 + x1) / 2, H - 6, ax.label, { anchor: 'middle', size: 12, cls: 'c-axis' }));
  if (ay.label) out.push(txt(12, (y0 + y1) / 2, ay.label, { anchor: 'middle', size: 12, cls: 'c-axis', extra: ` transform="rotate(-90 12 ${r1((y0 + y1) / 2)})"` }));

  const title = label(grid > 2 ? 'heat' : 'matrix', b);
  const head = [S.item, ax.label || 'x', ay.label || 'y'];
  const table = srTable(title, head, items.map((it) => [String(it.label ?? ''), String(it.x), String(it.y)]));
  const svg = `${svgOpen(x1 + mr, H, title, Math.round((x1 + mr) * 0.7), 1.1)}${out.join('')}</svg>`;
  return figure('matrix', `<div class="p-scroll">${svg}${fitVariants(renderMatrix, b, opts, W)}</div>${table}`, opts.caption);
}

// --- legend toggles (browser) -------------------------------------------------

/**
 * Progressive enhancement, run in the browser only (pages inline its source;
 * the viewer calls it on inspector panels): legend items become toggle buttons.
 * A series legend hides that series' marks (data-s); a pie or donut legend
 * takes the slice out and redraws the rest, their percentages and the total.
 * Self-contained (no module references) because pages embed it as text. Without
 * JavaScript the static chart is unchanged.
 */
export function enhanceCharts(root) {
  var NS = 'http://www.w3.org/2000/svg';
  var figs = (root || document).querySelectorAll('figure.p-chart');
  for (var n = 0; n < figs.length; n++) setup(figs[n]);
  fitAll((root || document).querySelectorAll('figure.p-chart > .p-scroll'));

  // Narrow containers (phones): swap in the widest drawing that fits without
  // scrolling sideways (template.p-fit, drawn at build time), on load and on
  // resize; print restores the static drawing.
  function fitAll(boxes) {
    var list = [].filter.call(boxes, function (el) { return el.querySelector('template.p-fit') && !el.getAttribute('data-fit'); });
    if (!list.length) return;
    var minOf = function (svg) { var m = /min-width:\s*(\d+)/.exec(svg.getAttribute('style') || ''); return m ? +m[1] : 0; };
    list.forEach(function (el) {
      var svg = el.querySelector('svg.p-chart-svg');
      if (!svg) return;
      el.setAttribute('data-fit', '1');
      var all = [{ w: Infinity, node: svg }];
      [].forEach.call(el.querySelectorAll('template.p-fit'), function (t) {
        var s = t.content.querySelector('svg');
        if (s) all.push({ w: +t.getAttribute('data-w'), node: s });
      });
      el._fits = all;
    });
    var show = function (el, pick) {
      var cur = el.querySelector('svg.p-chart-svg');
      var next = pick.w === Infinity ? pick.node : (pick.live = pick.live || document.importNode(pick.node, true));
      if (!cur || cur === next) return;
      el.replaceChild(next, cur);
      var fig = el.parentNode;
      // series hidden from the legend stay hidden in the new drawing
      [].forEach.call(fig.querySelectorAll('.p-legend li[data-i]'), function (li) {
        var hide = li.classList.contains('is-off');
        [].forEach.call(next.querySelectorAll('[data-s="' + li.getAttribute('data-i') + '"]'), function (m) { m.style.display = hide ? 'none' : ''; });
      });
      try { el.dispatchEvent(new Event('scroll')); } catch (e) { /* edge fades refresh on the next scroll */ }
    };
    var fit = function () {
      list.forEach(function (el) {
        if (!el._fits) return;
        var cw = el.clientWidth;
        if (!cw) return;
        // the design drawing while it fits, else the widest narrower one that does, else the narrowest
        var fits = el._fits.filter(function (f) { return minOf(f.node) <= cw; });
        var pick = fits.length ? fits.reduce(function (a, b) { return b.w > a.w ? b : a; }) : el._fits.reduce(function (a, b) { return b.w < a.w ? b : a; });
        show(el, pick);
      });
    };
    var timer = 0;
    var later = function () { clearTimeout(timer); timer = setTimeout(fit, 120); };
    fit();
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(later);
      list.forEach(function (el) { ro.observe(el); });
    } else addEventListener('resize', later);
    addEventListener('beforeprint', function () { list.forEach(function (el) { if (el._fits) show(el, el._fits[0]); }); });
    addEventListener('afterprint', fit);
  }

  function setup(fig) {
    var legend = fig.querySelector('.p-legend');
    if (!legend || fig.getAttribute('data-live')) return;
    var items = [].slice.call(legend.querySelectorAll('li[data-i]'));
    if (items.length < 2) return;
    var pie = legend.classList.contains('p-legend--pie');
    var off = {};
    fig.setAttribute('data-live', '1');
    legend.removeAttribute('aria-hidden');
    legend.classList.add('is-live');
    items.forEach(function (li) {
      var i = li.getAttribute('data-i');
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-pressed', 'true');
      var toggle = function () {
        var shown = items.filter(function (x) { return !off[x.getAttribute('data-i')]; }).length;
        if (!off[i] && shown < 2) return; // one series or slice always stays
        off[i] = !off[i];
        li.classList.toggle('is-off', off[i]);
        li.setAttribute('aria-pressed', String(!off[i]));
        if (pie) drawPie(fig, items, off);
        else [].forEach.call(fig.querySelectorAll('.p-chart-svg [data-s="' + i + '"]'), function (el) { el.style.display = off[i] ? 'none' : ''; });
      };
      li.addEventListener('click', toggle);
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  function fmt(fig, v, compact) {
    var f = {};
    try { f = JSON.parse(fig.getAttribute('data-fmt') || '{}'); } catch (e) { f = {}; }
    var a = Math.abs(v), s;
    if (compact && a >= 1e3) {
      var d = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1e3, 'k'];
      s = +(a / d[0]).toFixed(2) + d[1];
    } else s = a.toLocaleString(f.l || 'en-GB', { maximumFractionDigits: 2 });
    return (f.p || '') + s + (f.u || '');
  }

  function drawPie(fig, items, off) {
    var svg = fig.querySelector('.p-chart-svg');
    var donut = fig.classList.contains('p-chart--donut');
    var c = 120, r = 112, ir = donut ? 72 : 0;
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    var at = function (a, rad) { return r1(c + rad * Math.cos(a)) + ' ' + r1(c + rad * Math.sin(a)); };
    var old = svg.querySelectorAll('[data-i], text.c-pct');
    [].forEach.call(old, function (el) { el.parentNode.removeChild(el); });
    var on = items.filter(function (li) { return !off[li.getAttribute('data-i')]; });
    var total = on.reduce(function (t, li) { return t + Number(li.getAttribute('data-v')); }, 0);
    var pct = function (v) {
      var p = (v / total) * 100;
      return p > 0 && p < 1 ? '<1%' : +p.toFixed(p < 10 ? 1 : 0) + '%';
    };
    var before = svg.querySelector('text.c-total');
    var add = function (el) { svg.insertBefore(el, before); };
    var a = -Math.PI / 2;
    on.forEach(function (li) {
      var v = Number(li.getAttribute('data-v'));
      var frac = v / total, b2 = a + frac * 2 * Math.PI, big = frac > 0.5 ? 1 : 0;
      var el;
      if (frac > 0.9999) {
        el = document.createElementNS(NS, 'circle');
        el.setAttribute('cx', c);
        el.setAttribute('cy', c);
        if (donut) {
          el.setAttribute('class', 'c-ring');
          el.setAttribute('r', (r + ir) / 2);
          el.setAttribute('stroke-width', r - ir);
        } else {
          el.setAttribute('fill', 'currentColor');
          el.setAttribute('r', r);
        }
      } else {
        el = document.createElementNS(NS, 'path');
        el.setAttribute('class', 'c-slice');
        el.setAttribute('fill', 'currentColor');
        el.setAttribute('d', 'M' + at(a, r) + 'A' + r + ' ' + r + ' 0 ' + big + ' 1 ' + at(b2, r) + (donut ? 'L' + at(b2, ir) + 'A' + ir + ' ' + ir + ' 0 ' + big + ' 0 ' + at(a, ir) : 'L' + c + ' ' + c) + 'Z');
      }
      el.setAttribute('data-hue', li.getAttribute('data-hue'));
      el.setAttribute('data-i', li.getAttribute('data-i'));
      var t = document.createElementNS(NS, 'title');
      t.textContent = li.querySelector('span').textContent + ': ' + li.querySelector('b').textContent + ' (' + pct(v) + ')';
      el.appendChild(t);
      add(el);
      li.querySelector('em').textContent = pct(v);
      if (frac >= (donut ? 0.08 : 0.06)) {
        var mid = (a + b2) / 2, rad = donut ? (r + ir) / 2 : r * 0.64;
        var label = document.createElementNS(NS, 'text');
        label.setAttribute('x', r1(c + rad * Math.cos(mid)));
        label.setAttribute('y', r1(c + rad * Math.sin(mid) + 4));
        label.setAttribute('font-size', donut ? 11 : 12);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'c-pct');
        label.textContent = pct(v);
        add(label);
      }
      a = b2;
    });
    items.forEach(function (li) { if (off[li.getAttribute('data-i')]) li.querySelector('em').textContent = ''; });
    var sum = fig.querySelector('text.c-total');
    if (sum) sum.textContent = fmt(fig, total, total >= 1e5);
    var row = fig.querySelector('.p-legend--pie .is-total b');
    if (row) row.textContent = fmt(fig, total, false);
  }
}

// --- markdown ----------------------------------------------------------------

const cell = (v) => mi(v).replace(/\|/g, '\\|');
const mdTable = (head, rows) => [`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];

/** Markdown lines for a chart, gantt or matrix block (a list or table equivalent). */
export function chartMarkdown(b) {
  if (b.type === 'gantt') {
    const g = resolveGantt(b);
    const rows = ganttTable(g);
    const head = [S.task, S.group, S.start, S.end, S.after];
    const keep = head.map((_, c) => c !== 1 || g.groups.length).map((x, c) => (c === 4 ? rows.some((r) => r[4]) : x));
    const pick = (r) => r.filter((_, c) => keep[c]);
    const out = mdTable(pick(head), rows.map(pick));
    const today = typeof b.today === 'string' ? parseDay(b.today) : null;
    if (today !== null) out.push('', `*${S.today}: ${fmtDay(today)}*`);
    return out;
  }
  if (b.type === 'matrix') {
    const grid = matrixGrid(b);
    const ax = axisOf(b.x, grid);
    const ay = axisOf(b.y, grid);
    const items = list(b.items).filter((it) => it && isNum(it.x) && isNum(it.y));
    const out = [];
    if (ax.label || ay.label) out.push(`*${mi(ax.label || 'x')} × ${mi(ay.label || 'y')}*`, '');
    if (grid === 2) {
      const qs = quadrantOf(b);
      const midX = (ax.min + ax.max) / 2;
      const midY = (ay.min + ay.max) / 2;
      [0, 1, 2, 3].forEach((q) => {
        const inQ = items.filter((it) => (it.x >= midX ? 1 : 0) === q % 2 && (it.y >= midY ? 0 : 1) === Math.floor(q / 2));
        out.push(`- **${mi(qs[q]?.title || S.quadrants[q])}:** ${inQ.length ? inQ.map((it) => mi(it.label)).join(', ') : '-'}`);
      });
      return out;
    }
    const head = [`${ay.label || 'y'} \\ ${ax.label || 'x'}`, ...Array.from({ length: grid }, (_, i) => ax.labels?.[i] ?? String(i + 1))];
    const rows = [];
    for (let cy = grid; cy >= 1; cy--)
      rows.push([ay.labels?.[cy - 1] ?? String(cy), ...Array.from({ length: grid }, (_, i) => items.filter((it) => Math.round(it.x) === i + 1 && Math.round(it.y) === cy).map((it) => String(it.label)).join(', '))]);
    return [...out, ...mdTable(head, rows)];
  }
  // chart
  const kind = CHART_KINDS.includes(b.kind) ? b.kind : 'bar';
  const { cats, series } = chartSeries(b);
  if (Array.isArray(b.series) && Array.isArray(b.categories)) return mdTable(['', ...series.map((s) => s.name)], cats.map((c, j) => [c, ...series.map((s) => (s.values[j] === null ? '' : fmtValue(s.values[j], b, { ascii: true })))]));
  const vals = series[0]?.values || [];
  if (kind === 'pie' || kind === 'donut') {
    const total = vals.filter((v) => v > 0).reduce((a, v) => a + v, 0);
    const pct = (v) => (total > 0 ? ` (${+((v / total) * 100).toFixed(1)}%)` : '');
    return [...cats.map((c, j) => `- ${mi(c)}: ${fmtValue(vals[j], b, { ascii: true })}${pct(vals[j])}`), `- **${S.total}:** ${fmtValue(total, b, { ascii: true })}`];
  }
  return cats.map((c, j) => `- ${mi(c)}: ${fmtValue(vals[j], b, { ascii: true })}`);
}

// --- validation --------------------------------------------------------------

/** Block shape checks used by the validator (page/block-invalid when false). */
export const CHART_NEEDS = {
  chart: (b) =>
    (Array.isArray(b.data) && b.data.length > 0 && b.data.every((d) => d?.label !== undefined && d.label !== '' && isNum(d.value))) ||
    (Array.isArray(b.categories) && b.categories.length > 0 && Array.isArray(b.series) && b.series.length > 0 &&
      b.series.every((s) => s && typeof s === 'object' && s.name !== undefined && Array.isArray(s.values) && s.values.every((v) => v === null || isNum(v)))),
  gantt: (b) => Array.isArray(b.items) && b.items.length > 0 && b.items.every((i) => i && typeof i === 'object' && typeof i.title === 'string' && i.title.trim()),
  matrix: (b) =>
    Array.isArray(b.items) && b.items.every((i) => i && typeof i === 'object' && i.label !== undefined && isNum(i.x) && isNum(i.y)) &&
    (b.grid === undefined || (Number.isInteger(b.grid) && b.grid >= 2 && b.grid <= 5))
};

export const CHART_SHAPES = {
  chart: 'data: [{ label, value (number) }], or categories: [..] with series: [{ name, values: [numbers or null] }]',
  gantt: 'items: [{ title, start?, end? | days?, after?, milestone? }]',
  matrix: 'items: [{ label, x (number), y (number) }] and grid 2-5 (default 2)'
};

/** Findings beyond the block shape: lengths, limits, ranges, dates and dependencies. */
export function checkChartBlock(b) {
  const out = [];
  const add = (level, code, message) => out.push({ level, code, message });
  if (b.type === 'chart') {
    const kind = b.kind ?? 'bar';
    if (!CHART_KINDS.includes(kind)) add('error', 'page/chart-kind', `kind "${kind}" is not a chart kind; use one of: ${CHART_KINDS.join(', ')}.`);
    const multi = Array.isArray(b.series);
    if (multi && !Array.isArray(b.categories)) add('error', 'page/chart-mismatch', 'series needs categories: the x-axis labels, one per value.');
    if (multi && (kind === 'pie' || kind === 'donut')) add('error', 'page/chart-kind', `${kind} charts take data: [{ label, value }], not series.`);
    if (multi && Array.isArray(b.categories))
      b.series.forEach((s, i) => {
        if (Array.isArray(s?.values) && s.values.length !== b.categories.length)
          add('error', 'page/chart-mismatch', `series[${i}] "${s.name}" has ${s.values.length} values for ${b.categories.length} categories.`);
      });
    if (multi && b.series.length > CHART_LIMITS.series) add('warning', 'page/chart-too-many-series', `${b.series.length} series; keep to ${CHART_LIMITS.series} or fewer so colours stay distinct.`);
    const n = multi ? list(b.categories).length : list(b.data).length;
    const cap = kind === 'pie' || kind === 'donut' ? CHART_LIMITS.slices : kind === 'line' || kind === 'area' ? CHART_LIMITS.linePoints : CHART_LIMITS.bandPoints;
    if (n > cap) add('warning', 'page/chart-too-many-points', `${n} ${kind === 'pie' || kind === 'donut' ? 'slices' : 'points'} in a ${kind} chart; keep to ${cap} (group the rest as "Other" or use a table).`);
    if (kind === 'pie' || kind === 'donut') {
      const vals = list(b.data).map((d) => d?.value).filter(isNum);
      if (vals.some((v) => v < 0)) add('error', 'page/chart-negative', `${kind} charts need values of 0 or more; use a column or bar chart for negative numbers.`);
      else if (vals.length && !vals.some((v) => v > 0)) add('error', 'page/chart-negative', `${kind} chart values add up to 0.`);
    }
    if (b.stacked !== undefined && typeof b.stacked !== 'boolean') add('warning', 'page/chart-kind', 'stacked must be true or false.');
  }
  if (b.type === 'gantt') {
    const g = resolveGantt(b);
    out.push(...g.problems);
    if (list(b.items).length > CHART_LIMITS.tasks) add('warning', 'page/chart-too-many-points', `${b.items.length} tasks; keep a page plan to ${CHART_LIMITS.tasks} (group the detail into phases).`);
    if (b.today !== undefined && !(isNum(b.today) || parseDay(b.today) !== null)) add('error', 'page/gantt-date', `today "${b.today}" is not a date; use YYYY-MM-DD or DD/MM/YYYY.`);
  }
  if (b.type === 'matrix') {
    const grid = matrixGrid(b);
    const ax = axisOf(b.x, grid);
    const ay = axisOf(b.y, grid);
    if (b.quadrants !== undefined && (grid !== 2 || !Array.isArray(b.quadrants) || b.quadrants.length !== 4))
      add('error', 'page/chart-mismatch', 'quadrants needs exactly 4 titles (top left, top right, bottom left, bottom right) and grid 2.');
    for (const [name, a] of [['x', ax], ['y', ay]]) if (a.labels && a.labels.length !== grid) add('error', 'page/chart-mismatch', `${name}.labels has ${a.labels.length} labels for a grid of ${grid}.`);
    list(b.items).forEach((it, i) => {
      if (!it || !isNum(it.x) || !isNum(it.y)) return;
      if (it.x < ax.min || it.x > ax.max || it.y < ay.min || it.y > ay.max)
        add('warning', 'page/chart-out-of-range', `items[${i}] "${it.label}" (${it.x}, ${it.y}) is outside ${ax.min}-${ax.max} × ${ay.min}-${ay.max}; it is drawn at the edge.`);
    });
    if (grid === 2 && list(b.items).length > CHART_LIMITS.matrixItems) add('warning', 'page/chart-too-many-points', `${b.items.length} items in a 2x2; keep to ${CHART_LIMITS.matrixItems} so labels stay readable.`);
  }
  if (b.type === 'metrics')
    list(b.items).forEach((it, i) => {
      if (it?.trend === undefined) return;
      if (!Array.isArray(it.trend) || it.trend.length < 2 || !it.trend.every(isNum)) add('error', 'page/block-invalid', `items[${i}] "${it.label}" trend must be a list of at least 2 numbers.`);
      else if (it.trend.length > CHART_LIMITS.trend) add('warning', 'page/chart-too-many-points', `items[${i}] "${it.label}" trend has ${it.trend.length} points; keep to ${CHART_LIMITS.trend}.`);
    });
  return out;
}

/** Chart, gantt, matrix and sparkline styles (appended to the page block styles). */
export const CHART_CSS = `
.p-chart{margin:0;--c-bg:var(--y-bg)}
.p-chart-svg [data-hue],.p-spark[data-hue]{color:var(--y-hue)}
.p-chart>.p-scroll{padding:2px 0}
.p-chart-svg{display:block;width:100%;height:auto;margin:0 auto;overflow:visible}
.p-chart-svg text{fill:var(--y-ink-3);font-family:inherit;font-variant-numeric:tabular-nums}
.p-chart-svg .c-grid{stroke:var(--y-border);stroke-width:1}
.p-chart-svg .c-zero{stroke:var(--y-ink-3);stroke-width:1.2}
.p-chart-svg text.c-val{fill:var(--y-ink-2);font-weight:600}
.p-chart-svg text.c-cat,.p-chart-svg text.c-task,.p-chart-svg text.c-pt{fill:var(--y-ink)}
.p-chart-svg text.c-group,.p-chart-svg text.c-axis{fill:var(--y-ink-2);font-weight:700}
.p-chart-svg text.c-qt{fill:var(--y-ink-2);font-weight:700;letter-spacing:.02em}
.p-chart-svg text.c-total{fill:var(--y-ink);font-weight:700;letter-spacing:-.02em}
.p-chart-svg text.c-pct{fill:var(--y-surface);font-weight:700}
.p-chart-svg .c-line{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.p-chart-svg .c-area{fill:currentColor;fill-opacity:.14;stroke:none}
.p-chart-svg .c-area.is-stacked{fill-opacity:.55}
.p-chart-svg .c-mark{fill:currentColor;stroke:var(--c-bg);stroke-width:1.5}
.p-chart-svg .c-slice{stroke:var(--c-bg);stroke-width:2;stroke-linejoin:round}
.p-chart-svg .c-ring{fill:none;stroke:currentColor}
.p-chart-svg .c-weekend{fill:var(--y-surface-2)}
.p-chart-svg .c-track{fill-opacity:.32}
.p-chart-svg .c-span{fill:none;stroke:var(--y-ink-2);stroke-width:2}
.p-chart-svg .c-dep{fill:none;stroke:var(--y-ink-3);stroke-width:1.2}
.p-chart-svg .c-arrow{fill:var(--y-ink-3)}
.p-chart-svg .c-ms{fill:var(--y-ink);stroke:var(--c-bg);stroke-width:1.5}
.p-chart-svg .c-ms.is-hued{fill:currentColor}
.p-chart-svg .c-today{stroke:var(--y-accent);stroke-width:1.5;stroke-dasharray:4 3}
.p-chart-svg text.c-today-l{fill:var(--y-accent);font-weight:700}
.p-chart-svg .c-cell{fill:var(--y-surface);stroke:var(--y-border)}
.p-chart-svg .c-heat{fill:currentColor;fill-opacity:.18;stroke:none}
.p-chart-svg .c-mid{stroke:var(--y-border-strong);stroke-width:1.5}
.p-chart-svg .c-dot{fill:currentColor;stroke:var(--y-surface);stroke-width:2}
.p-chart figcaption{margin-top:8px;color:var(--y-ink-3);font-size:13px;text-align:center}
.p-legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0 0 8px!important;padding:0!important;list-style:none;color:var(--y-ink-2);font-size:13px}
.p-legend li{display:flex;align-items:center;gap:7px;margin:0;color:var(--y-ink-2)}
.p-legend i{flex:none;width:11px;height:11px;border-radius:3px;background:var(--y-hue)}
.p-legend i.is-line{width:16px;height:3px;border-radius:2px}
.p-legend.is-live li{cursor:pointer;border-radius:4px;user-select:none}
.p-legend.is-live li:hover span,.p-legend.is-live:not(.p-legend--pie) li:hover{text-decoration:underline}
.p-legend.is-live li:focus-visible{outline:2px solid var(--y-accent);outline-offset:2px}
.p-legend li.is-off{opacity:.45}
.p-legend li.is-off i{background:none;box-shadow:inset 0 0 0 1.5px var(--y-hue)}
.p-pie{display:flex;flex-wrap:wrap;align-items:center;gap:16px 32px}
.p-pie .p-chart-svg{flex:none;width:210px;max-width:100%}
.p-legend--pie{flex:1 1 240px;flex-direction:column;flex-wrap:nowrap;gap:2px;margin:0!important;font-size:14px}
.p-legend--pie li{color:var(--y-ink);display:grid;grid-template-columns:auto 1fr auto 3.4em;gap:10px;padding:5px 0;border-bottom:1px solid var(--y-border)}
.p-legend--pie b{color:var(--y-ink);font-variant-numeric:tabular-nums}
.p-legend--pie em{color:var(--y-ink-3);font-style:normal;font-variant-numeric:tabular-nums;text-align:right}
.p-legend--pie .is-total{border-bottom:0;font-weight:700}
.p-legend--pie .is-total i{visibility:hidden}
.p-spark{display:block;width:100%;height:26px;margin:6px 0 2px;overflow:visible}
.p-spark .l{fill:none;stroke:currentColor;stroke-width:1.75;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.p-spark .a{fill:currentColor;fill-opacity:.12}
@media print{.p-chart{break-inside:avoid}.p-chart .p-scroll{overflow:visible}.p-chart-svg{min-width:0!important}}
`;
