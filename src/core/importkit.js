/**
 * Shared payload assembly for the draw.io and PlantUML importers. The parsers
 * produce a neutral graph (raw ids, labels, types, groups); these helpers turn
 * it into a Yantra payload with roles, groups and a walkthrough, using the same
 * rules as the Mermaid importer (ids, text budgets, step generation).
 * Pure (no DOM, no Node APIs).
 */
import { humanize, GROUP_MAX_DEPTH } from './model.js';
import { SHAPE_ROLES, shorten, assignRoles, flowSteps, ignoredCollector } from './mermaid.js';

export { ignoredCollector, shorten };

export const MAX_TITLE = 42;
export const MAX_LABEL = 28;

/** Roles for importer-specific node types (shape types come from SHAPE_ROLES). */
export const EXTRA_ROLES = {
  component: { label: 'Component', color: 'blue' },
  usecase: { label: 'Use case', color: 'teal' },
  interface: { label: 'Interface', color: 'green' },
  action: { label: 'Action', color: 'blue' },
  card: { label: 'Entity', color: 'violet' },
  table: { label: 'Table', color: 'violet' },
  class: { label: 'Class', color: 'violet' }
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode XML/HTML character entities (named basics and numeric). */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return Object.hasOwn(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

/** Plain text from an HTML label: block tags and <br> become line breaks, other tags go. */
export function htmlText(s) {
  return decodeEntities(
    String(s ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(div|p|li|tr|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
}

/** Tidy lines: collapse spaces, drop empties. */
export function tidy(s) {
  return String(s ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Node data from clean multi-line text: first line is the title, the rest the subtitle. */
export function textData(text, fallback) {
  const lines = tidy(text).split('\n').filter(Boolean);
  const full = lines.join(' ') || fallback;
  const data = { title: lines[0] || fallback };
  if (lines.length > 1) data.subtitle = lines.slice(1).join(' ');
  if (data.title.length > MAX_TITLE) {
    data.title = shorten(data.title, MAX_TITLE);
    data.description = full;
  }
  return data;
}

/** Stable ids: plain characters kept, others become `-`, collisions get `-2`, `-3`. */
export function idFactory(taken = new Set()) {
  const map = new Map();
  return (raw, hint) => {
    if (map.has(raw)) return map.get(raw);
    const base = String(hint ?? raw).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'n';
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    map.set(raw, id);
    return id;
  };
}

/** A readable id from a label: "Validate order" -> "validate-order". */
export const slug = (s) => tidy(s).split('\n')[0]?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || '';

/** One-line edge label within the budget; long ones are collected for a single warning. */
function edgeLabel(raw, long) {
  const label = tidy(raw).replace(/\n/g, ' ');
  if (label.length <= MAX_LABEL) return label;
  long(label);
  return shorten(label, MAX_LABEL);
}

function edgeIdFactory() {
  const used = new Set();
  return (s, t) => {
    let id = `${s}-${t}`;
    for (let i = 2; used.has(id); i++) id = `${s}-${t}-${i}`;
    used.add(id);
    return id;
  };
}

function rolesFor(types, colors) {
  const roles = assignRoles(types, colors);
  for (const t of Object.keys(roles)) if (Object.hasOwn(EXTRA_ROLES, t)) roles[t].label = EXTRA_ROLES[t].label;
  return roles;
}

/**
 * Flow payload from a neutral graph.
 *   nodes:  [{ raw, label, type, data? (extra data fields), group? (raw group key), hint? (id hint) }]
 *   edges:  [{ from, to, label?, style?, arrow?, relation?, sourceEnd?, targetEnd? }]  (raw node keys; from === to is a self-loop)
 *   groups: [{ raw, title, parent? (raw), color? }]
 * Groups nested deeper than the viewer allows are merged into their ancestor;
 * empty groups are dropped. Returns { payload, warnings } (warnings appended to ctx.warnings).
 */
export function buildFlow({ nodes, edges, groups = [], direction = 'TB', title, description, warnings }) {
  const nodeId = idFactory();
  const byRaw = new Map();
  const outNodes = [];
  for (const n of nodes) {
    const data = { ...textData(n.label, String(n.hint || n.raw)), ...(n.data || {}) };
    const id = nodeId(n.raw, n.hint);
    byRaw.set(n.raw, id);
    const out = { id, type: n.type || 'node', data };
    if (n.shape) out.shape = n.shape;
    outNodes.push(out);
  }
  const colors = new Map(Object.entries(EXTRA_ROLES).map(([k, v]) => [k, { color: v.color }]));
  const roles = rolesFor(outNodes.map((n) => n.type), colors);

  const eid = edgeIdFactory();
  const outEdges = [];
  const longLabels = [];
  for (const e of edges) {
    const s = byRaw.get(e.from);
    const t = byRaw.get(e.to);
    if (!s || !t) continue;
    const edge = { id: eid(s, t), source: s, target: t };
    const label = e.label ? edgeLabel(tidy(e.label).replace(/\n/g, ' '), (l) => longLabels.push(l)) : '';
    if (label) edge.label = label;
    if (e.style) edge.style = e.style;
    if (e.arrow && e.arrow !== 'forward') edge.arrow = e.arrow;
    for (const k of ['relation', 'sourceEnd', 'targetEnd']) if (e[k]) edge[k] = e[k];
    outEdges.push(edge);
  }
  if (longLabels.length) warnings.push(`Shortened ${longLabels.length} edge label${longLabels.length > 1 ? 's' : ''} to ${MAX_LABEL} characters.`);

  // Groups: depth-limit, then keep only those with members (directly or below).
  const gByRaw = new Map(groups.map((g) => [g.raw, { ...g, members: [] }]));
  const depthOf = (g) => {
    let d = 0;
    for (let x = g; x; x = gByRaw.get(x.parent)) if (++d > 20) break;
    return d;
  };
  let merged = 0;
  for (const g of gByRaw.values()) {
    if (g.parent && !gByRaw.has(g.parent)) delete g.parent;
    while (depthOf(g) > GROUP_MAX_DEPTH) {
      g.mergeInto = g.parent;
      g.parent = gByRaw.get(g.parent)?.parent;
    }
  }
  const home = (raw) => {
    let g = gByRaw.get(raw);
    while (g?.mergeInto) {
      g = gByRaw.get(g.mergeInto);
    }
    return g;
  };
  for (const n of nodes) {
    const g = n.group !== undefined ? home(n.group) : null;
    if (g && byRaw.has(n.raw)) g.members.push(byRaw.get(n.raw));
  }
  for (const g of gByRaw.values()) if (g.mergeInto) merged++;
  if (merged) warnings.push(`${merged} group${merged > 1 ? 's' : ''} nested deeper than ${GROUP_MAX_DEPTH} levels ${merged > 1 ? 'were' : 'was'} merged into ${merged > 1 ? 'their' : 'its'} parent.`);
  const live = [...gByRaw.values()].filter((g) => !g.mergeInto);
  const hasMembers = (g) => g.members.length > 0 || live.some((c) => c.parent === g.raw && hasMembers(c));
  const kept = live.filter(hasMembers);
  const groupId = idFactory(new Set(outNodes.map((n) => n.id)));
  for (const g of kept) g.id = groupId(g.raw, g.hint || slug(g.title) || g.raw);
  const outGroups = kept.map((g) => {
    const out = { id: g.id, title: tidy(g.title).replace(/\n/g, ' ') || g.id, nodes: g.members };
    if (g.parent && gByRaw.get(g.parent)?.id) out.parent = gByRaw.get(g.parent).id;
    if (g.color) out.color = g.color;
    return out;
  });

  const payload = {
    meta: { title, description, layout: { direction } },
    roles,
    nodes: outNodes,
    edges: outEdges
  };
  if (outGroups.length) payload.groups = outGroups;
  if (!outNodes.length) warnings.push('No nodes were found.');
  payload.scenarios = [{ id: 'main', name: 'Walkthrough', steps: outNodes.length ? flowSteps(outNodes, outEdges, outGroups) : [] }];
  return { payload, warnings };
}

/**
 * Sequence payload (meta.view "sequence") from participants and messages.
 *   participants: [{ raw, label, kind: 'service' | 'actor' | 'store' }]
 *   messages:     [{ from, to, text, dashed, context: string[], notes: string[] }]
 *   boxes:        [{ title, members: raw[] }]
 */
export function buildSequence({ participants, messages, boxes = [], preNotes = [], title, source, warnings }) {
  if (!participants.length) throw new Error('The sequence diagram has no participants.');
  const parts = new Map(participants.map((p) => [p.raw, p]));
  const nodeId = idFactory();
  const roles = {};
  const outNodes = [];
  for (const p of participants) {
    const type = p.kind === 'service' && /\b(db|database|store|cache|queue|bucket|storage)\b/i.test(`${p.raw} ${p.label}`) ? 'store' : p.kind;
    if (!Object.hasOwn(roles, type)) roles[type] = { ...(Object.hasOwn(SHAPE_ROLES, type) ? SHAPE_ROLES[type] : { label: humanize(type), color: 'slate' }) };
    const data = textData(p.label, p.raw);
    if (type === 'actor') data.icon = 'user';
    if (type === 'store') data.icon = 'database';
    const sent = messages.filter((x) => x.from === p.raw).length;
    const got = messages.filter((x) => x.to === p.raw).length;
    data.description = `Sends ${sent} and receives ${got} message${got === 1 ? '' : 's'}.`;
    p.id = nodeId(p.raw);
    outNodes.push({ id: p.id, type, data });
  }

  const eid = edgeIdFactory();
  const pairs = new Map();
  const outEdges = [];
  const longLabels = [];
  const steps = [];
  messages.forEach((msg, i) => {
    const s = parts.get(msg.from).id;
    const t = parts.get(msg.to).id;
    let edge = null;
    if (s !== t) {
      const key = `${s}\u0000${t}`;
      edge = pairs.get(key);
      if (!edge) {
        edge = { id: eid(s, t), source: s, target: t };
        const label = edgeLabel(msg.text, (l) => longLabels.push(l));
        if (label) edge.label = label;
        if (msg.dashed) edge.style = 'dashed';
        pairs.set(key, edge);
        outEdges.push(edge);
      }
    }
    const from = tidy(parts.get(msg.from).label).replace(/\n/g, ' ');
    const to = tidy(parts.get(msg.to).label).replace(/\n/g, ' ');
    let description = s === t ? `${from} handles this itself.` : `${from} → ${to}${msg.dashed ? ' (reply)' : ''}.`;
    if (msg.context.length) description += ` Inside ${msg.context.join(', within ')}.`;
    if (msg.notes.length) description += ` ${msg.notes.join(' ')}`;
    const step = { id: `msg-${i + 1}`, title: msg.text ? shorten(msg.text, 80) : `${from} to ${to}`, description, highlightNodes: [...new Set([s, t])] };
    if (edge) step.highlightEdges = [edge.id];
    steps.push(step);
  });
  if (longLabels.length) warnings.push(`Shortened ${longLabels.length} edge label${longLabels.length > 1 ? 's' : ''} to ${MAX_LABEL} characters (the full text is the step title).`);
  const repeats = messages.length - outEdges.length - messages.filter((x) => x.from === x.to).length;
  if (repeats > 0) warnings.push(`${repeats} repeated message${repeats > 1 ? 's share' : ' shares'} an edge with an earlier one; each is still its own step.`);

  const payload = {
    meta: {
      title: title || 'Imported sequence diagram',
      description: `Imported from a ${source} sequence diagram: ${outNodes.length} participants, ${messages.length} messages.`,
      layout: { direction: 'LR' },
      view: 'sequence'
    },
    roles,
    nodes: outNodes,
    edges: outEdges
  };
  const groups = boxes.filter((b) => b.members.length).map((b, i) => ({ id: `box-${i + 1}`, title: b.title || `Group ${i + 1}`, nodes: [...new Set(b.members.map((r) => parts.get(r).id))] }));
  if (groups.length) payload.groups = groups;
  payload.scenarios = [
    {
      id: 'main',
      name: 'Message sequence',
      steps: [{ id: 'overview', title: 'Overview', description: [`${outNodes.length} participants exchange ${messages.length} messages.`, ...preNotes].join(' ') }, ...steps]
    }
  ];
  return { payload, warnings };
}
