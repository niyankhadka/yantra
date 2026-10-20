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
 */
import { isotonic } from './layout.js';

const STUB = 20; // straight run out of / into a port
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

/**
 * @param rects Map<nodeId, {x,y,w,h}>
 * @param edges [{ id, source, target, sides?: [src,tgt] }]
 * @param options { groups?: [{ x, y, w, h, titleBox }] }
 * @returns Map<edgeId, { points: [{x,y}], ok: boolean }>
 */
export function routeEdges(rects, edges, { groups: containers = [] } = {}) {
  const list = edges.filter((e) => rects.has(e.source) && rects.has(e.target));
  const windowed = list.length > WINDOW_EDGES || rects.size > WINDOW_NODES;

  // --- Sides and spread ports -------------------------------------------
  const ends = new Map(); // `${node}|${side}` -> [{ edge, role, ref }]
  const sideOf = new Map();
  for (const e of list) {
    const a = rects.get(e.source);
    const b = rects.get(e.target);
    const sides = e.sides || chooseSides(a, b);
    sideOf.set(e.id, sides);
    push(ends, `${e.source}|${sides[0]}`, { edge: e, role: 0, ref: center(b) });
    push(ends, `${e.target}|${sides[1]}`, { edge: e, role: 1, ref: center(a) });
  }
  // Port positions: spread along the middle of each side, then pulled
  // (isotonic fit, order and spacing preserved) towards the far port so
  // facing ports line up and edges come out straight.
  const groups = [];
  const where = new Map(); // `${edgeId}|${role}` -> [group, index]
  for (const [key, group] of ends) {
    const [nodeId, side] = key.split('|');
    const r = rects.get(nodeId);
    const vertical = side === 'left' || side === 'right';
    group.sort((p, q) => (vertical ? p.ref.y - q.ref.y : p.ref.x - q.ref.x) || cmp(p.edge.id, q.edge.id));
    const len = vertical ? r.h : r.w;
    const mid = (vertical ? r.y : r.x) + len / 2;
    const half = len * 0.3;
    let lo = mid - half;
    let hi = mid + half;
    if (side === 'top') {
      // Top ports never sit under a group title just above the node
      for (const gr of containers) {
        const t = gr.titleBox;
        if (!t || t.y + t.h > r.y || t.y + t.h < r.y - STUB - 30) continue;
        if (t.x < hi && t.x + t.w + 8 > lo && t.x + t.w + 8 <= hi - 4) lo = Math.max(lo, t.x + t.w + 8);
      }
    }
    const n = group.length;
    const gap = n > 1 ? Math.min(18, (hi - lo) / (n - 1)) : 0;
    const c = (lo + hi) / 2;
    const g = { r, side, vertical, group, lo, hi, gap, pos: group.map((_, k) => c + (k - (n - 1) / 2) * gap) };
    groups.push(g);
    group.forEach((p, k) => where.set(`${p.edge.id}|${p.role}`, [g, k]));
  }
  for (let iter = 0; iter < 6; iter++) {
    for (const g of groups) {
      const desired = g.group.map((p) => {
        const [og, ok] = where.get(`${p.edge.id}|${1 - p.role}`);
        if (og !== g && og.vertical === g.vertical) return og.pos[ok];
        return p.ref[g.vertical ? 'y' : 'x'];
      });
      const n = desired.length;
      const q = isotonic(desired.map((d, k) => d - k * g.gap), desired.map(() => 1));
      const maxQ = g.hi - (n - 1) * g.gap;
      g.pos = q.map((v, k) => Math.min(maxQ, Math.max(g.lo, v)) + k * g.gap);
    }
  }
  const ports = new Map(); // `${edgeId}|${role}` -> { x, y, dir }
  for (const g of groups) {
    const { r, side } = g;
    g.group.forEach((p, k) => {
      const t = Math.round(g.pos[k]);
      const pt =
        side === 'left' ? { x: r.x, y: t } :
        side === 'right' ? { x: r.x + r.w, y: t } :
        side === 'top' ? { x: t, y: r.y } : { x: t, y: r.y + r.h };
      ports.set(`${p.edge.id}|${p.role}`, { ...pt, dir: SIDE_DIR[side] });
    });
  }

  // --- Sparse grid ------------------------------------------------------
  const obstacles = [...rects.values()].map((r) => ({
    x0: r.x - CLEAR, y0: r.y - CLEAR, x1: r.x + r.w + CLEAR, y1: r.y + r.h + CLEAR
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
  for (const p of ports.values()) {
    const [dx, dy] = DIRS[p.dir];
    xsSet.add(p.x); ysSet.add(p.y);
    xsSet.add(p.x + dx * STUB); ysSet.add(p.y + dy * STUB);
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
  const ordered = list
    .map((e) => {
      const s = ports.get(`${e.id}|0`);
      const t = ports.get(`${e.id}|1`);
      return { e, s, t, d: Math.abs(s.x - t.x) + Math.abs(s.y - t.y) };
    })
    .sort((a, b) => a.d - b.d);

  for (const { e, s, t } of ordered) {
    const sStub = { x: s.x + DIRS[s.dir][0] * STUB, y: s.y + DIRS[s.dir][1] * STUB };
    const inDir = (t.dir + 2) % 4; // travel direction when entering the target
    const tStub = { x: t.x + DIRS[t.dir][0] * STUB, y: t.y + DIRS[t.dir][1] * STUB };
    const start = { i: xi.get(sStub.x), j: yi.get(sStub.y), d: s.dir };
    const goal = { i: xi.get(tStub.x), j: yi.get(tStub.y) };
    const cells = start.i !== undefined && goal.i !== undefined ? findPath(start, goal, inDir) : null;
    const ok = !!cells;

    let points;
    if (ok) {
      points = [s, ...cells.map((c) => ({ x: xs[c.i], y: ys[c.j] })), t];
      markUsed(cells);
    } else {
      // Fallback keeps the drawing connected; the validator reports it.
      points = [s, sStub, { x: tStub.x, y: sStub.y }, tStub, t];
    }
    results.set(e.id, { points: simplify(points.map(({ x, y }) => ({ x, y }))), ok });
  }
  centerJogs(results, [...obstacles, ...titles]);
  return results;

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
        return path.reverse();
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
          shared = usedH[at];
          near = haloH[at];
          inTitle = titleH[at];
          onBorder = borderH[at];
          beside = nearH[at];
        } else {
          const at = (nj < j ? nj : j) * nx + i;
          if (blockedV[at]) continue;
          len = Math.abs(ys[nj] - ys[j]);
          shared = usedV[at];
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

  function markUsed(cells) {
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1];
      const b = cells[k];
      if (a.j === b.j && a.i !== b.i) {
        const si = Math.min(a.i, b.i);
        usedH[a.j * nx + si]++;
        // tracks closer than NEAR read as one thick line: discourage them
        for (let jj = a.j - 1; jj >= 0 && ys[a.j] - ys[jj] < NEAR; jj--) nearH[jj * nx + si]++;
        for (let jj = a.j + 1; jj < ny && ys[jj] - ys[a.j] < NEAR; jj++) nearH[jj * nx + si]++;
        turnedAt[a.j * nx + a.i] |= 1; turnedAt[b.j * nx + b.i] |= 1;
      } else if (a.i === b.i && a.j !== b.j) {
        const sj = Math.min(a.j, b.j);
        usedV[sj * nx + a.i]++;
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
    .filter((e) => e.label && routes.has(e.id))
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
