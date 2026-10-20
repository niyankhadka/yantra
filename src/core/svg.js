/**
 * Static SVG rendering of a scene: pure SVG (no foreignObject), so it works
 * in Node for `yantra export`, and rasterises to PNG in the browser without
 * tainting the canvas.
 */
import { CARD, LABEL, GROUP } from './layout.js';
import { TOKENS, HUES, FONT_SANS, FONT_MONO } from './theme.js';
import { ICONS, DRILL_ICON } from './icons.js';
import { sequenceLive } from './sequence.js';
import { escapeXml as x, textWidth } from './text.js';

const PAD = 40;
const HEADER = 64;
const LEGEND = 44;

/**
 * @param scene   computeScene() result
 * @param options {
 *   theme: 'light'|'dark', highlight?: { nodes:Set, edges:Set },
 *   header?: show title/description (default true),
 *   watermark?: text | false (default meta.watermark, else "Made with Yantra"),
 *   logo?: raw SVG string shown next to the watermark
 * }
 */
export function renderSvg(scene, options = {}) {
  if (scene.kind === 'sequence') return renderSequenceSvg(scene, options);
  const { theme = 'light', highlight = null, header = true, watermark, logo = null } = options;
  const t = TOKENS[theme] || TOKENS.light;
  const hue = (name) => ((typeof name === 'string' && Object.hasOwn(HUES, name) ? HUES[name] : HUES.slate))[theme === 'dark' ? 'dark' : 'light'];
  const b = scene.bounds;
  const meta = scene.model.meta;
  const roles = Object.entries(scene.model.roles).filter(([type]) => scene.nodes.some((n) => (n.node.type || 'node') === type));

  const mark = watermark ?? meta.watermark;
  const markText = mark === false ? '' : typeof mark === 'string' ? mark : 'Made with Yantra';
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

  // Active edges run from the source role colour to the target role colour
  const edges = scene.edges
    .map((e, i) => {
      const on = focus && active('edges', e.id);
      const dash = e.dotted ? ' stroke-dasharray="2 4"' : e.dashed ? ' stroke-dasharray="6 5"' : '';
      let stroke = t.edge;
      let marker = 'arrow';
      if (on) {
        const from = hueOf.get(e.edge.source) || 'slate';
        const to = hueOf.get(e.edge.target) || 'slate';
        const a = e.points[0];
        const b = e.points[e.points.length - 1];
        const x2 = b.x === a.x && b.y === a.y ? b.x + 1 : b.x;
        gradients.push(`<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${x2}" y2="${b.y}"><stop offset="0" stop-color="${hue(from)}"/><stop offset="1" stop-color="${hue(to)}"/></linearGradient>`);
        usedHues.add(to);
        stroke = `url(#g${i})`;
        marker = `arrow-${to}`;
      }
      return `<path d="${e.d}" fill="none" stroke="${stroke}" stroke-width="${on ? 2.25 : 1.5}"${dash} marker-end="url(#${marker})" opacity="${focus && !on ? 0.2 : 1}"/>`;
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

  // Group boxes sit behind everything; a box dims when none of its members is active
  const groups = (scene.groups || [])
    .map((g) => {
      const c = hue(g.hue);
      const on = !focus || g.members.some((id) => highlight.nodes.has(id));
      const dash = g.dashed ? ' stroke-dasharray="5 4"' : '';
      return `<g opacity="${on ? 1 : 0.35}"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${GROUP.radius}" fill="${c}" fill-opacity="${theme === 'dark' ? 0.07 : 0.045}" stroke="${c}" stroke-opacity="0.55"${dash}/>` +
        `<text x="${g.x + GROUP.titleX}" y="${g.y + GROUP.titleY + 11.5}" font-size="${GROUP.titleSize}" font-weight="600" letter-spacing="0.06em" fill="${c}">${x(g.label)}</text></g>`;
    })
    .join('\n    ');

  const nodes = scene.nodes.map((n) => nodeSvg(n, t, hue(n.hue), focus ? active('nodes', n.id) : null)).join('\n    ');

  const defs = `${[...usedHues].map((h) => arrowMarker(`arrow-${h}`, hue(h))).join('')}
    ${gradients.join('')}`;
  return frame({ scene, t, hue, roles, markText, logo, header, width, height, defs, body: [groups, edges, nodes, labels], ox, oy });
}

/** Document shell shared by the flow and sequence exports: title, legend, watermark. */
function frame({ scene, t, hue, roles, markText, logo, header, width, height, defs, body, ox, oy }) {
  const meta = scene.model.meta;
  const legend = roles.length
    ? (() => {
        let lx = PAD;
        const ly = height - LEGEND / 2 - 4;
        return roles
          .map(([, role]) => {
            const label = x(role.label);
            const out = `<circle cx="${lx + 4}" cy="${ly - 4}" r="4" fill="${hue(role.hue)}"/><text x="${lx + 14}" y="${ly}" font-size="12" fill="${t.ink2}">${label}</text>`;
            lx += 30 + role.label.length * 7;
            return out;
          })
          .join('');
      })()
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${x(FONT_SANS)}" role="img" aria-labelledby="y-title y-desc">
  <title id="y-title">${x(meta.title || 'Diagram')}</title>
  <desc id="y-desc">${x(meta.description || '')}</desc>
  <defs>
    ${arrowMarker('arrow', t.edge)}
    ${defs}
  </defs>
  <rect width="100%" height="100%" fill="${t.bg}"/>
  ${header ? `<text x="${PAD}" y="${PAD + 8}" font-size="20" font-weight="650" fill="${t.ink}">${x(meta.title || '')}</text>` : ''}
  ${header && meta.description ? `<text x="${PAD}" y="${PAD + 32}" font-size="13" fill="${t.ink3}">${x(meta.description)}</text>` : ''}
  <g transform="translate(${ox} ${oy})">
    ${body.filter(Boolean).join('\n    ')}
  </g>
  ${legend}
  ${markText ? watermarkSvg(markText, logo, width, height, t) : ''}
</svg>
`;
}

const arrowMarker = (id, fill) => `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 10 5 0 9z" fill="${fill}"/></marker>`;

/**
 * Sequence view (computeSequenceScene): headers, lifelines, numbered step rows
 * and messages. `step` (0-based) highlights that row and dims the others.
 */
export function renderSequenceSvg(scene, { theme = 'light', step = null, header = true, watermark, logo = null } = {}) {
  const t = TOKENS[theme] || TOKENS.light;
  const dark = theme === 'dark';
  const hue = (name) => ((typeof name === 'string' && Object.hasOwn(HUES, name) ? HUES[name] : HUES.slate))[dark ? 'dark' : 'light'];
  const b = scene.bounds;
  const meta = scene.model.meta;
  const roles = Object.entries(scene.model.roles).filter(([type]) => scene.participants.some((n) => (n.node.type || 'node') === type));
  const mark = watermark ?? meta.watermark;
  const markText = mark === false ? '' : typeof mark === 'string' ? mark : 'Made with Yantra';
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
        `<text x="${g.x + GROUP.titleX}" y="${g.y + GROUP.titleY + 11.5}" font-size="${GROUP.titleSize}" font-weight="600" letter-spacing="0.06em" fill="${c}">${x(g.label)}</text></g>`;
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
      if (on) {
        gradients.push(`<linearGradient id="sg${i}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${z.x === a.x ? z.x + 1 : z.x}" y2="${z.y}"><stop offset="0" stop-color="${hue(from)}"/><stop offset="1" stop-color="${hue(to)}"/></linearGradient>`);
        usedHues.add(to);
        stroke = `url(#sg${i})`;
        marker = `arrow-${to}`;
      }
      const l = m.label;
      const pill = `<rect x="${l.x - l.w / 2}" y="${l.y - l.h / 2}" width="${l.w}" height="${l.h}" rx="${l.h / 2}" fill="${t.bg}" stroke="${on && focus ? hue(from) : t.border}"/>` +
        `<text x="${l.x}" y="${l.y + 4}" text-anchor="middle" font-size="${LABEL.size}" font-weight="500" fill="${on ? t.ink : t.ink2}">${x(m.text)}</text>`;
      return `<g opacity="${on ? 1 : 0.3}"><path d="${m.d}" fill="none" stroke="${stroke}" stroke-width="${on && focus ? 2.25 : 1.75}"${dash} marker-end="url(#${marker})"/>${pill}</g>`;
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

  const heads = scene.participants.map((p) => nodeSvg(p, t, hue(p.hue), focus ? live.has(p.id) : null)).join('\n    ');
  const defs = `${[...usedHues].map((h) => arrowMarker(`arrow-${h}`, hue(h))).join('')}
    ${gradients.join('')}`;
  return frame({ scene, t, hue, roles, markText, logo, header, width, height, defs, body: [rows, groups, lifelines, notes, messages, heads], ox, oy });
}


/** "Made with Yantra" badge in the bottom-right corner. */
function watermarkSvg(text, logo, width, height, t) {
  const tw = Math.ceil(textWidth(text, 11.5, { weight: 600 }));
  const logoW = logo ? 22 : 0;
  const w = tw + logoW + 20;
  const bx = width - PAD - w;
  const by = height - LEGEND / 2 - 4 - 15;
  const img = logo ? `<image x="${bx + 6}" y="${by + 4}" width="16" height="16" href="data:image/svg+xml,${encodeURIComponent(logo)}"/>` : '';
  return `<g opacity="0.9"><rect x="${bx}" y="${by}" width="${w}" height="24" rx="12" fill="${t.surface}" stroke="${t.border}"/>${img}<text x="${bx + 10 + logoW}" y="${by + 16}" font-size="11.5" font-weight="600" fill="${t.ink2}">${x(text)}</text></g>`;
}

function nodeSvg(n, t, hueColor, isActive) {
  const C = CARD;
  const dim = isActive === false;
  const lines = [];
  let y = C.padY + C.kicker + C.kickerGap;
  n.lines.title.forEach((line) => {
    lines.push(`<text x="${C.padX}" y="${baseline(y, C.titleLine, C.titleSize)}" font-size="${C.titleSize}" font-weight="600" fill="${t.ink}">${x(line)}</text>`);
    y += C.titleLine;
  });
  if (n.lines.subtitle.length) {
    y += C.subGap;
    n.lines.subtitle.forEach((line) => {
      lines.push(`<text x="${C.padX}" y="${baseline(y, C.subLine, C.subSize)}" font-size="${C.subSize}" fill="${t.ink2}">${x(line)}</text>`);
      y += C.subLine;
    });
  }
  if (n.lines.tech) {
    y += C.techGap;
    lines.push(`<text x="${C.padX}" y="${baseline(y, C.techLine, C.techSize)}" font-size="${C.techSize}" font-family="${x(FONT_MONO)}" fill="${t.ink3}">${x(n.lines.tech)}</text>`);
  }
  // Cards that open a detail diagram carry the drill mark top-right, as in the viewer
  const drill = typeof n.node?.data?.drill === 'string' && n.node.data.drill
    ? `<g transform="translate(${n.w - C.padX - 14} ${C.padY + 1}) scale(0.5833)" fill="none" stroke="${hueColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><title>Has a detail diagram</title>${DRILL_ICON}</g>`
    : '';
  const ring = isActive ? `<rect x="-3" y="-3" width="${n.w + 6}" height="${n.h + 6}" rx="11" fill="none" stroke="${hueColor}" stroke-opacity="0.22" stroke-width="3"/>` : '';
  return `<g transform="translate(${n.x} ${n.y})" opacity="${dim ? 0.25 : 1}">
      ${ring}<rect width="${n.w}" height="${n.h}" rx="8" fill="${t.surface}" stroke="${isActive ? hueColor : t.border}" stroke-width="${isActive ? 1.5 : 1}"/>
      <g transform="translate(${C.padX} ${C.padY + 1}) scale(0.5833)" fill="none" stroke="${hueColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${(typeof n.icon === 'string' && Object.hasOwn(ICONS, n.icon) ? ICONS[n.icon] : ICONS.cpu)}</g>
      <text x="${C.padX + 21}" y="${C.padY + 12}" font-size="10.5" font-weight="600" letter-spacing="0.06em" fill="${hueColor}">${x(String(n.kicker).toUpperCase())}</text>${drill}
      ${lines.join('\n      ')}
    </g>`;
}

const baseline = (top, lineHeight, size) => Math.round((top + (lineHeight - size) / 2 + size * 0.8) * 10) / 10;
