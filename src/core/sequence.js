/**
 * Sequence view: the same payload drawn as a sequence diagram. Pure (no DOM),
 * so the viewer, the SVG export and the validator share one geometry.
 *
 *   participants  nodes that send or receive a message in the active scenario,
 *                 left to right in order of first appearance (who speaks first
 *                 stands leftmost), with group members kept adjacent
 *   messages      one arrow per highlightEdges id of every step, in step order,
 *                 drawn source -> target between lifelines
 *   rows          one horizontal band per step, numbered in a left gutter
 *
 * Column gaps grow until every label fits between the lifelines it spans, so
 * labels never collide and arrows always end exactly on a lifeline.
 */
import { normalize, visibleGraph, groupIndex, roleKey, arrowOf } from './model.js';
import { computeScene } from './scene.js';
import { measureNode, labelSize, groupBoxes, groupTitle, LABEL, GROUP, GRID } from './layout.js';
import { roundedPath } from './route.js';
import { iconFor, knownIcon } from './icons.js';
import { truncate } from './text.js';
import { isEntity } from './entity.js';

export const SEQ = {
  gutter: 48, // left band holding the step numbers
  colGap: 50, // minimum clear space between neighbouring header cards
  headerWidth: 180, // header card width unless the node sets its own width
  headerGap: 24, // header bottom -> first row
  rowPad: 10, // inside a row, above the first and below the last message
  rowMin: 52, // a row is at least this tall (room for the step badge)
  msgH: 44, // slot per message: label above, arrow below
  msgArrow: 32, // arrow y inside its slot
  loopH: 48, // slot per self-message
  loopW: 36, // horizontal reach of a self-loop
  loopDrop: 24, // vertical drop of a self-loop
  noteH: 26, // step without messages: a note pill
  labelMax: 240, // longest label before it is truncated
  labelClear: 14, // space kept between a label and the lifelines it spans
  tail: 24 // lifelines run this far below the last row
};

const snapUp = (v) => Math.ceil(v / GRID) * GRID;

/** Steps of the scenario as message lists (only edges visible in the mode). */
function stepMessages(steps, edgeById) {
  return steps.map((st) => (st.highlightEdges || st.activeEdges || []).map((id) => edgeById.get(id)).filter(Boolean));
}

export const VIEWS = ['flow', 'sequence'];

/**
 * Views a payload offers: `meta.views` lists them ("flow", "sequence"); without
 * it both are offered, except that a diagram made only of table / class cards
 * (an ERD or class diagram) has no sequence view.
 * @returns { flow: boolean, sequence: boolean }  (sequence still needs messages: hasSequence)
 */
export function offeredViews(payload) {
  const meta = payload && typeof payload === 'object' && payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  if (Array.isArray(meta.views)) {
    const listed = meta.views.filter((v) => VIEWS.includes(v));
    if (listed.length) return { flow: listed.includes('flow'), sequence: listed.includes('sequence') };
  }
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const cardsOnly = nodes.length > 0 && nodes.every((n) => isEntity(n?.data));
  return { flow: true, sequence: !cardsOnly };
}

/** Does this scenario have anything to draw as a sequence (and does the payload offer that view)? */
export function hasSequence(payload, { scenarioIndex = 0 } = {}) {
  if (!offeredViews(payload).sequence) return false;
  const model = normalize(payload);
  const sc = model.scenarios[scenarioIndex] || model.scenarios[0];
  return (sc?.steps || []).some((st) => (st.highlightEdges || st.activeEdges || []).length > 0);
}

/**
 * @param payload  Yantra payload (raw or normalised)
 * @param options  { modeId?, scenarioIndex? }
 * @returns { kind: 'sequence', participants, nodes (alias), messages, edges: [],
 *            rows, groups, bounds, lifeline: { y1, y2 }, model, mode, scenario }
 */
export function computeSequenceScene(payload, options = {}) {
  const model = normalize(payload);
  const { nodes, edges, mode } = visibleGraph(model, options.modeId);
  const scenarioIndex = Math.max(0, Math.min(model.scenarios.length - 1, options.scenarioIndex || 0));
  const scenario = model.scenarios[scenarioIndex];
  const steps = scenario?.steps || [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const perStep = stepMessages(steps, edgeById);

  // --- participants: first appearance, then group members pulled together ---
  // (a step without messages contributes its highlighted nodes, so an opening
  // "the user clicks" step still puts the user on the left)
  const cast = new Set(perStep.flat().flatMap((e) => [e.source, e.target]));
  const wantAll = model.meta.sequence?.allParticipants === true || cast.size === 0;
  if (wantAll) nodes.forEach((n) => cast.add(n.id));
  const first = new Map();
  const meet = (id) => cast.has(id) && !first.has(id) && first.set(id, first.size);
  steps.forEach((st, k) => {
    if (perStep[k].length) perStep[k].forEach((e) => [e.source, e.target].forEach(meet));
    else (st.highlightNodes || st.activeNodes || []).forEach(meet);
  });
  nodes.forEach((n) => meet(n.id));
  const gi = groupIndex(model.groups, new Set(first.keys()));
  const order = groupedOrder([...first.keys()], first, gi);

  // --- header cards ----------------------------------------------------------
  const sized = order.map((id) => {
    const node = nodeById.get(id);
    const role = model.roles[roleKey(node)] || { label: node.type, hue: 'slate' };
    // Headers are always cards: pseudo-states (dots, diamonds) need a name above a lifeline
    return { id, node, role, ...measureNode({ ...node, shape: 'card', width: node.width || SEQ.headerWidth }) };
  });
  const headerH = Math.max(80, ...sized.map((s) => s.h));
  const chains = sized.map((s) => gi.chain(s.id));
  const levels = Math.max(0, ...chains.map((c) => c.length));
  const headerY = levels * GROUP.padTop;

  // Spacing between neighbouring lifelines (centre to centre)
  const gaps = sized.slice(1).map((s, i) => {
    const a = chains[i];
    const b = chains[i + 1];
    let c = 0;
    while (c < a.length && c < b.length && a[c] === b[c]) c++;
    const walls = a.length - c + (b.length - c);
    const clear = Math.max(SEQ.colGap, walls ? walls * GROUP.padX + GROUP.gap : 0);
    return snapUp(sized[i].w / 2 + s.w / 2 + clear);
  });

  // --- messages (text first; geometry once the columns are final) -----------
  const col = new Map(order.map((id, i) => [id, i]));
  const drafts = [];
  perStep.forEach((list, k) => {
    list.forEach((e, j) => {
      const text = truncate(e.label || steps[k].title || e.id, SEQ.labelMax - LABEL.padX * 2, LABEL.size, { weight: 500 });
      const size = labelSize(text);
      drafts.push({ k, j, e, text, size, a: col.get(e.source), b: col.get(e.target) });
    });
  });

  // Widen gaps until every label fits inside the span of its arrow
  const spans = drafts.filter((m) => m.a !== m.b).sort((m, n) => Math.abs(m.a - m.b) - Math.abs(n.a - n.b));
  for (const m of spans) {
    const lo = Math.min(m.a, m.b);
    const hi = Math.max(m.a, m.b);
    const need = m.size.w + SEQ.labelClear * 2;
    const have = gaps.slice(lo, hi).reduce((s, g) => s + g, 0);
    if (have < need) {
      const add = snapUp((need - have) / (hi - lo));
      for (let i = lo; i < hi; i++) gaps[i] += add;
    }
  }
  for (const m of drafts.filter((d) => d.a === d.b)) {
    const need = SEQ.loopW + 10 + m.size.w + SEQ.labelClear;
    if (m.a < gaps.length) gaps[m.a] = Math.max(gaps[m.a], snapUp(need));
  }

  // --- columns -----------------------------------------------------------------
  const centres = [];
  let cx = snapUp(SEQ.gutter + (chains[0]?.length || 0) * GROUP.padX + 12 + (sized[0]?.w || 0) / 2);
  sized.forEach((s, i) => {
    if (i) cx += gaps[i - 1];
    centres.push(cx);
  });

  // --- rows ----------------------------------------------------------------
  const rowsTop = headerY + headerH + SEQ.headerGap;
  let y = rowsTop;
  const rows = [];
  const messages = [];
  steps.forEach((st, k) => {
    const mine = drafts.filter((d) => d.k === k);
    const row = { index: k, id: st.id || `step-${k + 1}`, step: st, title: st.title || '', y, h: 0, messages: [], note: null };
    let cursor = y + SEQ.rowPad;
    for (const d of mine) {
      const x1 = centres[d.a];
      const x2 = centres[d.b];
      const self = d.a === d.b;
      let points;
      let label;
      if (self) {
        const ay = cursor + 12;
        points = [{ x: x1, y: ay }, { x: x1 + SEQ.loopW, y: ay }, { x: x1 + SEQ.loopW, y: ay + SEQ.loopDrop }, { x: x1, y: ay + SEQ.loopDrop }];
        label = { x: x1 + SEQ.loopW + 10 + d.size.w / 2, y: ay + SEQ.loopDrop / 2, w: d.size.w, h: d.size.h };
        cursor += SEQ.loopH;
      } else {
        const ay = cursor + SEQ.msgArrow;
        points = [{ x: x1, y: ay }, { x: x2, y: ay }];
        label = { x: (x1 + x2) / 2, y: ay - 15, w: d.size.w, h: d.size.h };
        cursor += SEQ.msgH;
      }
      const msg = {
        id: `${row.id}:${d.e.id}:${d.j}`,
        edgeId: d.e.id,
        edge: d.e,
        step: k,
        source: d.e.source,
        target: d.e.target,
        self,
        points,
        d: roundedPath(points),
        text: d.text,
        label,
        dashed: d.e.style === 'dashed' || (!d.e.style && /async|event|stream/.test(d.e.type || '')),
        dotted: d.e.style === 'dotted',
        arrow: arrowOf(d.e)
      };
      messages.push(msg);
      row.messages.push(msg.id);
    }
    if (!mine.length) {
      // A step without messages (an overview, a decision) becomes a note across its nodes
      const cols = (st.highlightNodes || st.activeNodes || []).map((id) => col.get(id)).filter((i) => i !== undefined);
      const lo = cols.length ? Math.min(...cols) : 0;
      const hi = cols.length ? Math.max(...cols) : Math.max(0, order.length - 1);
      const left = (centres[lo] ?? 0) - (sized[lo]?.w || 0) / 2;
      const right = (centres[hi] ?? 0) + (sized[hi]?.w || 0) / 2;
      const text = truncate(st.title || '', right - left - LABEL.padX * 2, LABEL.size, { weight: 500 });
      const w = Math.min(right - left, labelSize(text || ' ').w);
      row.note = { text, x: (left + right) / 2, y: cursor + 4 + SEQ.noteH / 2, w, h: SEQ.noteH };
      cursor += SEQ.noteH + 8;
    }
    row.h = snapUp(Math.max(SEQ.rowMin, cursor + SEQ.rowPad - y));
    y += row.h;
    rows.push(row);
  });

  const lifeEnd = y + SEQ.tail;
  const participants = sized.map((s, i) => ({
    id: s.id,
    node: s.node,
    index: i,
    x: centres[i] - s.w / 2,
    y: headerY,
    w: s.w,
    h: headerH,
    cx: centres[i],
    lines: s.lines,
    hue: s.role.hue,
    kicker: s.node.data?.badge || s.role.label || '',
    icon: knownIcon(s.node.data?.icon) || knownIcon(s.role.icon) || iconFor(s.node)
  }));

  // --- group boxes span their members' columns down the full lifeline -------
  const colRects = new Map(participants.map((p) => [p.id, { x: p.x, y: p.y, w: p.w, h: lifeEnd - p.y }]));
  const boxes = groupBoxes(gi.list, colRects);
  const groups = gi.list
    .filter((g) => boxes.has(g.id))
    .map((g) => {
      const b = boxes.get(g.id);
      const t = groupTitle(g.title, b);
      return { id: g.id, title: g.title, label: t.text, titleBox: t.strip, x: b.x, y: b.y, w: b.w, h: b.h, depth: g.depth, parent: g.parent, hue: g.hue, dashed: g.dashed, members: g.nodes, group: g };
    });

  // --- bounds; rows span the full width ----------------------------------------
  let x1 = 0;
  let yMax = lifeEnd;
  participants.forEach((p) => (x1 = Math.max(x1, p.x + p.w)));
  groups.forEach((g) => {
    x1 = Math.max(x1, g.x + g.w);
    yMax = Math.max(yMax, g.y + g.h);
  });
  messages.forEach((m) => (x1 = Math.max(x1, m.label.x + m.label.w / 2, ...m.points.map((p) => p.x))));
  x1 = snapUp(x1);
  rows.forEach((r) => {
    r.x = 0;
    r.w = x1;
  });
  const bounds = { x: 0, y: 0, w: x1, h: yMax };

  return {
    kind: 'sequence',
    model,
    mode,
    scenario,
    scenarioIndex,
    participants,
    nodes: participants,
    messages,
    edges: [],
    rows,
    groups,
    lifeline: { y1: headerY + headerH, y2: lifeEnd },
    bounds
  };
}

/**
 * Scene for a view name: "sequence" when the scenario has messages, else the
 * flow scene. view defaults to meta.view. Used by the CLI and MCP exports.
 */
export function sceneForView(payload, { view, modeId, scenarioIndex = 0 } = {}) {
  // A payload that offers only the sequence view opens in it
  const want = view || (offeredViews(payload).flow ? payload?.meta?.view : 'sequence');
  if (want === 'sequence' && hasSequence(payload, { scenarioIndex })) return computeSequenceScene(payload, { modeId, scenarioIndex });
  return computeScene(payload, { modeId });
}

/** Participants taking part in a row: its message ends and highlighted nodes. */
export function sequenceLive(scene, step) {
  const live = new Set();
  const row = Number.isInteger(step) ? scene.rows[step] : null;
  if (!row) return live;
  scene.messages.filter((m) => m.step === step).forEach((m) => live.add(m.source).add(m.target));
  const known = new Set(scene.participants.map((p) => p.id));
  (row.step.highlightNodes || row.step.activeNodes || []).forEach((id) => known.has(id) && live.add(id));
  return live;
}

/**
 * Order participants by first appearance while keeping every group's members
 * adjacent: a group sits where its earliest member would, its members (and
 * child groups) ordered the same way inside it.
 */
function groupedOrder(ids, first, gi) {
  const rank = (id) => first.get(id);
  const children = new Map([[null, []]]);
  const add = (parent, item) => {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(item);
  };
  const placed = new Set();
  for (const id of ids) {
    const chain = gi.chain(id);
    add(chain.length ? chain[chain.length - 1] : null, { id, rank: rank(id) });
    for (let i = chain.length - 1; i >= 0; i--) {
      if (placed.has(chain[i])) continue;
      placed.add(chain[i]);
      add(i ? chain[i - 1] : null, { group: chain[i] });
    }
  }
  const rankOf = (item) => (item.group ? Math.min(...[...gi.members(item.group)].map(rank)) : item.rank);
  const out = [];
  const walk = (key) => {
    for (const item of (children.get(key) || []).sort((a, b) => rankOf(a) - rankOf(b))) {
      if (item.group) walk(item.group);
      else out.push(item.id);
    }
  };
  walk(null);
  return out;
}
