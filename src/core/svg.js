/**
 * Static SVG rendering of a scene: pure SVG (no foreignObject), so it works
 * in Node for `yantra export`, and rasterises to PNG in the browser without
 * tainting the canvas.
 */
import { CARD, LABEL, GROUP, FORK } from './layout.js';
import { END_LABEL } from './route.js';
import { TOKENS, HUES, FONT_SANS, FONT_MONO } from './theme.js';
import { ICONS, DRILL_ICON } from './icons.js';
import { sequenceLive } from './sequence.js';
import { POINT_SHAPES } from './model.js';
import { POINT_BADGE } from './tree.js';
import { escapeXml as x, textWidth } from './text.js';
import { localeOf } from './i18n.js';
import { ROWS } from './entity.js';
import { markerDef } from './notation.js';

const PAD = 40;
const HEADER = 64;
const LEGEND = 44;

/**
 * @param scene   computeScene() result
 * @param options {
 *   theme: 'light'|'dark', highlight?: { nodes:Set, edges:Set },
 *   header?: show title/description (default true),
 *   watermark?: text | false (default meta.watermark, else "Made with Yantra" in the page language),
 *   logo?: raw SVG string shown next to the watermark,
 *   locale?: localeOf() result (default: from meta.lang, meta.dir and meta.strings),
 *   idSuffix?: appended to every id (and reference) so several SVGs can share one document
 * }
 * The root carries xml:lang and direction. Right-to-left documents mirror the
 * chrome and the text inside cards (title, legend, badge, card lines, group
 * titles) but keep the diagram's layout: an LR flow still runs left to right.
 */
export function renderSvg(scene, options = {}) {
  if (scene.kind === 'sequence') return renderSequenceSvg(scene, options);
  return scoped(flowSvg(scene, options), options.idSuffix);
}

/**
 * Every id in an SVG document made unique with a suffix, with the references
 * to it (url(#..), href="#..", aria-labelledby) rewritten. Used when several
 * SVGs share one HTML document (answer pages draw each diagram twice: a light
 * and a dark copy), so no copy ever points at another copy's markers.
 */
export function scopeSvgIds(svg, suffix) {
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  if (!ids.size) return svg;
  const to = (id) => (ids.has(id) ? `${id}-${suffix}` : id);
  return svg
    .replace(/(\sid=")([^"]+)"/g, (_, a, id) => `${a}${to(id)}"`)
    .replace(/url\(#([^)\s]+)\)/g, (_, id) => `url(#${to(id)})`)
    .replace(/(\s(?:xlink:)?href=")#([^"]+)"/g, (_, a, id) => `${a}#${to(id)}"`)
    .replace(/(\saria-(?:labelledby|describedby)=")([^"]+)"/g, (_, a, list) => `${a}${list.split(/\s+/).map(to).join(' ')}"`);
}

const scoped = (svg, suffix) => (suffix ? scopeSvgIds(svg, String(suffix)) : svg);

function flowSvg(scene, options) {
  const { theme = 'light', header = true, watermark, logo = null } = options;
  const highlight = folded(options.highlight || null, scene.collapse);
  const t = TOKENS[theme] || TOKENS.light;
  const L = options.locale || localeOf(scene.model.meta);
  const rtl = L.dir === 'rtl';
  const hue = (name) => ((typeof name === 'string' && Object.hasOwn(HUES, name) ? HUES[name] : HUES.slate))[theme === 'dark' ? 'dark' : 'light'];
  const b = scene.bounds;
  const meta = scene.model.meta;
  // Mind maps colour by branch, so a roles legend would not match the cards
  const roles = scene.branchColors ? [] : Object.entries(scene.model.roles).filter(([type]) => scene.nodes.some((n) => (n.node.type || 'node') === type));

  const mark = watermark ?? meta.watermark;
  const markText = mark === false ? '' : typeof mark === 'string' ? mark : L.t('watermark.text');
  const headerH = header ? HEADER : 0;
  const footer = roles.length || markText;
  const width = Math.ceil(b.w + PAD * 2);
  const height = Math.ceil(b.h + PAD * 2 + headerH + (footer ? LEGEND : 0));
  const ox = PAD - b.x;
  const oy = PAD + headerH - b.y;

  const active = (kind, id) => !highlight || highlight[kind].has(id);
  const focus = highlight && (highlight.nodes.size || highlight.edges.size);
  const hueOf = new Map(scene.nodes.map((n) => [n.id, n.hue]));
  const usedHues = new Set();
  const gradients = [];
  // Notation markers (UML heads, ER cardinality): one <marker> per kind and colour used
  const notation = new Map();
  const endMarker = (kind, hueName) => {
    if (!kind) return '';
    const id = `end-${theme}-${kind}${hueName ? `-${hueName}` : ''}`;
    if (!notation.has(id)) notation.set(id, markerDef(id, kind, hueName ? hue(hueName) : t.edge, t.bg));
    return `url(#${id})`;
  };

  // Active edges run from the source role colour to the target role colour
  const edges = scene.edges
    .map((e, i) => {
      const on = focus && active('edges', e.id);
      const dash = e.dotted ? ' stroke-dasharray="2 4"' : e.dashed ? ' stroke-dasharray="6 5"' : '';
      let stroke = t.edge;
      // Markers at both ends come from the scene: arrowheads (edge `arrow`) or notation
      const start = e.start !== undefined ? e.start : e.arrow === 'both' ? 'arrow' : null;
      const end = e.end !== undefined ? e.end : e.arrow === 'none' ? null : 'arrow';
      // Mind maps draw every connector in its branch colour, not only active ones
      const branch = scene.branchColors ? hueOf.get(e.edge.target) || 'slate' : null;
      if (branch) stroke = hue(branch);
      const from = on ? hueOf.get(e.edge.source) || 'slate' : branch;
      const to = on ? hueOf.get(e.edge.target) || 'slate' : branch;
      if (on) {
        const a = e.points[0];
        const b = e.points[e.points.length - 1];
        const x2 = b.x === a.x && b.y === a.y ? b.x + 1 : b.x;
        gradients.push(`<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${x2}" y2="${b.y}"><stop offset="0" stop-color="${hue(from)}"/><stop offset="1" stop-color="${hue(to)}"/></linearGradient>`);
        stroke = `url(#g${i})`;
      }
      const head = (kind, hueName) => {
        if (kind !== 'arrow') return endMarker(kind, hueName);
        if (hueName) usedHues.add(hueName);
        return `url(#${hueName ? `arrow-${hueName}` : 'arrow'})`;
      };
      const ms = head(start, from);
      const me = head(end, to);
      return `<path d="${e.d}" fill="none" stroke="${stroke}" stroke-width="${on ? 2.25 : 1.5}"${dash}${ms ? ` marker-start="${ms}"` : ''}${me ? ` marker-end="${me}"` : ''} opacity="${focus && !on ? 0.2 : 1}"/>`;
    })
    .join('\n    ');

  const labels = scene.edges
    .filter((e) => e.label)
    .map((e) => {
      const l = e.label;
      const on = focus && active('edges', e.id);
      const border = on ? hue(hueOf.get(e.edge.source)) : t.border;
      return `<g opacity="${focus && !on ? 0.3 : 1}"><rect x="${l.x - l.w / 2}" y="${l.y - l.h / 2}" width="${l.w}" height="${l.h}" rx="${l.h / 2}" fill="${t.bg}" stroke="${border}"/>` +
        `<text x="${l.x}" y="${l.y + 4}" text-anchor="middle" font-size="${LABEL.size}" font-weight="500" fill="${on ? t.ink : t.ink2}">${x(e.edge.label)}</text></g>`;
    })
    .join('\n    ');

  // End labels (multiplicities, roles): small text on a background patch beside each end
  const endLabels = scene.edges
    .flatMap((e) => [e.sourceLabel, e.targetLabel].filter(Boolean).map((l) => [e, l]))
    .map(([e, l]) => {
      const on = focus && active('edges', e.id);
      return `<g opacity="${focus && !on ? 0.3 : 1}"><rect x="${l.x - l.w / 2}" y="${l.y - l.h / 2}" width="${l.w}" height="${l.h}" rx="3" fill="${t.bg}"/>` +
        `<text x="${l.x}" y="${l.y + 3.5}" text-anchor="middle" font-size="${END_LABEL.size}" font-weight="500" fill="${on ? t.ink : t.ink2}">${x(l.text)}</text></g>`;
    })
    .join('\n    ');

  // Group boxes sit behind everything; a box dims when none of its members is active
  const groupHue = new Map((scene.groups || []).map((g) => [g.id, g.hue]));
  const groups = (scene.groups || [])
    .map((g) => {
      const c = hue(g.hue);
      const on = !focus || g.members.some((id) => highlight.nodes.has(id));
      const dash = g.dashed ? ' stroke-dasharray="5 4"' : '';
      if (g.region) {
        // A concurrent region: its title and the dashed divider before it, in the parent's colour
        const d = g.divider;
        const line = d ? `<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="${hue(groupHue.get(g.parent) || g.hue)}" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="6 4"/>` : '';
        return `<g opacity="${on ? 1 : 0.35}">${line}${groupTitle(g, c, rtl)}</g>`;
      }
      return `<g opacity="${on ? 1 : 0.35}"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${GROUP.radius}" fill="${c}" fill-opacity="${theme === 'dark' ? 0.07 : 0.045}" stroke="${c}" stroke-opacity="0.55"${dash}/>` +
        `${groupTitle(g, c, rtl)}</g>`;
    })
    .join('\n    ');

  const nodes = scene.nodes.map((n) => nodeSvg(n, t, hue(n.hue), focus ? active('nodes', n.id) : null, rtl, L)).join('\n    ');

  const defs = `${[...usedHues].map((h) => arrowMarker(`arrow-${h}`, hue(h))).join('')}${[...notation.values()].join('')}
    ${gradients.join('')}`;
  return frame({ scene, t, hue, roles, markText, logo, header, width, height, defs, body: [groups, edges, nodes, labels, endLabels], ox, oy, L });
}

/** Document shell shared by the flow and sequence exports: title, legend, watermark. */
function frame({ scene, t, hue, roles, markText, logo, header, width, height, defs, body, ox, oy, L }) {
  const meta = scene.model.meta;
  const rtl = L.dir === 'rtl';
  // RTL: title and legend start at the right; "start"-anchored text then grows leftwards
  const sx = rtl ? -1 : 1;
  const edge = rtl ? width - PAD : PAD;
  const legend = roles.length
    ? (() => {
        let lx = edge;
        const ly = height - LEGEND / 2 - 4;
        return roles
          .map(([, role]) => {
            const label = x(role.label);
            const out = `<circle cx="${lx + sx * 4}" cy="${ly - 4}" r="4" fill="${hue(role.hue)}"/><text x="${lx + sx * 14}" y="${ly}" font-size="12" fill="${t.ink2}">${label}</text>`;
            lx += sx * (30 + textWidth(role.label, 12));
            return out;
          })
          .join('');
      })()
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xml:lang="${x(L.lang)}" direction="${L.dir}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${x(FONT_SANS)}" role="img" aria-labelledby="y-title y-desc">
  <title id="y-title">${x(meta.title || L.t('export.diagram'))}</title>
  <desc id="y-desc">${x(meta.description || '')}</desc>
  <defs>
    ${arrowMarker('arrow', t.edge)}
    ${defs}
  </defs>
  <rect width="100%" height="100%" fill="${t.bg}"/>
  ${header ? `<text x="${edge}" y="${PAD + 8}" font-size="20" font-weight="650" fill="${t.ink}">${x(meta.title || '')}</text>` : ''}
  ${header && meta.description ? `<text x="${edge}" y="${PAD + 32}" font-size="13" fill="${t.ink3}">${x(meta.description)}</text>` : ''}
  <g transform="translate(${ox} ${oy})">
    ${body.filter(Boolean).join('\n    ')}
  </g>
  ${legend}
  ${markText ? watermarkSvg(markText, logo, width, height, t, rtl) : ''}
</svg>
`;
}

/** marker-start / marker-end attributes for an edge's arrow setting. */
const arrowHeads = (arrow, start, end) =>
  (arrow === 'both' ? ` marker-start="url(#${start})"` : '') + (arrow === 'none' ? '' : ` marker-end="url(#${end})"`);

const arrowMarker = (id, fill) => `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 10 5 0 9z" fill="${fill}"/></marker>`;

/**
 * Sequence view (computeSequenceScene): headers, lifelines, numbered step rows
 * and messages. `step` (0-based) highlights that row and dims the others.
 */
export function renderSequenceSvg(scene, options = {}) {
  return scoped(sequenceSvg(scene, options), options.idSuffix);
}

function sequenceSvg(scene, { theme = 'light', step = null, header = true, watermark, logo = null, locale = null } = {}) {
  const t = TOKENS[theme] || TOKENS.light;
  const L = locale || localeOf(scene.model.meta);
  const rtl = L.dir === 'rtl';
  const dark = theme === 'dark';
  const hue = (name) => ((typeof name === 'string' && Object.hasOwn(HUES, name) ? HUES[name] : HUES.slate))[dark ? 'dark' : 'light'];
  const b = scene.bounds;
  const meta = scene.model.meta;
  const roles = Object.entries(scene.model.roles).filter(([type]) => scene.participants.some((n) => (n.node.type || 'node') === type));
  const mark = watermark ?? meta.watermark;
  const markText = mark === false ? '' : typeof mark === 'string' ? mark : L.t('watermark.text');
  const headerH = header ? HEADER : 0;
  const footer = roles.length || markText;
  const width = Math.ceil(b.w + PAD * 2);
  const height = Math.ceil(b.h + PAD * 2 + headerH + (footer ? LEGEND : 0));
  const ox = PAD - b.x;
  const oy = PAD + headerH - b.y;

  const current = Number.isInteger(step) && scene.rows[step] ? step : null;
  const focus = current !== null;
  const hueOf = new Map(scene.participants.map((p) => [p.id, p.hue]));
  const live = sequenceLive(scene, current);
  const usedHues = new Set();
  const gradients = [];

  const rows = scene.rows
    .map((r, i) => {
      const on = i === current;
      const band = on
        ? `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${t.accentSoft}"/><rect x="${r.x}" y="${r.y}" width="3" height="${r.h}" fill="${t.accent}"/>`
        : i % 2
          ? `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${t.surface2}" fill-opacity="0.6"/>`
          : '';
      const cy = r.y + 26;
      const badge = `<circle cx="24" cy="${cy}" r="11" fill="${on ? t.accent : t.surface}" stroke="${on ? t.accent : t.border}"/>` +
        `<text x="24" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${on ? t.accentInk : t.ink2}">${i + 1}</text>`;
      return `<g>${band}${badge}</g>`;
    })
    .join('\n    ');

  const groups = scene.groups
    .map((g) => {
      const c = hue(g.hue);
      const dash = g.dashed ? ' stroke-dasharray="5 4"' : '';
      return `<g><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${GROUP.radius}" fill="${c}" fill-opacity="${dark ? 0.07 : 0.045}" stroke="${c}" stroke-opacity="0.55"${dash}/>` +
        `${groupTitle(g, c, rtl)}</g>`;
    })
    .join('\n    ');

  const lifelines = scene.participants
    .map((p) => `<line x1="${p.cx}" y1="${scene.lifeline.y1}" x2="${p.cx}" y2="${scene.lifeline.y2}" stroke="${hue(p.hue)}" stroke-opacity="${focus && !live.has(p.id) ? 0.25 : 0.55}" stroke-width="1.5" stroke-dasharray="4 4"/>`)
    .join('\n    ');

  const messages = scene.messages
    .map((m, i) => {
      const on = !focus || m.step === current;
      const dash = m.dotted ? ' stroke-dasharray="2 4"' : m.dashed ? ' stroke-dasharray="6 5"' : '';
      const from = hueOf.get(m.source) || 'slate';
      const to = hueOf.get(m.target) || 'slate';
      const a = m.points[0];
      const z = m.points[m.points.length - 1];
      let stroke = t.edge;
      let marker = 'arrow';
      let startMarker = 'arrow';
      if (on) {
        gradients.push(`<linearGradient id="sg${i}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${z.x === a.x ? z.x + 1 : z.x}" y2="${z.y}"><stop offset="0" stop-color="${hue(from)}"/><stop offset="1" stop-color="${hue(to)}"/></linearGradient>`);
        usedHues.add(to);
        if (m.arrow === 'both') usedHues.add(from);
        stroke = `url(#sg${i})`;
        marker = `arrow-${to}`;
        startMarker = `arrow-${from}`;
      }
      const l = m.label;
      const pill = `<rect x="${l.x - l.w / 2}" y="${l.y - l.h / 2}" width="${l.w}" height="${l.h}" rx="${l.h / 2}" fill="${t.bg}" stroke="${on && focus ? hue(from) : t.border}"/>` +
        `<text x="${l.x}" y="${l.y + 4}" text-anchor="middle" font-size="${LABEL.size}" font-weight="500" fill="${on ? t.ink : t.ink2}">${x(m.text)}</text>`;
      return `<g opacity="${on ? 1 : 0.3}"><path d="${m.d}" fill="none" stroke="${stroke}" stroke-width="${on && focus ? 2.25 : 1.75}"${dash}${arrowHeads(m.arrow, startMarker, marker)}/>${pill}</g>`;
    })
    .join('\n    ');

  const notes = scene.rows
    .filter((r) => r.note)
    .map((r) => {
      const n = r.note;
      const on = !focus || r.index === current;
      return `<g opacity="${on ? 1 : 0.4}"><rect x="${n.x - n.w / 2}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="6" fill="${t.surface}" stroke="${t.borderStrong}" stroke-dasharray="4 3"/>` +
        `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" font-size="${LABEL.size}" font-weight="500" fill="${t.ink2}">${x(n.text)}</text></g>`;
    })
    .join('\n    ');

  const heads = scene.participants.map((p) => nodeSvg(p, t, hue(p.hue), focus ? live.has(p.id) : null, rtl, L)).join('\n    ');
  const defs = `${[...usedHues].map((h) => arrowMarker(`arrow-${h}`, hue(h))).join('')}
    ${gradients.join('')}`;
  return frame({ scene, t, hue, roles, markText, logo, header, width, height, defs, body: [rows, groups, lifelines, notes, messages, heads], ox, oy, L });
}


/** "Made with Yantra" badge in the bottom-right corner (bottom-left, logo on the right, when RTL). */
function watermarkSvg(text, logo, width, height, t, rtl) {
  const tw = Math.ceil(textWidth(text, 11.5, { weight: 600 }));
  const logoW = logo ? 22 : 0;
  const w = tw + logoW + 20;
  const bx = rtl ? PAD : width - PAD - w;
  const by = height - LEGEND / 2 - 4 - 15;
  const img = logo ? `<image x="${rtl ? bx + w - 22 : bx + 6}" y="${by + 4}" width="16" height="16" href="data:image/svg+xml,${encodeURIComponent(logo)}"/>` : '';
  return `<g opacity="0.9"><rect x="${bx}" y="${by}" width="${w}" height="24" rx="12" fill="${t.surface}" stroke="${t.border}"/>${img}<text x="${rtl ? bx + w - 10 - logoW : bx + 10 + logoW}" y="${by + 16}" font-size="11.5" font-weight="600" fill="${t.ink2}">${x(text)}</text></g>`;
}

/** Group title in the box's top-left corner (top-right when RTL, without letter-spacing so scripts stay joined). */
function groupTitle(g, color, rtl) {
  const tx = rtl ? g.x + g.w - GROUP.titleX : g.x + GROUP.titleX;
  return `<text x="${tx}" y="${g.y + GROUP.titleY + 11.5}" font-size="${GROUP.titleSize}" font-weight="600"${rtl ? '' : ' letter-spacing="0.06em"'} fill="${color}">${x(g.label)}</text>`;
}

/** Pseudo-states: a filled dot (initial), a ringed dot (final), a diamond (choice), a fork / join bar. */
function pointSvg(n, t, hueColor, isActive, L = localeOf()) {
  if (n.shape === 'fork') {
    // Fork / join bar across the middle of its box
    const v = n.h > n.w;
    const k = FORK.thick;
    const bar = v ? { x: n.w / 2 - k / 2, y: 0, w: k, h: n.h } : { x: 0, y: n.h / 2 - k / 2, w: n.w, h: k };
    const glow = isActive ? `<rect x="${bar.x - 3}" y="${bar.y - 3}" width="${bar.w + 6}" height="${bar.h + 6}" rx="${k / 2 + 3}" fill="none" stroke="${hueColor}" stroke-opacity="0.22" stroke-width="3"/>` : '';
    return `<g transform="translate(${n.x} ${n.y})" opacity="${isActive === false ? 0.25 : 1}"><title>${x(n.node.data?.title || n.id)}</title>${glow}<rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" rx="${k / 2}" fill="${hueColor}"/>${foldChip(n, t, hueColor, false, L, POINT_BADGE)}</g>`;
  }
  const r = n.w / 2;
  const ring = isActive ? (n.shape === 'choice'
    ? `<polygon points="${r},-4 ${n.w + 4},${r} ${r},${n.h + 4} -4,${r}" fill="none" stroke="${hueColor}" stroke-opacity="0.22" stroke-width="3"/>`
    : `<circle cx="${r}" cy="${r}" r="${r + 3}" fill="none" stroke="${hueColor}" stroke-opacity="0.22" stroke-width="3"/>`) : '';
  const body =
    n.shape === 'initial' ? `<circle cx="${r}" cy="${r}" r="${r}" fill="${hueColor}"/>` :
    n.shape === 'final' ? `<circle cx="${r}" cy="${r}" r="${r - 1}" fill="${t.surface}" stroke="${hueColor}" stroke-width="2"/><circle cx="${r}" cy="${r}" r="${r - 5}" fill="${hueColor}"/>` :
    `<polygon points="${r},0 ${n.w},${r} ${r},${n.h} 0,${r}" fill="${t.surface}" stroke="${hueColor}" stroke-width="${isActive ? 2 : 1.5}" stroke-linejoin="round"/>`;
  return `<g transform="translate(${n.x} ${n.y})" opacity="${isActive === false ? 0.25 : 1}"><title>${x(n.node.data?.title || n.id)}</title>${ring}${body}${foldChip(n, t, hueColor, false, L, POINT_BADGE)}</g>`;
}

/** +N chip of a folded subtree or group, centred on the toggle side (`off` px outside it for pseudo-states). */
function foldChip(n, t, hueColor, rtl, L, off = 0) {
  if (!n.collapsed) return '';
  const text = `+${L.num(n.collapsed)}`;
  const cw = Math.ceil(textWidth(text, 11, { weight: 600 })) + 14;
  const at = { bottom: [n.w / 2, n.h + off], right: [n.w + off, n.h / 2], left: [-off, n.h / 2], corner: [rtl ? cw / 2 + 10 : n.w - cw / 2 - 10, 0] }[n.toggle] || [n.w / 2, n.h + off];
  return `<g transform="translate(${at[0] - cw / 2} ${at[1] - 9})"><rect width="${cw}" height="18" rx="9" fill="${hueColor}"/><text x="${cw / 2}" y="12.5" text-anchor="middle" font-size="11" font-weight="600" fill="${t.surface}">${text}</text></g>`;
}

/**
 * One card. RTL mirrors its inside (icon, kicker, lines and table rows against
 * the right padding, text anchored at "start" of the rtl root); the wrapped
 * lines and so the card height are the same in both directions.
 */
function nodeSvg(n, t, hueColor, isActive, rtl = false, L = localeOf()) {
  if (POINT_SHAPES.has(n.shape) || n.shape === 'fork') return pointSvg(n, t, hueColor, isActive, L);
  const C = CARD;
  const dim = isActive === false;
  const rx = n.shape === 'state' ? 16 : 8;
  const tx = rtl ? n.w - C.padX : C.padX;
  const lines = [];
  let y = C.padY + C.kicker + C.kickerGap;
  n.lines.title.forEach((line) => {
    lines.push(`<text x="${tx}" y="${baseline(y, C.titleLine, C.titleSize)}" font-size="${C.titleSize}" font-weight="600" fill="${t.ink}">${x(line)}</text>`);
    y += C.titleLine;
  });
  if (n.lines.subtitle.length) {
    y += C.subGap;
    n.lines.subtitle.forEach((line) => {
      lines.push(`<text x="${tx}" y="${baseline(y, C.subLine, C.subSize)}" font-size="${C.subSize}" fill="${t.ink2}">${x(line)}</text>`);
      y += C.subLine;
    });
  }
  if (n.lines.tech) {
    y += C.techGap;
    // Code-like text stays left to right on RTL cards (anchored at its right end)
    lines.push(`<text x="${tx}" y="${baseline(y, C.techLine, C.techSize)}"${rtl ? ' direction="ltr" text-anchor="end"' : ''} font-size="${C.techSize}" font-family="${x(FONT_MONO)}" fill="${t.ink3}">${x(n.lines.tech)}</text>`);
  }
  // A folded subtree or group shows how many cards it holds
  const chip = foldChip(n, t, hueColor, rtl, L);
  if (n.lines.rows) lines.push(rowsSvg(n, t, hueColor, rtl, L));
  // Cards that open a detail diagram carry the drill mark top-right, as in the viewer
  const drill = typeof n.node?.data?.drill === 'string' && n.node.data.drill
    ? `<g transform="translate(${rtl ? C.padX : n.w - C.padX - 14} ${C.padY + 1}) scale(0.5833)" fill="none" stroke="${hueColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><title>${x(L.t('drill.hasDetail'))}</title>${DRILL_ICON}</g>`
    : '';
  const ring = isActive ? `<rect x="-3" y="-3" width="${n.w + 6}" height="${n.h + 6}" rx="${rx + 3}" fill="none" stroke="${hueColor}" stroke-opacity="0.22" stroke-width="3"/>` : '';
  return `<g transform="translate(${n.x} ${n.y})" opacity="${dim ? 0.25 : 1}">
      ${ring}<rect width="${n.w}" height="${n.h}" rx="${rx}" fill="${t.surface}" stroke="${isActive ? hueColor : t.border}" stroke-width="${isActive ? 1.5 : 1}"/>
      <g transform="translate(${rtl ? n.w - C.padX - 14 : C.padX} ${C.padY + 1}) scale(0.5833)" fill="none" stroke="${hueColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${(typeof n.icon === 'string' && Object.hasOwn(ICONS, n.icon) ? ICONS[n.icon] : ICONS.cpu)}</g>
      <text x="${rtl ? n.w - C.padX - 21 : C.padX + 21}" y="${C.padY + 12}" font-size="10.5" font-weight="600"${n.stereotype ? ' font-style="italic"' : rtl ? '' : ' letter-spacing="0.06em"'} fill="${hueColor}">${x(n.stereotype ? n.kicker : String(n.kicker).toUpperCase())}</text>${drill}
      ${lines.join('\n      ')}${chip}
    </g>`;
}

/** Field / method rows of an entity or class card: a divider per section, key column, name, type on the right. */
function rowsSvg(n, t, hueColor, rtl = false, L = localeOf()) {
  const C = CARD;
  const R = ROWS;
  const { nameX, sections } = n.lines.rows;
  // RTL: key column on the right, names right-aligned, types against the left padding
  const at = (dx) => (rtl ? n.w - C.padX - dx : C.padX + dx);
  const out = [];
  for (const sec of sections) {
    out.push(`<line x1="0" y1="${sec.rule}" x2="${n.w}" y2="${sec.rule}" stroke="${t.border}"/>`);
    for (const r of sec.rows) {
      const by = baseline(r.y, R.line, R.nameSize);
      if (r.more) {
        out.push(`<text x="${at(nameX)}" y="${by}" font-size="${R.nameSize}" font-style="italic" fill="${t.ink3}">${x(L.t('card.more', { n: L.num(r.more) }))}</text>`);
        continue;
      }
      if (r.key) out.push(`<text x="${at(0)}" y="${by}" font-size="${R.keySize}" font-weight="700" font-family="${x(FONT_MONO)}" fill="${hueColor}">${x(r.key)}</text>`);
      const style = `${r.pk ? ' font-weight="600"' : ''}${r.abstract ? ' font-style="italic"' : ''}${r.static ? ' text-decoration="underline"' : ''}`;
      out.push(`<text x="${at(nameX)}" y="${by}" font-size="${R.nameSize}"${style} fill="${t.ink}">${x(r.name)}</text>`);
      if (r.type) out.push(`<text x="${rtl ? C.padX : n.w - C.padX}" y="${by}"${rtl ? ' direction="ltr" text-anchor="start"' : ' text-anchor="end"'} font-size="${R.typeSize}" font-family="${x(FONT_MONO)}" fill="${t.ink3}">${x(r.type)}</text>`);
    }
  }
  return out.join('\n      ');
}

/** Step highlights name original ids; folded cards and merged edges stand in for them. */
function folded(highlight, collapse) {
  if (!highlight || !collapse?.alias?.size) return highlight;
  const nodes = new Set([...highlight.nodes].map((id) => collapse.alias.get(id) ?? id));
  const edges = new Set();
  for (const id of highlight.edges) {
    const to = collapse.edgeAlias.has(id) ? collapse.edgeAlias.get(id) : id;
    if (to) edges.add(to);
  }
  return { ...highlight, nodes, edges };
}

const baseline = (top, lineHeight, size) => Math.round((top + (lineHeight - size) / 2 + size * 0.8) * 10) / 10;
