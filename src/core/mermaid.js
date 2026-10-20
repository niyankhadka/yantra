/**
 * Mermaid import: turns a Mermaid flowchart, sequence, state, ER or class diagram,
 * mind map or user journey into a Yantra payload, and a gantt, pie, timeline or
 * quadrant chart into an answer page (src/core/importcharts.js). Pure (no DOM,
 * no Node APIs) and dependency-free.
 *
 *   fromMermaid(text, { title? }) -> { payload, warnings: string[] }
 *   mermaidBlocks(markdown)       -> string[]   (```mermaid fenced blocks)
 */
import { humanize } from './model.js';
import { RELATIONS, END_LABELS } from './notation.js';
import { lint } from './lint.js';
import { fromMermaidGantt, fromMermaidPie, fromMermaidTimeline, fromMermaidQuadrant, fromMermaidJourney } from './importcharts.js';

// Shared with the draw.io and PlantUML importers (src/core/importkit.js)
export { SHAPE_ROLES, shorten, assignRoles, flowSteps, ignoredCollector };

const MAX_TITLE = 42;
const MAX_LABEL = 28;
const MAX_FLOW_STEPS = 8; // including the overview

/** Built-in roles for shape-derived types. */
const SHAPE_ROLES = {
  node: { label: 'Step', color: 'blue' },
  decision: { label: 'Decision', color: 'amber' },
  store: { label: 'Data store', color: 'violet', icon: 'database' },
  terminal: { label: 'Start / end', color: 'teal' },
  io: { label: 'Input / output', color: 'green' },
  event: { label: 'Event', color: 'orange' },
  actor: { label: 'Actor', color: 'amber', icon: 'user' },
  service: { label: 'Participant', color: 'blue' },
  state: { label: 'State', color: 'blue' },
  choice: { label: 'Choice', color: 'amber' },
  fork: { label: 'Fork / join', color: 'slate' }
};
const CLASS_HUES = ['blue', 'teal', 'green', 'amber', 'rose', 'violet', 'orange', 'slate'];

/** Opening/closing delimiters, longest first, with the type each shape implies. */
const SHAPES = [
  ['(((', ')))', 'terminal'],
  ['([', '])', 'terminal'],
  ['[(', ')]', 'store'],
  ['[[', ']]', 'node'],
  ['[/', '/]', 'io'],
  ['[/', '\\]', 'io'],
  ['[\\', '\\]', 'io'],
  ['[\\', '/]', 'io'],
  ['((', '))', 'terminal'],
  ['{{', '}}', 'node'],
  ['[', ']', 'node'],
  ['(', ')', 'node'],
  ['{', '}', 'decision'],
  ['>', ']', 'event']
];

/** Return every ```mermaid fenced block in a Markdown document. */
export function mermaidBlocks(markdown) {
  const out = [];
  const re = /^[ \t]*(`{3,}|~{3,})[ \t]*mermaid[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(String(markdown || '')))) out.push(m[2]);
  return out;
}

export function fromMermaid(text, opts = {}) {
  const warnings = [];
  const { lines, frontTitle } = preprocess(String(text || ''));
  if (!lines.length) throw new Error('The Mermaid text is empty.');
  const header = lines[0].text;
  const ctx = { warnings, title: opts.title || frontTitle };
  const parse = /^(graph|flowchart)\b/i.test(header) ? parseFlowchart
    : /^sequenceDiagram\b/.test(header) ? parseSequence
    : /^stateDiagram(-v2)?\b/.test(header) ? parseState
    : /^erDiagram\b/.test(header) ? parseErDiagram
    : /^classDiagram(-v2)?\b/.test(header) ? parseClassDiagram
    : /^mindmap\b/.test(header) ? (_, c) => parseMindmap(String(text || ''), c) // indentation matters: parse the raw text
    : /^gantt\b/.test(header) ? fromMermaidGantt
    : /^pie\b/.test(header) ? fromMermaidPie
    : /^timeline\b/.test(header) ? fromMermaidTimeline
    : /^quadrantChart\b/.test(header) ? fromMermaidQuadrant
    : /^journey\b/.test(header) ? fromMermaidJourney
    : null;
  if (parse) {
    try {
      return parse(lines, ctx);
    } catch (err) {
      // Never leak an internal TypeError: report a clear import error instead
      throw new Error(`Could not convert the Mermaid text (${err?.message || err}). Simplify the offending line or build the JSON directly.`);
    }
  }
  const kind = header.split(/\s+/)[0];
  throw new Error(`Unsupported Mermaid diagram type "${kind}". Supported: flowchart / graph, sequenceDiagram, stateDiagram, erDiagram, classDiagram, mindmap, journey (diagrams); gantt, pie, timeline, quadrantChart (answer pages).`);
}

// --- shared helpers ------------------------------------------------------------

/** Strip front matter, %% comments and blank lines; keep 1-based line numbers. */
function preprocess(text) {
  let src = text.replace(/\r\n?/g, '\n');
  let frontTitle;
  const fm = /^\s*---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(src);
  if (fm) {
    const t = /^title:\s*(.+)$/m.exec(fm[1]);
    if (t) frontTitle = unquote(t[1].trim());
    src = src.slice(fm[0].length);
  }
  const lines = [];
  src.split('\n').forEach((raw, i) => {
    const line = raw.replace(/%%.*$/, '').trim();
    if (line) lines.push({ text: line, no: i + 1 });
  });
  return { lines, frontTitle };
}

const unquote = (s) => (/^"[\s\S]*"$/.test(s) || /^'[\s\S]*'$/.test(s) ? s.slice(1, -1) : s);

/** Plain text from a Mermaid label: no HTML, entities, markdown or fa: icons. */
export function cleanLabel(raw) {
  return String(raw || '')
    .replace(/^"([\s\S]*)"$/, '$1')
    .replace(/^`([\s\S]*)`$/, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/#quot;/g, '"')
    .replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\bfa[bsr]?:fa-[\w-]+\s*/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Shorten at a word boundary. */
function shorten(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** Node data from a label: first line is the title, the rest the subtitle. */
function labelData(label, fallback) {
  const lines = cleanLabel(label).split('\n').filter(Boolean);
  const full = lines.join(' ') || fallback;
  const data = { title: lines[0] || fallback };
  if (lines.length > 1) data.subtitle = lines.slice(1).join(' ');
  if (data.title.length > MAX_TITLE) {
    data.title = shorten(data.title, MAX_TITLE);
    data.description = full;
  }
  return data;
}

function idFactory(taken = new Set()) {
  const map = new Map();
  return (raw) => {
    if (map.has(raw)) return map.get(raw);
    let base = String(raw).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'n';
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    map.set(raw, id);
    return id;
  };
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

function edgeLabel(raw, warn) {
  const label = cleanLabel(raw).replace(/\n/g, ' ');
  if (label.length > MAX_LABEL) {
    warn(label);
    return shorten(label, MAX_LABEL);
  }
  return label;
}

/** Map a CSS hex colour to the nearest Yantra hue. */
export function hueOf(color) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.15 || d < 0.06) return 'slate';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 330) return 'rose';
  if (h < 40) return 'orange';
  if (h < 70) return 'amber';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 255) return 'blue';
  if (h < 300) return 'violet';
  return 'rose';
}

const IGNORED_WHY = {
  style: 'colours come from roles; use classDef + class to set a node type',
  linkStyle: 'edge styling is automatic',
  click: 'links and callbacks are not imported',
  direction: 'layout is automatic',
  '~~~ (invisible link)': 'layout is automatic'
};

/** Collapse repeated ignored-line kinds into one warning each. */
function ignoredCollector(warnings) {
  const counts = new Map();
  return {
    add: (kind) => counts.set(kind, (counts.get(kind) || 0) + 1),
    flush: (why) => {
      for (const [kind, n] of counts) warnings.push(`Ignored ${n} \`${kind}\` line${n > 1 ? 's' : ''} (${why[kind] || 'not supported'}).`);
    }
  };
}

// --- flowcharts ----------------------------------------------------------------

const LINK_TEXT = /(<)?(--|==|-\.)(?![->=.]|[ox](?:\s|$))\s*(.+?)\s*(-{2,}>|-{2,}[ox](?![\w])|-{3,}|={2,}>|={2,}[ox](?![\w])|={3,}|\.-+>|\.-+[ox](?![\w])|\.-+)/y;
const LINK = /(<|o|x)?(-{2,}>|-{2,}[ox](?![\w])|-{3,}|={2,}>|={2,}[ox](?![\w])|={3,}|-\.+->|-\.+-[ox](?![\w])|-\.+-|~~~)/y;
const PIPE = /\s*\|([^|]*)\|/y;
const NODE_ID = /[A-Za-z0-9_À-￿$][\wÀ-￿$]*(?:-[\wÀ-￿$]+)*/y;

function parseFlowchart(lines, ctx) {
  const { warnings } = ctx;
  const head = /^(graph|flowchart)\s*(TD|TB|BT|LR|RL)?/i.exec(lines[0].text);
  const dir = (head[2] || 'TB').toUpperCase();
  if (dir === 'BT' || dir === 'RL') warnings.push(`Direction ${dir} is drawn as ${dir === 'BT' ? 'TB' : 'LR'}; Yantra does not reverse the flow.`);
  const ignored = ignoredCollector(warnings);

  const nodes = new Map(); // mermaid id -> { raw, label, shape type, classes[], explicit, order, group }
  const rawEdges = [];
  const groups = []; // { raw, title, nodes: rawIds[], parent }
  const stack = [];
  const classDefs = new Map(); // name -> { color }
  const longLabels = [];
  const circleHeads = new Set();

  const touch = (raw, shape) => {
    let n = nodes.get(raw);
    if (!n) {
      n = { raw, label: raw, type: 'node', classes: [], explicit: false, order: nodes.size };
      nodes.set(raw, n);
      const g = stack[stack.length - 1];
      if (g) {
        n.group = g;
        g.nodes.push(raw);
      }
    }
    if (shape) {
      n.label = shape.label;
      n.type = shape.type;
      n.explicit = true;
    }
    return n;
  };

  // Rest of the statement: a node reference with optional shape and :::class.
  const readNode = (s, i) => {
    while (s[i] === ' ' || s[i] === '\t') i++;
    NODE_ID.lastIndex = i;
    const m = NODE_ID.exec(s);
    if (!m) return null;
    const raw = m[0];
    i = NODE_ID.lastIndex;
    let shape = null;
    for (const [open, close, type] of SHAPES) {
      if (!s.startsWith(open, i)) continue;
      let j = i + open.length;
      let label;
      if (s[j] === '"') {
        const q = s.indexOf('"', j + 1);
        if (q < 0) continue;
        label = s.slice(j, q + 1);
        j = q + 1;
        if (!s.startsWith(close, j)) continue;
      } else {
        const c = s.indexOf(close, j);
        if (c < 0) continue;
        label = s.slice(j, c);
        j = c;
      }
      shape = { label, type };
      i = j + close.length;
      break;
    }
    const classes = [];
    while (s.startsWith(':::', i)) {
      const cm = /:::([\w-]+)/y;
      cm.lastIndex = i;
      const r = cm.exec(s);
      if (!r) break;
      classes.push(r[1]);
      i = cm.lastIndex;
    }
    return { raw, shape, classes, end: i };
  };

  const readGroup = (s, i) => {
    const refs = [];
    for (;;) {
      const ref = readNode(s, i);
      if (!ref) return refs.length ? { refs, end: i } : null;
      refs.push(ref);
      i = ref.end;
      const amp = /\s*&\s*/y;
      amp.lastIndex = i;
      if (!amp.exec(s)) return { refs, end: i };
      i = amp.lastIndex;
    }
  };

  const readLink = (s, i) => {
    while (s[i] === ' ' || s[i] === '\t') i++;
    let m;
    let label = '';
    let token;
    LINK_TEXT.lastIndex = i;
    if ((m = LINK_TEXT.exec(s))) {
      token = `${m[1] || ''}${m[2]}${m[4]}`;
      label = m[3];
      i = LINK_TEXT.lastIndex;
    } else {
      LINK.lastIndex = i;
      if (!(m = LINK.exec(s))) return null;
      token = m[0];
      i = LINK.lastIndex;
      PIPE.lastIndex = i;
      const p = PIPE.exec(s);
      if (p) {
        label = p[1];
        i = PIPE.lastIndex;
      }
    }
    return { token, label, end: i };
  };

  const statement = (s, no) => {
    const first = readGroup(s, 0);
    if (!first) return warnings.push(`Line ${no}: could not parse "${s}".`);
    const all = [first];
    const links = [];
    let i = first.end;
    for (;;) {
      const link = readLink(s, i);
      if (!link) break;
      const next = readGroup(s, link.end);
      if (!next) return warnings.push(`Line ${no}: edge without a target in "${s}".`);
      links.push(link);
      all.push(next);
      i = next.end;
    }
    if (s.slice(i).trim()) warnings.push(`Line ${no}: ignored trailing text "${s.slice(i).trim()}".`);
    for (const g of all)
      for (const r of g.refs) {
        const n = touch(r.raw, r.shape);
        n.classes.push(...r.classes);
      }
    links.forEach((link, k) => {
      const t = link.token;
      if (t === '~~~') return ignored.add('~~~ (invisible link)');
      // Heads: "-->" one way, "<-->" / "o--o" / "x--x" both ways, "---" / "-.-" / "===" none
      const tail = /^[<ox]/.test(t);
      const head = /[>ox]$/.test(t);
      if (/^[ox]|[ox]$/.test(t)) circleHeads.add(t);
      const arrow = head ? (tail ? 'both' : 'forward') : 'none';
      const style = t.includes('.') ? 'dashed' : t.includes('=') ? 'solid' : undefined;
      for (const a of all[k].refs)
        for (const b of all[k + 1].refs) rawEdges.push({ from: a.raw, to: b.raw, label: link.label, style, arrow, no });
    });
  };

  for (const { text: line, no } of lines.slice(1)) {
    for (const part of splitStatements(line)) {
      let m;
      if ((m = /^subgraph\s+(.*)$/.exec(part))) {
        const spec = m[1].trim();
        let raw;
        let title;
        const idt = /^([\w-]+)\s*\[\s*([\s\S]*?)\s*\]$/.exec(spec);
        if (idt) [raw, title] = [idt[1], idt[2]];
        else if (/^"[\s\S]*"$/.test(spec)) [raw, title] = [spec.slice(1, -1), spec];
        else [raw, title] = [spec, spec];
        const g = { raw, title: cleanLabel(title).replace(/\n/g, ' ') || raw, nodes: [], parent: stack[stack.length - 1] };
        groups.push(g);
        stack.push(g);
      } else if (part === 'end') {
        if (!stack.pop()) warnings.push(`Line ${no}: "end" without a subgraph.`);
      } else if (/^direction\s+/.test(part)) {
        ignored.add('direction');
      } else if ((m = /^classDef\s+([\w,-]+)\s*(.*)$/.exec(part))) {
        const fill = /(?:^|[,;\s])fill\s*:\s*(#[0-9a-f]{3,6})/i.exec(m[2]);
        const stroke = /(?:^|[,;\s])stroke\s*:\s*(#[0-9a-f]{3,6})/i.exec(m[2]);
        for (const name of m[1].split(',')) classDefs.set(name, { color: hueOf(fill?.[1]) || hueOf(stroke?.[1]) });
      } else if ((m = /^class\s+([^\s]+)\s+([\w-]+)\s*$/.exec(part))) {
        for (const raw of m[1].split(',')) touch(raw.trim()).classes.push(m[2]);
      } else if ((m = /^(click|style|linkStyle)\b/.exec(part))) {
        ignored.add(m[1]);
      } else if (/^(accTitle|accDescr)\b/.test(part)) {
        ignored.add(part.split(/[\s:]/)[0]);
      } else statement(part, no);
    }
  }
  ignored.flush(IGNORED_WHY);
  if (circleHeads.size) warnings.push(`Circle and cross heads (${[...circleHeads].join(', ')}) are drawn as arrows.`);
  if (stack.length) warnings.push(`${stack.length} subgraph${stack.length > 1 ? 's were' : ' was'} not closed with "end".`);

  // Edges that point at a subgraph go to its first node.
  const groupByRaw = new Map(groups.map((g) => [g.raw, g]));
  const firstNode = (g) => g.nodes.find((r) => !groupByRaw.has(r)) || groups.filter((c) => c.parent === g).map(firstNode).find(Boolean);
  for (const [raw, n] of nodes) {
    const g = groupByRaw.get(raw);
    if (!g || n.explicit) continue;
    const target = firstNode(g);
    nodes.delete(raw);
    if (n.group) n.group.nodes = n.group.nodes.filter((r) => r !== raw);
    if (!target) {
      warnings.push(`Subgraph "${g.title}" is linked but empty; its edges were dropped.`);
      continue;
    }
    warnings.push(`Edges to subgraph "${g.title}" are attached to its first node "${target}".`);
    for (const e of rawEdges) {
      if (e.from === raw) e.from = target;
      if (e.to === raw) e.to = target;
    }
  }

  // --- assemble the payload -----------------------------------------------------
  const nodeId = idFactory();
  const outNodes = [];
  for (const n of nodes.values()) {
    const cls = n.classes.filter((c) => classDefs.has(c)).pop() || n.classes.pop();
    const type = cls || n.type;
    const data = labelData(n.label, n.raw);
    if (n.type === 'store') data.icon = 'database';
    if (cls && n.type !== 'node' && !data.subtitle) data.subtitle = SHAPE_ROLES[n.type].label;
    n.id = nodeId(n.raw);
    outNodes.push({ id: n.id, type, data });
  }
  const roles = assignRoles(outNodes.map((n) => n.type), classDefs);

  const eid = edgeIdFactory();
  const outEdges = [];
  for (const e of rawEdges) {
    const s = nodes.get(e.from)?.id;
    const t = nodes.get(e.to)?.id;
    if (!s || !t) continue;
    const edge = { id: eid(s, t), source: s, target: t };
    const label = edgeLabel(e.label, (l) => longLabels.push(l));
    if (label) edge.label = label;
    if (e.style) edge.style = e.style;
    if (e.arrow !== 'forward') edge.arrow = e.arrow;
    outEdges.push(edge);
  }
  if (longLabels.length) warnings.push(`Shortened ${longLabels.length} edge label${longLabels.length > 1 ? 's' : ''} to ${MAX_LABEL} characters.`);
  const unlabeled = outEdges.filter((e) => !e.label).length;
  if (unlabeled) warnings.push(`${unlabeled} edge${unlabeled > 1 ? 's have' : ' has'} no label; add |labels| in Mermaid or label them in the JSON.`);

  const groupId = idFactory(new Set(outNodes.map((n) => n.id)));
  for (const g of groups) g.id = groupId(g.raw);
  const outGroups = groups.map((g) => {
    const out = { id: g.id, title: g.title, nodes: g.nodes.filter((r) => nodes.has(r)).map((r) => nodes.get(r).id) };
    if (g.parent) out.parent = g.parent.id;
    return out;
  });

  const title = ctx.title || 'Imported flowchart';
  const payload = {
    meta: {
      title,
      description: `Imported from a Mermaid flowchart: ${outNodes.length} nodes, ${outEdges.length} edges.`,
      layout: { direction: dir === 'LR' || dir === 'RL' ? 'LR' : 'TB' }
    },
    roles,
    nodes: outNodes,
    edges: outEdges
  };
  if (outGroups.length) payload.groups = outGroups;
  if (!outNodes.length) warnings.push('No nodes were found; check the flowchart syntax (e.g. "A --> B").');
  payload.scenarios = [{ id: 'main', name: 'Walkthrough', steps: outNodes.length ? flowSteps(outNodes, outEdges, outGroups) : [] }];
  return { payload, warnings };
}

/**
 * One role per type. Classes are coloured first (from their classDef fill when
 * given), then shape types keep their usual hue unless a class already took it.
 */
function assignRoles(types, classDefs) {
  const unique = [...new Set(types)];
  const roles = Object.create(null);
  const used = new Set();
  const free = (preferred) => {
    const pick = preferred && !used.has(preferred) ? preferred : CLASS_HUES.find((h) => !used.has(h)) || preferred || 'slate';
    used.add(pick);
    return pick;
  };
  const shape = (x) => Object.hasOwn(SHAPE_ROLES, x);
  for (const t of unique.filter((x) => !shape(x))) roles[t] = { label: humanize(t), color: free(classDefs.get(t)?.color) };
  for (const t of unique.filter(shape)) roles[t] = { ...SHAPE_ROLES[t], color: free(SHAPE_ROLES[t].color) };
  return Object.fromEntries(unique.map((t) => [t, roles[t]]));
}

/** Split "A-->B; B-->C" on semicolons outside quotes and brackets. */
function splitStatements(line) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of line) {
    if (ch === '"') quote = !quote;
    else if (!quote && '[({'.includes(ch)) depth++;
    else if (!quote && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ';' && !quote && !depth) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Overview + one step per node (or per rank when there are many), in topological order. */
function flowSteps(nodes, edges, groups) {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const loops = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (e.source === e.target) {
      loops.get(e.source).push(e); // a self-loop neither orders nor follows anything
      continue;
    }
    incoming.get(e.target).push(e);
    outgoing.get(e.source).push(e);
  }

  // Kahn's algorithm; on a cycle, release the earliest-declared remaining node.
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const done = new Set();
  const topo = [];
  const remaining = new Set(nodes.map((n) => n.id));
  const forward = new Set(); // edges that respect the topological order
  for (const e of edges) indeg.set(e.target, indeg.get(e.target) + 1);
  while (remaining.size) {
    let ready = [...remaining].filter((id) => indeg.get(id) === 0);
    if (!ready.length) ready = [[...remaining].sort((a, b) => order.get(a) - order.get(b))[0]];
    ready.sort((a, b) => order.get(a) - order.get(b));
    const id = ready[0];
    remaining.delete(id);
    done.add(id);
    topo.push(id);
    for (const e of outgoing.get(id)) {
      if (done.has(e.target)) continue;
      forward.add(e.id);
      indeg.set(e.target, indeg.get(e.target) - 1);
      depth.set(e.target, Math.max(depth.get(e.target), depth.get(id) + 1));
    }
  }

  const titleOf = (id) => byId.get(id)?.data?.title ?? String(id ?? '');
  const describe = (ids) => {
    const parts = [];
    for (const id of ids) {
      const inc = incoming.get(id);
      const n = byId.get(id);
      const own = n.data.subtitle || n.data.description;
      let s = inc.length
        ? `${titleOf(id)} follows ${list(inc.map((e) => `${titleOf(e.source)}${e.label ? ` (${e.label})` : ''}`))}.`
        : `${titleOf(id)} is a starting point.`;
      if (own) s += ` ${own}.`;
      const self = loops.get(id);
      if (self.length) s += ` It can repeat itself (${list(self.map((e) => e.label || 'loop'))}).`;
      const out = outgoing.get(id);
      if ((n.type === 'decision' || n.shape === 'choice') && out.length) s += ` Branches: ${list(out.map((e) => `${e.label || 'otherwise'} → ${titleOf(e.target)}`))}.`;
      else if (!out.length && n.shape !== 'final') s += ' The flow ends here.';
      parts.push(s.replace(/\.\./g, '.'));
    }
    return parts.join(' ');
  };

  // One node per step, or one rank per step, merged so the walkthrough stays short.
  let buckets;
  const budget = MAX_FLOW_STEPS - 1;
  if (topo.length <= budget) buckets = topo.map((id) => [id]);
  else {
    const ranks = [];
    for (const id of topo) (ranks[depth.get(id)] ||= []).push(id);
    const levels = ranks.filter(Boolean);
    const per = Math.ceil(levels.length / budget);
    buckets = [];
    for (let i = 0; i < levels.length; i += per) buckets.push(levels.slice(i, i + per).flat());
  }

  const steps = [
    {
      id: 'overview',
      title: 'Overview',
      description: `${nodes.length} parts${groups.length ? ` in ${groups.length} group${groups.length > 1 ? 's' : ''}` : ''}, from ${titleOf(topo[0])} to ${titleOf(topo[topo.length - 1])}.`
    }
  ];
  buckets.forEach((ids, i) => {
    const set = new Set(ids);
    const inEdges = ids.flatMap((id) => [...incoming.get(id), ...loops.get(id)]);
    const highlightNodes = [...new Set([...inEdges.map((e) => e.source), ...ids])];
    const step = {
      id: `step-${i + 1}`,
      title: ids.length === 1 ? titleOf(ids[0]) : shorten(list(ids.map(titleOf)), 60),
      description: describe(ids),
      highlightNodes
    };
    const he = inEdges.filter((e) => set.has(e.target)).map((e) => e.id);
    if (he.length) step.highlightEdges = he;
    steps.push(step);
  });
  return steps;
}

const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// --- sequence diagrams -----------------------------------------------------------

const BOX_COLOR = /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|transparent|aqua|azure|beige|gray|grey|ivory|lavender|lightblue|lightgreen|lightgray|lightgrey|lightyellow|pink|purple|white|wheat)\s*/i;
const ARROWS = ['<<-->>', '<<->>', '-->>', '->>', '--x', '-x', '--)', '-)', '-->', '->'];
const MESSAGE = new RegExp(`^(.+?)\\s*(${ARROWS.map((a) => a.replace(/[()>]/g, '\\$&')).join('|')})\\s*([+-]?)\\s*(.+?)\\s*:\\s*(.*)$`);

function parseSequence(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const parts = new Map(); // raw -> { label, kind, order, box }
  const boxes = [];
  let box = null;
  const blocks = []; // { kind, label }
  const messages = []; // { from, to, text, dashed, context, notes[] }
  const preNotes = [];
  let title = ctx.title;

  const participant = (raw, kind, label) => {
    raw = raw.trim();
    let p = parts.get(raw);
    if (!p) {
      p = { raw, label: raw, kind: kind || 'service', order: parts.size };
      parts.set(raw, p);
      if (box) {
        p.box = box;
        box.members.push(raw);
      }
    }
    if (kind) p.kind = kind;
    if (label) p.label = label;
    return p;
  };

  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if ((m = /^title\s*:?\s+(.+)$/.exec(line))) title = title || m[1].trim();
    else if ((m = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(line))) {
      if (/^create\s/.test(line)) ignored.add('create');
      participant(m[2], m[1] === 'actor' ? 'actor' : 'service', m[3] && cleanLabel(m[3]));
    } else if ((m = /^box\b\s*(.*)$/.exec(line))) {
      const t = m[1].replace(BOX_COLOR, '').trim();
      box = { title: cleanLabel(t) || `Group ${boxes.length + 1}`, members: [] };
      boxes.push(box);
      blocks.push({ kind: 'box' });
    } else if ((m = /^(alt|opt|loop|par|critical|break|rect)\b\s*(.*)$/.exec(line))) {
      blocks.push({ kind: m[1], label: m[1] === 'rect' ? '' : cleanLabel(m[2]) });
    } else if ((m = /^(else|and|option)\b\s*(.*)$/.exec(line))) {
      const b = blocks[blocks.length - 1];
      if (b) b.label = cleanLabel(m[2]) || m[1];
      else warnings.push(`Line ${no}: "${m[1]}" outside a block.`);
    } else if (line === 'end') {
      const b = blocks.pop();
      if (!b) warnings.push(`Line ${no}: "end" without a block.`);
      else if (b.kind === 'box') box = null;
    } else if ((m = /^note\s+(?:left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(line))) {
      const note = cleanLabel(m[2]).replace(/\n/g, ' ');
      m[1].split(',').forEach((r) => participant(r));
      if (messages.length) messages[messages.length - 1].notes.push(note);
      else preNotes.push(note);
    } else if ((m = /^(autonumber|activate|deactivate|destroy|links?|properties|details)\b/.exec(line))) {
      if (m[1] !== 'autonumber' && m[1] !== 'activate' && m[1] !== 'deactivate') ignored.add(m[1]);
    } else if ((m = MESSAGE.exec(line))) {
      const from = participant(m[1]);
      const to = participant(m[4]);
      const context = blocks
        .filter((b) => b.kind !== 'box' && b.kind !== 'rect')
        .map((b) => `${b.kind}${b.label ? ` “${b.label}”` : ''}`);
      messages.push({ from: from.raw, to: to.raw, text: cleanLabel(m[5]).replace(/\n/g, ' '), dashed: m[2].includes('--'), context, notes: [] });
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush(IGNORED_WHY);
  if (!parts.size) throw new Error('The sequence diagram has no participants.');

  const nodeId = idFactory();
  const roles = {};
  const outNodes = [];
  for (const p of parts.values()) {
    const type = p.kind === 'service' && /\b(db|database|store|cache|queue|bucket|storage)\b/i.test(`${p.raw} ${p.label}`) ? 'store' : p.kind;
    if (!Object.hasOwn(roles, type)) roles[type] = { ...(Object.hasOwn(SHAPE_ROLES, type) ? SHAPE_ROLES[type] : {}) };
    const data = labelData(p.label, p.raw);
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
    const from = parts.get(msg.from).label;
    const to = parts.get(msg.to).label;
    let description = s === t ? `${from} handles this itself.` : `${from} → ${to}${msg.dashed ? ' (reply)' : ''}.`;
    if (msg.context.length) description += ` Inside ${msg.context.join(', within ')}.`;
    if (msg.notes.length) description += ` ${msg.notes.join(' ')}`;
    const step = { id: `msg-${i + 1}`, title: msg.text || `${from} to ${to}`, description, highlightNodes: [...new Set([s, t])] };
    if (edge) step.highlightEdges = [edge.id];
    steps.push(step);
  });
  if (longLabels.length) warnings.push(`Shortened ${longLabels.length} edge label${longLabels.length > 1 ? 's' : ''} to ${MAX_LABEL} characters (the full text is the step title).`);
  const repeats = messages.length - outEdges.length - messages.filter((x) => x.from === x.to).length;
  if (repeats > 0) warnings.push(`${repeats} repeated message${repeats > 1 ? 's share' : ' shares'} an edge with an earlier one; each is still its own step.`);

  const payload = {
    meta: {
      title: title || 'Imported sequence diagram',
      description: `Imported from a Mermaid sequence diagram: ${outNodes.length} participants, ${messages.length} messages.`,
      layout: { direction: 'LR' },
      view: 'sequence'
    },
    roles,
    nodes: outNodes,
    edges: outEdges
  };
  const groups = boxes.filter((b) => b.members.length).map((b, i) => ({ id: `box-${i + 1}`, title: b.title, nodes: b.members.map((r) => parts.get(r).id) }));
  if (groups.length) payload.groups = groups;
  payload.scenarios = [
    {
      id: 'main',
      name: 'Message sequence',
      steps: [
        {
          id: 'overview',
          title: 'Overview',
          description: [`${outNodes.length} participants exchange ${messages.length} messages.`, ...preNotes].join(' ')
        },
        ...steps
      ]
    }
  ];
  return { payload, warnings };
}

// --- mind maps -----------------------------------------------------------------

/** Mind-map node shapes, longest delimiters first (the shape itself is not kept). */
const MIND_SHAPES = [
  ['((', '))'],
  ['))', '(('],
  ['{{', '}}'],
  ['(', ')'],
  [')', '('],
  ['[', ']']
];
const MIND_ROLES = {
  root: { label: 'Central topic', color: 'violet' },
  branch: { label: 'Branch', color: 'blue' },
  topic: { label: 'Topic', color: 'slate' }
};
const MIND_FOLD = 40; // above this many nodes, branches open folded

/** "id((text))", "[text]", "plain text" -> { id?, text } */
function mindNode(s) {
  for (const [open, close] of MIND_SHAPES) {
    const at = s.indexOf(open);
    if (at < 0 || !s.endsWith(close) || s.length < at + open.length + close.length) continue;
    const id = s.slice(0, at).trim();
    if (id && /\s/.test(id)) continue;
    return { id: id || undefined, text: s.slice(at + open.length, s.length - close.length).trim() };
  }
  return { text: s };
}

/**
 * Mermaid `mindmap`: indentation gives the hierarchy. Becomes a payload with
 * `meta.layout.algorithm: "mindmap"`, one edge per parent -> child and a walkthrough
 * with one step per branch. Icons and classes are ignored with a warning.
 */
function parseMindmap(text, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  let src = text.replace(/\r\n?/g, '\n');
  const fm = /^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(src);
  if (fm) src = src.slice(fm[0].length);
  const rows = [];
  src.split('\n').forEach((raw, i) => {
    const line = raw.replace(/%%.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) return;
    const indent = /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;
    rows.push({ indent, text: line.trim(), no: i + 1 });
  });
  rows.shift(); // the "mindmap" header

  const taken = new Set();
  const named = idFactory(taken);
  const nextEdge = edgeIdFactory();
  const nodes = [];
  const edges = [];
  const depth = new Map();
  const stack = []; // [{ indent, id }]
  let root = null;
  for (const row of rows) {
    if (/^::icon\(/.test(row.text)) {
      ignored.add('::icon');
      continue;
    }
    if (/^:::/.test(row.text)) {
      ignored.add(':::class');
      continue;
    }
    const { id: rawId, text: label } = mindNode(row.text);
    const data = labelData(unquote(label), rawId || 'Topic');
    // Explicit ids are kept; untitled repeats ("Examples" under two branches) get -2, -3
    const id = rawId ? named(rawId) : idFactory(taken)(data.title);
    while (stack.length && stack[stack.length - 1].indent >= row.indent) stack.pop();
    let parent = stack.length ? stack[stack.length - 1].id : null;
    if (!parent && root) {
      warnings.push(`Line ${row.no}: a mind map has one root; "${data.title}" is attached to "${nodes[0].data.title}".`);
      parent = root;
    }
    const d = parent ? depth.get(parent) + 1 : 0;
    depth.set(id, d);
    if (!root) root = id;
    nodes.push({ id, type: d === 0 ? 'root' : d === 1 ? 'branch' : 'topic', data });
    if (parent) edges.push({ id: nextEdge(parent, id), source: parent, target: id });
    stack.push({ indent: row.indent, id });
  }
  ignored.flush({ '::icon': 'icons come from roles', ':::class': 'branch colours are automatic' });
  if (!nodes.length) throw new Error('The mind map has no nodes; add a root line under "mindmap".');

  const types = [...new Set(nodes.map((n) => n.type))];
  const roles = Object.fromEntries(types.map((t) => [t, MIND_ROLES[t]]));
  const branches = nodes.filter((n) => depth.get(n.id) === 1);
  const below = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) below.get(e.source).push(e);
  const subtree = (id) => {
    const ns = [id];
    const es = [];
    for (const e of below.get(id)) {
      const sub = subtree(e.target);
      es.push(e.id, ...sub.edges);
      ns.push(...sub.nodes);
    }
    return { nodes: ns, edges: es };
  };
  const listed = branches.slice(0, MAX_FLOW_STEPS - 1);
  if (branches.length > listed.length) warnings.push(`Only the first ${listed.length} of ${branches.length} branches get their own walkthrough step.`);
  const steps = [
    { id: 'overview', title: 'Overview', description: `${nodes[0].data.title}: ${branches.length} branch${branches.length === 1 ? '' : 'es'}, ${nodes.length} topics in all.` },
    ...listed.map((b) => {
      const sub = subtree(b.id);
      const kids = below.get(b.id).map((e) => nodes.find((n) => n.id === e.target).data.title);
      return {
        id: `branch-${b.id}`,
        title: b.data.title,
        description: kids.length ? `${b.data.title}: ${list(kids)}.` : `${b.data.title}.`,
        highlightNodes: [root, ...sub.nodes],
        highlightEdges: [edges.find((e) => e.target === b.id).id, ...sub.edges]
      };
    })
  ];

  const layout = { algorithm: 'mindmap' };
  if (nodes.length > MIND_FOLD) {
    layout.collapsed = branches.filter((b) => below.get(b.id).length).map((b) => b.id);
    warnings.push(`${nodes.length} nodes: every branch opens folded (meta.layout.collapsed); readers unfold them with +N.`);
  }
  return {
    payload: {
      meta: {
        title: ctx.title || shorten(nodes[0].data.title, MAX_TITLE),
        description: `Imported from a Mermaid mind map: ${nodes.length} topics in ${branches.length} branches.`,
        layout
      },
      roles,
      nodes,
      edges,
      scenarios: [{ id: 'main', name: 'Branch by branch', steps }]
    },
    warnings
  };
}

// --- state diagrams ----------------------------------------------------------------

const STATE_ID = '\\[\\*\\]|[\\w\\u00C0-\\uFFFF.]+(?:-[\\w\\u00C0-\\uFFFF.]+)*';
const TRANSITION = new RegExp(`^(${STATE_ID})(?::::[\\w-]+)?\\s*-->\\s*(${STATE_ID})(?::::[\\w-]+)?\\s*(?::\\s*(.*))?$`);
const STATE_IGNORED_WHY = {
  ...IGNORED_WHY,
  class: 'colours come from roles',
  classDef: 'colours come from roles',
  hide: 'not needed',
  scale: 'layout is automatic'
};

function parseState(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  let dir = 'TB';
  const states = new Map(); // key -> { key, raw, label, kind, desc[], scope, order }
  const composites = new Map(); // raw -> { raw, label, scope (parent), members: keys[] }
  const stack = [];
  const rawEdges = []; // { from, to, label, no }
  const notes = []; // { target, text } (a note can name its state's concurrent region)
  let inNote = null;

  const scope = () => stack[stack.length - 1] || null;
  // [*] is the scope's initial state when a transition leaves it, its final state when one enters it;
  // each concurrent region (separated by --) has its own
  const touch = (raw, kind) => {
    const sc = scope();
    const key = raw === '[*]' ? `\u0000${kind}:${sc ? `${sc.raw}#${sc.region}` : ''}` : raw;
    let st = states.get(key);
    if (!st) {
      st = { key, raw, label: raw === '[*]' ? '' : raw, kind: raw === '[*]' ? kind : 'state', desc: [], scope: sc, region: sc ? sc.region : 0, order: states.size };
      states.set(key, st);
      if (sc) sc.members.push(key);
    }
    return st;
  };

  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if (inNote) {
      if (/^end\s+note$/i.test(line)) inNote = null;
      else if (!inNote.text) inNote.text = line;
      continue;
    }
    if ((m = /^note\s+(?:left|right)\s+of\s+([^:]+?)(?:\s*:(.*))?$/i.exec(line))) {
      const note = { target: m[1].trim(), text: (m[2] || '').trim() };
      notes.push(note);
      if (m[2] === undefined) inNote = note;
    } else if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(line))) {
      if (stack.length) ignored.add('direction');
      else {
        const d = m[1].toUpperCase();
        if (d === 'BT' || d === 'RL') warnings.push(`Direction ${d} is drawn as ${d === 'BT' ? 'TB' : 'LR'}; Yantra does not reverse the flow.`);
        dir = d === 'LR' || d === 'RL' ? 'LR' : 'TB';
      }
    } else if ((m = /^state\s+(?:"([^"]*)"\s+as\s+([\w.-]+)|([\w.-]+))\s*(<<\s*(\w+)\s*>>)?\s*(\{)?$/.exec(line))) {
      const raw = m[2] || m[3];
      const label = m[1] !== undefined ? cleanLabel(m[1]).replace(/\n/g, ' ') : null;
      if (m[6]) {
        const c = composites.get(raw) || { raw, label: raw, scope: scope(), at: scope() ? scope().region : 0, region: 0, regions: 1, members: [] };
        if (label) c.label = label;
        composites.set(raw, c);
        stack.push(c);
      } else {
        const st = touch(raw);
        if (label) st.label = label;
        const stereo = (m[5] || '').toLowerCase();
        if (stereo === 'choice') st.kind = 'choice';
        else if (stereo === 'fork' || stereo === 'join') {
          st.kind = 'fork';
          if (!label) st.label = humanize(stereo);
        } else if (stereo) {
          st.desc.push(humanize(stereo));
          warnings.push(`Line ${no}: <<${stereo}>> "${raw}" is drawn as a plain state.`);
        }
      }
    } else if (line === '}') {
      if (!stack.pop()) warnings.push(`Line ${no}: "}" without a composite state.`);
    } else if (line === '--' || line === '||') {
      // Concurrent regions: what follows belongs to the next region of the composite
      const c = scope();
      if (!c) warnings.push(`Line ${no}: "--" (a concurrent region) outside a composite state.`);
      else {
        c.region++;
        c.regions = Math.max(c.regions, c.region + 1);
      }
    } else if ((m = TRANSITION.exec(line))) {
      const from = touch(m[1], 'initial');
      const to = touch(m[2], 'final');
      if (line.includes(':::')) ignored.add('class');
      rawEdges.push({ from: from.key, to: to.key, label: m[3] || '', no });
    } else if ((m = /^([\w.-]+)\s*:\s*(.+)$/.exec(line))) {
      touch(m[1]).desc.push(cleanLabel(m[2]).replace(/\n/g, ' '));
    } else if ((m = /^(classDef|class|style|scale|hide|click|accTitle|accDescr)\b/.exec(line))) {
      ignored.add(m[1]);
    } else if ((m = /^([\w.-]+)(?::::[\w-]+)?$/.exec(line))) {
      touch(m[1]);
      if (line.includes(':::')) ignored.add('class');
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush(STATE_IGNORED_WHY);
  if (stack.length) warnings.push(`${stack.length} composite state${stack.length > 1 ? 's were' : ' was'} not closed with "}".`);

  // A composite with members becomes a group. Transitions to it enter at the
  // target of its initial state; transitions from it leave from the state
  // that reaches its final state (else its first / last member).
  const groupOf = new Map([...composites].filter(([, c]) => c.members.length));
  for (const raw of groupOf.keys()) {
    const st = states.get(raw);
    if (!st) continue;
    states.delete(raw);
    if (st.scope) st.scope.members = st.scope.members.filter((k) => k !== raw);
  }
  const isState = (k) => states.get(k)?.kind === 'state' || states.get(k)?.kind === 'choice';
  // Entry / exit states of a composite: the targets of its [*] (else its first / last state);
  // with concurrent regions, one per region, so a transition to it fans out to every region
  const ends = (raw, which, seen = new Set()) => {
    const c = groupOf.get(raw);
    if (!c || seen.has(raw)) return [raw];
    seen.add(raw);
    const pseudoKey = (i) => `\u0000${which === 'entry' ? 'initial' : 'final'}:${raw}#${i}`;
    const out = [];
    for (let i = 0; i < c.regions; i++) {
      const members = c.members.filter((k) => c.regions === 1 || states.get(k)?.region === i || (groupOf.has(k) && groupOf.get(k).at === i));
      const viaPseudo = which === 'entry' ? rawEdges.find((e) => e.from === pseudoKey(i))?.to : rawEdges.find((e) => e.to === pseudoKey(i))?.from;
      const list = which === 'entry' ? members : [...members].reverse();
      const pick = viaPseudo || list.find(isState) || list[0];
      if (pick) out.push(...ends(pick, which, seen));
    }
    return out.length ? out : [raw];
  };
  const attached = new Set();
  const entered = new Set();
  const left = new Set();
  const expanded = [];
  for (const e of rawEdges) {
    const froms = groupOf.has(e.from) ? (attached.add(e.from), left.add(e.from), ends(e.from, 'exit')) : [e.from];
    const tos = groupOf.has(e.to) ? (attached.add(e.to), entered.add(e.to), ends(e.to, 'entry')) : [e.to];
    for (const from of froms) for (const to of tos) expanded.push({ ...e, from, to });
  }
  // A composite entered (left) from outside needs no inner start (end) dots of its own:
  // the outside transition now lands on the state they pointed to
  const redundant = (k) =>
    [...entered].some((raw) => k.startsWith(`\u0000initial:${raw}#`)) || [...left].some((raw) => k.startsWith(`\u0000final:${raw}#`));
  for (const k of [...states.keys()]) {
    if (!redundant(k)) continue;
    const st = states.get(k);
    states.delete(k);
    if (st.scope) st.scope.members = st.scope.members.filter((x) => x !== k);
  }
  rawEdges.splice(0, rawEdges.length, ...expanded.filter((e) => !redundant(e.from) && !redundant(e.to)));
  for (const raw of attached) warnings.push(`Transitions to or from composite state "${groupOf.get(raw).label}" are attached to its entry and exit states${groupOf.get(raw).regions > 1 ? ' in every region' : ''}.`);

  // --- assemble the payload -----------------------------------------------------
  const taken = new Set();
  const alloc = (base) => {
    const b = String(base).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'state';
    let id = b;
    for (let i = 2; taken.has(id); i++) id = `${b}-${i}`;
    taken.add(id);
    return id;
  };
  const pseudo = (st) => st.kind === 'initial' || st.kind === 'final';
  const ordered = [...states.values()].sort((a, b) => a.order - b.order);
  ordered.filter((st) => !pseudo(st)).forEach((st) => (st.id = alloc(st.raw)));
  const groupIds = new Map([...groupOf.keys()].map((raw) => [raw, alloc(raw)]));
  const outNodes = [];
  for (const st of ordered) {
    const where = st.scope && groupOf.has(st.scope.raw) ? st.scope : null;
    if (pseudo(st)) {
      const word = st.kind === 'initial' ? 'start' : 'end';
      st.id = alloc(where ? `${groupIds.get(where.raw)}-${word}` : word);
      const title = where ? `${where.label} ${word}` : word;
      outNodes.push({ id: st.id, type: 'terminal', shape: st.kind, data: { title: title[0].toUpperCase() + title.slice(1) } });
      continue;
    }
    const data = labelData(st.label || st.raw, st.raw);
    if (st.desc.length) {
      const text = st.desc.join(' ');
      if (!data.subtitle && text.length <= 60) data.subtitle = text;
      else data.description = [data.description, text].filter(Boolean).join(' ');
    }
    const kind = st.kind === 'choice' || st.kind === 'fork' ? st.kind : 'state';
    outNodes.push({ id: st.id, type: kind, shape: kind, data });
  }
  const roles = assignRoles(outNodes.map((n) => n.type), new Map());

  const eid = edgeIdFactory();
  const longLabels = [];
  const outEdges = [];
  for (const e of rawEdges) {
    const s = states.get(e.from)?.id;
    const t = states.get(e.to)?.id;
    if (!s || !t) continue;
    const edge = { id: eid(s, t), source: s, target: t };
    const label = edgeLabel(e.label, (l) => longLabels.push(l));
    if (label) edge.label = label;
    outEdges.push(edge);
  }
  if (longLabels.length) warnings.push(`Shortened ${longLabels.length} transition label${longLabels.length > 1 ? 's' : ''} to ${MAX_LABEL} characters.`);
  // Transitions out of a start or into an end need no label (the validator agrees)
  const dots = new Set(outNodes.filter((n) => n.shape === 'initial' || n.shape === 'final' || n.shape === 'fork').map((n) => n.id));
  const unlabeled = outEdges.filter((e) => !e.label && !dots.has(e.source) && !dots.has(e.target)).length;
  if (unlabeled) warnings.push(`${unlabeled} transition${unlabeled > 1 ? 's have' : ' has'} no label; add ": event" in Mermaid or label them in the JSON.`);

  // A region is named by a note on one of its states, or by the one composite it holds
  // (a used note is not reported as ignored)
  function regionTitle(c, i) {
    const inRegion = (k) => states.get(k)?.scope === c && states.get(k).region === i;
    const note = notes.find((n) => n.text && inRegion(n.target));
    if (note) {
      notes.splice(notes.indexOf(note), 1);
      return shorten(cleanLabel(note.text).replace(/\n/g, ' '), 40);
    }
    const plain = c.members.filter((k) => inRegion(k) && isState(k));
    const nested = [...groupOf.values()].filter((x) => x.scope === c && x.at === i);
    return !plain.length && nested.length === 1 ? nested[0].label : null;
  }

  // A composite with concurrent regions (--) keeps no nodes itself: each region is a child
  // group (kind "region") holding its states, and nested composites hang off their region
  const regionId = (c, i) => `${groupIds.get(c.raw)}-region-${i + 1}`;
  const split = (c) => !!c && groupOf.has(c.raw) && c.regions > 1;
  const ids = (keys) => keys.map((k) => states.get(k)?.id).filter(Boolean);
  const outGroups = [];
  for (const c of groupOf.values()) {
    const g = { id: groupIds.get(c.raw), title: c.label, nodes: split(c) ? [] : ids(c.members) };
    if (c.scope && groupOf.has(c.scope.raw)) g.parent = split(c.scope) ? regionId(c.scope, c.at) : groupIds.get(c.scope.raw);
    outGroups.push(g);
    if (!split(c)) continue;
    for (let i = 0; i < c.regions; i++)
      outGroups.push({ id: regionId(c, i), title: regionTitle(c, i) || `${c.label} ${i + 1}`, kind: 'region', parent: g.id, nodes: ids(c.members.filter((k) => states.get(k)?.region === i)) });
  }
  if (notes.length) warnings.push(`Ignored ${notes.length} note${notes.length > 1 ? 's' : ''} (notes are not imported; put the text in a state description).`);

  const real = outNodes.filter((n) => !dots.has(n.id)).length;
  const payload = {
    meta: {
      title: ctx.title || 'Imported state diagram',
      description: `Imported from a Mermaid state diagram: ${real} states, ${outEdges.length} transitions.`,
      layout: { direction: dir }
    },
    roles,
    nodes: outNodes,
    edges: outEdges
  };
  if (outGroups.length) payload.groups = outGroups;
  if (!outNodes.length) warnings.push('No states were found; check the syntax (e.g. "[*] --> Idle").');
  payload.scenarios = [{ id: 'main', name: 'Lifecycle', steps: outNodes.length ? flowSteps(outNodes, outEdges, outGroups) : [] }];
  return { payload, warnings };
}

// --- ER diagrams ---------------------------------------------------------------

/** Crow's foot symbols, read from either side of the link. */
const ER_SYMBOLS = { '||': 'one', '|o': 'zero-or-one', 'o|': 'zero-or-one', '}o': 'zero-or-many', 'o{': 'zero-or-many', '}|': 'one-or-many', '|{': 'one-or-many' };
const ER_WORDS = [
  [/^(only one|exactly one|1)$/i, 'one'],
  [/^(zero or one|one or zero)$/i, 'zero-or-one'],
  [/^(zero or more|zero or many|many\(0\)|0\+)$/i, 'zero-or-many'],
  [/^(one or more|one or many|many\(1\)|1\+)$/i, 'one-or-many']
];
const ER_ENTITY = String.raw`("[^"]+"|[\w$-]+(?:\[[^\]]*\])?)`;
const ER_REL = new RegExp(String.raw`^${ER_ENTITY}\s*(\|\||\|o|\}o|\}\|)(--|\.\.)(\|\||o\||o\{|\|\{)\s*${ER_ENTITY}\s*:\s*(.+)$`);
const ER_WORD = String.raw`only one|exactly one|zero or one|one or zero|zero or more|zero or many|one or more|one or many|many\(0\)|many\(1\)|0\+|1\+|1`;
const ER_REL_WORDS = new RegExp(String.raw`^${ER_ENTITY}\s+(${ER_WORD})\s+(to|optionally to)\s+(${ER_WORD})\s+${ER_ENTITY}\s*:\s*(.+)$`, 'i');
const ER_BLOCK = new RegExp(String.raw`^${ER_ENTITY}\s*\{\s*(\})?$`);
const ER_INLINE = new RegExp(String.raw`^${ER_ENTITY}\s*\{(.*\S.*)\}$`);
const ER_BARE = new RegExp(String.raw`^${ER_ENTITY}$`);
const ER_ATTR = /^(\S+)\s+(\S+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?\s*$/i;
const ER_KEYS = /^(?:PK|FK|UK)(?:,(?:PK|FK|UK))*,?$/i;

/** Attributes written on one line: `string id PK "note" string name` (`;` or `,` may separate them). */
function erInlineAttrs(body) {
  const toks = String(body).match(/"[^"]*"|[^\s;]+|;/g) || [];
  const out = [];
  let i = 0;
  while (i < toks.length) {
    if (toks[i] === ';') {
      i++;
      continue;
    }
    if (i + 1 >= toks.length || toks[i + 1] === ';') return null;
    let attr = `${toks[i]} ${toks[i + 1]}`;
    i += 2;
    let keys = '';
    while (i < toks.length && (ER_KEYS.test(toks[i]) || (keys && /^,/.test(toks[i])))) keys += toks[i++];
    if (keys) attr += ` ${keys.replace(/,+$/, '')}`;
    if (i < toks.length && /^"/.test(toks[i])) attr += ` ${toks[i++]}`;
    out.push(attr);
  }
  return out;
}

/** "id", "id[Alias]" or "\"quoted name\"" -> { raw, label } */
function erName(token) {
  const t = token.trim();
  if (/^"[\s\S]*"$/.test(t)) return { raw: t.slice(1, -1), label: t.slice(1, -1) };
  const m = /^([\w$-]+)\[\s*"?([^"\]]*)"?\s*\]$/.exec(t);
  return m ? { raw: m[1], label: m[2] || m[1] } : { raw: t, label: t };
}

function parseErDiagram(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const entities = new Map(); // raw -> { raw, label, fields[] }
  const rels = []; // { a, b, from, to, dashed, label, no }
  let dir = 'LR'; // tall cards read best side by side
  let open = null; // entity whose { block is open
  let title;

  const touch = ({ raw, label }) => {
    let e = entities.get(raw);
    if (!e) entities.set(raw, (e = { raw, label, fields: [] }));
    else if (label !== raw) e.label = label;
    return e;
  };
  const word = (w) => ER_WORDS.find(([re]) => re.test(w.trim()))?.[1];
  const addAttr = (ent, text) => {
    const m = ER_ATTR.exec(text);
    if (!m) return false;
    const keys = (m[3] || '').toUpperCase().split(/\s*,\s*/);
    const f = { name: m[2].replace(/^\*/, ''), type: m[1].replace(/~([^~]*)~/g, '<$1>') };
    if (keys.includes('PK') || m[2].startsWith('*')) f.pk = true;
    if (keys.includes('FK')) f.fk = true;
    if (keys.includes('UK')) f.unique = true;
    if (m[4]) f.note = m[4];
    ent.fields.push(f);
    return true;
  };

  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if (open) {
      if (line === '}') open = null;
      else if (!addAttr(open, line)) warnings.push(`Line ${no}: could not parse attribute "${line}".`);
    } else if ((m = ER_INLINE.exec(line))) {
      const e = touch(erName(m[1]));
      const attrs = erInlineAttrs(m[2]);
      if (!attrs || !attrs.every((a) => addAttr(e, a))) warnings.push(`Line ${no}: could not parse the attributes of "${e.raw}".`);
    } else if ((m = ER_REL.exec(line))) {
      rels.push({ a: touch(erName(m[1])), b: touch(erName(m[5])), from: ER_SYMBOLS[m[2]], to: ER_SYMBOLS[m[4]], dashed: m[3] === '..', label: unquote(m[6].trim()), no });
    } else if ((m = ER_REL_WORDS.exec(line))) {
      rels.push({ a: touch(erName(m[1])), b: touch(erName(m[5])), from: word(m[2]), to: word(m[4]), dashed: /optionally/i.test(m[3]), label: unquote(m[6].trim()), no });
    } else if ((m = ER_BLOCK.exec(line))) {
      const e = touch(erName(m[1]));
      if (!m[2]) open = e;
    } else if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(line))) {
      dir = /^(LR|RL)$/i.test(m[1]) ? 'LR' : 'TB';
    } else if ((m = /^title\s+(.+)$/.exec(line))) {
      title = unquote(m[1].trim());
    } else if ((m = /^(style|classDef|class|accTitle|accDescr|click)\b/.exec(line))) {
      ignored.add(m[1]);
    } else if ((m = ER_BARE.exec(line))) {
      touch(erName(m[1]));
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  if (open) warnings.push(`Entity "${open.raw}" has no closing "}".`);
  ignored.flush({ ...IGNORED_WHY, classDef: 'colours come from roles', class: 'colours come from roles', accTitle: 'accessibility text is not imported', accDescr: 'accessibility text is not imported' });

  const nid = idFactory();
  const outNodes = [...entities.values()].map((e) => {
    const data = labelData(e.label, e.raw);
    data.icon = 'database';
    data.fields = e.fields;
    if (e.fields.length > 12) warnings.push(`Entity "${e.raw}" has ${e.fields.length} attributes; the card shows 12 rows (the rest as "+ N more").`);
    return { id: (e.id = nid(e.raw)), type: 'entity', data };
  });
  const eid = edgeIdFactory();
  const longLabels = [];
  const outEdges = [];
  for (const r of rels) {
    // A self-relationship (an employee manages employees) is drawn as a loop on the card
    const edge = { id: eid(r.a.id, r.b.id), source: r.a.id, target: r.b.id };
    const label = edgeLabel(r.label, (l) => longLabels.push(l));
    if (label) edge.label = label;
    edge.sourceEnd = r.from;
    edge.targetEnd = r.to;
    if (r.dashed) edge.style = 'dashed';
    outEdges.push(edge);
    r.edge = edge;
  }
  linkFieldRows(rels);
  if (longLabels.length) warnings.push(`Shortened ${longLabels.length} relationship label${longLabels.length > 1 ? 's' : ''} to ${MAX_LABEL} characters.`);
  if (!outNodes.length) warnings.push('No entities were found; check the erDiagram syntax (e.g. "CUSTOMER ||--o{ ORDER : places").');

  const titleOf = new Map(outNodes.map((n) => [n.id, n.data.title]));
  const sentence = (e) =>
    `${titleOf.get(e.source)} ${e.label || 'relates to'} ${titleOf.get(e.target)}: ${END_LABELS[e.sourceEnd]} ${titleOf.get(e.source)} to ${END_LABELS[e.targetEnd]} ${titleOf.get(e.target)}${e.style ? ' (non-identifying)' : ''}.`;
  const payload = {
    meta: {
      title: ctx.title || title || 'Imported data model',
      description: `Imported from a Mermaid ER diagram: ${outNodes.length} entities, ${outEdges.length} relationships.`,
      layout: { direction: dir }
    },
    roles: { entity: { label: 'Entity', color: 'blue', icon: 'database' } },
    nodes: outNodes,
    edges: outEdges,
    scenarios: [{ id: 'main', name: 'Relationships', steps: relationSteps(outNodes, outEdges, { title: (e) => `${titleOf.get(e.source)} ${e.label || 'and'} ${titleOf.get(e.target)}`, sentence }, 'entities') }]
  };
  keepRoutableFields(payload, warnings);
  return { payload, warnings };
}

/**
 * Attach relationships to the key rows they join, when the names make it plain: the
 * entity with a single primary key `id` and the other one's foreign key named after it
 * (`customer_id`, `customerId`, `customer_id` for CUSTOMERS). A self-relationship takes
 * the entity's one foreign key that no other relationship explains (`manager_id`).
 * Sets edge.sourceField / targetField; leaves the edge alone when unsure.
 */
function linkFieldRows(rels) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const stems = (e) => [...new Set([e.raw, e.label].flatMap((n) => [norm(n), norm(n).replace(/(ies)$/, 'y').replace(/s$/, '')]))];
  const pkOf = (e) => {
    const pks = e.fields.filter((f) => f.pk);
    return pks.length === 1 ? pks[0] : null;
  };
  const fkFor = (child, parent) => {
    const pk = pkOf(parent);
    if (!pk || child === parent) return null;
    const want = new Set(stems(parent).flatMap((s) => [`${s}${norm(pk.name)}`, `${s}id`]));
    const hits = child.fields.filter((f) => f.fk && want.has(norm(f.name)));
    return hits.length === 1 ? { pk, fk: hits[0] } : null;
  };
  const claimed = new Map(); // entity -> Set of fk names explained by a relationship
  const claim = (e, f) => (claimed.get(e) || claimed.set(e, new Set()).get(e)).add(f.name);
  for (const r of rels) {
    if (r.a === r.b) continue;
    const down = fkFor(r.b, r.a); // parent -> child (CUSTOMER ||--o{ ORDER)
    const up = !down && fkFor(r.a, r.b); // child -> parent (ORDER }o--|| CUSTOMER)
    if (down) Object.assign(r.edge, { sourceField: down.pk.name, targetField: down.fk.name }), claim(r.b, down.fk);
    else if (up) Object.assign(r.edge, { sourceField: up.fk.name, targetField: up.pk.name }), claim(r.a, up.fk);
  }
  for (const r of rels) {
    if (r.a !== r.b) continue;
    const pk = pkOf(r.a);
    const free = r.a.fields.filter((f) => f.fk && !f.pk && !claimed.get(r.a)?.has(f.name));
    if (pk && free.length === 1) {
      Object.assign(r.edge, { sourceField: pk.name, targetField: free[0].name });
      claim(r.a, free[0]);
    }
  }
}

/**
 * Overview + one step per relationship, or per source node when there are more
 * than fit; each step lights both ends and its edges.
 */
function relationSteps(nodes, edges, { title: titleFor, sentence }, noun) {
  const titleOf = new Map(nodes.map((n) => [n.id, n.data.title]));
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  const lone = nodes.filter((n) => !linked.has(n.id)).map((n) => n.data.title);
  const steps = [
    {
      id: 'overview',
      title: 'Overview',
      description: `${nodes.length} ${noun}, ${edges.length} relationship${edges.length === 1 ? '' : 's'}.${lone.length ? ` Not linked: ${list(lone)}.` : ''}`
    }
  ];
  const budget = MAX_FLOW_STEPS - 1;
  let buckets;
  if (edges.length <= budget) buckets = edges.map((e) => [e]);
  else {
    const bySource = new Map();
    for (const e of edges) {
      if (!bySource.has(e.source)) bySource.set(e.source, []);
      bySource.get(e.source).push(e);
    }
    const groups = [...bySource.values()];
    const per = Math.ceil(groups.length / budget);
    buckets = [];
    for (let i = 0; i < groups.length; i += per) buckets.push(groups.slice(i, i + per).flat());
  }
  buckets.forEach((es, i) => {
    const title = es.length === 1 ? titleFor(es[0]) : list([...new Set(es.map((e) => titleOf.get(e.source)))]);
    steps.push({
      id: `step-${i + 1}`,
      title: shorten(title, 60),
      description: es.map(sentence).join(' '),
      highlightNodes: [...new Set(es.flatMap((e) => [e.source, e.target]))],
      highlightEdges: es.map((e) => e.id)
    });
  });
  return steps;
}

// --- class diagrams --------------------------------------------------------------

const CLASS_NAME = String.raw`([\w$-]+(?:~[^~]*~)?)`;
const CLASS_REL = new RegExp(String.raw`^${CLASS_NAME}\s*(?:"([^"]*)"\s*)?(<\||\*|o|<|\(\))?(--|\.\.)(\|>|\*|o|>|\(\))?\s*(?:"([^"]*)"\s*)?${CLASS_NAME}\s*(?::\s*(.*))?$`);
const CLASS_INLINE = new RegExp(String.raw`^class\s+${CLASS_NAME}(?:\s*\[\s*"?([^"\]]*)"?\s*\])?(?::::([\w-]+))?\s*\{(.*\S.*)\}$`);
const CLASS_DECL = new RegExp(String.raw`^class\s+${CLASS_NAME}(?:\s*\[\s*"?([^"\]]*)"?\s*\])?(?::::([\w-]+))?\s*(\{)?\s*(\})?$`);
const CLASS_HEADS = { '<|': 'triangle', '|>': 'triangle', '*': 'diamond', o: 'open-diamond', '<': 'open-arrow', '>': 'open-arrow' };
const CLASS_ROLES = {
  class: { label: 'Class', color: 'blue' },
  interface: { label: 'Interface', color: 'teal' },
  abstract: { label: 'Abstract class', color: 'violet' },
  enumeration: { label: 'Enumeration', color: 'amber' }
};
/** [verb, reads target-first]: UML is spoken child -> parent and part -> whole. */
const CLASS_VERBS = {
  inheritance: ['inherits from', true],
  realization: ['implements', true],
  composition: ['is part of', true],
  aggregation: ['belongs to', true],
  association: ['uses', false],
  dependency: ['depends on', false]
};
const generic = (t) => String(t || '').replace(/~([^~]*)~/g, '<$1>');

/** One class member: "+String name", "-name: String", "+area() double", "draw()*", "count$". */
export function classMember(raw) {
  let s = String(raw || '').trim();
  const m = {};
  const flag = (c) => (c === '$' ? (m.static = true) : (m.abstract = true));
  if (/[$*]$/.test(s)) {
    flag(s.slice(-1));
    s = s.slice(0, -1).trim();
  }
  if (/^[+\-#~]/.test(s)) {
    m.visibility = s[0];
    s = s.slice(1).trim();
  }
  const open = s.indexOf('(');
  if (open >= 0) {
    const close = s.lastIndexOf(')');
    m.name = s.slice(0, open).trim();
    const params = generic(s.slice(open + 1, close > open ? close : undefined).trim());
    if (params) m.params = params;
    let rest = close > open ? s.slice(close + 1).trim() : '';
    if (/^[$*]/.test(rest)) {
      flag(rest[0]);
      rest = rest.slice(1).trim();
    }
    rest = generic(rest.replace(/^:\s*/, ''));
    if (rest) m.type = rest;
    return { kind: 'methods', member: m };
  }
  const colon = s.indexOf(':');
  if (colon > 0) {
    m.name = s.slice(0, colon).trim();
    const type = generic(s.slice(colon + 1).trim());
    if (type) m.type = type;
  } else {
    const parts = s.split(/\s+/);
    m.name = parts.pop();
    if (parts.length) m.type = generic(parts.join(' '));
  }
  return { kind: 'fields', member: m };
}

function parseClassDiagram(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const classes = new Map(); // raw -> { raw, label, fields[], methods[], stereotype, notes[] }
  const rels = [];
  const namespaces = []; // { title, members: raw[] }
  const notes = [];
  let ns = null;
  let open = null;
  let dir = 'TB'; // parents above children
  let title;

  const touch = (name) => {
    const raw = name.replace(/~[^~]*~$/, '');
    let c = classes.get(raw);
    if (!c) {
      classes.set(raw, (c = { raw, label: generic(name), fields: [], methods: [], notes: [] }));
      if (ns) ns.members.push(raw);
    } else if (name.includes('~')) c.label = generic(name);
    return c;
  };
  const addMember = (c, text) => {
    const { kind, member } = classMember(text);
    if (member.name) c[kind].push(member);
  };

  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if (open) {
      if (line === '}') open = null;
      else if ((m = /^<<\s*(.+?)\s*>>$/.exec(line))) open.stereotype = m[1];
      else addMember(open, line);
    } else if ((m = CLASS_INLINE.exec(line))) {
      // class A { +x int; +run() } on one line
      const c = touch(m[1]);
      if (m[2]) c.label = cleanLabel(m[2]).replace(/\n/g, ' ') || c.label;
      if (m[3]) ignored.add(':::');
      for (const part of m[4].split(';').map((x) => x.trim()).filter(Boolean)) {
        const st = /^<<\s*(.+?)\s*>>$/.exec(part);
        if (st) c.stereotype = st[1];
        else addMember(c, part);
      }
    } else if ((m = CLASS_DECL.exec(line))) {
      const c = touch(m[1]);
      if (m[2]) c.label = cleanLabel(m[2]).replace(/\n/g, ' ') || c.label;
      if (m[4] && !m[5]) open = c;
      if (m[3]) ignored.add(':::');
    } else if ((m = /^<<\s*(.+?)\s*>>\s*([\w$-]+)$/.exec(line))) {
      touch(m[2]).stereotype = m[1];
    } else if ((m = /^namespace\s+([\w$.-]+)\s*\{$/.exec(line))) {
      ns = { title: m[1], members: [] };
      namespaces.push(ns);
    } else if (line === '}' && ns) {
      ns = null;
    } else if ((m = CLASS_REL.exec(line))) {
      rels.push({ a: touch(m[1]), b: touch(m[7]), lm: m[2], lh: m[3], line: m[4], rh: m[5], rm: m[6], label: unquote((m[8] || '').trim()), no });
    } else if ((m = /^([\w$-]+)\s*:\s*(.+)$/.exec(line))) {
      addMember(touch(m[1]), m[2]);
    } else if ((m = /^note\s+for\s+([\w$-]+)\s+"([\s\S]*)"$/.exec(line))) {
      touch(m[1]).notes.push(cleanLabel(m[2]).replace(/\n/g, ' '));
    } else if ((m = /^note\s+"([\s\S]*)"$/.exec(line))) {
      notes.push(cleanLabel(m[1]).replace(/\n/g, ' '));
    } else if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(line))) {
      dir = /^(LR|RL)$/i.test(m[1]) ? 'LR' : 'TB';
    } else if ((m = /^title\s+(.+)$/.exec(line))) {
      title = unquote(m[1].trim());
    } else if ((m = /^(style|cssClass|classDef|click|link|callback|accTitle|accDescr)\b/.exec(line))) {
      ignored.add(m[1]);
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  if (open) warnings.push(`Class "${open.raw}" has no closing "}".`);
  ignored.flush({
    ...IGNORED_WHY,
    ':::': 'colours come from roles',
    cssClass: 'colours come from roles',
    classDef: 'colours come from roles',
    link: 'links are not imported',
    callback: 'callbacks are not imported',
    accTitle: 'accessibility text is not imported',
    accDescr: 'accessibility text is not imported'
  });

  // The class at the () end of a lollipop is an interface
  for (const r of rels) for (const [head, c] of [[r.lh, r.a], [r.rh, r.b]]) if (head === '()' && !c.stereotype) c.stereotype = 'interface';
  const roleOf = (st) => {
    const s = String(st || '').toLowerCase();
    return s === 'interface' ? 'interface' : s === 'abstract' ? 'abstract' : /^enum/.test(s) ? 'enumeration' : 'class';
  };
  const nid = idFactory();
  const outNodes = [...classes.values()].map((c) => {
    // Not labelData: generics such as List<T> would be stripped as HTML
    const data = { title: shorten(c.label, MAX_TITLE) };
    if (data.title !== c.label) data.description = c.label;
    if (c.stereotype) data.stereotype = c.stereotype;
    data.fields = c.fields; // enumeration values are plain names: kept as fields
    if (c.methods.length) data.methods = c.methods;
    if (c.notes.length) data.description = [data.description, ...c.notes].filter(Boolean).join(' ');
    return { id: (c.id = nid(c.raw)), type: roleOf(c.stereotype), data };
  });

  const eid = edgeIdFactory();
  const longLabels = [];
  const outEdges = [];
  const mult = new Map(); // edge id -> [source multiplicity, target multiplicity]
  const structural = (k) => k === 'triangle' || k === 'diamond' || k === 'open-diamond';
  for (const r of rels) {
    // Self-relationships (a Node has child Nodes) are kept and drawn as a loop on the card
    let [src, tgt, sh, th, sm, tm] = [r.a, r.b, CLASS_HEADS[r.lh], CLASS_HEADS[r.rh], r.lm, r.rm];
    if (r.lh === '()' || r.rh === '()') {
      // Lollipop interface: `Shape ()-- Circle` / `Circle --() Shape`: the class at () is an
      // interface that the other one realizes (triangle on the interface, the Yantra source)
      const [iface, impl, im, cm] = r.lh === '()' ? [r.a, r.b, r.lm, r.rm] : [r.b, r.a, r.rm, r.lm];
      [src, tgt, sh, th, sm, tm] = [iface, impl, 'triangle', undefined, im, cm];
    }
    // Triangles and diamonds go on the source (parent / whole), plain arrows on the target
    if ((structural(th) && !structural(sh)) || (sh && !th && !structural(sh))) [src, tgt, sh, th, sm, tm] = [tgt, src, th, sh, tm, sm];
    const dashed = r.line === '..' || r.lh === '()' || r.rh === '()';
    const relation =
      sh === 'triangle' ? (dashed ? 'realization' : 'inheritance')
      : sh === 'diamond' ? 'composition'
      : sh === 'open-diamond' ? 'aggregation'
      : dashed ? 'dependency' : 'association';
    const edge = { id: eid(src.id, tgt.id), source: src.id, target: tgt.id, relation };
    // Heads the relation does not imply (a plain link, a two-headed arrow) are set explicitly
    if (RELATIONS[relation].source !== (sh || 'none')) edge.sourceEnd = sh || 'none';
    if (RELATIONS[relation].target !== (th || 'none')) edge.targetEnd = th || 'none';
    const label = edgeLabel(r.label, (l) => longLabels.push(l));
    if (label) edge.label = label;
    // Multiplicities are drawn at the ends of the edge ("1", "0..*", "many")
    if (sm) edge.sourceLabel = shorten(cleanLabel(sm), 12);
    if (tm) edge.targetLabel = shorten(cleanLabel(tm), 12);
    if (sm || tm) mult.set(edge.id, [sm, tm]);
    outEdges.push(edge);
  }
  if (longLabels.length) warnings.push(`Shortened ${longLabels.length} relationship label${longLabels.length > 1 ? 's' : ''} to ${MAX_LABEL} characters.`);
  const unlabeled = outEdges.filter((e) => !e.label && (e.relation === 'association' || e.relation === 'dependency')).length;
  if (unlabeled) warnings.push(`${unlabeled} association${unlabeled > 1 ? 's have' : ' has'} no label; add ": label" in Mermaid or label them in the JSON.`);
  if (!outNodes.length) warnings.push('No classes were found; check the classDiagram syntax (e.g. "Animal <|-- Duck").');

  const titleOf = new Map(outNodes.map((n) => [n.id, n.data.title]));
  const phrase = (e) => {
    const [verb, back] = CLASS_VERBS[e.relation];
    const [a, b] = [titleOf.get(e.source), titleOf.get(e.target)];
    return back ? `${b} ${verb} ${a}` : `${a} ${verb} ${b}`;
  };
  const sentence = (e) => {
    const [sm, tm] = mult.get(e.id) || [];
    const many = sm || tm ? ` (${sm || '*'} ${titleOf.get(e.source)} to ${tm || '*'} ${titleOf.get(e.target)})` : '';
    return `${phrase(e)}${many || (e.label ? ` (${e.label})` : '')}.`;
  };
  const steps = relationSteps(outNodes, outEdges, { title: phrase, sentence }, 'classes');
  if (notes.length) steps[0].description += ` ${notes.join(' ')}`;
  const payload = {
    meta: {
      title: ctx.title || title || 'Imported class diagram',
      description: `Imported from a Mermaid class diagram: ${outNodes.length} classes, ${outEdges.length} relationships.`,
      layout: { direction: dir }
    },
    roles: Object.fromEntries([...new Set(outNodes.map((n) => n.type))].map((t) => [t, CLASS_ROLES[t]])),
    nodes: outNodes,
    edges: outEdges
  };
  const gid = idFactory(new Set(outNodes.map((n) => n.id)));
  const groups = namespaces.filter((g) => g.members.length).map((g) => ({ id: gid(g.title), title: g.title, nodes: g.members.map((r) => classes.get(r).id) }));
  if (groups.length) payload.groups = groups;
  payload.scenarios = [{ id: 'main', name: 'Relationships', steps }];
  return { payload, warnings };
}

/**
 * Field-row attachments are a guess from column names; if the drawing cannot route
 * them (a busy key row), fall back to card sides: first for self-relationships, then
 * for every relationship. Only geometry errors trigger the fallback.
 */
export function keepRoutableFields(payload, warnings) {
  const linked = payload.edges.filter((e) => e.sourceField || e.targetField);
  if (!linked.length) return;
  const bad = () => lint(payload).errors.some((f) => /^geometry\//.test(f.code));
  if (!bad()) return;
  const drop = (es) => es.forEach((e) => (delete e.sourceField, delete e.targetField));
  drop(linked.filter((e) => e.source === e.target));
  if (bad()) drop(linked);
  const kept = payload.edges.filter((e) => e.sourceField).length;
  warnings.push(`${linked.length - kept} relationship${linked.length - kept > 1 ? 's' : ''} attach${linked.length - kept > 1 ? '' : 'es'} to card sides instead of key rows (the rows could not be routed cleanly).`);
}
