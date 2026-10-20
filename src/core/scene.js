/**
 * computeScene: payload + mode (+ dragged positions) -> fully resolved
 * geometry. The browser renderer, SVG exporter and validator all draw from
 * this one function, so what is validated is exactly what is shown.
 */
import { normalize, visibleGraph, groupIndex, roleKey, shapeOf, arrowOf, POINT_SHAPES } from './model.js';
import { measureNode, autoLayout, labelSize, groupBoxes, groupTitle, GRID } from './layout.js';
import { routeEdges, placeLabels, roundedPath, loopGeometry } from './route.js';
import { iconFor, knownIcon } from './icons.js';
import { edgeEnds } from './notation.js';

/**
 * @param payload   Yantra payload (raw or already normalised)
 * @param options   { modeId?, overrides?: Map|Object<id,{x,y}>, layoutCache? }
 */
export function computeScene(payload, options = {}) {
  const model = normalize(payload);
  const { nodes, edges, mode } = visibleGraph(model, options.modeId);

  const sized = nodes.map((n) => ({ node: n, ...measureNode(n) }));
  const byId = new Map(sized.map((s) => [s.node.id, s]));
  const gi = groupIndex(model.groups, new Set(nodes.map((n) => n.id)));

  // Base positions: auto layout (cached per mode) or authored coordinates
  let base;
  const cacheKey = `${mode?.id}`;
  if (model.layout.mode === 'manual') {
    base = {
      positions: new Map(sized.map((s) => [s.node.id, { x: num(s.node.x), y: num(s.node.y) }])),
      sides: new Map()
    };
  } else if (options.layoutCache?.has(cacheKey)) {
    base = options.layoutCache.get(cacheKey);
  } else {
    base = autoLayout(
      sized.map((s) => ({ id: s.node.id, w: s.w, h: s.h, rank: s.node.rank })),
      edges,
      { direction: model.layout.direction, groups: gi }
    );
    options.layoutCache?.set(cacheKey, base);
  }

  const overrides = toMap(options.overrides);
  const moved = [...overrides.keys()].some((id) => byId.has(id));
  const rects = new Map();
  for (const s of sized) {
    const p = overrides.get(s.node.id) || base.positions.get(s.node.id) || { x: 0, y: 0 };
    const shape = shapeOf(s.node);
    rects.set(s.node.id, { x: Math.round(p.x), y: Math.round(p.y), w: s.w, h: s.h, ...(POINT_SHAPES.has(shape) ? { shape } : {}) });
  }

  // Layout hints only hold while nothing has been dragged (a self-loop keeps its side)
  const routeInput = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    sides: moved && e.source !== e.target ? undefined : base.sides.get(e.id)
  }));
  // Group boxes always follow their members (auto, manual or dragged) and wrap their self-loops
  const boxRects = new Map(rects);
  for (const [id, loop] of loopGeometry(rects, routeInput)) {
    const src = routeInput.find((e) => e.id === id).source;
    boxRects.set(src, union(boxRects.get(src), loop.box));
  }
  const boxes = groupBoxes(gi.list, boxRects);
  const sceneGroups = gi.list
    .filter((g) => boxes.has(g.id))
    .map((g) => {
      const b = boxes.get(g.id);
      const t = groupTitle(g.title, b);
      return { id: g.id, title: g.title, label: t.text, titleBox: t.strip, x: b.x, y: b.y, w: b.w, h: b.h, depth: g.depth, parent: g.parent, hue: g.hue, dashed: g.dashed, members: g.nodes, group: g.group };
    });

  const routes = routeEdges(rects, routeInput, { groups: sceneGroups });
  const labels = placeLabels(routes, rects, edges, labelSize, [...sceneGroups.map((g) => g.titleBox), ...markerZones(edges, routes)]);

  const sceneNodes = sized.map((s) => {
    const r = rects.get(s.node.id);
    const role = model.roles[roleKey(s.node)] || { label: s.node.type, hue: 'slate' };
    return {
      id: s.node.id,
      node: s.node,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      lines: s.lines,
      shape: shapeOf(s.node),
      hue: role.hue,
      kicker: stereotypeOf(s.node) || s.node.data?.badge || role.label || '',
      stereotype: !!stereotypeOf(s.node),
      icon: knownIcon(s.node.data?.icon) || knownIcon(role.icon) || iconFor(s.node)
    };
  });

  const sceneEdges = edges.map((e) => {
    const route = routes.get(e.id);
    const ends = edgeEnds(e);
    return {
      id: e.id,
      edge: e,
      points: route.points,
      ok: route.ok,
      d: roundedPath(route.points),
      label: e.label ? labels.get(e.id) || null : null,
      arrow: arrowOf(e),
      self: e.source === e.target,
      dashed: e.style === 'dashed' || (!e.style && (ends.dashed || /async|event|stream/.test(e.type || ''))),
      dotted: e.style === 'dotted',
      // Markers at the source / target end (null = none): arrowheads, UML heads, ER cardinality
      start: ends.start,
      end: ends.end
    };
  });

  return { model, mode, nodes: sceneNodes, edges: sceneEdges, groups: sceneGroups, bounds: boundsOf(sceneNodes, sceneEdges, sceneGroups) };
}

/** Boxes over the notation markers at edge ends (UML heads, crow's feet), kept clear of labels. */
function markerZones(edges, routes) {
  const zones = [];
  const zone = (tip, next) => {
    // the marker runs from the card border back along the first leg
    const dx = Math.sign(next.x - tip.x);
    const dy = Math.sign(next.y - tip.y);
    const far = { x: tip.x + dx * MARKER_LEN, y: tip.y + dy * MARKER_LEN };
    zones.push({ x: Math.min(tip.x, far.x) - 8, y: Math.min(tip.y, far.y) - 8, w: Math.abs(far.x - tip.x) + 16, h: Math.abs(far.y - tip.y) + 16 });
  };
  for (const e of edges) {
    const p = routes.get(e.id)?.points;
    if (!p || p.length < 2) continue;
    const ends = edgeEnds(e);
    if (ends.start && ends.start !== 'arrow') zone(p[0], p[1]);
    if (ends.end && ends.end !== 'arrow') zone(p[p.length - 1], p[p.length - 2]);
  }
  return zones;
}
const MARKER_LEN = 20;

/** «stereotype» shown in place of the kicker on class cards (an empty string when none). */
function stereotypeOf(node) {
  const st = node.data?.stereotype;
  return typeof st === 'string' && st.trim() ? `«${st.trim().replace(/^<<|>>$|^«|»$/g, '')}»` : '';
}

function boundsOf(nodes, edges, groups = []) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x, y) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  nodes.forEach((n) => { add(n.x, n.y); add(n.x + n.w, n.y + n.h); });
  groups.forEach((g) => { add(g.x, g.y); add(g.x + g.w, g.y + g.h); });
  edges.forEach((e) => {
    e.points.forEach((p) => add(p.x, p.y));
    if (e.label) { add(e.label.x - e.label.w / 2, e.label.y - e.label.h / 2); add(e.label.x + e.label.w / 2, e.label.y + e.label.h / 2); }
  });
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function toMap(o) {
  if (!o) return new Map();
  if (o instanceof Map) return o;
  return new Map(Object.entries(o));
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v / GRID) * GRID : 0);
