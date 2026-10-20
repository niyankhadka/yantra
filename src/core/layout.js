/**
 * Card sizing and automatic layered layout (a compact Sugiyama pipeline):
 * cycle breaking -> ranking -> long-edge dummies -> crossing reduction ->
 * cross-axis placement (isotonic regression) -> main-axis spacing that
 * reserves room for edge labels.
 */
import { textWidth, wrapText, truncate } from './text.js';

/** Card metrics. src/css/diagram.css mirrors these numbers exactly. */
export const CARD = {
  width: 220,
  minWidth: 160,
  maxWidth: 320,
  padX: 14,
  padY: 12,
  kicker: 16,
  kickerGap: 8,
  titleSize: 14,
  titleLine: 19,
  titleMax: 3,
  subSize: 12,
  subLine: 17,
  subMax: 2,
  subGap: 3,
  techSize: 11,
  techLine: 15,
  techGap: 8
};

export const LABEL = { size: 11, padX: 8, height: 20 };

/**
 * Group (container) metrics. src/styles/diagram.css mirrors the title
 * metrics. Boxes are member rects plus padding; the top padding holds the title.
 */
export const GROUP = { padX: 20, padTop: 36, padBottom: 20, gap: 24, radius: 12, titleSize: 11, titleX: 12, titleY: 8, titleH: 16 };

/** Width of a group title as drawn: uppercase, semibold, 0.06em tracking. */
export function groupTitleWidth(text) {
  const t = String(text || '').toUpperCase();
  return Math.ceil(textWidth(t, GROUP.titleSize, { weight: 600 }) + t.length * GROUP.titleSize * 0.06);
}

/** Title text cut to fit a box, and the strip it occupies (kept clear of edges and labels). */
export function groupTitle(title, box) {
  const max = box.w - GROUP.titleX * 2;
  let text = String(title || '').toUpperCase();
  if (groupTitleWidth(text) > max) {
    while (text.length > 1 && groupTitleWidth(`${text}\u2026`) > max) text = text.slice(0, -1);
    text = `${text.trimEnd()}\u2026`;
  }
  const w = Math.min(max, groupTitleWidth(text));
  return { text, strip: { x: box.x + GROUP.titleX - 4, y: box.y + GROUP.titleY - 3, w: w + 8, h: GROUP.titleH + 6 } };
}

/**
 * Group boxes from member rects, innermost first so parents wrap children.
 * @param list  [{ id, parent, depth, nodes: [nodeId incl. descendants] }]
 * @returns Map<groupId, {x,y,w,h}> (groups without placed members are absent)
 */
export function groupBoxes(list, rects) {
  const boxes = new Map();
  for (const g of [...list].sort((a, b) => b.depth - a.depth)) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (r) => {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    };
    for (const id of g.nodes) if (rects.has(id)) add(rects.get(id));
    for (const c of list) if (c.parent === g.id && boxes.has(c.id)) add(boxes.get(c.id));
    if (!isFinite(x0)) continue;
    boxes.set(g.id, { x: x0 - GROUP.padX, y: y0 - GROUP.padTop, w: x1 - x0 + GROUP.padX * 2, h: y1 - y0 + GROUP.padTop + GROUP.padBottom });
  }
  return boxes;
}

export const GRID = 10;
const snap = (v) => Math.round(v / GRID) * GRID;
const ceilTo = (v, q) => Math.ceil(v / q) * q;

export function labelSize(text) {
  if (!text) return null;
  return { w: Math.ceil(textWidth(text, LABEL.size, { weight: 500 }) + LABEL.padX * 2), h: LABEL.height };
}

/** Width/height plus the wrapped text lines a card will show. */
export function measureNode(node) {
  const d = node.data || {};
  const w = ceilTo(Math.min(CARD.maxWidth, Math.max(CARD.minWidth, node.width || CARD.width)), 20);
  const inner = w - CARD.padX * 2;

  const title = wrapText(d.title || node.id, inner, CARD.titleSize, { weight: 600 }, CARD.titleMax);
  const subtitle = d.subtitle ? wrapText(d.subtitle, inner, CARD.subSize, {}, CARD.subMax) : [];
  const tech = d.tech ? truncate(d.tech, inner, CARD.techSize, { mono: true }) : '';

  let h = CARD.padY + CARD.kicker + CARD.kickerGap + title.length * CARD.titleLine;
  if (subtitle.length) h += CARD.subGap + subtitle.length * CARD.subLine;
  if (tech) h += CARD.techGap + CARD.techLine;
  h += CARD.padY;

  // Even multiples of the grid keep centres on the grid, so aligned
  // neighbours produce perfectly straight edges after snapping.
  return { w, h: Math.max(ceilTo(h, 20), 80), lines: { title, subtitle, tech } };
}

/**
 * @param nodes  [{ id, w, h, rank? }]
 * @param edges  [{ id, source, target, label? }]
 * @param groups groupIndex() result over these nodes (optional): members stay
 *               contiguous in every rank and get room for their boxes
 * @returns { positions: Map<id,{x,y}>, sides: Map<edgeId,[src,tgt]> }
 */
export function autoLayout(nodes, edges, { direction = 'LR', groups = null } = {}) {
  const horiz = direction !== 'TB';
  const ids = nodes.map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order0 = new Map(ids.map((id, i) => [id, i]));

  const mainSize = (n) => (horiz ? n.w : n.h);
  const crossSize = (n) => (horiz ? n.h : n.w);

  const validEdges = edges.filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target);

  // 1. Cycle breaking (DFS in author order; edges into the stack are reversed)
  const outgoing = new Map(ids.map((id) => [id, []]));
  validEdges.forEach((e) => outgoing.get(e.source).push(e));
  const reversed = new Set();
  const state = new Map();
  for (const root of ids) {
    if (state.get(root)) continue;
    const stack = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const out = outgoing.get(top[0]);
      if (top[1] >= out.length) {
        state.set(top[0], 2);
        stack.pop();
        continue;
      }
      const e = out[top[1]++];
      const s = state.get(e.target);
      if (s === 1) reversed.add(e.id);
      else if (!s) {
        state.set(e.target, 1);
        stack.push([e.target, 0]);
      }
    }
  }
  const oriented = validEdges.map((e) =>
    reversed.has(e.id) ? { edge: e, u: e.target, v: e.source } : { edge: e, u: e.source, v: e.target }
  );

  // 2. Ranking: longest path, then pull pure sources next to their successors
  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  oriented.forEach(({ u, v }) => {
    succs.get(u).push(v);
    preds.get(v).push(u);
  });
  const indeg = new Map(ids.map((id) => [id, preds.get(id).length]));
  const topo = [];
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    topo.push(id);
    for (const v of succs.get(id)) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  const rank = new Map();
  for (const id of topo) {
    const fixed = byId.get(id).rank;
    rank.set(id, Number.isInteger(fixed) ? fixed : Math.max(0, ...preds.get(id).map((p) => rank.get(p) + 1)));
  }
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    if (Number.isInteger(byId.get(id).rank)) continue;
    if (preds.get(id).length === 0 && succs.get(id).length) {
      rank.set(id, Math.min(...succs.get(id).map((s) => rank.get(s))) - 1);
    }
  }
  const minRank = Math.min(...ids.map((id) => rank.get(id)));
  ids.forEach((id) => rank.set(id, rank.get(id) - minRank));
  const maxRank = Math.max(0, ...ids.map((id) => rank.get(id)));

  // 3. Layers with dummy nodes for edges that span several ranks
  const items = new Map(); // id -> { id, real, size, rank, path, up: [{id,w}], down: [{id,w}] }
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  const gl = groups && groups.list.some((g) => g.nodes.length) ? groups : null;
  const chainOf = (id) => (gl ? gl.chain(id) : []);
  const commonPath = (a, b) => {
    const pa = chainOf(a);
    const pb = chainOf(b);
    let k = 0;
    while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++;
    return pa.slice(0, k);
  };
  for (const id of ids) {
    const it = { id, real: true, size: crossSize(byId.get(id)), rank: rank.get(id), path: chainOf(id), up: [], down: [] };
    items.set(id, it);
    layers[it.rank].push(it);
  }
  const link = (a, b, w) => {
    items.get(a).down.push({ id: b, w });
    items.get(b).up.push({ id: a, w });
  };
  for (const { edge, u, v } of oriented) {
    const ru = rank.get(u);
    const rv = rank.get(v);
    if (rv <= ru) continue; // same-rank edge from explicit ranks: routed freely
    // Main-flow edges pull hard (straight rows); return edges barely pull
    const weight = reversed.has(edge.id) ? 0.25 : 1;
    let prev = u;
    const chain = [];
    for (let r = ru + 1; r < rv; r++) {
      const id = `\u0000${edge.id}:${r}`;
      const it = { id, real: false, back: reversed.has(edge.id), edge: edge.id, size: 16, rank: r, path: commonPath(u, v), up: [], down: [] };
      items.set(id, it);
      layers[r].push(it);
      chain.push(id);
      link(prev, id, (prev === u ? 1 : 2) * weight);
      prev = id;
    }
    link(prev, v, (chain.length ? 1 : 4) * weight);
  }
  // A group is present in every rank it spans: placeholders keep outsiders
  // from being ordered into the middle of its box where it has no members.
  const span = new Map();
  if (gl) {
    for (const g of gl.list) {
      const rs = g.nodes.filter((id) => rank.has(id)).map((id) => rank.get(id));
      if (rs.length) span.set(g.id, [Math.min(...rs), Math.max(...rs)]);
    }
    for (const [gid, [r0, r1]] of span)
      for (let r = r0; r <= r1; r++) {
        if (layers[r].some((it) => it.path.includes(gid))) continue;
        const id = `\u0000group:${gid}:${r}`;
        const it = { id, real: false, ph: true, size: 0, rank: r, path: gl.ancestors(gid), up: [], down: [] };
        items.set(id, it);
        layers[r].push(it);
      }
  }

  // 4. Crossing reduction: barycentre sweeps, keep the best ordering
  const pos = new Map();
  const reindex = () => layers.forEach((layer) => layer.forEach((it, i) => pos.set(it.id, i)));
  // Members of a group stay contiguous: order units (single items or whole
  // groups, keyed by mean position) and recurse into each group.
  const cluster = (list, depth, globalKey) => {
    const units = [];
    const byGroup = new Map();
    for (const it of list) {
      const g = it.path[depth];
      if (g === undefined) units.push({ key: pos.get(it.id), items: [it] });
      else {
        if (!byGroup.has(g)) {
          const u = { key: 0, items: [], g };
          byGroup.set(g, u);
          units.push(u);
        }
        byGroup.get(g).items.push(it);
      }
    }
    byGroup.forEach((u) => (u.key = u.items.reduce((s, it) => s + pos.get(it.id), 0) / u.items.length));
    units.sort((a, b) => a.key - b.key);
    if (globalKey) {
      // sibling groups keep one relative order in every rank
      const slots = units.map((u, i) => (u.g !== undefined ? i : -1)).filter((i) => i >= 0);
      const sorted = slots.map((i) => units[i]).sort((a, b) => globalKey.get(a.g) - globalKey.get(b.g));
      slots.forEach((i, k) => (units[i] = sorted[k]));
    }
    return units.flatMap((u) => (u.g === undefined ? u.items : cluster(u.items, depth + 1, globalKey)));
  };
  const clusterLayer = (layer, globalKey) => {
    if (!gl) return;
    const next = cluster(layer, 0, globalKey);
    layer.splice(0, layer.length, ...next);
    layer.forEach((it, i) => pos.set(it.id, i));
  };
  layers.forEach((layer) => layer.sort((a, b) => (order0.get(a.id) ?? 1e9) - (order0.get(b.id) ?? 1e9)));
  reindex();
  layers.forEach((layer) => clusterLayer(layer));

  const crossings = () => {
    let total = 0;
    for (let r = 0; r < layers.length - 1; r++) {
      const segs = [];
      layers[r].forEach((it) => it.down.forEach((d) => segs.push([pos.get(it.id), pos.get(d.id)])));
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++)
          if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) total++;
    }
    return total;
  };
  const sortLayer = (layer, key) => {
    const bary = new Map(
      layer.map((it) => {
        const ns = it[key];
        return [it.id, ns.length ? ns.reduce((s, n) => s + pos.get(n.id), 0) / ns.length : pos.get(it.id)];
      })
    );
    layer.sort((a, b) => bary.get(a.id) - bary.get(b.id) || pos.get(a.id) - pos.get(b.id));
    layer.forEach((it, i) => pos.set(it.id, i));
    clusterLayer(layer);
  };

  let best = crossings();
  let bestOrder = layers.map((l) => l.slice());
  for (let iter = 0; iter < 24 && best > 0; iter++) {
    if (iter % 2 === 0) for (let r = 1; r < layers.length; r++) sortLayer(layers[r], 'up');
    else for (let r = layers.length - 2; r >= 0; r--) sortLayer(layers[r], 'down');
    const c = crossings();
    if (c < best) {
      best = c;
      bestOrder = layers.map((l) => l.slice());
    }
  }
  if (gl) {
    // One consistent order of sibling groups across ranks (mean centred index)
    layers.forEach((_, r) => (layers[r] = bestOrder[r]));
    reindex();
    const acc = new Map();
    layers.forEach((layer) =>
      layer.forEach((it, i) => {
        const v = i - (layer.length - 1) / 2;
        for (const g of it.path) {
          const a = acc.get(g) || [0, 0];
          acc.set(g, [a[0] + v, a[1] + 1]);
        }
      })
    );
    const globalKey = new Map([...acc].map(([g, [s, n]]) => [g, s / n]));
    layers.forEach((layer) => clusterLayer(layer, globalKey));
    bestOrder = layers.map((l) => l.slice());
  }
  // Return paths run in a corridor outside the drawing: above it when both
  // ends are first in their layer, otherwise below it.
  const realOrder = bestOrder.map((l) => l.filter((it) => it.real));
  const first = (id) => realOrder[rank.get(id)][0]?.id === id;
  const last = (id) => realOrder[rank.get(id)].at(-1)?.id === id;
  const corridor = new Map();
  for (const { edge } of oriented) {
    if (!reversed.has(edge.id) || commonPath(edge.source, edge.target).length) continue;
    if (first(edge.source) && first(edge.target)) corridor.set(edge.id, 'start');
    else if (last(edge.source) && last(edge.target)) corridor.set(edge.id, 'end');
  }
  bestOrder.forEach((l, r) => {
    const side = (it) => (it.back && !it.path.length ? corridor.get(it.edge) || 'end' : 'mid');
    layers[r] = [...l.filter((it) => side(it) === 'start'), ...l.filter((it) => side(it) === 'mid'), ...l.filter((it) => side(it) === 'end')];
  });
  reindex();

  // 5. Cross-axis placement: pull towards neighbours, keep order and spacing
  const nodeGap = horiz ? 40 : 60;
  const dummyGap = 34;
  // Crossing a group boundary adds that box's padding (title side first)
  const padStart = horiz ? GROUP.padTop : GROUP.padX;
  const padEnd = horiz ? GROUP.padBottom : GROUP.padX;
  const boundary = (a, b) => {
    let k = 0;
    while (k < a.path.length && k < b.path.length && a.path[k] === b.path[k]) k++;
    return (a.path.length - k) * padEnd + (b.path.length - k) * padStart;
  };
  const sep = (a, b) =>
    a.size / 2 + b.size / 2 + (a.ph || b.ph ? 0 : a.real && b.real ? nodeGap : dummyGap) + (gl ? boundary(a, b) : 0);
  const cross = new Map();
  layers.forEach((layer) => {
    let c = 0;
    layer.forEach((it, i) => {
      if (i > 0) c += sep(layer[i - 1], it);
      cross.set(it.id, c);
    });
    const mid = c / 2;
    layer.forEach((it) => cross.set(it.id, cross.get(it.id) - mid));
  });

  const place = (layer, keys) => {
    if (!layer.length) return;
    const desired = layer.map((it) => {
      let sw = 0;
      let s = 0;
      for (const key of keys)
        for (const n of it[key]) {
          sw += n.w;
          s += n.w * cross.get(n.id);
        }
      return sw ? s / sw : cross.get(it.id);
    });
    const weights = layer.map((it) => (it.real ? 2 : 1));
    // offsets so that constraint p[i+1] - p[i] >= sep becomes q non-decreasing
    const offset = [0];
    for (let i = 1; i < layer.length; i++) offset.push(offset[i - 1] + sep(layer[i - 1], layer[i]));
    const q = isotonic(desired.map((d, i) => d - offset[i]), weights);
    layer.forEach((it, i) => cross.set(it.id, q[i] + offset[i]));
  };
  for (let iter = 0; iter < 20; iter++) {
    if (iter % 2 === 0) for (let r = 1; r < layers.length; r++) place(layers[r], ['up']);
    else for (let r = layers.length - 2; r >= 0; r--) place(layers[r], ['down']);
  }
  for (let r = 0; r < layers.length; r++) place(layers[r], ['up', 'down']);

  // 6. Main axis: rank bands separated by gaps wide enough for labels
  const bandSize = layers.map((layer) => Math.max(0, ...layer.filter((it) => it.real).map((it) => mainSize(byId.get(it.id)))));
  const gapNeed = Array.from({ length: Math.max(0, layers.length - 1) }, () => (horiz ? 90 : 80));
  for (const { edge, u, v } of oriented) {
    const lab = labelSize(edge.label);
    if (!lab || corridor.has(edge.id)) continue; // corridor labels sit on the long run
    const g = Math.min(rank.get(u), rank.get(v));
    if (g < gapNeed.length) gapNeed[g] = Math.max(gapNeed[g], (horiz ? lab.w : lab.h) + 52);
  }
  if (gl) {
    // Boxes closing after rank r and opening at r + 1 need their padding
    const closeAt = new Array(layers.length).fill(0);
    const openAt = new Array(layers.length).fill(0);
    for (const g of gl.list) {
      if (!span.has(g.id)) continue;
      const [r0, r1] = span.get(g.id);
      const chain = gl.ancestors(g.id).filter((a) => span.has(a));
      closeAt[r1] = Math.max(closeAt[r1], chain.filter((a) => span.get(a)[1] === r1).length);
      openAt[r0] = Math.max(openAt[r0], chain.filter((a) => span.get(a)[0] === r0).length);
    }
    const mainStart = horiz ? GROUP.padX : GROUP.padTop;
    const mainEnd = horiz ? GROUP.padX : GROUP.padBottom;
    for (let r = 0; r < gapNeed.length; r++) {
      const pads = closeAt[r] * mainEnd + openAt[r + 1] * mainStart;
      gapNeed[r] += pads;
    }
  }
  const bandStart = [];
  let m = 0;
  for (let r = 0; r < layers.length; r++) {
    bandStart.push(m);
    m += bandSize[r] + (gapNeed[r] || 0);
  }
  for (let r = 0; r < gapNeed.length; r++) bandStart[r + 1] = snap(bandStart[r + 1]);

  // 6b. Push outsiders and sibling groups out of each other's boxes (cross axis)
  if (gl) separateGroups();

  // 7. Emit positions, snapped, normalised to the origin
  const raw = new Map();
  for (const id of ids) {
    const n = byId.get(id);
    const r = rank.get(id);
    const main = bandStart[r] + (bandSize[r] - mainSize(n)) / 2;
    const c = cross.get(id) - crossSize(n) / 2;
    raw.set(id, horiz ? { x: main, y: c } : { x: c, y: main });
  }
  const minX = Math.min(...[...raw.values()].map((p) => p.x));
  const minY = Math.min(...[...raw.values()].map((p) => p.y));
  const positions = new Map();
  raw.forEach((p, id) => positions.set(id, { x: snap(p.x - minX), y: snap(p.y - minY) }));

  const sides = new Map();
  for (const { edge, u, v } of oriented) {
    const rev = reversed.has(edge.id);
    const lane = corridor.get(edge.id);
    if (lane) {
      const s = horiz ? (lane === 'start' ? 'top' : 'bottom') : lane === 'start' ? 'left' : 'right';
      sides.set(edge.id, [s, s]);
    } else if (rank.get(v) > rank.get(u)) {
      sides.set(edge.id, horiz ? (rev ? ['left', 'right'] : ['right', 'left']) : rev ? ['top', 'bottom'] : ['bottom', 'top']);
    }
  }

  return { positions, sides, reversed };

  function separateGroups() {
    const list = gl.list.filter((g) => span.has(g.id));
    const lo = (b) => (horiz ? b.y : b.x);
    const hi = (b) => (horiz ? b.y + b.h : b.x + b.w);
    const rectOf = (id) => {
      const n = byId.get(id);
      const r = rank.get(id);
      const main = bandStart[r] + (bandSize[r] - mainSize(n)) / 2;
      const c = cross.get(id) - crossSize(n) / 2;
      return horiz ? { x: main, y: c, w: n.w, h: n.h } : { x: c, y: main, w: n.w, h: n.h };
    };
    const shift = (r, from, to, d) => {
      for (let i = from; i < to; i++) cross.set(layers[r][i].id, cross.get(layers[r][i].id) + d);
    };
    const G = GROUP.gap;
    for (let iter = 0; iter < 200; iter++) {
      const rects = new Map(ids.map((id) => [id, rectOf(id)]));
      const boxes = groupBoxes(list, rects);
      let fixed = false;
      // (a) a node inside a box it does not belong to: move it (and everything
      // beyond it in its rank) out on the side it is ordered on
      for (const g of list) {
        const b = boxes.get(g.id);
        if (!b) continue;
        const members = gl.members(g.id);
        for (const id of ids) {
          if (members.has(id) || !overlaps(rects.get(id), inflate(b, G - 1))) continue;
          const r = rank.get(id);
          const layer = layers[r];
          const idx = layer.findIndex((it) => it.id === id);
          const at = layer.findIndex((it) => it.path.includes(g.id));
          const rc = rects.get(id);
          const before = at >= 0 ? idx < at : lo(rc) + hi(rc) < lo(b) + hi(b);
          if (before) shift(r, 0, idx + 1, -(hi(rc) + G - lo(b)));
          else shift(r, idx, layer.length, hi(b) + G - lo(rc));
          fixed = true;
          break;
        }
        if (fixed) break;
      }
      if (fixed) continue;
      // (b) two boxes that are not nested overlap: move the later sibling branch
      for (let i = 0; i < list.length && !fixed; i++)
        for (let j = i + 1; j < list.length && !fixed; j++) {
          const A = gl.ancestors(list[i].id);
          const B = gl.ancestors(list[j].id);
          if (A.includes(list[j].id) || B.includes(list[i].id)) continue;
          const ba = boxes.get(list[i].id);
          const bb = boxes.get(list[j].id);
          if (!ba || !bb || !overlaps(inflate(ba, G - 1), bb)) continue;
          let k = 0;
          while (A[k] === B[k]) k++;
          const ga = boxes.get(A[k]);
          const gb = boxes.get(B[k]);
          const aFirst = lo(ga) + hi(ga) <= lo(gb) + hi(gb);
          const later = aFirst ? B[k] : A[k];
          const d = hi(aFirst ? ga : gb) + G - lo(aFirst ? gb : ga);
          for (let r = 0; r < layers.length; r++) {
            const at = layers[r].findIndex((it) => it.path.includes(later));
            if (at >= 0) shift(r, at, layers[r].length, d);
          }
          fixed = true;
        }
      if (!fixed) break;
    }
  }
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inflate(r, m) {
  return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
}

/** Weighted pool-adjacent-violators: closest non-decreasing sequence. */
export function isotonic(values, weights) {
  const blocks = [];
  values.forEach((v, i) => {
    blocks.push({ sum: v * weights[i], w: weights[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, w: a.w + b.w, n: a.n + b.n });
    }
  });
  const out = [];
  blocks.forEach((b) => {
    for (let i = 0; i < b.n; i++) out.push(b.sum / b.w);
  });
  return out;
}
