/**
 * Payload normalisation: fills defaults, resolves roles/hues and applies
 * mode visibility so every consumer sees the same graph.
 */
import { HUE_ORDER, HUES } from './theme.js';
import { clampText, TEXT_CAP } from './text.js';

/** Own-property test: payload strings such as "constructor" or "__proto__" are never keys of a lookup table. */
export const has = (table, key) => table != null && typeof key === 'string' && Object.hasOwn(table, key);

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
/** Entries of an array that are plain objects; anything else (null, strings, nested arrays) is dropped. */
export const objects = (arr) => (Array.isArray(arr) ? arr.filter(isObj) : []);
/** Ids may be written as numbers; anything else that is not a string stays invalid (lint reports it). */
export const idOf = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);
const strings = (arr) => (Array.isArray(arr) ? arr.map(idOf).filter((x) => x !== undefined) : []);

/** Copy only when a field needs fixing, so well-formed objects keep their identity. */
function fixIds(obj, keys) {
  let out = obj;
  for (const k of keys) {
    if (!(k in obj) || typeof obj[k] === 'string') continue;
    if (out === obj) out = { ...obj };
    out[k] = idOf(obj[k]);
  }
  return out;
}

function fixLists(obj, keys) {
  let out = obj;
  for (const k of keys) {
    if (obj[k] === undefined || (Array.isArray(obj[k]) && obj[k].every((x) => typeof x === 'string'))) continue;
    if (out === obj) out = { ...obj };
    out[k] = strings(obj[k]);
  }
  return out;
}

/** Oversized text is cut for rendering (lint reports content/text-too-long). */
function clampFields(obj, keys) {
  let out = obj;
  for (const k of keys) {
    if (typeof obj[k] !== 'string' || obj[k].length <= TEXT_CAP) continue;
    if (out === obj) out = { ...obj };
    out[k] = clampText(obj[k]);
  }
  return out;
}
const clampNode = (n) => {
  if (!isObj(n.data)) return n;
  const data = clampFields(n.data, ['title', 'subtitle', 'tech', 'badge']);
  return data === n.data ? n : { ...n, data };
};

export function normalize(payload) {
  const p = isObj(payload) ? payload : {};
  const meta = isObj(p.meta) ? p.meta : {};

  const modes = objects(Array.isArray(p.modes) && p.modes.length ? p.modes : meta.modes).map((m) =>
    fixLists(fixIds(m, ['id']), ['hideNodes', 'hideEdges'])
  );
  const scenarios = objects(Array.isArray(p.scenarios) && p.scenarios.length ? p.scenarios : meta.scenarios).map((sc) =>
    Array.isArray(sc.steps) && sc.steps.every(isObj) ? sc : { ...sc, steps: objects(sc.steps) }
  );
  const steps = (list) => list.map((st) => fixLists(st, ['highlightNodes', 'highlightEdges', 'activeNodes', 'activeEdges']));

  const layout = isObj(meta.layout) ? meta.layout : {};
  const nodes = objects(p.nodes).map((n) => clampNode(fixIds(n, ['id'])));

  return {
    meta,
    nodes,
    edges: objects(p.edges).map((e) => clampFields(fixIds(e, ['id', 'source', 'target']), ['label'])),
    modes: modes.length ? modes : [{ id: 'default', name: 'Default' }],
    scenarios: (scenarios.length
      ? scenarios
      : [{ id: 'main', name: 'Walkthrough', steps: objects(p.steps) }]
    ).map((sc) => ({ ...sc, steps: steps(sc.steps) })),
    layout: {
      mode: layout.mode === 'manual' ? 'manual' : 'auto',
      direction: layout.direction === 'TB' ? 'TB' : 'LR',
      algorithm: layout.algorithm === 'tree' || layout.algorithm === 'mindmap' ? layout.algorithm : 'layered',
      collapsed: strings(layout.collapsed),
      // Tree layouts: stack leaf teams in a column (true), never (false) or when too wide (auto)
      compact: layout.compact === true || layout.compact === false ? layout.compact : 'auto'
    },
    roles: resolveRoles({ roles: p.roles, nodes }),
    panels: objects(p.panels),
    groups: objects(p.groups).filter((g) => typeof g.id === 'string' && g.id).map((g) => clampFields(g, ['title'])),
    inspector: isObj(meta.inspector) ? meta.inspector : {}
  };
}

/** Map every node type to { label, hue, icon? }, honouring payload.roles. */
export function resolveRoles(payload) {
  const declared = isObj(payload?.roles) ? payload.roles : {};
  // Null prototype: a type named "__proto__" or "constructor" is just another role
  const roles = Object.create(null);
  let next = 0;
  const pick = () => HUE_ORDER[next++ % HUE_ORDER.length];

  for (const [type, def] of Object.entries(declared)) {
    roles[type] = {
      label: def?.label || humanize(type),
      hue: has(HUES, def?.color) ? def.color : pick(),
      icon: def?.icon
    };
  }
  for (const node of objects(payload?.nodes)) {
    const type = typeof node.type === 'string' && node.type ? node.type : 'node';
    if (!roles[type]) roles[type] = { label: humanize(type), hue: pick() };
  }
  return roles;
}

/** Key of a node's role in model.roles (the same rule resolveRoles uses). */
export const roleKey = (node) => (typeof node?.type === 'string' && node.type ? node.type : 'node');

export function humanize(id) {
  return String(id || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getMode(model, modeId) {
  return model.modes.find((m) => m.id === modeId) || model.modes[0];
}

/** Nodes and edges visible in a mode, with per-mode data overrides applied. */
export function visibleGraph(model, modeId) {
  const mode = getMode(model, modeId);
  const hiddenNodes = new Set(Array.isArray(mode?.hideNodes) ? mode.hideNodes : []);
  const hiddenEdges = new Set(Array.isArray(mode?.hideEdges) ? mode.hideEdges : []);

  const nodes = model.nodes
    .filter((n) => n && typeof n.id === 'string' && n.id && !hiddenNodes.has(n.id))
    .map((n) => {
      const modes = isObj(n.data) && isObj(n.data.modes) ? n.data.modes : null;
      const override = modes && has(modes, mode?.id) && isObj(modes[mode.id]) ? modes[mode.id] : null;
      return override ? { ...n, data: { ...n.data, ...override } } : n;
    });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = model.edges.filter(
    (e) => e && e.id && !hiddenEdges.has(e.id) && ids.has(e.source) && ids.has(e.target)
  );
  return { nodes, edges, mode };
}

/**
 * Node shapes. "card" (default) and "state" (a rounder card) carry text;
 * the state-machine pseudo-states are small and textless: "initial" (filled
 * dot), "final" (ringed dot) and "choice" (diamond), plus "fork", a thick bar
 * for a fork or join (horizontal in TB, vertical in LR) that edges attach
 * along. Their title still names them in the inspector, tooltips and exports.
 * "chart" is a wider card that draws its `data.chart` as a full chart
 * (src/core/cardchart.js).
 */
export const NODE_SHAPES = ['card', 'state', 'initial', 'final', 'choice', 'fork', 'chart'];
export const POINT_SHAPES = new Set(['initial', 'final', 'choice']);
/** Shapes drawn without text: the pseudo-states and the fork / join bar. */
export const TEXTLESS = new Set([...POINT_SHAPES, 'fork']);
export const shapeOf = (node) => (NODE_SHAPES.includes(node?.shape) ? node.shape : 'card');

/** Edge arrowheads: "forward" (default, at the target), "both", or "none" (an undirected link). */
export const EDGE_ARROWS = ['forward', 'both', 'none'];
export const arrowOf = (edge) => (EDGE_ARROWS.includes(edge?.arrow) ? edge.arrow : 'forward');

/** Deepest group nesting the validator accepts (group/too-deep). */
export const GROUP_MAX_DEPTH = 8;
/**
 * Comfortable limits for groups in one frame: beyond these lint warns
 * (budget/too-many-groups, budget/deep-nesting) and suggests folding or a
 * detail diagram. Importers merge groups nested deeper than `depth`. A diagram
 * whose groups open folded counts its cards as they show at first (BUDGET in
 * lint.js) and all of them against `nodes` / `edges`.
 */
export const GROUP_BUDGET = { groups: 24, depth: 6, nodes: 48, edges: 64 };

/**
 * Resolve groups into a forest over the given node ids. Tolerant of bad
 * input (the validator reports it): unknown parents and cycles become
 * top-level, a node listed twice keeps its first group, depth is capped.
 * @returns {
 *   list: [{ id, title, parent, depth, hue, dashed, nodes, group }] (outer first),
 *   byId: Map<id, entry>, nodeGroup: Map<nodeId, groupId> (innermost),
 *   chain(nodeId) -> [outer..inner group ids], members(groupId) -> Set<nodeId>,
 *   ancestors(groupId) -> [outer..self]
 * }
 */
export function groupIndex(groups, nodeIds) {
  const known = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  const raw = new Map();
  for (const g of groups || []) if (g && typeof g.id === 'string' && g.id && !raw.has(g.id) && !known.has(g.id)) raw.set(g.id, g);

  const rawParent = (id) => {
    const p = raw.get(id).parent;
    return typeof p === 'string' && raw.has(p) ? p : null;
  };
  // Groups on a parent cycle become top-level
  const parentOf = new Map();
  for (const id of raw.keys()) {
    const seen = new Set();
    let q = rawParent(id);
    while (q && q !== id && !seen.has(q)) {
      seen.add(q);
      q = rawParent(q);
    }
    parentOf.set(id, q === id ? null : rawParent(id));
  }
  const ancestors = (id) => {
    const out = [];
    for (let q = id; q && out.length <= GROUP_MAX_DEPTH + 8; q = parentOf.get(q)) out.unshift(q);
    return out;
  };

  const nodeGroup = new Map();
  for (const [id, g] of raw)
    for (const n of Array.isArray(g.nodes) ? g.nodes : []) if (known.has(n) && !nodeGroup.has(n)) nodeGroup.set(n, id);

  const memberSets = new Map([...raw.keys()].map((id) => [id, new Set()]));
  for (const [n, gid] of nodeGroup) for (const a of ancestors(gid)) memberSets.get(a).add(n);

  const list = [...raw.values()]
    .map((g) => ({
      id: g.id,
      title: typeof g.title === 'string' && g.title ? g.title : humanize(g.id),
      parent: parentOf.get(g.id),
      depth: ancestors(g.id).length - 1,
      hue: has(HUES, g.color) ? g.color : 'slate',
      dashed: g.style !== 'solid',
      nodes: [...memberSets.get(g.id)],
      group: g
    }))
    .sort((a, b) => a.depth - b.depth);
  return {
    list,
    byId: new Map(list.map((g) => [g.id, g])),
    nodeGroup,
    chain: (nodeId) => (nodeGroup.has(nodeId) ? ancestors(nodeGroup.get(nodeId)) : []),
    members: (id) => memberSets.get(id) || new Set(),
    ancestors
  };
}
