/**
 * Validator. Structural checks on the payload plus geometry checks on the
 * computed scene of every mode. Each finding carries a stable code so agents
 * can repair deterministically:
 *   { level: 'error' | 'warning', code, message, ...context }
 */
import { normalize, GROUP_MAX_DEPTH, has } from './model.js';
import { TEXT_CAP } from './text.js';
import { HUES } from './theme.js';
import { WINDOW_NODES, WINDOW_EDGES } from './route.js';
import { computeScene } from './scene.js';
import { computeSequenceScene, hasSequence } from './sequence.js';
import { overlaps, segmentsOf, segmentHitsBox } from './route.js';
import { ICONS } from './icons.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');
import { BLOCK_TYPES, isSafeImageSrc } from './page.js';

export const BUILTIN_TABS = ['summary', 'step', 'node'];

export const BUDGET = { nodes: 14, edges: 20, labelChars: 28, titleChars: 42 };

export function lint(payload) {
  const findings = [];
  const add = (level, code, message, extra = {}) => findings.push({ level, code, message, ...extra });

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    add('error', 'schema/not-an-object', 'Payload must be a JSON object.');
    return report(findings);
  }
  if (payload.kind === 'page') return lintPage(payload);
  const model = normalize(payload);

  if (!model.meta.title) add('error', 'schema/missing-title', 'meta.title is required.');
  if (model.meta.summary !== undefined) {
    const sm = model.meta.summary;
    if (typeof sm !== 'object' || Array.isArray(sm)) add('error', 'schema/summary-invalid', 'meta.summary must be an object with points and/or facts.');
    else if ((sm.points || []).length > 6) add('warning', 'content/summary-too-long', `meta.summary has ${sm.points.length} points; keep it to 3-5.`);
  }
  if (!model.nodes.length) add('error', 'schema/no-nodes', 'nodes must be a non-empty array of objects.');
  if (!Array.isArray(payload.edges)) add('error', 'schema/no-edges', 'edges must be an array (it may be empty).');
  for (const key of ['nodes', 'edges', 'groups', 'panels', 'modes', 'scenarios', 'steps'])
    arr(payload[key]).forEach((x, i) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) add('error', `schema/${key}-entry-not-object`, `${key}[${i}] must be an object, not ${x === null ? 'null' : Array.isArray(x) ? 'an array' : typeof x}.`);
    });
  for (const key of ['panels', 'modes', 'scenarios', 'steps', 'roles']) // groups: see checkGroups
    if (payload[key] !== undefined && (key === 'roles' ? typeof payload[key] !== 'object' || payload[key] === null || Array.isArray(payload[key]) : !Array.isArray(payload[key])))
      add('error', `schema/${key}-invalid`, `${key} must be ${key === 'roles' ? 'an object' : 'an array'}.`);
  arr(payload.scenarios).forEach((sc, i) => {
    if (sc && typeof sc === 'object' && sc.steps !== undefined && !Array.isArray(sc.steps))
      add('error', 'schema/steps-invalid', `scenarios[${i}].steps must be an array.`);
  });

  // Over-long text is cut for rendering; say so
  const tooLong = (what, text, extra) =>
    typeof text === 'string' && text.length > TEXT_CAP &&
    add('warning', 'content/text-too-long', `${what} is over ${TEXT_CAP} chars and is cut on the card; move detail to description.`, extra);
  model.nodes.forEach((n) => ['title', 'subtitle', 'tech', 'badge'].forEach((k) => tooLong(`Node "${n.id}" ${k}`, n.data?.[k], { node: n.id })));
  model.edges.forEach((e) => tooLong(`Edge "${e.id}" label`, e.label, { edge: e.id }));
  model.groups.forEach((g) => tooLong(`Group "${g.id}" title`, g.title, { group: g.id }));

  // Colours and icons must be built in (own keys only: "constructor" is not a colour)
  const roles = payload.roles && typeof payload.roles === 'object' && !Array.isArray(payload.roles) ? payload.roles : {};
  for (const [type, def] of Object.entries(roles)) {
    if (def?.color !== undefined && !has(HUES, def.color))
      add('warning', 'content/unknown-color', `Role "${type}" color "${def.color}" is not one of ${Object.keys(HUES).join(', ')}; a palette colour is used.`, { role: type });
    if (def?.icon !== undefined && !has(ICONS, def.icon))
      add('warning', 'content/unknown-icon', `Role "${type}" icon "${def.icon}" is not built in; a default is used.`, { role: type });
  }
  model.groups.forEach((g) => {
    if (g.color !== undefined && !has(HUES, g.color))
      add('warning', 'content/unknown-color', `Group "${g.id}" color "${g.color}" is not one of ${Object.keys(HUES).join(', ')}; slate is used.`, { group: g.id });
  });

  // --- identifiers ------------------------------------------------------
  const nodeIds = new Set();
  model.nodes.forEach((n, i) => {
    if (!n || typeof n.id !== 'string' || !n.id) return add('error', 'ref/node-missing-id', `nodes[${i}] has no id.`);
    if (nodeIds.has(n.id)) add('error', 'ref/duplicate-node-id', `Duplicate node id "${n.id}".`, { node: n.id });
    nodeIds.add(n.id);
    if (!n.data?.title || typeof n.data.title !== 'string') add('error', 'schema/node-missing-title', `Node "${n.id}" needs data.title (a string).`, { node: n.id });
    else if (n.data.title.length > BUDGET.titleChars && n.data.title.length <= TEXT_CAP)
      add('warning', 'content/title-too-long', `Node "${n.id}" title is ${n.data.title.length} chars; keep titles under ${BUDGET.titleChars} and move detail to subtitle/description.`, { node: n.id });
    if (n.data?.icon && !has(ICONS, n.data.icon))
      add('warning', 'content/unknown-icon', `Node "${n.id}" icon "${n.data.icon}" is not built in; a default is used.`, { node: n.id });
    if (model.layout.mode === 'manual') {
      if (typeof n.x !== 'number' || typeof n.y !== 'number')
        add('error', 'layout/manual-missing-xy', `Manual layout: node "${n.id}" needs numeric x and y.`, { node: n.id });
      else if (n.x % 10 || n.y % 10)
        add('warning', 'layout/off-grid', `Node "${n.id}" is not on the 10px grid.`, { node: n.id });
    }
  });

  const edgeIds = new Set();
  model.edges.forEach((e, i) => {
    if (!e || typeof e.id !== 'string' || !e.id) return add('error', 'ref/edge-missing-id', `edges[${i}] has no id.`);
    if (edgeIds.has(e.id)) add('error', 'ref/duplicate-edge-id', `Duplicate edge id "${e.id}".`, { edge: e.id });
    edgeIds.add(e.id);
    if (typeof e.source !== 'string' || !nodeIds.has(e.source)) add('error', 'ref/edge-unknown-source', `Edge "${e.id}" source "${typeof e.source === 'string' ? e.source : JSON.stringify(e.source) ?? 'undefined'}" is not a node.`, { edge: e.id });
    if (typeof e.target !== 'string' || !nodeIds.has(e.target)) add('error', 'ref/edge-unknown-target', `Edge "${e.id}" target "${typeof e.target === 'string' ? e.target : JSON.stringify(e.target) ?? 'undefined'}" is not a node.`, { edge: e.id });
    if (e.label !== undefined && typeof e.label !== 'string') add('error', 'schema/edge-label-invalid', `Edge "${e.id}" label must be a string.`, { edge: e.id });
    else if (!e.label) add('warning', 'content/edge-missing-label', `Edge "${e.id}" has no label; say what flows along it.`, { edge: e.id });
    else if (e.label.length > BUDGET.labelChars && e.label.length <= TEXT_CAP)
      add('warning', 'content/label-too-long', `Edge "${e.id}" label is ${e.label.length} chars; keep labels under ${BUDGET.labelChars}.`, { edge: e.id });
  });

  // --- groups -------------------------------------------------------------
  checkGroups(payload, model, nodeIds, add);

  // --- modes & story ----------------------------------------------------
  const modeIds = new Set(model.modes.map((m) => m.id));
  if (model.meta.defaultMode && !modeIds.has(model.meta.defaultMode) && payload.modes?.length)
    add('error', 'ref/default-mode-unknown', `meta.defaultMode "${model.meta.defaultMode}" is not a mode id.`);
  for (const m of model.modes) {
    arr(m.hideNodes).forEach((id) => nodeIds.has(id) || add('error', 'ref/mode-unknown-node', `Mode "${m.id}" hides unknown node "${id}".`, { mode: m.id }));
    arr(m.hideEdges).forEach((id) => edgeIds.has(id) || add('error', 'ref/mode-unknown-edge', `Mode "${m.id}" hides unknown edge "${id}".`, { mode: m.id }));
  }

  const edgeById = new Map(model.edges.map((e) => [e.id, e]));
  let stepCount = 0;
  for (const sc of model.scenarios) {
    arr(sc.steps).forEach((st, i) => {
      stepCount++;
      const where = `Scenario "${sc.name || sc.id}" step ${i + 1}`;
      if (!st.title) add('error', 'schema/step-missing-title', `${where} needs a title.`);
      const hn = arr(st.highlightNodes || st.activeNodes);
      const he = arr(st.highlightEdges || st.activeEdges);
      hn.forEach((id) => nodeIds.has(id) || add('error', 'ref/step-unknown-node', `${where} highlights unknown node "${id}".`, { step: st.id }));
      he.forEach((id) => {
        const e = edgeById.get(id);
        if (!e) return add('error', 'ref/step-unknown-edge', `${where} highlights unknown edge "${id}".`, { step: st.id });
        if (hn.length && (!hn.includes(e.source) || !hn.includes(e.target)))
          add('warning', 'story/edge-endpoint-dimmed', `${where} highlights edge "${id}" but not both of its nodes.`, { step: st.id });
      });
    });
  }
  if (!stepCount) add('warning', 'story/no-steps', 'No walkthrough steps: add scenarios[].steps so the diagram tells a story.');

  // --- inspector: built-in tabs and custom panels ---------------------------
  const panelIds = new Set();
  model.panels.forEach((pn, i) => {
    const where = `panels[${i}]${pn.title ? ` "${pn.title}"` : ''}`;
    if (!pn.id || !pn.title) add('error', 'panel/missing-id-or-title', `${where} needs an id and a title (the tab label).`);
    if (pn.id && (panelIds.has(pn.id) || BUILTIN_TABS.includes(pn.id))) add('error', 'panel/duplicate-id', `${where} id "${pn.id}" is already used.`);
    panelIds.add(pn.id);
    if (!Array.isArray(pn.blocks) || !pn.blocks.length) add('error', 'panel/no-blocks', `${where} needs a non-empty blocks array.`);
    else checkBlocks(pn.blocks, add, `panels[${i}].blocks`);
  });
  for (const id of arr(model.inspector.tabs)) {
    if (!BUILTIN_TABS.includes(id) && !panelIds.has(id))
      add('error', 'ref/inspector-unknown-tab', `meta.inspector.tabs lists "${id}", which is neither ${BUILTIN_TABS.join(', ')} nor a panel id.`);
  }
  const onClick = model.inspector.onNodeClick;
  if (onClick !== undefined && onClick !== 'node' && onClick !== 'stay' && !panelIds.has(onClick))
    add('error', 'ref/inspector-unknown-click-target', `meta.inspector.onNodeClick is "${onClick}"; use "node", "stay" or a panel id.`);
  if (Array.isArray(model.inspector.tabs) && onClick && onClick !== 'stay' && !model.inspector.tabs.includes(onClick))
    add('warning', 'ref/inspector-click-tab-hidden', `meta.inspector.onNodeClick targets "${onClick}", which meta.inspector.tabs does not show.`);
  model.panels.forEach((pn, i) =>
    arr(pn.blocks).forEach((b, j) =>
      (Array.isArray(b?.nodes) ? b.nodes : []).forEach((id) => {
        if (!nodeIds.has(id)) add('error', 'ref/panel-unknown-node', `panels[${i}].blocks[${j}] lists unknown node "${id}" in nodes.`);
      })
    )
  );

  // --- budgets ----------------------------------------------------------
  if (model.nodes.length > BUDGET.nodes)
    add('warning', 'budget/too-many-nodes', `${model.nodes.length} nodes (budget ${BUDGET.nodes}). Split into an overview plus detail diagrams.`);
  if (model.edges.length > BUDGET.edges)
    add('warning', 'budget/too-many-edges', `${model.edges.length} edges (budget ${BUDGET.edges}). Merge parallel flows or split the diagram.`);
  if (model.nodes.length > WINDOW_NODES || model.edges.length > WINDOW_EDGES)
    add('warning', 'budget/large-graph-fast-routing', `Graph is large (over ${WINDOW_NODES} nodes or ${WINDOW_EDGES} edges), so edges use the faster windowed router; routes may bend more. Split the diagram for the best routing.`);

  // --- geometry (only when the graph is referentially sound) -------------
  if (!findings.some((f) => f.level === 'error')) {
    for (const mode of model.modes) geometry(computeScene(payload, { modeId: mode.id }), mode, add, model.modes.length > 1);
  }

  // --- sequence view ------------------------------------------------------
  const view = model.meta.view;
  if (view !== undefined && view !== 'flow' && view !== 'sequence')
    add('error', 'schema/unknown-view', `meta.view is "${view}"; use "flow" or "sequence".`);
  if (view === 'sequence') {
    const withMessages = model.scenarios.map((sc, i) => i).filter((i) => hasSequence(payload, { scenarioIndex: i }));
    if (!withMessages.length)
      add('warning', 'sequence/no-messages', 'meta.view is "sequence" but no step has highlightEdges; the flow view is shown instead. List the edges each step sends.');
    else if (!findings.some((f) => f.level === 'error'))
      for (const mode of model.modes)
        for (const i of withMessages) sequenceGeometry(computeSequenceScene(payload, { modeId: mode.id, scenarioIndex: i }), add, model.modes.length > 1 ? ` [mode ${mode.id}]` : '');
  }

  return report(findings);
}

function geometry(scene, mode, add, tagMode) {
  const ctx = tagMode ? { mode: mode.id } : {};
  const sfx = tagMode ? ` [mode ${mode.id}]` : '';
  const nodes = scene.nodes;

  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (overlaps(nodes[i], nodes[j]))
        add('error', 'geometry/node-overlap', `Nodes "${nodes[i].id}" and "${nodes[j].id}" overlap${sfx}.`, { ...ctx, nodes: [nodes[i].id, nodes[j].id] });

  const labels = [];
  for (const e of scene.edges) {
    if (!e.ok) add('error', 'geometry/route-failed', `No clear path for edge "${e.id}"${sfx}; move its nodes apart.`, { ...ctx, edge: e.id });
    const segs = segmentsOf(e.points);
    const ex = e.points.map((p) => p.x);
    const ey = e.points.map((p) => p.y);
    const span = { x: Math.min(...ex), y: Math.min(...ey), x1: Math.max(...ex), y1: Math.max(...ey) };
    for (const n of nodes) {
      if (n.x > span.x1 || n.x + n.w < span.x || n.y > span.y1 || n.y + n.h < span.y) continue; // cannot touch this route
      const own = n.id === e.edge.source || n.id === e.edge.target;
      // Port stubs legitimately touch their own node
      const check = own ? segs.slice(1, -1) : segs;
      if (check.some((s) => segmentHitsBox(s, shrink(n, 1))))
        add('error', 'geometry/edge-through-node', `Edge "${e.id}" passes through node "${n.id}"${sfx}.`, { ...ctx, edge: e.id, node: n.id });
    }
    if (e.label) {
      const box = { x: e.label.x - e.label.w / 2, y: e.label.y - e.label.h / 2, w: e.label.w, h: e.label.h };
      const hit = nodes.find((n) => overlaps(box, n));
      if (hit) add('error', 'geometry/label-overlaps-node', `Label of "${e.id}" overlaps node "${hit.id}"${sfx}; shorten the label or widen the gap.`, { ...ctx, edge: e.id, node: hit.id });
      const other = labels.find((l) => overlaps(box, l.box));
      if (other) add('error', 'geometry/label-overlaps-label', `Labels of "${e.id}" and "${other.id}" overlap${sfx}.`, { ...ctx, edges: [e.id, other.id] });
      labels.push({ id: e.id, box });
    }
  }

  // Group boxes: siblings apart, outsiders out, titles clear
  const groups = scene.groups || [];
  const nested = (a, b) => {
    for (let g = b; g; g = groups.find((x) => x.id === g.parent)) if (g.parent === a.id) return true;
    return false;
  };
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      if (!nested(a, b) && !nested(b, a) && overlaps(a, b))
        add('error', 'geometry/group-overlap', `Groups "${a.id}" and "${b.id}" overlap${sfx}; nest one inside the other or move their nodes apart.`, { ...ctx, groups: [a.id, b.id] });
    }
  for (const g of groups) {
    const members = new Set(g.members);
    for (const n of nodes)
      if (!members.has(n.id) && overlaps(n, g))
        add('error', 'geometry/node-in-foreign-group', `Node "${n.id}" sits inside group "${g.id}" but is not a member${sfx}; add it to the group or move it out.`, { ...ctx, node: n.id, group: g.id });
    for (const l of labels)
      if (overlaps(l.box, g.titleBox))
        add('warning', 'geometry/label-overlaps-group-title', `Label of "${l.id}" covers the title of group "${g.id}"${sfx}.`, { ...ctx, edge: l.id, group: g.id });
  }

  // Parallel edges drawn on top of each other read as one line
  const segs = scene.edges.flatMap((e) => segmentsOf(e.points).map((s) => ({ ...s, id: e.id })));
  const seen = new Set();
  // Only segments on the same line can share track: bucket them by line
  const lineOf = (s) => (s.a.x === s.b.x ? 'v' + s.a.x : 'h' + s.a.y);
  const byLine = new Map();
  segs.forEach((s, k) => {
    const key = lineOf(s);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(k);
  });
  for (let i = 0; i < segs.length; i++)
    for (const j of byLine.get(lineOf(segs[i]))) {
      if (j <= i) continue;
      const a = segs[i];
      const b = segs[j];
      if (a.id === b.id) continue;
      const shared = collinearOverlap(a, b);
      const key = [a.id, b.id].sort().join('|');
      if (shared >= 8 && !seen.has(key)) {
        seen.add(key);
        add('warning', 'geometry/edges-stacked', `Edges "${a.id}" and "${b.id}" share ${Math.round(shared)}px of track${sfx}.`, { ...ctx, edges: [a.id, b.id] });
      }
    }
}

/**
 * Sequence layout widens column gaps so labels fit; these checks guard that
 * promise (labels inside their arrow's span, clear of each other and headers).
 */
function sequenceGeometry(scene, add, sfx) {
  const boxes = scene.messages.map((m) => ({ id: m.edgeId, m, box: { x: m.label.x - m.label.w / 2, y: m.label.y - m.label.h / 2, w: m.label.w, h: m.label.h } }));
  for (const { id, m, box } of boxes) {
    const lo = Math.min(m.points[0].x, m.points[m.points.length - 1].x);
    const hi = Math.max(m.points[0].x, m.points[m.points.length - 1].x);
    if (!m.self && (box.x < lo || box.x + box.w > hi))
      add('error', 'geometry/sequence-label-overflow', `Sequence label of "${id}" is wider than its arrow${sfx}.`, { edge: id });
    const head = scene.participants.find((p) => overlaps(box, p));
    if (head) add('error', 'geometry/sequence-label-overlaps-node', `Sequence label of "${id}" overlaps header "${head.id}"${sfx}.`, { edge: id, node: head.id });
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlaps(boxes[i].box, boxes[j].box))
        add('error', 'geometry/sequence-label-overlap', `Sequence labels of "${boxes[i].id}" and "${boxes[j].id}" overlap${sfx}.`, { edges: [boxes[i].id, boxes[j].id] });
}

function checkGroups(payload, model, nodeIds, add) {
  if (payload.groups === undefined) return;
  if (!Array.isArray(payload.groups)) return add('error', 'schema/groups-invalid', 'groups must be an array.');
  const ids = new Set();
  const byId = new Map();
  payload.groups.forEach((g, i) => {
    if (!g || typeof g.id !== 'string' || !g.id) return add('error', 'group/missing-id', `groups[${i}] needs an id.`);
    if (ids.has(g.id) || nodeIds.has(g.id)) add('error', 'group/duplicate-id', `Group id "${g.id}" is already used by ${nodeIds.has(g.id) ? 'a node' : 'another group'}.`, { group: g.id });
    ids.add(g.id);
    if (!byId.has(g.id)) byId.set(g.id, g);
    if (!g.title) add('warning', 'group/missing-title', `Group "${g.id}" needs a title.`, { group: g.id });
  });
  const owner = new Map();
  for (const g of byId.values()) {
    for (const n of Array.isArray(g.nodes) ? g.nodes : []) {
      if (!nodeIds.has(n)) add('error', 'group/unknown-node', `Group "${g.id}" lists unknown node "${n}".`, { group: g.id, node: n });
      else if (owner.has(n) && owner.get(n) !== g.id)
        add('error', 'group/node-in-two-groups', `Node "${n}" is in groups "${owner.get(n)}" and "${g.id}"; list it only in its innermost group.`, { node: n, groups: [owner.get(n), g.id] });
      else owner.set(n, g.id);
    }
  }
  const children = new Map();
  for (const g of byId.values()) {
    if (g.parent === undefined || g.parent === null) continue;
    if (!byId.has(g.parent)) add('error', 'group/unknown-parent', `Group "${g.id}" has unknown parent "${g.parent}".`, { group: g.id });
    else children.set(g.parent, [...(children.get(g.parent) || []), g.id]);
  }
  const reported = new Set();
  for (const g of byId.values()) {
    const chain = [g.id];
    let q = byId.get(g.parent);
    while (q && !chain.includes(q.id)) {
      chain.push(q.id);
      q = byId.get(q.parent);
    }
    if (q) {
      const cyc = chain.slice(chain.indexOf(q.id)).sort().join(' > ');
      if (!reported.has(cyc)) add('error', 'group/cycle', `Groups form a parent cycle: ${cyc}.`, { groups: cyc.split(' > ') });
      reported.add(cyc);
    } else if (chain.length > GROUP_MAX_DEPTH) add('error', 'group/too-deep', `Group "${g.id}" is nested ${chain.length} deep; the maximum is ${GROUP_MAX_DEPTH}.`, { group: g.id });
  }
  for (const g of byId.values()) {
    const hasNodes = (id, seen = new Set()) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return arr(byId.get(id)?.nodes).some((n) => nodeIds.has(n)) || (children.get(id) || []).some((c) => hasNodes(c, seen));
    };
    if (!reported.size && !hasNodes(g.id)) add('warning', 'group/empty', `Group "${g.id}" has no nodes; remove it or list its members.`, { group: g.id });
  }
  if (byId.size > 6) add('warning', 'budget/too-many-groups', `${byId.size} groups; keep to 2-5 so the boxes stay readable.`);
}

function collinearOverlap(a, b) {
  const av = a.a.x === a.b.x;
  const bv = b.a.x === b.b.x;
  if (av !== bv) return 0;
  if (av) {
    if (a.a.x !== b.a.x) return 0;
    return Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) - Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y));
  }
  if (a.a.y !== b.a.y) return 0;
  return Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x)) - Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x));
}

const shrink = (r, m) => ({ x: r.x + m, y: r.y + m, w: r.w - m * 2, h: r.h - m * 2 });

function report(findings) {
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');
  return { valid: errors.length === 0, errors, warnings };
}

// --- Answer pages -------------------------------------------------------------
export const PAGE_BUDGET = { blocks: 12, headlineChars: 220, interactiveDiagrams: 2 };

const BLOCK_NEEDS = {
  text: (b) => typeof b.body === 'string' && b.body.trim(),
  points: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.title),
  steps: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.title),
  metrics: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.label && i.value !== undefined),
  table: (b) => Array.isArray(b.columns) && b.columns.length && Array.isArray(b.rows) && b.rows.every((r) => Array.isArray(r) && r.length === b.columns.length),
  compare: (b) => Array.isArray(b.options) && b.options.length >= 2 && b.options.every((o) => o?.name),
  callout: (b) => typeof b.body === 'string' && b.body.trim(),
  diagram: (b) => b.diagram && typeof b.diagram === 'object',
  chart: (b) => Array.isArray(b.data) && b.data.length && b.data.every((d) => d?.label && typeof d.value === 'number'),
  code: (b) => typeof b.code === 'string',
  sources: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.title || i?.url),
  timeline: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.date && i?.title),
  faq: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.q && typeof i.a === 'string' && i.a.trim()),
  checklist: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.text),
  quote: (b) => typeof b.text === 'string' && b.text.trim(),
  image: (b) => typeof b.src === 'string' && b.src.trim(),
  kv: (b) => Array.isArray(b.items) && b.items.length && b.items.every((i) => i?.k && i.v !== undefined && i.v !== null)
};

const BLOCK_SHAPE = {
  text: 'body (string)',
  points: 'items: [{ title, text? }]',
  steps: 'items: [{ title, text? }]',
  metrics: 'items: [{ label, value, note? }]',
  table: 'columns: [..] and rows: [[..]] with one cell per column',
  compare: 'options: [{ name, pros?, cons?, verdict? }] (2 or more)',
  callout: 'body (string)',
  diagram: 'diagram (a Yantra diagram payload) or src (path to one)',
  chart: 'data: [{ label, value (number) }]',
  code: 'code (string)',
  sources: 'items: [{ title, url? }]',
  timeline: 'items: [{ date, title, text?, tone? }]',
  faq: 'items: [{ q, a }]',
  checklist: 'items: [{ text, done?, note? }]',
  quote: 'text (string), by?, source?',
  image: 'src (https: URL or data:image/ URI) and alt',
  kv: 'items: [{ k, v }]'
};

export function lintPage(page) {
  const findings = [];
  const add = (level, code, message, extra = {}) => findings.push({ level, code, message, ...extra });
  const meta = page.meta || {};
  if (!meta.title && !meta.question) add('error', 'schema/missing-title', 'meta.title or meta.question is required.');
  const answer = page.answer;
  if (!answer || typeof answer !== 'object' || !answer.headline)
    add('error', 'page/missing-answer', 'answer.headline is required: state the conclusion first, in one or two sentences.');
  else if (answer.headline.length > PAGE_BUDGET.headlineChars)
    add('warning', 'page/headline-too-long', `answer.headline is ${answer.headline.length} chars; keep it under ${PAGE_BUDGET.headlineChars} and move detail to answer.text.`);

  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  if (page.blocks !== undefined && !Array.isArray(page.blocks)) add('error', 'schema/blocks-invalid', 'blocks must be an array.');
  if (blocks.length > PAGE_BUDGET.blocks) add('warning', 'page/too-many-blocks', `${blocks.length} blocks (budget ${PAGE_BUDGET.blocks}); one page should be scannable. Cut or merge.`);

  if (meta.toc !== undefined && typeof meta.toc !== 'boolean') add('warning', 'page/bad-toc', 'meta.toc must be true or false.');
  const live = blocks.filter((b) => b?.type === 'diagram' && b.interactive).length;
  if (live > PAGE_BUDGET.interactiveDiagrams)
    add('warning', 'page/heavy-embed', `${live} interactive diagrams; each embeds the full viewer. Keep at most ${PAGE_BUDGET.interactiveDiagrams} and show the rest as static figures.`);

  checkBlocks(blocks, add, 'blocks');
  return report(findings);
}

/** Validate page or panel blocks; embedded diagrams get the full diagram lint. */
function checkBlocks(blocks, add, path) {
  blocks.forEach((b, i) => {
    const where = `${path}[${i}]${b?.title ? ` "${b.title}"` : ''}`;
    if (!b || !BLOCK_TYPES.includes(b.type)) return add('error', 'page/unknown-block', `${where} has unknown type "${b?.type}". Use one of: ${BLOCK_TYPES.join(', ')}.`, { block: i });
    if (b.type === 'diagram' && b.src && !b.diagram) {
      const src = String(b.src);
      const unsafe = /^([a-zA-Z]:|[\\/])/.test(src) || src.split(/[\\/]/).includes('..') || !/\.json$/i.test(src);
      return add('error', 'page/diagram-unresolved', unsafe
        ? `${where} src "${src}" was not loaded: diagram src must be a relative path to a .json file inside the page's folder (no "..", no absolute paths).`
        : `${where} references "${src}" which was not loaded (missing, unreadable or not valid JSON).`, { block: i });
    }
    if (!BLOCK_NEEDS[b.type](b)) return add('error', 'page/block-invalid', `${where} (${b.type}) needs ${BLOCK_SHAPE[b.type]}.`, { block: i });
    if (b.type === 'diagram') {
      const r = lint(b.diagram);
      for (const f of [...r.errors, ...r.warnings]) {
        if (f.code === 'story/no-steps') continue; // a static figure needs no walkthrough
        add(f.level, f.code, `${where}: ${f.message}`, { ...f, block: i });
      }
    }
    if (b.type === 'image') {
      if (!isSafeImageSrc(b.src)) add('error', 'page/image-src', `${where} src must be an https: URL or a data:image/ URI.`, { block: i });
      if (typeof b.alt !== 'string' || !b.alt.trim()) add('error', 'page/image-alt', `${where} needs alt text describing the image for screen readers.`, { block: i });
    }
    if (b.type === 'diagram' && b.height !== undefined && !(Number.isFinite(b.height) && b.height >= 240))
      add('warning', 'page/bad-height', `${where} height must be a number of pixels, at least 240.`, { block: i });
    if (b.span && b.span !== 'half' && b.span !== 'full') add('warning', 'page/bad-span', `${where} span must be "half" or "full".`, { block: i });
  });
}
