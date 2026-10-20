/**
 * Hierarchical layouts and collapsing:
 * - treeIndex: the spanning forest of a graph (first parent wins, author order);
 * - tidyTree: Reingold-Tilford style placement (parents centred over their
 *   children, subtrees packed by contour), TB or LR, with comb connectors;
 * - mindMap: the root in the centre, branches balanced left and right, curved
 *   connectors and one colour per branch;
 * - collapseGraph: hides collapsed subtrees (tree layouts) or folds collapsed
 *   groups into one summary card (layered layout), with id aliases so steps
 *   still point at something visible.
 */
import { labelSize, GRID } from './layout.js';
import { HUE_ORDER } from './theme.js';

export const ALGORITHMS = ['layered', 'tree', 'mindmap'];
export const isTreeAlgorithm = (a) => a === 'tree' || a === 'mindmap';

/** Main-axis spacing: parent band -> bus, bus -> child (comb connectors). */
export const TREE = {
  bus: 30,
  drop: 30,
  labelPad: 14, // clear space around a label on its drop segment
  sibling: { TB: 30, LR: 20 },
  subtree: { TB: 50, LR: 30 },
  forest: 80,
  mindGap: 60, // horizontal room for a mind-map curve
  mindSibling: 20,
  mindSubtree: 30
};

const snap = (v) => Math.round(v / GRID) * GRID;
const ceilTo = (v, q) => Math.ceil(v / q) * q;

/**
 * Spanning forest over `ids` (in author order). Roots are nodes without an
 * incoming edge; a node with several parents keeps the first listed edge from
 * a node visited before it, and the other edges are cross-links. A cycle with
 * no root starts from its first node.
 * @returns { roots, parent: Map, children: Map<id,[id]>, edgeOf: Map<childId, edgeId>,
 *            depth: Map, tree: Set<edgeId>, cross: [edgeId] }
 */
export function treeIndex(ids, edges) {
  const known = new Set(ids);
  const valid = edges.filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target);
  const incoming = new Map(ids.map((id) => [id, []]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const e of valid) {
    incoming.get(e.target).push(e);
    outgoing.get(e.source).push(e);
  }
  // Visit order: breadth-first from the nodes nothing points at, then from the
  // first unvisited node of each remaining cycle
  const order = new Map();
  const reach = (start) => {
    const queue = [start];
    order.set(start, order.size);
    while (queue.length)
      for (const e of outgoing.get(queue.shift()))
        if (!order.has(e.target)) {
          order.set(e.target, order.size);
          queue.push(e.target);
        }
  };
  for (const id of ids) if (!incoming.get(id).length && !order.has(id)) reach(id);
  for (const id of ids) if (!order.has(id)) reach(id);
  // Each node takes the first listed edge from a node visited before it (so no cycles)
  const parent = new Map();
  const edgeOf = new Map();
  for (const n of ids) {
    const e = incoming.get(n).find((c) => order.get(c.source) < order.get(n));
    if (!e) continue;
    parent.set(n, e.source);
    edgeOf.set(n, e.id);
  }
  const tree = new Set(edgeOf.values());
  const children = new Map(ids.map((id) => [id, []]));
  for (const e of valid) if (tree.has(e.id)) children.get(e.source).push(e.target); // edge order
  const roots = ids.filter((id) => !parent.has(id));
  const depth = new Map();
  const stack = roots.map((r) => [r, 0]);
  while (stack.length) {
    const [id, d] = stack.pop();
    depth.set(id, d);
    for (const c of children.get(id)) stack.push([c, d + 1]);
  }
  const cross = valid.filter((e) => !tree.has(e.id)).map((e) => e.id);
  return { roots, parent, children, edgeOf, depth, tree, cross };
}

/** Every node below `id` in the forest. */
export function descendants(index, id) {
  const out = [];
  const stack = [...(index.children.get(id) || [])];
  while (stack.length) {
    const v = stack.pop();
    out.push(v);
    stack.push(...index.children.get(v));
  }
  return out;
}

/**
 * Contour packing shared by both layouts. `kids(id)` lists children, `size(id)`
 * is the cross-axis extent (a number, centred, or [lo, hi] around the centre
 * when a self-loop sticks out on one side); gaps are { sibling, subtree, forest };
 * `deep(id)` adds contour levels below a childless node (a compact stack).
 * @returns Map<id, cross centre> with the forest centred on 0
 */
function packForest(roots, kids, size, gaps, deep = () => []) {
  const rel = new Map(); // child -> offset from its parent's centre
  // Place subtrees side by side: each one as close as its contour allows
  const row = (contours, gapAt) => {
    const offsets = [];
    let acc = null;
    for (const c of contours) {
      if (!acc) {
        offsets.push(0);
        acc = c.map(([lo, hi]) => [lo, hi]);
        continue;
      }
      let shift = -Infinity;
      for (let k = 0; k < Math.min(acc.length, c.length); k++) shift = Math.max(shift, acc[k][1] - c[k][0] + gapAt(k));
      offsets.push(shift);
      c.forEach(([lo, hi], k) => {
        if (k < acc.length) acc[k] = [Math.min(acc[k][0], lo + shift), Math.max(acc[k][1], hi + shift)];
        else acc.push([lo + shift, hi + shift]);
      });
    }
    return { offsets, acc };
  };
  const gapAt = (k) => (k === 0 ? gaps.sibling : gaps.subtree);
  const contour = (id) => {
    const own = spanOf(size(id));
    const list = kids(id);
    if (!list.length) return [own, ...deep(id)];
    const { offsets, acc } = row(list.map(contour), gapAt);
    const mid = (offsets[0] + offsets[offsets.length - 1]) / 2;
    list.forEach((c, i) => rel.set(c, offsets[i] - mid));
    return [own, ...acc.map(([lo, hi]) => [lo - mid, hi - mid])];
  };
  const { offsets, acc } = row(roots.map(contour), () => gaps.forest);
  const lo = Math.min(...acc.map((a) => a[0]));
  const hi = Math.max(...acc.map((a) => a[1]));
  const centre = new Map();
  const assign = (id, c) => {
    centre.set(id, c);
    for (const k of kids(id)) assign(k, c + rel.get(k));
  };
  roots.forEach((r, i) => assign(r, offsets[i] - (lo + hi) / 2));
  return centre;
}

/** Room a labelled drop segment needs along the main axis. */
function dropFor(labels, horiz) {
  let need = TREE.drop;
  for (const text of labels) {
    const lab = labelSize(text);
    if (lab) need = Math.max(need, (horiz ? lab.w : lab.h) + TREE.labelPad * 2);
  }
  return ceilTo(need, GRID);
}

/** Compact stacks: leaf teams listed below their parent on a side bus (TB trees). */
export const COMPACT = { indent: 20, stub: 20, gap: 30, sibling: 20 };
/** compact "auto": stack leaf teams once the spread tree is wider than this and this flat. */
export const COMPACT_AUTO = { width: 1600, ratio: 2.4 };
export const COMPACT_MODES = [true, false, 'auto'];
/** Assistant cards beside their manager: side bus, gap to the card, gap between assistants. */
export const ASSIST = { bus: 20, gap: 40, sibling: 20 };
/** A folded pseudo-state's +N badge: centre this far outside the dot or diamond. */
export const POINT_BADGE = 16;

/**
 * Tidy tree. Every depth is one band (TB: rows with tops aligned; LR: columns
 * with left edges aligned); the comb bus of a parent runs TREE.bus past its band.
 * - Assistants (ids in `assistants` that are leaves) sit beside their manager in
 *   its band, alternating right / left (TB) or below / above (LR), on a side connector.
 * - Compact (TB only): a parent whose children are all unlabelled leaves lists
 *   them in one column below itself, indented on a side bus, instead of a row.
 *   `compact`: true (every such parent), false, or "auto" (only when the spread
 *   tree is too wide for its height, see COMPACT_AUTO).
 * @param nodes  [{ id, w, h, loop? }] (visible nodes)
 * @param index  treeIndex() over the visible graph
 * @param labels Map<childId, edge label> of tree edges
 * @returns { positions: Map<id,{x,y}>, bus: Map<parentId, main coordinate>,
 *            links: Map<childId, 'stack'|'side'>, compact: boolean, direction }
 */
export function tidyTree(nodes, index, { direction = 'TB', labels = new Map(), compact = 'auto', assistants = new Set() } = {}) {
  const horiz = direction === 'LR';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const all = (id) => (index.children.get(id) || []).filter((c) => byId.has(c));
  const aide = new Set([...assistants].filter((id) => byId.has(id) && byId.has(index.parent.get(id)) && !all(id).length));
  const kids = (id) => all(id).filter((c) => !aide.has(c));
  const eligible = horiz ? [] : nodes.map((n) => n.id).filter((id) => kids(id).length >= 2 && kids(id).every((c) => !all(c).length && !labels.get(c)));
  const place = (stacked) => placeTree(nodes, index, { horiz, labels, byId, aide, kids, stacked });
  if (compact === true) return place(new Set(eligible));
  const spread = place(new Set());
  if (compact === false || !eligible.length || !tooWide(spread.positions, byId)) return spread;
  return place(new Set(eligible));
}

function tooWide(positions, byId) {
  let w = 0;
  let h = 0;
  positions.forEach((p, id) => {
    w = Math.max(w, p.x + byId.get(id).w);
    h = Math.max(h, p.y + byId.get(id).h);
  });
  return w > COMPACT_AUTO.width && w > h * COMPACT_AUTO.ratio;
}

function placeTree(nodes, index, { horiz, labels, byId, aide, kids, stacked }) {
  const main = (n) => (horiz ? n.w : n.h);
  const cross = (n) => (horiz ? n.h : n.w);
  const inStack = (id) => stacked.has(index.parent.get(id));
  const banded = nodes.filter((n) => !aide.has(n.id) && !inStack(n.id));
  const depthOf = (id) => index.depth.get(id) || 0;
  const roots = index.roots.filter((r) => byId.has(r));

  // Assistants: one column on each side of the manager (first right / below, then left / above),
  // the first centred on the manager along the main axis, the next ones after it
  const aides = new Map(); // manager -> { items: Map<id, { side, main, cross }>, lo, hi, end } (relative to its centre / band start)
  for (const n of banded) {
    const list = (index.children.get(n.id) || []).filter((c) => aide.has(c));
    if (!list.length) continue;
    const half = cross(n) / 2;
    const next = [null, null];
    const wide = [0, 0];
    const gap = [0, 0];
    const items = new Map();
    let end = main(n);
    list.forEach((a, i) => {
      const side = i % 2;
      const box = byId.get(a);
      const at = next[side] ?? Math.max(0, (main(n) - main(box)) / 2);
      next[side] = at + main(box) + ASSIST.sibling;
      wide[side] = Math.max(wide[side], cross(box));
      const lab = labelSize(labels.get(a));
      gap[side] = Math.max(gap[side], lab ? ceilTo(ASSIST.bus + (horiz ? lab.h : lab.w) + TREE.labelPad * 2, GRID) : ASSIST.gap);
      items.set(a, { side, main: at });
      end = Math.max(end, at + main(box));
    });
    const right = half + (n.loop || 0) + gap[0];
    items.forEach((it, a) => (it.cross = it.side ? -half - gap[1] - cross(byId.get(a)) : right));
    aides.set(n.id, { items, lo: wide[1] ? -half - gap[1] - wide[1] : -half, hi: wide[0] ? right + wide[0] : half + (n.loop || 0), end });
  }

  // Bands: depth d starts after band d-1, its bus and the drop into d
  const maxDepth = Math.max(0, ...banded.map((n) => depthOf(n.id)));
  const band = Array.from({ length: maxDepth + 1 }, () => 0);
  const into = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of banded) {
    const d = depthOf(n.id);
    band[d] = Math.max(band[d], aides.get(n.id)?.end ?? main(n));
    if (labels.get(n.id)) into[d].push(labels.get(n.id));
  }
  const start = [0];
  for (let d = 1; d <= maxDepth; d++) start.push(start[d - 1] + band[d - 1] + TREE.bus + dropFor(into[d], horiz));

  // Compact stacks (TB): one column under the parent, left edges past its side bus
  const stacks = new Map(); // parent -> { items: Map<id, top offset>, lo, hi, bottom }
  for (const p of stacked) {
    const n = byId.get(p);
    let at = (aides.get(p)?.end ?? n.h) + COMPACT.gap;
    let wide = 0;
    const items = new Map();
    for (const c of kids(p)) {
      const box = byId.get(c);
      items.set(c, at);
      at += box.h + COMPACT.sibling;
      wide = Math.max(wide, box.w + (box.loop || 0));
    }
    const lo = -n.w / 2 + COMPACT.indent + COMPACT.stub;
    stacks.set(p, { items, lo, hi: lo + wide, bottom: at - COMPACT.sibling });
  }

  // A self-loop sits on the far cross side (right in TB, below in LR): reserve it
  const span = (id) => {
    const n = byId.get(id);
    const own = aides.get(id) || { lo: -cross(n) / 2, hi: cross(n) / 2 + (n.loop || 0) };
    const st = stacks.get(id);
    return st ? [Math.min(own.lo, st.lo), Math.max(own.hi, st.hi)] : [own.lo, own.hi];
  };
  // A stack hangs into the bands below its parent: reserve its column there too
  const deep = (id) => {
    const st = stacks.get(id);
    if (!st) return [];
    const d = depthOf(id);
    const out = [];
    for (let j = d + 1; j <= maxDepth && start[d] + st.bottom > start[j - 1] + band[j - 1]; j++) out.push([st.lo, st.hi]);
    return out;
  };
  const centre = packForest(roots, (id) => (stacks.has(id) ? [] : kids(id)), span, {
    sibling: TREE.sibling[horiz ? 'LR' : 'TB'],
    subtree: TREE.subtree[horiz ? 'LR' : 'TB'],
    forest: TREE.forest
  }, deep);

  const raw = new Map();
  const links = new Map();
  for (const n of banded) {
    const d = depthOf(n.id);
    const c = centre.get(n.id) ?? 0;
    raw.set(n.id, horiz ? { x: start[d], y: c - n.h / 2 } : { x: c - n.w / 2, y: start[d] });
    aides.get(n.id)?.items.forEach((it, a) => {
      raw.set(a, horiz ? { x: start[d] + it.main, y: c + it.cross } : { x: c + it.cross, y: start[d] + it.main });
      links.set(a, 'side');
    });
    const st = stacks.get(n.id);
    st?.items.forEach((top, k) => {
      raw.set(k, { x: c + st.lo, y: start[d] + top });
      links.set(k, 'stack');
    });
  }
  const positions = normalise(raw);
  const shift = minOf(raw, horiz ? 'x' : 'y');
  const bus = new Map();
  for (const n of banded) {
    const d = depthOf(n.id);
    if (kids(n.id).length && !stacks.has(n.id)) bus.set(n.id, snap(start[d] + band[d] + TREE.bus - shift));
  }
  return { positions, bus, links, compact: stacks.size > 0, direction: horiz ? 'LR' : 'TB' };
}

/**
 * Compact-stack connector: down the parent's side bus (COMPACT.indent in from
 * its left edge), then into the child's left side. Null when the child is not
 * below and right of the bus (after a drag).
 */
export function stackRoute(p, c) {
  const x = p.x + COMPACT.indent;
  const y = c.y + c.h / 2;
  if (c.x < x + GRID || c.y < p.y + p.h + GRID) return null;
  return [{ x, y: p.y + p.h }, { x, y }, { x: c.x, y }];
}

/**
 * Assistant connector: out of the manager's side (TB: right or left; LR: bottom
 * or top) to a short side bus, then into the assistant's facing side. Null when
 * the assistant no longer sits on that side (after a drag).
 */
export function sideRoute(p, c, direction) {
  if (direction === 'LR') {
    const s = c.y + c.h / 2 >= p.y + p.h / 2 ? 1 : -1;
    const y0 = s > 0 ? p.y + p.h : p.y;
    const y1 = s > 0 ? c.y : c.y + c.h;
    if (s * (y1 - y0) < ASSIST.bus + GRID) return null;
    const x1 = p.x + p.w / 2;
    const x2 = c.x + c.w / 2;
    const at = y0 + s * ASSIST.bus;
    return simplify([{ x: x1, y: y0 }, { x: x1, y: at }, { x: x2, y: at }, { x: x2, y: y1 }]);
  }
  const s = c.x + c.w / 2 >= p.x + p.w / 2 ? 1 : -1;
  const x0 = s > 0 ? p.x + p.w : p.x;
  const x1 = s > 0 ? c.x : c.x + c.w;
  if (s * (x1 - x0) < ASSIST.bus + GRID) return null;
  const y1 = p.y + p.h / 2;
  const y2 = c.y + c.h / 2;
  const at = x0 + s * ASSIST.bus;
  return simplify([{ x: x0, y: y1 }, { x: at, y: y1 }, { x: at, y: y2 }, { x: x1, y: y2 }]);
}

/** Label box (centre) on the last segment of a route (comb drop, stack stub, assistant link). */
export function endLabel(points, size) {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: size.w, h: size.h };
}

/**
 * Comb bus for a parent at its current position: the same distance past the
 * parent as in the layout, pulled back to half way when a child came closer
 * (after a drag). Null when a child no longer sits clearly past the parent.
 * @param p     the parent's rect; kids: rects of its comb children
 * @param shift layout bus minus the layout's parent band end
 */
export function busFor(p, kids, shift, direction) {
  const horiz = direction === 'LR';
  const from = horiz ? p.x + p.w : p.y + p.h;
  const to = Math.min(...kids.map((c) => (horiz ? c.x : c.y)));
  if (!isFinite(to) || to - from < GRID * 2) return null;
  return Math.min(from + shift, snap((from + to) / 2));
}

/**
 * Comb connector from a parent to one child: trunk out of the parent's
 * child-side centre to the bus, along the bus, then a drop into the child.
 */
export function busRoute(p, c, busAt, direction) {
  if (direction === 'LR') {
    const y1 = p.y + p.h / 2;
    const y2 = c.y + c.h / 2;
    return simplify([{ x: p.x + p.w, y: y1 }, { x: busAt, y: y1 }, { x: busAt, y: y2 }, { x: c.x, y: y2 }]);
  }
  const x1 = p.x + p.w / 2;
  const x2 = c.x + c.w / 2;
  return simplify([{ x: x1, y: p.y + p.h }, { x: x1, y: busAt }, { x: x2, y: busAt }, { x: x2, y: c.y }]);
}

/** Label box (centre) on a comb route's drop segment. */
export function dropLabel(points, size, direction) {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return direction === 'LR' ? { x: (a.x + b.x) / 2, y: b.y, w: size.w, h: size.h } : { x: b.x, y: (a.y + b.y) / 2, w: size.w, h: size.h };
}

/**
 * Mind map: the first root in the centre, its branches (and any other roots)
 * split into a right and a left half of similar height, laid out outwards.
 * @returns { positions, side: Map<id, 1|-1|0>, root, band: Map<id, outer edge of its band> }
 */
export function mindMap(nodes, index, { labels = new Map() } = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = (id) => (index.children.get(id) || []).filter((c) => byId.has(c));
  const roots = index.roots.filter((r) => byId.has(r));
  const root = roots[0];
  const branches = [...kids(root), ...roots.slice(1)];
  const gaps = { sibling: TREE.mindSibling, subtree: TREE.mindSubtree, forest: TREE.mindSubtree };
  // Self-loops sit below their card: reserve the room when stacking
  const height = (id) => [-byId.get(id).h / 2, byId.get(id).h / 2 + (byId.get(id).loop || 0)];

  // Balance: the split that makes the two halves' stacked heights closest
  const extent = branches.map((b) => {
    const c = packForest([b], kids, height, gaps);
    let lo = Infinity;
    let hi = -Infinity;
    c.forEach((v, id) => {
      lo = Math.min(lo, v + height(id)[0]);
      hi = Math.max(hi, v + height(id)[1]);
    });
    return hi - lo + gaps.subtree;
  });
  const total = extent.reduce((s, v) => s + v, 0);
  let split = branches.length;
  let best = Infinity;
  let run = 0;
  for (let k = 1; k <= branches.length; k++) {
    run += extent[k - 1];
    const diff = Math.abs(total - 2 * run);
    if (diff < best) {
      best = diff;
      split = k;
    }
  }
  if (branches.length > 1) split = Math.min(split, branches.length - 1);
  // Clockwise: right half top to bottom, left half bottom to top
  const halves = [
    { s: 1, list: branches.slice(0, split) },
    { s: -1, list: branches.slice(split).reverse() }
  ];

  const r = byId.get(root);
  const raw = new Map([[root, { x: -r.w / 2, y: -r.h / 2 }]]);
  const side = new Map([[root, 0]]);
  const band = new Map();
  for (const { s, list } of halves) {
    if (!list.length) continue;
    const centre = packForest(list, kids, height, gaps);
    const depthOf = new Map();
    const walk = (id, d) => {
      depthOf.set(id, d);
      side.set(id, s);
      kids(id).forEach((k) => walk(k, d + 1));
    };
    list.forEach((b) => walk(b, 1));
    const maxDepth = Math.max(...depthOf.values());
    const width = Array.from({ length: maxDepth + 1 }, () => 0);
    const into = Array.from({ length: maxDepth + 1 }, () => []);
    depthOf.forEach((d, id) => {
      width[d] = Math.max(width[d], byId.get(id).w);
      if (labels.get(id)) into[d].push(labels.get(id));
    });
    const gapInto = (d) => ceilTo(Math.max(TREE.mindGap, ...into[d].map((t) => labelSize(t).w + 40)), GRID);
    const off = [0, r.w / 2 + gapInto(1)];
    for (let d = 2; d <= maxDepth; d++) off.push(off[d - 1] + width[d - 1] + gapInto(d));
    depthOf.forEach((d, id) => {
      const n = byId.get(id);
      const cy = centre.get(id);
      raw.set(id, { x: s > 0 ? off[d] : -off[d] - n.w, y: cy - n.h / 2 });
    });
    // A parent's curve starts at the outer edge of its band, past wider neighbours
    depthOf.forEach((d, id) => {
      if (kids(id).length) band.set(id, s * (off[d] + width[d]));
    });
  }
  const positions = normalise(raw);
  const dx = minOf(raw, 'x');
  const outer = new Map();
  band.forEach((v, k) => outer.set(k, snap(v - dx)));
  return { positions, side, root, band: outer };
}

/**
 * Curved mind-map connector: a short straight run to the end of the parent's
 * band, then a horizontal-tangent cubic into the child's facing side.
 * @returns { points (sampled, for bounds, validation and packets), d, mid }
 */
export function curveRoute(p, c, s, bandEdge) {
  const x0 = s > 0 ? p.x + p.w : p.x;
  const y1 = p.y + p.h / 2;
  const x1 = bandEdge ?? x0;
  const x2 = s > 0 ? c.x : c.x + c.w;
  const y2 = c.y + c.h / 2;
  const mx = (x1 + x2) / 2;
  const points = x1 !== x0 ? [{ x: x0, y: y1 }] : [];
  const at = (t) => {
    const u = 1 - t;
    return {
      x: Math.round((u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2) * 10) / 10,
      y: Math.round((u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2) * 10) / 10
    };
  };
  for (let k = 0; k <= 16; k++) points.push(at(k / 16));
  const d = `M${x0} ${y1}${x1 !== x0 ? ` L${x1} ${y1}` : ''} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  return { points, d, mid: at(0.5) };
}

/** Hue per node: each branch of the root keeps one palette colour down its subtree. */
export function branchHues(index, root, rootHue) {
  const palette = HUE_ORDER.filter((h) => h !== rootHue && h !== 'slate');
  const hue = new Map();
  const branches = [...(index.children.get(root) || []), ...index.roots.filter((r) => r !== root)];
  branches.forEach((b, i) => {
    const h = palette[i % palette.length];
    hue.set(b, h);
    for (const d of descendants(index, b)) hue.set(d, h);
  });
  return hue;
}

/**
 * Apply collapsed ids to a visible graph.
 * - Tree layouts: a collapsed node keeps its card and hides its subtree.
 * - Layered layout: a collapsed group becomes one summary card (id = group id)
 *   that takes over its members' edges.
 * Edges whose ends fold into one card disappear; parallel edges merge.
 * @returns { nodes, edges, groups, alias: Map<nodeId, visibleId>, edgeAlias: Map<edgeId, visibleEdgeId|null>,
 *            hidden: Map<nodeId, count>, active: Set<collapsed id actually applied> }
 */
export function collapseGraph({ nodes, edges, groups, collapsed, algorithm, index, L = null }) {
  const alias = new Map();
  const hidden = new Map();
  const active = new Set();
  const want = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  const nodeIds = new Set(nodes.map((n) => n.id));
  let outNodes = nodes;
  let outGroups = groups;

  if (want.size && isTreeAlgorithm(algorithm) && index) {
    // Outermost collapsed ancestor wins
    for (const id of nodes.map((n) => n.id)) {
      if (!want.has(id) || alias.has(id) || !(index.children.get(id) || []).length) continue;
      active.add(id);
      const below = descendants(index, id);
      hidden.set(id, below.length);
      for (const d of below) alias.set(d, id);
    }
    for (const [d, id] of alias) {
      let top = id;
      while (alias.has(top)) top = alias.get(top);
      alias.set(d, top);
    }
    for (const id of [...hidden.keys()]) if (alias.has(id)) hidden.delete(id), active.delete(id);
    outNodes = nodes.filter((n) => !alias.has(n.id));
  } else if (want.size && !isTreeAlgorithm(algorithm)) {
    const byId = new Map(groups.map((g) => [g.id, g]));
    const parentOf = (g) => (typeof g.parent === 'string' && byId.has(g.parent) ? g.parent : null);
    const chain = (g) => {
      const out = [];
      for (let q = g.id, n = 0; q && n < 16; q = parentOf(byId.get(q)), n++) out.push(q);
      return out;
    };
    const members = (gid) => {
      const out = [];
      const seen = new Set();
      const walk = (id) => {
        if (seen.has(id)) return;
        seen.add(id);
        const g = byId.get(id);
        for (const n of Array.isArray(g.nodes) ? g.nodes : []) if (nodeIds.has(n) && !alias.has(n)) out.push(n);
        for (const c of groups) if (parentOf(c) === id) walk(c.id);
      };
      walk(gid);
      return out;
    };
    const summaries = [];
    for (const g of groups) {
      if (!want.has(g.id) || nodeIds.has(g.id)) continue;
      if (chain(g).slice(1).some((a) => want.has(a))) continue; // an outer group is collapsed
      const list = members(g.id);
      if (!list.length) continue;
      // Boxes folded inside this one (with members): the card counts them too
      const inner = groups.filter((c) => c.id !== g.id && chain(c).includes(g.id) && members(c.id).length).length;
      active.add(g.id);
      list.forEach((n) => alias.set(n, g.id));
      hidden.set(g.id, list.length);
      summaries.push({
        id: g.id,
        data: {
          title: typeof g.title === 'string' && g.title ? g.title : g.id,
          subtitle: foldedText(list.length, inner, L),
          badge: L ? L.t('fold.badge') : 'Group',
          icon: 'layers',
          ...(typeof g.description === 'string' ? { description: g.description } : {})
        },
        summary: { group: g.id, count: list.length, hue: g.color },
        // manual layout: the card sits where its first member was
        ...pick(nodes.find((n) => n.id === list[0]))
      });
    }
    if (active.size) {
      // Nested collapsed groups vanish; a summary card joins its parent group
      const gone = new Set(groups.filter((g) => chain(g).some((a) => active.has(a))).map((g) => g.id));
      outGroups = groups
        .filter((g) => !gone.has(g.id))
        .map((g) => {
          const add = groups.filter((c) => active.has(c.id) && parentOf(c) === g.id).map((c) => c.id);
          return add.length ? { ...g, nodes: [...(Array.isArray(g.nodes) ? g.nodes : []), ...add] } : g;
        });
      // Each summary card takes the place of its first member
      const first = new Map();
      for (const n of nodes) if (alias.has(n.id) && !first.has(alias.get(n.id))) first.set(alias.get(n.id), n.id);
      outNodes = [];
      for (const n of nodes) {
        if (!alias.has(n.id)) outNodes.push(n);
        else if (first.get(alias.get(n.id)) === n.id) outNodes.push(summaries.find((s) => s.id === alias.get(n.id)));
      }
    }
  }

  const edgeAlias = new Map();
  let outEdges = edges;
  if (alias.size) {
    const seen = new Map();
    outEdges = [];
    for (const e of edges) {
      const s = alias.get(e.source) ?? e.source;
      const t = alias.get(e.target) ?? e.target;
      if (s === t) {
        edgeAlias.set(e.id, null);
        continue;
      }
      const key = `${s}\u0000${t}`;
      if (seen.has(key)) {
        edgeAlias.set(e.id, seen.get(key));
        continue;
      }
      seen.set(key, e.id);
      if (s !== e.source || t !== e.target) edgeAlias.set(e.id, e.id);
      outEdges.push(s === e.source && t === e.target ? e : { ...e, source: s, target: t });
    }
  }
  return { nodes: outNodes, edges: outEdges, groups: outGroups, alias, edgeAlias, hidden, active };
}

/** Summary card subtitle: "5 cards folded", or "9 cards · 3 groups" when boxes are folded inside. */
export function foldedText(cards, inner = 0, L = null) {
  if (!L) return inner ? `${cards} card${cards === 1 ? '' : 's'} · ${inner} group${inner === 1 ? '' : 's'}` : `${cards} card${cards === 1 ? '' : 's'} folded`;
  const n = L.num(cards);
  if (!inner) return L.plural(cards, 'fold.card', 'fold.cards', { n });
  return `${L.plural(cards, 'fold.cardCount1', 'fold.cardCount', { n })} · ${L.plural(inner, 'fold.groupCount1', 'fold.groupCount', { n: L.num(inner) })}`;
}

/** Collapsed ids that hide any of `ids` (a step that shows them expands these). */
export function hidingIds({ collapsed, algorithm, index, groups }, ids) {
  const out = new Set();
  const want = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  if (!want.size) return out;
  if (isTreeAlgorithm(algorithm) && index) {
    for (const id of ids) for (let p = index.parent.get(id); p !== undefined; p = index.parent.get(p)) if (want.has(p)) out.add(p);
  } else {
    const byId = new Map((groups || []).map((g) => [g.id, g]));
    const owner = new Map();
    for (const g of groups || []) for (const n of Array.isArray(g.nodes) ? g.nodes : []) if (!owner.has(n)) owner.set(n, g.id);
    for (const id of ids)
      for (let g = owner.get(id), k = 0; g && k < 16; g = byId.get(g)?.parent, k++) if (want.has(g)) out.add(g);
  }
  return out;
}

const spanOf = (v) => (Array.isArray(v) ? v : [-v / 2, v / 2]);

/** Side for self-loops in hierarchical layouts: across the flow, after the card. */
export const loopSideFor = (algorithm, direction) => (algorithm === 'tree' && direction === 'TB' ? 'right' : 'bottom');

const pick = (n) => (n && typeof n.x === 'number' && typeof n.y === 'number' ? { x: n.x, y: n.y } : {});

function normalise(raw) {
  const minX = minOf(raw, 'x');
  const minY = minOf(raw, 'y');
  const out = new Map();
  raw.forEach((p, id) => out.set(id, { x: snap(p.x - minX), y: snap(p.y - minY) }));
  return out;
}

function minOf(map, key) {
  let m = Infinity;
  map.forEach((p) => (m = Math.min(m, p[key])));
  return isFinite(m) ? m : 0;
}

function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      if ((a.x === last.x && last.x === p.x) || (a.y === last.y && last.y === p.y)) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

