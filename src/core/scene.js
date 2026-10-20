/**
 * computeScene: payload + mode (+ dragged positions) -> fully resolved
 * geometry. The browser renderer, SVG exporter and validator all draw from
 * this one function, so what is validated is exactly what is shown.
 */
import { normalize, visibleGraph, groupIndex, roleKey, has, shapeOf, arrowOf, POINT_SHAPES, TEXTLESS } from './model.js';
import { measureNode, autoLayout, labelSize, groupBoxes, groupTitle, selfLoop, GRID, GROUP } from './layout.js';
import { routeEdges, placeLabels, placeEndLabels, roundedPath, loopGeometry } from './route.js';
import { POINT_BADGE, treeIndex, tidyTree, mindMap, busRoute, dropLabel, curveRoute, branchHues, collapseGraph, isTreeAlgorithm, loopSideFor, stackRoute, sideRoute, endLabel, busFor } from './tree.js';
import { iconFor, knownIcon } from './icons.js';
import { HUES } from './theme.js';
import { edgeEnds, hasNotation } from './notation.js';
import { fieldRows } from './entity.js';

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

  // Fork bars run across the flow and grow with the edges on their busier side
  const forkPorts = (id) => Math.max(edges.filter((e) => e.target === id && e.source !== id).length, edges.filter((e) => e.source === id && e.target !== id).length);
  const sized = nodes.map((n) => ({ node: n, ...measureNode(n, shapeOf(n) === 'fork' ? { direction: model.layout.direction, ports: forkPorts(n.id) } : {}) }));
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
    // Assistant cards sit beside their manager; compact stacks list leaf teams in a column
    const assistants = new Set(nodes.filter((n) => n.data?.assistant === true).map((n) => n.id));
    if (algorithm === 'tree') base = { ...tidyTree(boxes, index, { direction: model.layout.direction, labels, compact: model.layout.compact, assistants }), sides };
    else if (algorithm === 'mindmap') base = { ...mindMap(boxes, index, { labels }), sides };
    else
      base = autoLayout(
        sized.map((s) => ({ id: s.node.id, w: s.w, h: s.h, rank: s.node.rank, shape: shapeOf(s.node) })),
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
    const fields = fieldRows(s.node.data, s.lines);
    rects.set(s.node.id, { x: Math.round(p.x), y: Math.round(p.y), w: s.w, h: s.h, ...(TEXTLESS.has(shape) ? { shape } : {}), ...(fields ? { fields } : {}) });
  }

  // Fork / join bars stretch across their neighbours so edges leave them straight
  for (const s of sized) if (shapeOf(s.node) === 'fork') stretchBar(s.node.id, rects, edges);

  // Layout hints only hold while nothing has been dragged (a self-loop keeps its side)
  const routeInput = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    sides: moved && e.source !== e.target ? undefined : base.sides.get(e.id),
    ...(typeof e.sourceField === 'string' ? { sourceField: e.sourceField } : {}),
    ...(typeof e.targetField === 'string' ? { targetField: e.targetField } : {}),
    marked: hasNotation(e)
  }));
  // Group boxes always follow their members (auto, manual or dragged) and wrap their self-loops
  const boxRects = new Map(rects);
  for (const [id, loop] of loopGeometry(rects, routeInput)) {
    const src = routeInput.find((e) => e.id === id).source;
    boxRects.set(src, union(boxRects.get(src), loop.box));
  }
  const boxes = groupBoxes(gi.list, boxRects);
  const dividers = regionDividers(gi, boxes, model.layout.direction);
  const sceneGroups = gi.list
    .filter((g) => boxes.has(g.id))
    .map((g) => {
      const b = boxes.get(g.id);
      const t = groupTitle(g.title, b);
      // A concurrent region draws as a compartment of its parent: its title and the dashed divider before it
      const region = isRegion(g, gi) ? { region: true, divider: dividers.get(g.id) || null } : {};
      return { id: g.id, title: g.title, label: t.text, titleBox: t.strip, x: b.x, y: b.y, w: b.w, h: b.h, depth: g.depth, parent: g.parent, hue: g.hue, dashed: g.dashed, members: g.nodes, group: g.group, ...region };
    });

  // Hierarchy edges: comb connectors, compact stacks and assistant links (tree)
  // or curves (mind map); everything else goes through the orthogonal router.
  // After a drag each parent's connectors are rebuilt from where its cards are now;
  // an edge whose cards no longer sit in tree order falls back to the router.
  const drawn = new Map(); // edgeId -> { points, d, label }
  const treeLabels = [];
  const sideOf = (p, c) => (c.x + c.w / 2 >= p.x + p.w / 2 ? 1 : -1);
  const atBase = (id) => {
    const b = base.positions.get(id);
    const r = rects.get(id);
    return !!b && b.x === r.x && b.y === r.y;
  };
  const combKids = new Map(); // parent -> its comb children (tree layout)
  if (algorithm === 'tree' && base.bus)
    for (const e of edges)
      if (isTreeEdge(e) && base.bus.has(e.source) && !base.links?.has(e.target)) {
        if (!combKids.has(e.source)) combKids.set(e.source, []);
        combKids.get(e.source).push(e.target);
      }
  const busAt = new Map();
  combKids.forEach((list, pid) => {
    const p = rects.get(pid);
    const b = base.positions.get(pid);
    if (!b) return;
    // an unmoved parent with unmoved children keeps the layout's bus exactly
    if (atBase(pid) && list.every(atBase)) return busAt.set(pid, base.bus.get(pid));
    const shift = base.bus.get(pid) - (base.direction === 'LR' ? b.x + p.w : b.y + p.h);
    const at = busFor(p, list.map((id) => rects.get(id)), shift, base.direction);
    if (at !== null) busAt.set(pid, at);
  });
  for (const e of edges) {
    if (!isTreeEdge(e)) continue;
    const p = rects.get(e.source);
    const c = rects.get(e.target);
    const size = labelSize(e.label);
    if (algorithm === 'mindmap') {
      // the band edge holds while parent and child sit where the layout put them
      const band = atBase(e.source) && atBase(e.target) ? base.band?.get(e.source) : undefined;
      const curve = curveRoute(p, c, sideOf(p, c), band);
      drawn.set(e.id, { points: curve.points, d: curve.d, label: size ? { x: curve.mid.x, y: curve.mid.y, w: size.w, h: size.h } : null });
    } else {
      const link = base.links?.get(e.target);
      let points = null;
      if (link === 'stack') points = stackRoute(p, c);
      else if (link === 'side') points = sideRoute(p, c, base.direction);
      else if (busAt.has(e.source)) {
        const at = busAt.get(e.source);
        if (base.direction === 'LR' ? c.x >= at + GRID : c.y >= at + GRID) points = busRoute(p, c, at, base.direction);
      }
      if (!points) continue;
      drawn.set(e.id, { points, d: roundedPath(points), label: size ? (link ? endLabel(points, size) : dropLabel(points, size, base.direction)) : null });
    }
    const l = drawn.get(e.id).label;
    if (l) treeLabels.push({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });
  }
  const routes = routeEdges(rects, routeInput.filter((e) => !drawn.has(e.id)), { groups: sceneGroups });
  // Notation markers (UML heads, crow's feet) at either kind of route stay clear of labels
  const allRoutes = new Map([...routes, ...drawn]);
  const zones = markerZones(edges, allRoutes);
  // End labels (multiplicities, roles) beside the markers, then edge labels clear of both
  const box = (l) => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });
  const loopLabels = [...routes.values()].filter((r) => r.label).map((r) => box(r.label));
  const endLabels = placeEndLabels(
    allRoutes,
    rects,
    edges.filter((e) => e.sourceLabel || e.targetLabel).map((e) => ({ id: e.id, sourceLabel: e.sourceLabel, targetLabel: e.targetLabel, ...edgeEnds(e) })),
    [...sceneGroups.map((g) => g.titleBox), ...treeLabels, ...loopLabels]
  );
  const endBoxes = [...endLabels.values()].flatMap((r) => [r.source, r.target]).filter(Boolean).map(box);
  const labels = placeLabels(routes, rects, edges.filter((e) => !drawn.has(e.id)), labelSize, [...sceneGroups.map((g) => g.titleBox), ...treeLabels, ...zones, ...endBoxes]);
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
    // Pseudo-states (dots, diamonds) are too small for a fold button; folded, they carry a +N badge beside them
    const folds = folded.hidden.get(s.node.id) || 0;
    const side = summary ? 'corner' : kids && (!TEXTLESS.has(shapeOf(s.node)) || folds) ? toggleSide(s.node.id) : null;
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
      ...(side ? { toggle: side, collapsed: folds } : {})
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
      end: ends.end,
      // End labels (multiplicities, roles): { x, y (centre), w, h, text } or null
      sourceLabel: endLabels.get(e.id)?.source || null,
      targetLabel: endLabels.get(e.id)?.target || null
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

/**
 * Lengthen a fork / join bar (never shorten it) so it spans the centres of the
 * cards it joins, as far as it can without touching another card.
 */
function stretchBar(id, rects, edges) {
  const r = rects.get(id);
  const vertical = r.h > r.w;
  const axis = vertical ? 'y' : 'x';
  const size = vertical ? 'h' : 'w';
  const near = edges.filter((e) => e.source !== e.target && (e.source === id || e.target === id)).map((e) => rects.get(e.source === id ? e.target : e.source));
  const centres = near.filter(Boolean).map((q) => q[axis] + q[size] / 2);
  if (centres.length < 2) return;
  const from = Math.min(r[axis], Math.floor((Math.min(...centres) - 16) / GRID) * GRID);
  const to = Math.max(r[axis] + r[size], Math.ceil((Math.max(...centres) + 16) / GRID) * GRID);
  const bar = { ...r, [axis]: from, [size]: to - from };
  const hits = (q) => bar.x - 10 < q.x + q.w && bar.x + bar.w + 10 > q.x && bar.y - 10 < q.y + q.h && bar.y + bar.h + 10 > q.y;
  if ([...rects].some(([k, q]) => k !== id && hits(q))) return;
  rects.set(id, bar);
}

/** A concurrent region: a child group with kind "region", drawn as a compartment of its parent. */
const isRegion = (g, gi) => g.group?.kind === 'region' && !!g.parent && gi.byId.has(g.parent);

/**
 * Dashed dividers between the concurrent regions of a composite state. Regions
 * stack across the flow (rows in LR, columns in TB); each region after the
 * first gets the line between it and the one before, across the whole parent.
 * @returns Map<groupId, { x1, y1, x2, y2 }>
 */
function regionDividers(gi, boxes, direction) {
  const out = new Map();
  const byParent = new Map();
  for (const g of gi.list) {
    if (!isRegion(g, gi) || !boxes.has(g.id) || !boxes.has(g.parent)) continue;
    if (!byParent.has(g.parent)) byParent.set(g.parent, []);
    byParent.get(g.parent).push(g.id);
  }
  const rows = direction !== 'TB';
  for (const [parent, ids] of byParent) {
    const p = boxes.get(parent);
    const sorted = ids.map((id) => [id, boxes.get(id)]).sort((a, b) => (rows ? a[1].y - b[1].y : a[1].x - b[1].x));
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1][1];
      const cur = sorted[k][1];
      if (rows) {
        const y = Math.round((prev.y + prev.h + cur.y) / 2);
        out.set(sorted[k][0], { x1: p.x, y1: y, x2: p.x + p.w, y2: y });
      } else {
        const x = Math.round((prev.x + prev.w + cur.x) / 2);
        out.set(sorted[k][0], { x1: x, y1: p.y + GROUP.padTop - 6, x2: x, y2: p.y + p.h });
      }
    }
  }
  return out;
}

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
  nodes.forEach((n) => {
    // a folded pseudo-state's +N badge sits outside it
    const m = n.collapsed && TEXTLESS.has(n.shape) ? POINT_BADGE + 16 : 0;
    add(n.x - m, n.y - m); add(n.x + n.w + m, n.y + n.h + m);
  });
  groups.forEach((g) => { add(g.x, g.y); add(g.x + g.w, g.y + g.h); });
  edges.forEach((e) => {
    e.points.forEach((p) => add(p.x, p.y));
    for (const l of [e.label, e.sourceLabel, e.targetLabel]) if (l) { add(l.x - l.w / 2, l.y - l.h / 2); add(l.x + l.w / 2, l.y + l.h / 2); }
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
