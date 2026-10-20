/**
 * computeScene: payload + mode (+ dragged positions) -> fully resolved
 * geometry. The browser renderer, SVG exporter and validator all draw from
 * this one function, so what is validated is exactly what is shown.
 */
import { normalize, visibleGraph, groupIndex, roleKey, has, shapeOf, arrowOf, POINT_SHAPES } from './model.js';
import { measureNode, autoLayout, labelSize, groupBoxes, groupTitle, selfLoop, GRID } from './layout.js';
import { routeEdges, placeLabels, roundedPath, loopGeometry } from './route.js';
import { treeIndex, tidyTree, mindMap, busRoute, dropLabel, curveRoute, branchHues, collapseGraph, isTreeAlgorithm, loopSideFor } from './tree.js';
import { iconFor, knownIcon } from './icons.js';
import { HUES } from './theme.js';
import { edgeEnds } from './notation.js';

/**
 * @param payload   Yantra payload (raw or already normalised)
 * @param options   { modeId?, overrides?: Map|Object<id,{x,y}>, layoutCache?,
 *                    collapsed?: Set|Array of node/group ids (default meta.layout.collapsed) }
 */
export function computeScene(payload, options = {}) {
  const model = normalize(payload);
  const graph = visibleGraph(model, options.modeId);
  const { mode } = graph;
  const algorithm = model.layout.algorithm;
  const treeMode = isTreeAlgorithm(algorithm);
  const manual = model.layout.mode === 'manual';

  // Collapsed subtrees (tree layouts) or groups (layered) fold before layout
  const index = treeMode ? treeIndex(graph.nodes.map((n) => n.id), graph.edges) : null;
  const collapsed = new Set(options.collapsed !== undefined ? options.collapsed : model.layout.collapsed);
  const folded = collapseGraph({ nodes: graph.nodes, edges: graph.edges, groups: model.groups, collapsed, algorithm, index });
  const { nodes, edges } = folded;
  const original = new Set(graph.edges);
  const isTreeEdge = (e) => treeMode && index.tree.has(e.id) && original.has(e);

  const sized = nodes.map((n) => ({ node: n, ...measureNode(n) }));
  const byId = new Map(sized.map((s) => [s.node.id, s]));
  // Tree layouts draw the hierarchy itself, so groups are not drawn there (lint warns)
  const gi = groupIndex(treeMode ? [] : folded.groups, new Set(nodes.map((n) => n.id)));

  // Base positions: auto layout (cached per mode and collapse state) or authored coordinates
  let base;
  const cacheKey = `${mode?.id}|${[...folded.active].sort().join('\u0000')}`;
  if (manual) {
    base = {
      positions: new Map(sized.map((s) => [s.node.id, { x: num(s.node.x), y: num(s.node.y) }])),
      sides: new Map()
    };
  } else if (options.layoutCache?.has(cacheKey)) {
    base = options.layoutCache.get(cacheKey);
  } else {
    const labels = new Map(edges.filter((e) => isTreeEdge(e) && e.label).map((e) => [e.target, e.label]));
    // Hierarchical layouts put a card's first self-loop on one fixed side and keep room for it
    const loopSide = loopSideFor(algorithm, model.layout.direction);
    const sides = new Map();
    const loop = new Map();
    for (const e of edges) {
      if (e.source !== e.target || loop.has(e.source)) continue;
      const s = byId.get(e.source);
      sides.set(e.id, [loopSide, loopSide]);
      loop.set(e.source, selfLoop({ x: 0, y: 0, w: s.w, h: s.h }, loopSide, labelSize(e.label)).extent + 10);
    }
    const boxes = sized.map((s) => ({ id: s.node.id, w: s.w, h: s.h, loop: loop.get(s.node.id) || 0 }));
    if (algorithm === 'tree') base = { ...tidyTree(boxes, index, { direction: model.layout.direction, labels }), sides };
    else if (algorithm === 'mindmap') base = { ...mindMap(boxes, index, { labels }), sides };
    else
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

  // Hierarchy edges: comb connectors (tree, until a card is dragged) or curves
  // (mind map); everything else goes through the orthogonal router.
  const drawn = new Map(); // edgeId -> { points, d, label }
  const treeLabels = [];
  const sideOf = (p, c) => (c.x + c.w / 2 >= p.x + p.w / 2 ? 1 : -1);
  for (const e of edges) {
    if (!isTreeEdge(e)) continue;
    const p = rects.get(e.source);
    const c = rects.get(e.target);
    const size = labelSize(e.label);
    if (algorithm === 'mindmap') {
      const curve = curveRoute(p, c, sideOf(p, c), moved ? undefined : base.band?.get(e.source));
      drawn.set(e.id, { points: curve.points, d: curve.d, label: size ? { x: curve.mid.x, y: curve.mid.y, w: size.w, h: size.h } : null });
    } else if (!moved && base.bus?.has(e.source)) {
      const points = busRoute(p, c, base.bus.get(e.source), base.direction);
      drawn.set(e.id, { points, d: roundedPath(points), label: size ? dropLabel(points, size, base.direction) : null });
    } else continue;
    const l = drawn.get(e.id).label;
    if (l) treeLabels.push({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });
  }
  const routes = routeEdges(rects, routeInput.filter((e) => !drawn.has(e.id)), { groups: sceneGroups });
  // Notation markers (UML heads, crow's feet) at either kind of route stay clear of labels
  const zones = markerZones(edges, new Map([...routes, ...drawn]));
  const labels = placeLabels(routes, rects, edges.filter((e) => !drawn.has(e.id)), labelSize, [...sceneGroups.map((g) => g.titleBox), ...treeLabels, ...zones]);
  drawn.forEach((r, id) => {
    routes.set(id, { points: r.points, ok: true, d: r.d });
    if (r.label) labels.set(id, r.label);
  });

  // Mind maps colour by branch; cards that can fold carry the side of their toggle
  const root = algorithm === 'mindmap' && byId.has(index.roots[0]) ? index.roots[0] : null;
  const branch = root !== null ? branchHues(index, root, model.roles[roleKey(byId.get(root).node)]?.hue) : null;
  const toggleSide = (id) => {
    if (algorithm === 'tree') return model.layout.direction === 'TB' ? 'bottom' : 'right';
    if (id === root) return null;
    return root !== null && sideOf(rects.get(root), rects.get(id)) < 0 ? 'left' : 'right';
  };
  const sceneNodes = sized.map((s) => {
    const r = rects.get(s.node.id);
    const role = model.roles[roleKey(s.node)] || { label: s.node.type, hue: 'slate' };
    const summary = s.node.summary;
    const kids = treeMode ? (index.children.get(s.node.id) || []).length : 0;
    // Pseudo-states (dots, diamonds) are too small to carry a fold button
    const side = summary ? 'corner' : kids && !POINT_SHAPES.has(shapeOf(s.node)) ? toggleSide(s.node.id) : null;
    return {
      id: s.node.id,
      node: s.node,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      lines: s.lines,
      shape: shapeOf(s.node),
      hue: summary ? (has(HUES, summary.hue) ? summary.hue : 'slate') : branch?.get(s.node.id) || role.hue,
      kicker: stereotypeOf(s.node) || s.node.data?.badge || role.label || '',
      stereotype: !!stereotypeOf(s.node),
      icon: knownIcon(s.node.data?.icon) || knownIcon(role.icon) || iconFor(s.node),
      ...(side ? { toggle: side, collapsed: folded.hidden.get(s.node.id) || 0 } : {})
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
      d: route.d || roundedPath(route.points),
      label: e.label ? labels.get(e.id) || null : null,
      ...(isTreeEdge(e) ? { tree: true } : {}),
      arrow: arrowOf(e),
      self: e.source === e.target,
      dashed: e.style === 'dashed' || (!e.style && (ends.dashed || /async|event|stream/.test(e.type || ''))),
      dotted: e.style === 'dotted',
      // Markers at the source / target end (null = none): arrowheads, UML heads, ER cardinality
      start: ends.start,
      end: ends.end
    };
  });

  return {
    model,
    mode,
    layout: algorithm,
    branchColors: !!branch,
    collapse: { active: folded.active, alias: folded.alias, edgeAlias: folded.edgeAlias },
    nodes: sceneNodes,
    edges: sceneEdges,
    groups: sceneGroups,
    bounds: boundsOf(sceneNodes, sceneEdges, sceneGroups)
  };
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
