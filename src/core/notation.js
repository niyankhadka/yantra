/**
 * Relationship notation at edge ends: ER cardinality (crow's foot) and UML
 * heads (inheritance triangle, composition / aggregation diamonds, open
 * arrows). Pure geometry and SVG markup, shared by the viewer and the export.
 *
 *   edge.sourceEnd / edge.targetEnd: one of END_KINDS
 *   edge.relation: a UML kind (RELATIONS) that fills in both ends and the dash
 *
 * Markers are drawn in their own user space (not scaled by the stroke), with
 * the tip on the card border and the shape reaching back along the path. Every
 * shape stays within the 20px straight stub the router leaves at each port.
 */
import { arrowOf } from './model.js';

export const ER_ENDS = ['one', 'zero-or-one', 'many', 'one-or-many', 'zero-or-many'];
export const UML_ENDS = ['arrow', 'open-arrow', 'triangle', 'diamond', 'open-diamond'];
export const END_KINDS = ['none', ...UML_ENDS, ...ER_ENDS];

/**
 * UML relationship kinds. Triangles and diamonds sit on the SOURCE (the parent,
 * the interface, the whole), so edges run parent -> child and whole -> part and
 * the layout puts parents first; association and dependency point at the target.
 */
export const RELATIONS = {
  inheritance: { source: 'triangle', target: 'none' },
  realization: { source: 'triangle', target: 'none', dashed: true },
  composition: { source: 'diamond', target: 'none' },
  aggregation: { source: 'open-diamond', target: 'none' },
  association: { source: 'none', target: 'open-arrow' },
  dependency: { source: 'none', target: 'open-arrow', dashed: true }
};

/** Readable names, for the inspector and the Markdown export. */
export const END_LABELS = {
  one: 'exactly one',
  'zero-or-one': 'zero or one',
  many: 'many',
  'one-or-many': 'one or more',
  'zero-or-many': 'zero or more'
};

const kindOf = (v) => (typeof v === 'string' && END_KINDS.includes(v) ? v : null);
const relationOf = (v) => (typeof v === 'string' && Object.hasOwn(RELATIONS, v) ? RELATIONS[v] : null);

/** True when an edge carries any notation (relation or explicit end). */
export const hasNotation = (edge) => !!(relationOf(edge?.relation) || kindOf(edge?.sourceEnd) || kindOf(edge?.targetEnd));

/**
 * Markers at both ends of an edge. Without notation, edge.arrow decides
 * ("forward": arrowhead at the target, "both", "none"); once an edge has any
 * notation, that wins and an end without one is plain.
 * @returns { start: kind | null, end: kind | null, dashed: boolean }  (null = no marker)
 */
export function edgeEnds(edge) {
  const rel = relationOf(edge?.relation);
  const s = kindOf(edge?.sourceEnd);
  const t = kindOf(edge?.targetEnd);
  if (!rel && !s && !t) {
    const arrow = arrowOf(edge);
    return { start: arrow === 'both' ? 'arrow' : null, end: arrow === 'none' ? null : 'arrow', dashed: false };
  }
  const start = s || rel?.source || 'none';
  const end = t || rel?.target || 'none';
  return { start: start === 'none' ? null : start, end: end === 'none' ? null : end, dashed: !!rel?.dashed };
}

/** Short description of an edge's notation, e.g. "exactly one to zero or more" or "inheritance". */
export function notationText(edge) {
  if (!hasNotation(edge)) return '';
  const s = kindOf(edge.sourceEnd);
  const t = kindOf(edge.targetEnd);
  if ((s && END_LABELS[s]) || (t && END_LABELS[t])) return `${END_LABELS[s] || 'any'} to ${END_LABELS[t] || 'any'}`;
  return relationOf(edge.relation) ? edge.relation : [s, t].filter(Boolean).join(' / ');
}

/**
 * Marker geometry for one kind: viewBox width/height, and the shapes as SVG
 * markup in that box (tip at x = w, centre line at y = h / 2).
 * @param ink  stroke colour (or CSS value)
 * @param bg   fill for hollow shapes: the canvas background
 * @param css  paint through style="" (needed for CSS variables) instead of attributes
 */
export function markerShape(kind, ink, bg, css = false) {
  const paint = (fill, stroke) =>
    css ? `style="fill:${fill}${stroke ? `;stroke:${stroke}` : ''}"` : `fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}`;
  const line = (d) => `<path d="${d}" ${paint('none', ink)} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const shape = (d, fill) => `<path d="${d}" ${paint(fill, ink)} stroke-width="1.5" stroke-linejoin="round"/>`;
  const circle = (cx) => `<circle cx="${cx}" cy="7" r="4" ${paint(bg, ink)} stroke-width="1.5"/>`;
  const crow = 'M20 1 L10 7 L20 13';
  const bar = (x) => `M${x} 1.5 V12.5`;
  switch (kind) {
    case 'arrow':
      return { w: 10, h: 10, body: `<path d="M0 1 10 5 0 9z" ${paint(ink)}/>` };
    case 'open-arrow':
      return { w: 12, h: 12, body: line('M1 1.5 L11.5 6 L1 10.5') };
    case 'triangle':
      return { w: 15, h: 14, body: shape('M1 1 L14 7 L1 13 Z', bg) };
    case 'diamond':
      return { w: 20, h: 12, body: shape('M1 6 L10 1 L19 6 L10 11 Z', ink) };
    case 'open-diamond':
      return { w: 20, h: 12, body: shape('M1 6 L10 1 L19 6 L10 11 Z', bg) };
    case 'one':
      return { w: 20, h: 14, body: line(`${bar(14)} ${bar(10)}`) };
    case 'zero-or-one':
      return { w: 20, h: 14, body: line(bar(14)) + circle(6) };
    case 'many':
      return { w: 20, h: 14, body: line(crow) };
    case 'one-or-many':
      return { w: 20, h: 14, body: line(`${crow} ${bar(7)}`) };
    case 'zero-or-many':
      return { w: 20, h: 14, body: line(crow) + circle(5) };
    default:
      return null;
  }
}

/** A complete <marker> element (orient auto-start-reverse, so one marker serves both ends). */
export function markerDef(id, kind, ink, bg, css = false) {
  const m = markerShape(kind, ink, bg, css);
  if (!m) return '';
  // The default arrow keeps its stroke-scaled size; notation markers are drawn 1:1
  if (kind === 'arrow')
    return `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">${m.body}</marker>`;
  return `<marker id="${id}" viewBox="0 0 ${m.w} ${m.h}" refX="${m.w}" refY="${m.h / 2}" markerWidth="${m.w}" markerHeight="${m.h}" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible">${m.body}</marker>`;
}
