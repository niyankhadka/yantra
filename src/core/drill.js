/**
 * Multi-level diagrams and links. A node's `data.drill` names a detail diagram
 * in the payload's `diagrams` map (nested maps in detail diagrams are lifted
 * to one flat namespace). `{ "$ref": "./payments.json" }` entries are loaded
 * by the Node builder (lib/build.js) before lint and build; here they stay
 * unresolved. Also: the URL sanitiser for node, edge and step `url` links.
 */

/** Detail levels below the overview. */
export const DRILL_MAX_DEPTH = 8;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** `{ "$ref": "file.json" }` (an unresolved file reference). */
export const isRef = (v) => isObj(v) && typeof v.$ref === 'string';

/** Paths a reference may never take: absolute, drive letters, URLs, non-.json. */
export const isUnsafeRefPath = (p) => typeof p !== 'string' || /^([a-zA-Z][\w+.-]*:|[\\/])/.test(p) || !/\.json$/i.test(p);

/** Links open only http(s) and mailto targets; anything else (javascript:, data:, relative) is dropped. */
export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(t) || /^mailto:[^\s"'<>]+$/i.test(t) ? t : null;
}

/** Drill target of a node, or null. */
export const drillOf = (node) => (isObj(node?.data) && typeof node.data.drill === 'string' && node.data.drill ? node.data.drill : null);

/**
 * Mode-specific drill targets: `data.modes.<mode id>.drill` overrides data.drill
 * in that mode (the viewer applies mode overrides to cards). A list of
 * { mode, drill } for every override that sets drill (drill may be null: none in that mode).
 */
export function modeDrills(node) {
  const modes = isObj(node?.data) && isObj(node.data.modes) ? node.data.modes : null;
  if (!modes) return [];
  return Object.entries(modes)
    .filter(([, o]) => isObj(o) && Object.hasOwn(o, 'drill'))
    .map(([mode, o]) => ({ mode, drill: o.drill }));
}

/** Every level a node opens, in any mode (data.drill and each mode override). */
export function drillTargets(node) {
  const all = [drillOf(node), ...modeDrills(node).map((m) => (typeof m.drill === 'string' && m.drill ? m.drill : null))];
  return [...new Set(all.filter(Boolean))];
}

/**
 * Every detail diagram, flattened: { map: id -> payload, refs: id -> ref entry
 * (unresolved), issues: [{ code, id, message }] }. The first definition of an id wins.
 */
export function collectDiagrams(payload) {
  const map = new Map();
  const refs = new Map();
  const issues = [];
  const seen = new Set();
  const walk = (owner, where) => {
    if (!isObj(owner) || seen.has(owner)) return;
    seen.add(owner);
    const table = owner.diagrams;
    if (table === undefined) return;
    if (!isObj(table)) return issues.push({ code: 'drill/diagrams-invalid', id: null, message: `${where}diagrams must be an object of detail diagrams keyed by id.` });
    for (const [id, sub] of Object.entries(table)) {
      if (map.has(id) || refs.has(id)) {
        issues.push({ code: 'drill/duplicate-id', id, message: `Detail diagram id "${id}" is defined twice; ids are shared by every level.` });
        continue;
      }
      if (isRef(sub)) refs.set(id, sub);
      else if (!isObj(sub) || sub.kind === 'page') issues.push({ code: 'drill/invalid-diagram', id, message: `diagrams.${id} must be a diagram payload or { "$ref": "file.json" }.` });
      else {
        map.set(id, sub);
        walk(sub, `diagrams.${id}.`);
      }
    }
  };
  walk(payload, '');
  return { map, refs, issues };
}

/** Diagram ids each level drills into, in any mode ('' is the overview). */
export function drillEdges(payload, map = collectDiagrams(payload).map) {
  const out = new Map();
  for (const [id, p] of [['', payload], ...map]) {
    const nodes = Array.isArray(p?.nodes) ? p.nodes : [];
    out.set(id, [...new Set(nodes.flatMap(drillTargets))]);
  }
  return out;
}

/** True when the payload has detail diagrams. */
export const hasLevels = (payload) => collectDiagrams(payload).map.size > 0;

/** The payload of a level (null id: the overview), or null when unknown. */
export function getLevel(payload, id) {
  if (!id) return payload;
  return collectDiagrams(payload).map.get(id) || null;
}

/**
 * A valid drill path from the overview, as a list of diagram ids. Each step
 * must be a drill target of the level before; a path that is not (a deep
 * link with only the last id, or a stale one) becomes the shortest path to
 * its last known id, or [] when there is none.
 */
export function levelPath(payload, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter((x) => typeof x === 'string' && x);
  if (!list.length) return [];
  const { map } = collectDiagrams(payload);
  const edges = drillEdges(payload, map);
  const ok = list.every((id, i) => map.has(id) && (edges.get(i ? list[i - 1] : '') || []).includes(id) && list.indexOf(id) === i);
  if (ok) return list;
  const goal = [...list].reverse().find((id) => map.has(id));
  if (!goal) return [];
  // Breadth-first from the overview
  const prev = new Map([['', null]]);
  const queue = [''];
  while (queue.length) {
    const at = queue.shift();
    if (at === goal) break;
    for (const next of edges.get(at) || []) {
      if (prev.has(next) || !map.has(next)) continue;
      prev.set(next, at);
      queue.push(next);
    }
  }
  if (!prev.has(goal)) return [goal];
  const path = [];
  for (let q = goal; q; q = prev.get(q)) path.unshift(q);
  return path;
}

/** Copy of the root with the detail diagram `id` replaced by `sub`, wherever it is nested. */
export function replaceLevel(root, id, sub) {
  const visit = (owner) => {
    if (!isObj(owner) || !isObj(owner.diagrams)) return owner;
    let changed = false;
    const table = {};
    for (const [k, v] of Object.entries(owner.diagrams)) {
      const next = k === id ? sub : visit(v);
      if (next !== v) changed = true;
      table[k] = next;
    }
    return changed ? { ...owner, diagrams: table } : owner;
  };
  return visit(root);
}

/** Levels in reading order (depth first from the overview), each with its breadcrumb trail. */
export function levelOrder(payload) {
  const { map } = collectDiagrams(payload);
  const edges = drillEdges(payload, map);
  const out = [];
  const seen = new Set();
  const visit = (id, trail) => {
    for (const next of edges.get(id) || []) {
      if (seen.has(next) || !map.has(next)) continue;
      seen.add(next);
      out.push({ id: next, payload: map.get(next), trail: [...trail, next] });
      visit(next, [...trail, next]);
    }
  };
  visit('', []);
  return out;
}
