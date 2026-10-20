/**
 * Orthogonal edge router.
 *
 * - Ports are spread along each node side (k / (n + 1)) and ordered by the
 *   position of the far endpoint, so edges leaving one side never cross.
 * - Paths are found with A* over a sparse grid built from node boundaries
 *   plus evenly spaced channel tracks; nodes (inflated by CLEAR) are hard
 *   obstacles, bends and reused tracks are penalised so edges spread out.
 * - Paths prefer to stay out of a soft halo around nodes, and Z-shaped
 *   jogs are slid to the middle of their gap afterwards.
 * - Group boxes: edges cross borders freely where they enter or leave, but
 *   avoid running along a border and stay out of the title strip.
 * - Self-loops are drawn, not searched: a fixed loop on the least busy side
 *   (or the side the layout reserved), which other routes treat as an obstacle.
 *   Ports on that side stay out of the loop; a dot or diamond keeps the side free.
 * - Ends at a pseudo-state (dot or diamond) are clipped to its outline; when
 *   several ends share a side, the extra ones take the free side with the
 *   cheapest route. Fork bars take edges along their length, at the bar face.
 * - Field rows (sourceField / targetField on entity and class cards) fix the
 *   port at the row, on the left or right side facing the other card.
 * - End labels (sourceLabel / targetLabel) sit beside each end, clear of markers.
 */
import { isotonic, selfLoop, labelSize, fieldLoop, FORK } from './layout.js';
import { POINT_SHAPES } from './model.js';
import { hasNotation } from './notation.js';
import { textWidth } from './text.js';

const STUB = 20; // straight run out of / into a port
const TRUNK = 40; // shared run out of a field row that several edges leave together
const CLEAR = 14; // minimum distance kept from any node
const HALO = 34; // softer zone around nodes that routes avoid when they can
const BEND = 26;
const SHARE = 40; // penalty per unit segment already used by another edge
const NEAR = 14; // parallel tracks closer than this are discouraged
const CROSS = 10;
const TITLE = 30; // cost multiplier inside a group title strip (effectively forbidden)
const BORDER = 8; // half-width of the band along a group border that routes avoid
// Graphs above either size route with windowed A* (see findPath)
export const WINDOW_NODES = 60;
export const WINDOW_EDGES = 120;
const WINDOW_MARGINS = [240, 720];
const WINDOW_GREED = 2; // heuristic weight for windowed searches

const DIRS = [
  [1, 0], // 0 east
  [0, 1], // 1 south
  [-1, 0], // 2 west
  [0, -1] // 3 north
];
const SIDE_DIR = { right: 0, bottom: 1, left: 2, top: 3 };

const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function chooseSides(a, b) {
  if (a === b) return ['right', 'top'];
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const gapX = Math.abs(dx) - (a.w + b.w) / 2;
  const gapY = Math.abs(dy) - (a.h + b.h) / 2;
  if (gapX >= gapY) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

/** Absolute y of a field row's centre on an entity / class card (rect.fields), or null. */
export const fieldY = (r, name) => (typeof name === 'string' && r?.fields?.has(name) ? r.y + r.fields.get(name) : null);

/** A fork bar takes edges only along its length: the side facing the other end. */
function barSide(r, other, side) {
  const vertical = r.h > r.w;
  if (vertical ? side === 'left' || side === 'right' : side === 'top' || side === 'bottom') return side;
  const c = center(r);
  const o = center(other);
  return vertical ? (o.x >= c.x ? 'right' : 'left') : o.y >= c.y ? 'bottom' : 'top';
}

/**
 * Sides of both ends of an edge: the layout hint or the facing sides, then
 * field rows (left / right of an entity card, facing the other card when the
 * two stand apart, else on the same side) and fork bars (along the bar).
 */
export function endSides(e, rects) {
  const a = rects.get(e.source);
  const b = rects.get(e.target);
  const sides = [...(e.sides || chooseSides(a, b))];
  const fa = fieldY(a, e.sourceField);
  const fb = fieldY(b, e.targetField);
  if (fa !== null || fb !== null) {
    const ca = center(a);
    const cb = center(b);
    const apart = Math.abs(cb.x - ca.x) - (a.w + b.w) / 2 >= STUB * 2;
    const toward = cb.x >= ca.x ? 'right' : 'left'; // side of a that faces b
    const back = toward === 'right' ? 'left' : 'right';
    if (fa !== null) sides[0] = apart || fb === null ? toward : 'right';
    if (fb !== null) sides[1] = apart || fa === null ? back : 'right';
  }
  if (a.shape === 'fork') sides[0] = barSide(a, b, sides[0]);
  if (b.shape === 'fork') sides[1] = barSide(b, a, sides[1]);
  return sides;
}

const LOOP_ORDER = ['top', 'right', 'bottom', 'left'];

/**
 * Side of every self-loop. Cards: the hint (e.sides[0]) when given, otherwise
 * the first side in LOOP_ORDER with the fewest ports of other edges. Loops
 * between field rows run on the left or right, whichever is less busy. A dot
 * or diamond keeps its loop on a side without ports (the hint first), so the
 * loop never crosses another edge's port.
 * @returns Map<edgeId, side>
 */
export function loopSides(rects, edges) {
  const used = new Map(); // `${node}|${side}` -> count
  const bump = (key) => used.set(key, (used.get(key) || 0) + 1);
  const loops = [];
  for (const e of edges) {
    if (!rects.has(e.source) || !rects.has(e.target)) continue;
    if (e.source === e.target) {
      loops.push(e);
      continue;
    }
    const sides = endSides(e, rects);
    bump(`${e.source}|${sides[0]}`);
    bump(`${e.target}|${sides[1]}`);
  }
  const out = new Map();
  for (const e of loops) {
    const r = rects.get(e.source);
    const count = (s) => used.get(`${e.source}|${s}`) || 0;
    const least = (order) => order.reduce((best, s) => (count(s) < count(best) ? s : best), order[0]);
    const hint = LOOP_ORDER.includes(e.sides?.[0]) ? e.sides[0] : null;
    let side;
    // a loop between field rows runs on the left or right; a hint (the side layout made room on) wins,
    // and a top / bottom hint (tree layouts) keeps an ordinary loop there
    if (fieldLoop(e) && r.fields && (!hint || hint === 'left' || hint === 'right')) side = hint || least(['right', 'left']);
    else if (POINT_SHAPES.has(r.shape)) side = least(hint ? [hint, ...LOOP_ORDER.filter((s) => s !== hint)] : LOOP_ORDER);
    else side = hint || least(LOOP_ORDER);
    bump(`${e.source}|${side}`);
    out.set(e.id, side);
  }
  return out;
}

/** Ends sharing one field row: tracks this far apart (less when many share it), within the row. */
const ROW_TRACK = 12;
const ROW_SPAN = 18;

/** Head row a field loop joins when one of its fields is missing. */
const headY = (r) => r.y + Math.min(30, r.h / 2);

/**
 * Ends that meet at one field row on one side of a card. Ends going to
 * different places share the row's port and leave as one trunk (a family);
 * parallel ends (same far card and row) and self-loop legs get tracks of
 * their own across the row: loop legs on the inside (towards the loop's other
 * leg), so a loop nests inside the edges leaving the same row.
 * @returns { offset: Map<`${edgeId}|${role}`, dy>, family: Map<`${edgeId}|${role}`, key> }
 */
export function rowSlots(rects, edges, sides = loopSides(rects, edges)) {
  const rows = new Map(); // `${node}|${side}|${y}` -> [{ id, role, ref, far, loop?: inward, rank }]
  edges.forEach((e, rank) => {
    if (!rects.has(e.source) || !rects.has(e.target)) return;
    const a = rects.get(e.source);
    if (e.source === e.target) {
      const side = sides.get(e.id);
      if (!fieldLoop(e) || !a.fields || (side !== 'left' && side !== 'right')) return;
      const ys = [fieldY(a, e.sourceField), fieldY(a, e.targetField)];
      const legs = ys.map((y) => y ?? headY(a));
      ys.forEach((y, role) => {
        if (y !== null) push(rows, `${e.source}|${side}|${y}`, { id: e.id, role, loop: Math.sign(legs[1 - role] - legs[role]), rank });
      });
      return;
    }
    const b = rects.get(e.target);
    const s = endSides(e, rects);
    const same = s[0] === s[1];
    [[a, b, e.sourceField, e.targetField, e.target, 0], [b, a, e.targetField, e.sourceField, e.source, 1]].forEach(([r, o, name, other, farId, role]) => {
      const side = s[role];
      const y = side === 'left' || side === 'right' ? fieldY(r, name) : null;
      if (y === null) return;
      const far = `${farId}|${s[1 - role]}|${fieldY(o, other) ?? ''}`;
      push(rows, `${role ? e.target : e.source}|${side}|${y}`, { id: e.id, role, ref: center(o).y, far, rank: role && same ? -rank : rank });
    });
  });
  const offset = new Map();
  const family = new Map();
  for (const [key, list] of rows) {
    if (list.length < 2) continue;
    const loops = list.filter((p) => p.loop !== undefined);
    const fars = new Set(list.map((p) => p.far));
    if (!loops.length && fars.size === list.length) {
      list.forEach((p) => family.set(`${p.id}|${p.role}`, key));
      continue;
    }
    const n = list.length;
    const gap = Math.min(ROW_TRACK, ROW_SPAN / (n - 1));
    const up = loops.filter((p) => p.loop < 0);
    const down = loops.filter((p) => p.loop > 0);
    const flat = loops.filter((p) => p.loop === 0);
    const rest = [...list.filter((p) => p.loop === undefined).sort((p, q) => p.ref - q.ref || p.rank - q.rank), ...flat];
    [...up, ...rest, ...down].forEach((p, k) => offset.set(`${p.id}|${p.role}`, Math.round((k - (n - 1) / 2) * gap)));
  }
  return { offset, family };
}

/** Self-loop geometry for every loop edge: Map<edgeId, selfLoop()>. */
export function loopGeometry(rects, edges, slots = null) {
  const out = new Map();
  const sides = loopSides(rects, edges);
  const { offset } = slots || rowSlots(rects, edges, sides);
  for (const [id, side] of sides) {
    const e = edges.find((x) => x.id === id);
    const r = rects.get(e.source);
    const opts = { shape: r.shape, marked: e.marked ?? hasNotation(e) };
    if (fieldLoop(e) && r.fields && (side === 'left' || side === 'right')) {
      // a missing field end joins the card's header; a row shared with other ends gives the leg its own track
      const at = (name, role) => {
        const y = fieldY(r, name);
        return y === null ? headY(r) : y + (offset.get(`${id}|${role}`) || 0);
      };
      opts.ys = [at(e.sourceField, 0), at(e.targetField, 1)];
    }
    out.set(id, selfLoop(r, side, labelSize(e.label), opts));
  }
  return out;
}

/**
 * @param rects Map<nodeId, {x,y,w,h, shape?, fields?: Map<fieldName, row centre from the card top>}>
 * @param edges [{ id, source, target, sides?: [src,tgt], label?, sourceField?, targetField?, marked? }]
 * @param options { groups?: [{ x, y, w, h, titleBox }] }
 * @returns Map<edgeId, { points: [{x,y}], ok: boolean, label?: fixed self-loop label }>
 */
export function routeEdges(rects, edges, { groups: containers = [] } = {}) {
  const all = edges.filter((e) => rects.has(e.source) && rects.has(e.target));
  const list = all.filter((e) => e.source !== e.target);
  const slots = rowSlots(rects, all);
  const loops = loopGeometry(rects, all, slots);
  const windowed = list.length > WINDOW_EDGES || rects.size > WINDOW_NODES;

  // --- Sides and spread ports -------------------------------------------
  const ends = new Map(); // `${node}|${side}` -> [{ edge, role, ref, field }]
  for (const e of list) {
    const a = rects.get(e.source);
    const b = rects.get(e.target);
    const sides = endSides(e, rects);
    const row = (r, side, name, role) => {
      const y = side === 'left' || side === 'right' ? fieldY(r, name) : null;
      return y === null ? null : y + (slots.offset.get(`${e.id}|${role}`) || 0);
    };
    push(ends, `${e.source}|${sides[0]}`, { edge: e, role: 0, ref: center(b), field: row(a, sides[0], e.sourceField, 0) });
    push(ends, `${e.target}|${sides[1]}`, { edge: e, role: 1, ref: center(a), field: row(b, sides[1], e.targetField, 1) });
  }
  // Sides a self-loop occupies: dots and diamonds keep them free of ports,
  // cards keep ports out of the stretch between the loop's legs
  const loopKeys = new Set();
  const loopSpan = new Map(); // `${node}|${side}` -> [lo, hi] along the side
  for (const [id, loop] of loops) {
    const node = all.find((e) => e.id === id).source;
    const key = `${node}|${loop.side}`;
    if (POINT_SHAPES.has(rects.get(node).shape)) loopKeys.add(key);
    else {
      const axis = loop.side === 'left' || loop.side === 'right' ? 'y' : 'x';
      const legs = [loop.points[0][axis], loop.points[loop.points.length - 1][axis]];
      const old = loopSpan.get(key) || [Infinity, -Infinity];
      loopSpan.set(key, [Math.min(old[0], ...legs) - 14, Math.max(old[1], ...legs) + 14]);
    }
  }
  // Ends that leave a dot or diamond from a shared or occupied side pick their side while routing
  const flex = spreadPointPorts(ends, rects, loopKeys);
  // Port positions: spread along the middle of each side, then pulled
  // (isotonic fit, order and spacing preserved) towards the far port so
  // facing ports line up and edges come out straight. Field rows fix theirs.
  const groups = [];
  const where = new Map(); // `${edgeId}|${role}` -> [group, index]
  const rows = new Map(); // `${node}|${side}` -> [y] of field ports
  for (const [key, members] of ends) {
    const [nodeId, side] = key.split('|');
    const r = rects.get(nodeId);
    const vertical = side === 'left' || side === 'right';
    for (const p of members.filter((q) => q.field !== null)) {
      const g = { key, r, side, vertical, group: [p], pos: [p.field], gap: 0, lo: p.field, hi: p.field, fixed: true };
      groups.push(g);
      where.set(`${p.edge.id}|${p.role}`, [g, 0]);
      push(rows, key, p.field);
    }
    const free = members.filter((q) => q.field === null);
    if (!free.length) continue;
    free.sort((p, q) => (vertical ? p.ref.y - q.ref.y : p.ref.x - q.ref.x) || cmp(p.edge.id, q.edge.id));
    const len = vertical ? r.h : r.w;
    const start = vertical ? r.y : r.x;
    const mid = start + len / 2;
    // Fork bars take edges along their whole length
    const half = r.shape === 'fork' ? len / 2 - 8 : len * 0.3;
    let lo = mid - half;
    const hi = mid + half;
    if (side === 'top') {
      // Top ports never sit under a group title just above the node
      for (const gr of containers) {
        const t = gr.titleBox;
        if (!t || t.y + t.h > r.y || t.y + t.h < r.y - STUB - 30) continue;
        if (t.x < hi && t.x + t.w + 8 > lo && t.x + t.w + 8 <= hi - 4) lo = Math.max(lo, t.x + t.w + 8);
      }
    }
    // A self-loop on this side: ports go before or after its legs
    const parts = [];
    const span = loopSpan.get(key);
    const axis = vertical ? 'y' : 'x';
    if (span) {
      const before = [start + 10, Math.min(hi, span[0])];
      const after = [Math.max(lo, span[1]), start + len - 10];
      const roomBefore = before[1] >= before[0];
      const roomAfter = after[1] >= after[0];
      const c = (span[0] + span[1]) / 2;
      if (!roomBefore && !roomAfter) parts.push([free, lo, hi]);
      else if (!roomBefore) parts.push([free, ...after]);
      else if (!roomAfter) parts.push([free, ...before]);
      else {
        const head = free.filter((p) => p.ref[axis] < c);
        const tail = free.filter((p) => p.ref[axis] >= c);
        if (head.length) parts.push([head, ...before]);
        if (tail.length) parts.push([tail, ...after]);
      }
    } else parts.push([free, lo, hi]);
    for (const [group, plo, phi] of parts) {
      const n = group.length;
      const gap = n > 1 ? Math.min(18, (phi - plo) / (n - 1)) : 0;
      const c = (plo + phi) / 2;
      const g = { key, r, side, vertical, group, lo: plo, hi: phi, gap, pos: group.map((_, k) => c + (k - (n - 1) / 2) * gap) };
      groups.push(g);
      group.forEach((p, k) => where.set(`${p.edge.id}|${p.role}`, [g, k]));
    }
  }
  for (let iter = 0; iter < 6; iter++) {
    for (const g of groups) {
      if (g.fixed) continue;
      const desired = g.group.map((p) => {
        const other = where.get(`${p.edge.id}|${1 - p.role}`);
        // a fork bar lines its ports up with the middle of the cards it joins
        if (other && other[0] !== g && other[0].vertical === g.vertical && g.r.shape !== 'fork') return other[0].pos[other[1]];
        return p.ref[g.vertical ? 'y' : 'x'];
      });
      const n = desired.length;
      const q = isotonic(desired.map((d, k) => d - k * g.gap), desired.map(() => 1));
      const maxQ = g.hi - (n - 1) * g.gap;
      g.pos = q.map((v, k) => Math.min(maxQ, Math.max(g.lo, v)) + k * g.gap);
    }
  }
  // Other ports keep clear of field rows on the same side
  for (const g of groups) {
    const taken0 = !g.fixed && rows.get(g.key);
    if (!taken0) continue;
    const start = g.vertical ? g.r.y : g.r.x;
    const end = start + (g.vertical ? g.r.h : g.r.w);
    const placed = [];
    g.pos = g.pos.map((v) => {
      const taken = [...taken0, ...placed];
      let w = v;
      if (taken.some((t) => Math.abs(t - v) < 10)) {
        for (let d = 10; d < end - start && w === v; d += 10)
          for (const u of [v + d, v - d]) if (u > start + 6 && u < end - 6 && !taken.some((t) => Math.abs(t - u) < 10)) { w = u; break; }
      }
      placed.push(w);
      return w;
    });
  }
  const ports = new Map(); // `${edgeId}|${role}` -> { x, y, dir }
  const portAt = (r, side, t) =>
    side === 'left' ? { x: r.x, y: t } :
    side === 'right' ? { x: r.x + r.w, y: t } :
    side === 'top' ? { x: t, y: r.y } : { x: t, y: r.y + r.h };
  for (const g of groups)
    g.group.forEach((p, k) => ports.set(`${p.edge.id}|${p.role}`, { ...portAt(g.r, g.side, Math.round(g.pos[k])), dir: SIDE_DIR[g.side] }));
  // Candidate ports of a flexible end: the middle of each free side of its dot or diamond
  const sidePort = (r, side) => ({ ...portAt(r, side, Math.round(side === 'left' || side === 'right' ? r.y + r.h / 2 : r.x + r.w / 2)), dir: SIDE_DIR[side] });
  const candidates = (e, role) => {
    const key = `${e.id}|${role}`;
    if (ports.has(key)) return [{ port: ports.get(key) }];
    const f = flex.get(key);
    const r = rects.get(f.node);
    return f.free.map((side) => ({ port: sidePort(r, side), side, f }));
  };

  // --- Sparse grid ------------------------------------------------------
  const obstacles = [...rects.values()].map((r) => ({
    x0: r.x - CLEAR, y0: r.y - CLEAR, x1: r.x + r.w + CLEAR, y1: r.y + r.h + CLEAR
  }));
  // Loops (with their labels) are fixed: other routes keep clear of them
  for (const { box: b } of loops.values()) obstacles.push({ x0: b.x - 6, y0: b.y - 6, x1: b.x + b.w + 6, y1: b.y + b.h + 6 });
  // Ends that leave one field row together (a family) share a longer trunk out of
  // the port, then branch: routes of one family may run on each other's tracks
  const famNo = new Map(); // family key -> number (1...)
  const fams = new Map(); // edgeId -> [family of the source end, of the target end] (0 = none)
  for (const e of list)
    fams.set(e.id, [0, 1].map((role) => {
      const key = slots.family.get(`${e.id}|${role}`);
      if (!key) return 0;
      if (!famNo.has(key)) famNo.set(key, famNo.size + 1);
      const p = ports.get(`${e.id}|${role}`);
      const [dx, dy] = DIRS[p.dir];
      const tip = { x: p.x + dx * TRUNK, y: p.y + dy * TRUNK };
      const own = rects.get(role ? e.target : e.source);
      if (!obstacles.some((o, k) => o.x0 < tip.x && tip.x < o.x1 && o.y0 < tip.y && tip.y < o.y1 && !(k < rects.size && [...rects.values()][k] === own))) p.stub = TRUNK;
      return famNo.get(key);
    }));
  const xsSet = new Set();
  const ysSet = new Set();
  for (const o of obstacles) {
    xsSet.add(o.x0); xsSet.add(o.x1);
    ysSet.add(o.y0); ysSet.add(o.y1);
  }
  const titles = containers.filter((gr) => gr.titleBox).map(({ titleBox: t }) => ({ x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h }));
  for (const gr of containers) {
    // tracks just outside each box so detours run clear of the border
    xsSet.add(gr.x - 12); xsSet.add(gr.x + gr.w + 12);
    ysSet.add(gr.y - 12); ysSet.add(gr.y + gr.h + 12);
  }
  const flexPorts = [...flex.values()].flatMap((f) => f.free.map((side) => sidePort(rects.get(f.node), side)));
  for (const p of [...ports.values(), ...flexPorts]) {
    const [dx, dy] = DIRS[p.dir];
    xsSet.add(p.x); ysSet.add(p.y);
    xsSet.add(p.x + dx * (p.stub || STUB)); ysSet.add(p.y + dy * (p.stub || STUB));
  }
  const frame = [...obstacles, ...containers.map((gr) => ({ x0: gr.x, y0: gr.y, x1: gr.x + gr.w, y1: gr.y + gr.h }))].reduce(
    (f, o) => ({ x0: Math.min(f.x0, o.x0), y0: Math.min(f.y0, o.y0), x1: Math.max(f.x1, o.x1), y1: Math.max(f.y1, o.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  );
  xsSet.add(frame.x0 - 40); xsSet.add(frame.x1 + 40);
  ysSet.add(frame.y0 - 40); ysSet.add(frame.y1 + 40);
  // Large graphs get fewer channel tracks per gap: a much smaller search grid
  const maxTracks = windowed ? 2 : 5;
  const xs = withTracks([...xsSet], maxTracks);
  const ys = withTracks([...ysSet], maxTracks);
  const nx = xs.length;
  const ny = ys.length;
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));

  // blockedH[j*nx+i]: segment (i,j)-(i+1,j); blockedV[j*nx+i]: (i,j)-(i,j+1)
  const blockedH = new Uint8Array(nx * ny);
  const blockedV = new Uint8Array(nx * ny);
  const haloH = new Uint8Array(nx * ny);
  const haloV = new Uint8Array(nx * ny);
  markRects(obstacles, blockedH, blockedV);
  markRects(
    [...rects.values()].map((r) => ({ x0: r.x - HALO, y0: r.y - HALO, x1: r.x + r.w + HALO, y1: r.y + r.h + HALO })),
    haloH,
    haloV
  );
  const titleH = new Uint8Array(nx * ny);
  const titleV = new Uint8Array(nx * ny);
  const borderH = new Uint8Array(nx * ny);
  const borderV = new Uint8Array(nx * ny);
  if (containers.length) {
    markRects(titles.map((t) => ({ x0: t.x0 - 2, y0: t.y0 - 2, x1: t.x1 + 2, y1: t.y1 + 2 })), titleH, titleV);
    const bands = [];
    for (const gr of containers) {
      const x1 = gr.x + gr.w;
      const y1 = gr.y + gr.h;
      bands.push(
        { x0: gr.x, y0: gr.y - BORDER, x1, y1: gr.y + BORDER },
        { x0: gr.x, y0: y1 - BORDER, x1, y1: y1 + BORDER },
        { x0: gr.x - BORDER, y0: gr.y, x1: gr.x + BORDER, y1 },
        { x0: x1 - BORDER, y0: gr.y, x1: x1 + BORDER, y1 }
      );
    }
    markRects(bands, borderH, borderV);
  }
  function markRects(boxes, outH, outV) {
    const eps = 0.5;
    for (const o of boxes) {
    const i0 = lowerBound(xs, o.x0 - eps);
    const i1 = lowerBound(xs, o.x1 + eps);
    const j0 = lowerBound(ys, o.y0 - eps);
    const j1 = lowerBound(ys, o.y1 + eps);
    for (let j = j0; j < j1 && j < ny; j++) {
      const y = ys[j];
      for (let i = i0; i < i1 && i < nx; i++) {
        const x = xs[i];
        if (y > o.y0 + eps && y < o.y1 - eps && i + 1 < nx && xs[i + 1] <= o.x1 + eps) outH[j * nx + i] = 1;
        if (x > o.x0 + eps && x < o.x1 - eps && j + 1 < ny && ys[j + 1] <= o.y1 + eps) outV[j * nx + i] = 1;
      }
    }
    }
  }
  const usedH = new Uint16Array(nx * ny);
  const usedV = new Uint16Array(nx * ny);
  const famH = new Int32Array(nx * ny); // family whose routes alone use a segment (0 none, -1 several)
  const famV = new Int32Array(nx * ny);
  let fam = [0, 0]; // families of the edge being routed
  let trunk = [false, false]; // its ends leave a shared trunk: turn at the trunk's tip
  const nearH = new Uint16Array(nx * ny);
  const nearV = new Uint16Array(nx * ny);
  const turnedAt = new Uint8Array(nx * ny); // bit 1: horizontal pass, bit 2: vertical pass

  // A* state lives in typed arrays shared by every edge; a stamp marks which
  // entries belong to the current search, so nothing is cleared or rehashed.
  const states = nx * ny * 4;
  const gCost = new Float64Array(states);
  const prevState = new Int32Array(states);
  const stamp = new Uint32Array(states);
  const heap = new Heap();
  let search = 0;
  // Large graphs: windowed, weighted A* (inflated heuristic: near-optimal, far
  // fewer expansions) with a per-search budget; an edge that still finds no
  // path in its windows retries over the whole grid with obstacles only.
  const maxExpansions = windowed ? Math.max(20000, Math.min(400000, states / 4)) : Infinity;

  // --- Route, short edges first so long ones detour around them ---------
  const results = new Map();
  const at = (e, role) => ports.get(`${e.id}|${role}`) || center(rects.get(role ? e.target : e.source));
  const ordered = list
    .map((e) => {
      const s = at(e, 0);
      const t = at(e, 1);
      return { e, d: Math.abs(s.x - t.x) + Math.abs(s.y - t.y) };
    })
    .sort((a, b) => a.d - b.d);

  for (const { e } of ordered) {
    fam = fams.get(e.id);
    // A flexible end tries every free side of its dot or diamond: the cheapest route wins
    let best = null;
    for (const S of candidates(e, 0))
      for (const T of candidates(e, 1)) {
        const cells = attempt(S.port, T.port);
        const cost = cells ? cells.cost : Infinity;
        if (!best || cost < best.cost) best = { S, T, cells, cost };
      }
    const { S, T, cells } = best;
    for (const C of [S, T])
      if (C.f) {
        C.f.free.splice(C.f.free.indexOf(C.side), 1);
        ports.set(`${e.id}|${C === S ? 0 : 1}`, C.port);
      }
    const s = S.port;
    const t = T.port;
    const ok = !!cells;
    let points;
    if (ok) {
      points = [s, ...cells.map((c) => ({ x: xs[c.i], y: ys[c.j] })), t];
      markUsed(cells, fam);
    } else {
      // Fallback keeps the drawing connected; the validator reports it.
      const sStub = stubOf(s);
      const tStub = stubOf(t);
      points = [s, sStub, { x: tStub.x, y: sStub.y }, tStub, t];
    }
    results.set(e.id, { points: simplify(points.map(({ x, y }) => ({ x, y }))), ok, fam });
  }
  centerJogs(results, [...obstacles, ...titles]);
  for (const e of list) {
    const r = results.get(e.id);
    clipToShape(r.points, rects.get(e.source), true);
    clipToShape(r.points, rects.get(e.target), false);
  }
  for (const r of results.values()) delete r.fam;
  for (const [id, loop] of loops) results.set(id, { points: loop.points, ok: true, ...(loop.label ? { label: loop.label } : {}) });
  return results;

  function stubOf(p) {
    const len = p.stub || STUB;
    return { x: p.x + DIRS[p.dir][0] * len, y: p.y + DIRS[p.dir][1] * len };
  }

  /** Grid path between two ports (null when there is none), with its cost. */
  function attempt(s, t) {
    const sStub = stubOf(s);
    const tStub = stubOf(t);
    trunk = [!!s.stub, !!t.stub];
    const start = { i: xi.get(sStub.x), j: yi.get(sStub.y), d: s.dir };
    const goal = { i: xi.get(tStub.x), j: yi.get(tStub.y) };
    if (start.i === undefined || start.j === undefined || goal.i === undefined || goal.j === undefined) return null;
    return findPath(start, goal, (t.dir + 2) % 4); // travel direction when entering the target
  }

  // Small graphs search the whole grid (exact, as before). Large graphs search
  // a window around the two ends first and widen it only when that fails, so
  // each edge explores a neighbourhood instead of the whole drawing.
  function findPath(start, goal, arriveDir) {
    const full = { i0: 0, j0: 0, i1: nx - 1, j1: ny - 1 };
    if (!windowed) return astar(start, goal, arriveDir, full, 1, Infinity);
    const x0 = Math.min(xs[start.i], xs[goal.i]);
    const x1 = Math.max(xs[start.i], xs[goal.i]);
    const y0 = Math.min(ys[start.j], ys[goal.j]);
    const y1 = Math.max(ys[start.j], ys[goal.j]);
    for (const margin of WINDOW_MARGINS) {
      const win = {
        i0: Math.max(0, lowerBound(xs, x0 - margin) - 1),
        i1: Math.min(nx - 1, lowerBound(xs, x1 + margin)),
        j0: Math.max(0, lowerBound(ys, y0 - margin) - 1),
        j1: Math.min(ny - 1, lowerBound(ys, y1 + margin))
      };
      const path = astar(start, goal, arriveDir, win, WINDOW_GREED, maxExpansions);
      if (path) return path;
      if (win.i0 === 0 && win.j0 === 0 && win.i1 === nx - 1 && win.j1 === ny - 1) break;
    }
    // Last resort: obstacles only (no sharing, halo or crossing penalties)
    return astar(start, goal, arriveDir, full, 2, Infinity, true);
  }

  function astar(start, goal, arriveDir, win, greed, budget, plain = false) {
    search++;
    heap.clear();
    const gx = xs[goal.i];
    const gy = ys[goal.j];
    const h = (i, j) => (Math.abs(xs[i] - gx) + Math.abs(ys[j] - gy)) * greed;
    const { i0, i1, j0, j1 } = win;
    const k0 = ((start.j * nx + start.i) << 2) | start.d;
    stamp[k0] = search;
    gCost[k0] = 0;
    prevState[k0] = -1;
    heap.push(h(start.i, start.j), k0);
    let expansions = 0;
    while (heap.size) {
      const f = heap.topPriority();
      const k = heap.pop();
      const d = k & 3;
      const cell = k >> 2;
      const i = cell % nx;
      const j = (cell - i) / nx;
      const gk = gCost[k];
      if (f > gk + h(i, j)) continue; // stale heap entry: a cheaper one was expanded already
      if (++expansions > budget) return null;
      if (i === goal.i && j === goal.j && (arriveDir < 0 || d !== (arriveDir + 2) % 4)) {
        const path = [];
        for (let c = k; c !== -1; c = prevState[c]) {
          const cc = c >> 2;
          const ci = cc % nx;
          path.push({ i: ci, j: (cc - ci) / nx, d: c & 3 });
        }
        path.reverse();
        path.cost = gk;
        return path;
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue; // no U-turns
        const ni = i + DIRS[nd][0];
        const nj = j + DIRS[nd][1];
        if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue;
        let len;
        let shared;
        let near;
        let inTitle;
        let onBorder;
        let beside;
        if (nd === 0 || nd === 2) {
          const at = j * nx + (ni < i ? ni : i);
          if (blockedH[at]) continue;
          len = Math.abs(xs[ni] - xs[i]);
          shared = usedH[at] && kin(famH[at]) ? 0 : usedH[at];
          if (usedH[at] && !shared) len *= 0.5;
          near = haloH[at];
          inTitle = titleH[at];
          onBorder = borderH[at];
          beside = nearH[at];
        } else {
          const at = (nj < j ? nj : j) * nx + i;
          if (blockedV[at]) continue;
          len = Math.abs(ys[nj] - ys[j]);
          shared = usedV[at] && kin(famV[at]) ? 0 : usedV[at];
          if (usedV[at] && !shared) len *= 0.5;
          near = haloV[at];
          inTitle = titleV[at];
          onBorder = borderV[at];
          beside = nearV[at];
        }
        if (inTitle) len = len * TITLE + 400;
        else if (onBorder) len *= 4;
        let cost = plain
          ? gk + len + (nd !== d ? BEND : 0)
          : gk + len * (near ? 1.6 : 1) + (nd !== d ? BEND : 0) + shared * (SHARE + len * 2) + beside * len * 0.8;
        const crossBit = nd === 0 || nd === 2 ? 2 : 1;
        if (turnedAt[nj * nx + ni] & crossBit) cost += CROSS;
        if (ni === goal.i && nj === goal.j && arriveDir >= 0 && nd !== arriveDir) cost += BEND;
        // a trunk branches where it ends: going straight on past its tip costs extra
        if (trunk[0] && k === k0 && nd === d) cost += BEND * 2;
        if (trunk[1] && ni === goal.i && nj === goal.j && nd === arriveDir) cost += BEND * 2;
        const nk = ((nj * nx + ni) << 2) | nd;
        if (stamp[nk] !== search || cost < gCost[nk]) {
          stamp[nk] = search;
          gCost[nk] = cost;
          prevState[nk] = k;
          heap.push(cost + h(ni, nj), nk);
        }
      }
    }
    return null;
  }

  /** The segment is used only by routes of a family the current edge belongs to. */
  function kin(f) {
    return f > 0 && (f === fam[0] || f === fam[1]);
  }

  function markUsed(cells, [f0, f1]) {
    const own = f0 || f1; // a route in two families shares tracks with both, but marks the first
    const mark = (arr, at, used) => (arr[at] = used === 1 ? own : arr[at] === own || kin2(arr[at]) ? arr[at] : -1);
    const kin2 = (f) => f > 0 && (f === f0 || f === f1);
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1];
      const b = cells[k];
      if (a.j === b.j && a.i !== b.i) {
        const si = Math.min(a.i, b.i);
        mark(famH, a.j * nx + si, ++usedH[a.j * nx + si]);
        // tracks closer than NEAR read as one thick line: discourage them
        for (let jj = a.j - 1; jj >= 0 && ys[a.j] - ys[jj] < NEAR; jj--) nearH[jj * nx + si]++;
        for (let jj = a.j + 1; jj < ny && ys[jj] - ys[a.j] < NEAR; jj++) nearH[jj * nx + si]++;
        turnedAt[a.j * nx + a.i] |= 1; turnedAt[b.j * nx + b.i] |= 1;
      } else if (a.i === b.i && a.j !== b.j) {
        const sj = Math.min(a.j, b.j);
        mark(famV, sj * nx + a.i, ++usedV[sj * nx + a.i]);
        for (let ii = a.i - 1; ii >= 0 && xs[a.i] - xs[ii] < NEAR; ii--) nearV[sj * nx + ii]++;
        for (let ii = a.i + 1; ii < nx && xs[ii] - xs[a.i] < NEAR; ii++) nearV[sj * nx + ii]++;
        turnedAt[a.j * nx + a.i] |= 2; turnedAt[b.j * nx + b.i] |= 2;
      }
    }
  }
}

/**
 * Slide the middle leg of every Z-shaped route (H-V-H or V-H-V) to the centre
 * of the free span between its neighbours, picking the nearest offset that
 * neither hits a node nor runs on top of another edge.
 */
function centerJogs(results, obstacles) {
  const all = [...results.values()];
  const hits = (a, b) => {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return obstacles.some((o) => x0 < o.x1 - 0.5 && x1 > o.x0 + 0.5 && y0 < o.y1 - 0.5 && y1 > o.y0 + 0.5);
  };
  // Port legs start inside their own node's clearance zone: test from the stub end
  const trim = (port, toward, isPort) => {
    if (!isPort) return port;
    const dx = Math.sign(toward.x - port.x);
    const dy = Math.sign(toward.y - port.y);
    return { x: port.x + dx * STUB, y: port.y + dy * STUB };
  };
  const overlap = (a0, a1, b0, b1) => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const stacked = (self, a, b) => {
    const vertical = a.x === b.x;
    for (const r of all) {
      if (r === self) continue;
      const p = r.points;
      for (let k = 1; k < p.length; k++) {
        const c = p[k - 1];
        const d = p[k];
        if (vertical && c.x === d.x && Math.abs(c.x - a.x) < 8 && overlap(c.y, d.y, a.y, b.y) > 0) return true;
        if (!vertical && c.y === d.y && Math.abs(c.y - a.y) < 8 && overlap(c.x, d.x, a.x, b.x) > 0) return true;
      }
    }
    return false;
  };

  // 1. Remove tiny jogs by moving an adjoining leg onto the other's line
  for (const r of all) {
    if (!r.ok) continue;
    let p = r.points;
    for (let k = 1; k + 2 < p.length; k++) {
      const a = p[k - 1];
      const b = p[k];
      const c = p[k + 1];
      const next = p[k + 2];
      const jogVertical = b.x === c.x && a.y === b.y && c.y === next.y;
      const jogHorizontal = b.y === c.y && a.x === b.x && c.x === next.x;
      if (!jogVertical && !jogHorizontal) continue;
      const perp = jogVertical ? 'y' : 'x';
      if (Math.abs(c[perp] - b[perp]) >= 16) continue;
      const tryPoints = (candidate) => {
        const q = simplify(candidate);
        for (let m = 1; m < q.length; m++) {
          if (m > 1 && m < q.length - 1 && hits(q[m - 1], q[m])) return null;
          if (stacked(r, q[m - 1], q[m])) return null;
        }
        return q;
      };
      let fixed = null;
      if (k - 1 >= 1) {
        // shift leg a-b onto c's line (a is a bend, so its other leg stretches)
        const a2 = { ...a, [perp]: c[perp] };
        fixed = tryPoints([...p.slice(0, k - 1), a2, ...p.slice(k + 1)]);
      }
      if (!fixed && k + 2 <= p.length - 2) {
        const n2 = { ...next, [perp]: b[perp] };
        fixed = tryPoints([...p.slice(0, k + 1), n2, ...p.slice(k + 3)]);
      }
      if (fixed) {
        r.points = p = fixed;
        k = 0;
      }
    }
  }

  // 2. Centre the middle leg of Z shapes in their gap
  for (const r of all) {
    if (!r.ok) continue;
    const p = r.points;
    for (let k = 1; k + 2 < p.length; k++) {
      const a = p[k - 1];
      const b = p[k];
      const c = p[k + 1];
      const next = p[k + 2];
      // a-b runs along one axis, b-c is the jog, c-next continues the first axis
      const vertical = b.x === c.x && a.y === b.y && c.y === next.y;
      const horizontal = b.y === c.y && a.x === b.x && c.x === next.x;
      if (!vertical && !horizontal) continue;
      const axis = vertical ? 'x' : 'y';
      if (Math.sign(b[axis] - a[axis]) !== Math.sign(next[axis] - c[axis])) continue; // Z only
      if ((k === 1 && r.fam?.[0]) || (k + 2 === p.length - 1 && r.fam?.[1])) continue; // a shared trunk stays put
      const dir = Math.sign(next[axis] - a[axis]);
      // keep the straight stub out of each port
      const from = a[axis] + (k === 1 ? STUB * dir : 0);
      const to = next[axis] - (k + 2 === p.length - 1 ? STUB * dir : 0);
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      if (hi - lo < 16) continue;
      const mid = Math.round((lo + hi) / 2);
      for (const off of [0, 14, -14, 28, -28, 42, -42]) {
        const v = mid + off;
        if (v <= lo + 4 || v >= hi - 4) continue;
        const nb = { ...b, [axis]: v };
        const nc = { ...c, [axis]: v };
        if (hits(trim(a, nb, k === 1), nb) || hits(nb, nc) || hits(nc, trim(next, nc, k + 2 === p.length - 1))) continue;
        if (stacked(r, nb, nc)) continue;
        p[k] = nb;
        p[k + 1] = nc;
        break;
      }
    }
  }
}

/**
 * A dot or diamond is too small for several ports on one side: the end most
 * in line keeps that side, the others (and any end on a side its self-loop
 * holds) become flexible: while routing they take whichever free side gives
 * the cheapest route, so an edge enters the dot directly instead of detouring.
 * @returns Map<`${edgeId}|${role}`, { node, free: [side] (shared per node, consumed), home }>
 */
function spreadPointPorts(ends, rects, blocked) {
  const flex = new Map();
  const nodes = new Set([...ends.keys()].map((k) => k.split('|')[0]).filter((id) => POINT_SHAPES.has(rects.get(id)?.shape)));
  for (const nodeId of nodes) {
    const c = center(rects.get(nodeId));
    const kept = new Set();
    const moving = [];
    for (const side of LOOP_ORDER) {
      const key = `${nodeId}|${side}`;
      const group = ends.get(key);
      if (!group?.length) continue;
      const axis = side === 'left' || side === 'right' ? 'y' : 'x';
      const sorted = [...group].sort((p, q) => Math.abs(p.ref[axis] - c[axis]) - Math.abs(q.ref[axis] - c[axis]) || cmp(p.edge.id, q.edge.id));
      if (blocked.has(key)) {
        moving.push(...sorted.map((p) => ({ p, side })));
        ends.delete(key);
      } else {
        kept.add(side);
        moving.push(...sorted.slice(1).map((p) => ({ p, side })));
        ends.set(key, [sorted[0]]);
      }
    }
    const free = LOOP_ORDER.filter((s) => !kept.has(s) && !blocked.has(`${nodeId}|${s}`));
    moving.forEach(({ p, side }, k) => {
      // more ends than free sides: the rest share their side after all
      if (k < free.length) flex.set(`${p.edge.id}|${p.role}`, { node: nodeId, free, home: side });
      else push(ends, `${nodeId}|${side}`, p);
    });
  }
  return flex;
}

/**
 * Pull a route end that sits on the bounding box of a dot or diamond in to
 * the outline, along its (axis-aligned) end segment.
 */
function clipToShape(points, r, atStart) {
  if (!r || points.length < 2) return;
  const k = atStart ? 0 : points.length - 1;
  if (r.shape === 'fork') {
    // ends sit on the face of the bar, which is thinner than its box
    const p = points[k];
    const half = FORK.thick / 2;
    if (r.h > r.w) {
      const cx = r.x + r.w / 2;
      points[k] = { x: p.x < cx ? cx - half : cx + half, y: p.y };
    } else {
      const cy = r.y + r.h / 2;
      points[k] = { x: p.x, y: p.y < cy ? cy - half : cy + half };
    }
    return;
  }
  if (!POINT_SHAPES.has(r.shape)) return;
  const p = points[k];
  const q = points[atStart ? 1 : k - 1];
  const half = r.w / 2;
  const cx = r.x + half;
  const cy = r.y + r.h / 2;
  const horizontal = p.y === q.y;
  const off = Math.abs(horizontal ? p.y - cy : p.x - cx); // distance of the port from the centre line
  if (off >= half) return;
  const depth = r.shape === 'choice' ? half - off : Math.sqrt(half * half - off * off); // centre to outline
  const v = Math.round(((horizontal ? p.x < cx : p.y < cy) ? -depth : depth) * 10) / 10;
  points[k] = horizontal ? { x: cx + v, y: p.y } : { x: p.x, y: cy + v };
}

/** Sorted unique coordinates plus channel tracks inside wide gaps. */
function withTracks(values, maxTracks = 5) {
  const base = [...new Set(values.map((v) => Math.round(v)))].sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < base.length; k++) {
    out.push(base[k]);
    if (k + 1 < base.length) {
      const gap = base[k + 1] - base[k];
      const tracks = Math.min(maxTracks, Math.floor(gap / 22) - 1);
      for (let t = 1; t <= tracks; t++) out.push(Math.round(base[k] + (gap * t) / (tracks + 1)));
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
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

/** SVG path with rounded elbows. */
export function roundedPath(points, radius = 8) {
  if (!points.length) return '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let k = 1; k < points.length - 1; k++) {
    const a = points[k - 1];
    const b = points[k];
    const c = points[k + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const p1 = { x: b.x - ((b.x - a.x) / l1) * r, y: b.y - ((b.y - a.y) / l1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += ` L${fmt(p1.x)} ${fmt(p1.y)} Q${b.x} ${b.y} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x} ${last.y}`;
}

/**
 * Place each label on its own route, centred on a segment long enough to
 * hold it, avoiding nodes and previously placed labels.
 * @returns Map<edgeId, {x, y, w, h}> where x/y is the label centre.
 */
export function placeLabels(routes, rects, edges, sizeOf, avoid = []) {
  const placed = [];
  const out = new Map();
  // Self-loop labels have a fixed spot; place them first so others avoid them
  routes.forEach((r, id) => {
    if (!r.label || !edges.some((e) => e.id === id && e.label)) return;
    out.set(id, r.label);
    placed.push({ x: r.label.x - r.label.w / 2, y: r.label.y - r.label.h / 2, w: r.label.w, h: r.label.h });
  });
  const nodeBoxes = [...[...rects.values()].map((r) => inflate(r, 4)), ...avoid.map((r) => inflate(r, 2))];
  const allSegments = [];
  routes.forEach((r, id) => segmentsOf(r.points).forEach((s) => allSegments.push({ ...s, id })));
  // Bucket segments on a coarse grid so each candidate box only tests nearby ones
  const CELL = 160;
  const buckets = new Map();
  const cellsOf = (x0, y0, x1, y1, fn) => {
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) fn(cx + ',' + cy);
  };
  allSegments.forEach((o, k) => {
    cellsOf(Math.min(o.a.x, o.b.x), Math.min(o.a.y, o.b.y), Math.max(o.a.x, o.b.x), Math.max(o.a.y, o.b.y), (key) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(k);
    });
  });
  const seenAt = new Int32Array(allSegments.length);
  let probe = 0;
  const segmentHits = (box, ownId) => {
    probe++;
    let hits = 0;
    cellsOf(box.x, box.y, box.x + box.w, box.y + box.h, (key) => {
      for (const k of buckets.get(key) || []) {
        if (seenAt[k] === probe) continue;
        seenAt[k] = probe;
        const o = allSegments[k];
        if (o.id !== ownId && segmentHitsBox(o, box)) hits++;
      }
    });
    return hits;
  };

  // Most constrained first: short, simple routes have the fewest spots
  const routeLength = (id) => segmentsOf(routes.get(id).points).reduce((s, g) => s + g.len, 0);
  const sorted = edges
    .filter((e) => e.label && routes.has(e.id) && !out.has(e.id))
    .sort((a, b) => routeLength(a.id) - routeLength(b.id) || sizeOf(b.label).w - sizeOf(a.label).w);

  for (const e of sorted) {
    const size = sizeOf(e.label);
    const segs = segmentsOf(routes.get(e.id).points);
    let best = null;
    segs.forEach((s, idx) => {
      const horizontal = s.a.y === s.b.y;
      const len = s.len;
      const need = horizontal ? size.w + 12 : size.h + 12;
      const isStub = idx === 0 || idx === segs.length - 1;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const cx = s.a.x + (s.b.x - s.a.x) * t;
        const cy = s.a.y + (s.b.y - s.a.y) * t;
        const box = { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
        let score = Math.abs(t - 0.5) * 40;
        if (len < need) score += 400 + (need - len) * 4;
        if (!horizontal) score += 60;
        if (isStub && segs.length > 1) score += 120;
        score -= Math.min(len, 400) * 0.2;
        if (nodeBoxes.some((n) => overlaps(box, n))) score += 10000;
        if (placed.some((p) => overlaps(box, inflate(p, 4)))) score += 5000;
        score += segmentHits(box, e.id) * 80;
        if (!best || score < best.score) best = { score, box: { x: cx, y: cy, w: size.w, h: size.h } };
      }
    });
    if (best) {
      out.set(e.id, best.box);
      placed.push({ x: best.box.x - size.w / 2, y: best.box.y - size.h / 2, w: size.w, h: size.h });
    }
  }
  return out;
}

export function segmentsOf(points) {
  const segs = [];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    segs.push({ a, b, len: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) });
  }
  return segs;
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function segmentHitsBox(s, box) {
  const x0 = Math.min(s.a.x, s.b.x);
  const x1 = Math.max(s.a.x, s.b.x);
  const y0 = Math.min(s.a.y, s.b.y);
  const y1 = Math.max(s.a.y, s.b.y);
  return x0 < box.x + box.w && x1 > box.x && y0 < box.y + box.h && y1 > box.y;
}

function inflate(r, m) {
  return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fmt = (v) => Math.round(v * 10) / 10;

class Heap {
  constructor() {
    this.p = [];
    this.v = [];
    this.n = 0;
  }
  get size() {
    return this.n;
  }
  clear() {
    this.n = 0;
  }
  topPriority() {
    return this.p[0];
  }
  push(priority, value) {
    const p = this.p;
    const v = this.v;
    let i = this.n++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= priority) break;
      p[i] = p[parent];
      v[i] = v[parent];
      i = parent;
    }
    p[i] = priority;
    v[i] = value;
  }
  pop() {
    const p = this.p;
    const v = this.v;
    const top = v[0];
    const n = --this.n;
    if (n > 0) {
      const lp = p[n];
      const lv = v[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        let m = l;
        if (r < n && p[r] < p[l]) m = r;
        if (!(p[m] < lp)) break;
        p[i] = p[m];
        v[i] = v[m];
        i = m;
      }
      p[i] = lp;
      v[i] = lv;
    }
    return top;
  }
}

/** End label metrics (sourceLabel / targetLabel). src/styles/diagram.css mirrors them (.y-end-label). */
export const END_LABEL = { size: 10.5, h: 14, padX: 3, gap: 4 };

/** Size of an end label as drawn. */
export function endLabelSize(text) {
  return { w: Math.ceil(textWidth(text, END_LABEL.size, { weight: 500 }) + END_LABEL.padX * 2), h: END_LABEL.h };
}

/**
 * End labels (sourceLabel / targetLabel: multiplicities such as "1" or "0..*",
 * role names) beside each end of a route, just past the card and clear of its
 * marker (crow's foot, UML head, arrow), of nodes, of other labels and lines.
 * @param edges [{ id, sourceLabel?, targetLabel?, start, end }] start / end: marker kinds (null = none)
 * @param avoid boxes {x,y,w,h} (top-left) to keep clear of
 * @returns Map<edgeId, { source: {x,y,w,h,text} | null, target: ... }> (x/y is the centre)
 */
export function placeEndLabels(routes, rects, edges, avoid = []) {
  const placed = [...avoid];
  const nodeBoxes = [...rects.values()];
  const segs = [];
  routes.forEach((r, id) => segmentsOf(r.points).forEach((s, k) => segs.push({ ...s, id, k })));
  const out = new Map();
  for (const e of edges) {
    const p = routes.get(e.id)?.points;
    if (!p || p.length < 2) continue;
    const res = { source: null, target: null };
    for (const role of [0, 1]) {
      const raw = role ? e.targetLabel : e.sourceLabel;
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) continue;
      const tip = role ? p[p.length - 1] : p[0];
      const next = role ? p[p.length - 2] : p[1];
      const own = role ? p.length - 2 : 0;
      const dx = Math.sign(next.x - tip.x);
      const dy = Math.sign(next.y - tip.y);
      const horizontal = dy === 0;
      const { w, h } = endLabelSize(text);
      const kind = role ? e.end : e.start;
      const mark = !kind ? 0 : kind === 'arrow' ? 10 : 20; // marker length along the line
      const half = !kind ? 1 : kind === 'arrow' ? 4 : 7; // and half its width across it
      let best = null;
      for (const along of [END_LABEL.gap, mark + END_LABEL.gap, mark + 16])
        for (const sgn of [-1, 1]) {
          // near edge `along` px from the tip, beside the line (clear of the marker while it is alongside)
          const a = along + (horizontal ? w / 2 : h / 2);
          const off = (horizontal ? h / 2 : w / 2) + (along < mark ? half : 1) + 3;
          const cx = Math.round(tip.x + dx * a + (horizontal ? 0 : sgn * off));
          const cy = Math.round(tip.y + dy * a + (horizontal ? sgn * off : 0));
          const box = { x: cx - w / 2, y: cy - h / 2, w, h };
          let score = along * 0.5 + (sgn > 0 ? 1 : 0);
          if (nodeBoxes.some((n) => overlaps(box, n))) score += 1000;
          if (placed.some((b) => overlaps(box, inflate(b, 2)))) score += 400;
          for (const s of segs) if (!(s.id === e.id && s.k === own) && segmentHitsBox(s, box)) score += 60;
          if (!best || score < best.score) best = { score, box: { x: cx, y: cy, w, h, text } };
        }
      res[role ? 'target' : 'source'] = best.box;
      placed.push({ x: best.box.x - w / 2, y: best.box.y - h / 2, w, h });
    }
    out.set(e.id, res);
  }
  return out;
}
