/**
 * draw.io / diagrams.net import: turns a .drawio (mxfile) or exported .xml /
 * .drawio.svg into a Yantra flow payload. Pure (no DOM, no Node APIs);
 * compressed pages (base64 + raw deflate + URI encoding) are inflated in JS.
 *
 *   fromDrawio(text, { title?, page? }) -> { payload, warnings: string[], pages: string[] }
 *   drawioPages(text)                   -> string[]   (page names)
 *
 * Coordinates are ignored (layout is automatic); they only hint the direction.
 */
import { inflateRaw } from './inflate.js';
import { hueOf } from './mermaid.js';
import { buildFlow, decodeEntities, htmlText, tidy, slug } from './importkit.js';

// --- a small XML reader ----------------------------------------------------------

/** Parse XML into { name, attrs, children, text }. Enough for mxfile; not validating. */
export function parseXml(xml) {
  const src = String(xml ?? '');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const ATTR = /([^\s=/>]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      top().text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top().text += src.slice(lt + 9, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 3;
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = src.slice(lt + 2, end < 0 ? src.length : end).trim();
      // Pop to the matching element; stray closers are ignored
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      i = end < 0 ? src.length : end + 1;
    } else {
      // Find the tag end outside quoted attribute values
      let j = lt + 1;
      let q = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (c === '>') break;
      }
      let body = src.slice(lt + 1, j);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const name = /^[^\s/>]+/.exec(body)?.[0] || '';
      const attrs = {};
      ATTR.lastIndex = name.length;
      let m;
      while ((m = ATTR.exec(body))) {
        if (!m[0]) break;
        const v = m[2] ?? '';
        attrs[m[1]] = decodeEntities(/^["']/.test(v) ? v.slice(1, -1) : v);
      }
      const el = { name, attrs, children: [], text: '' };
      top().children.push(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  return root;
}

const child = (el, name) => el?.children.find((c) => c.name === name);
const descendant = (el, name) => {
  if (!el) return null;
  for (const c of el.children) {
    if (c.name === name) return c;
    const d = descendant(c, name);
    if (d) return d;
  }
  return null;
};

// --- pages -------------------------------------------------------------------------

/** draw.io compression: base64 -> raw deflate -> URI-encoded XML. */
export function decompressDrawio(data) {
  const bin = atob(String(data).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const text = new TextDecoder().decode(inflateRaw(bytes));
  try {
    return decodeURIComponent(text);
  } catch {
    return text; // some writers skip the URI encoding
  }
}

/** The mxfile / mxGraphModel element of a document (also inside a .drawio.svg `content`). */
function documentRoot(text) {
  const doc = parseXml(text);
  const svg = descendant(doc, 'svg');
  if (svg?.attrs.content) return documentRoot(svg.attrs.content);
  const file = descendant(doc, 'mxfile');
  if (file) return file;
  const model = descendant(doc, 'mxGraphModel');
  if (model) return model;
  throw new Error('Not a draw.io file: no <mxfile> or <mxGraphModel> element found.');
}

function pageList(root) {
  if (root.name === 'mxGraphModel') return [{ name: 'Page-1', model: () => root }];
  return root.children
    .filter((c) => c.name === 'diagram')
    .map((d, i) => ({
      name: d.attrs.name || `Page-${i + 1}`,
      model: () => {
        const inline = child(d, 'mxGraphModel');
        if (inline) return inline;
        const data = d.text.trim();
        if (!data) return null;
        let xml;
        try {
          xml = decompressDrawio(data);
        } catch (err) {
          throw new Error(`Page "${d.attrs.name || i + 1}" is compressed and could not be inflated (${err.message}).`);
        }
        return descendant(parseXml(xml), 'mxGraphModel');
      }
    }));
}

export function drawioPages(text) {
  return pageList(documentRoot(text)).map((p) => p.name);
}

// --- styles and shapes ---------------------------------------------------------------

/** "rounded=1;ellipse;fillColor=#fff" -> { rounded: '1', ellipse: '', fillColor: '#fff' } plus `_shape`. */
export function parseStyle(style) {
  const out = {};
  const parts = String(style || '').split(';').map((s) => s.trim()).filter(Boolean);
  parts.forEach((p, i) => {
    const eq = p.indexOf('=');
    if (eq < 0) {
      out[p] = '';
      if (i === 0) out._shape = p;
    } else out[p.slice(0, eq)] = p.slice(eq + 1);
  });
  if (out.shape) out._shape = out.shape;
  return out;
}

/** Node type from the shape name, where the intent is obvious. */
export function shapeType(st) {
  const s = `${st._shape || ''} ${st.resIcon || ''}`.toLowerCase();
  if (/umlactor|\bactor\b|person|\buser\b/.test(s)) return 'actor';
  if (/cylinder|datastore|database|storage|disk|\bdb\b|dynamo|\brds\b|\bs3\b|bucket/.test(s)) return 'store';
  if (/rhombus|decision/.test(s)) return 'decision';
  if (/terminator|start_|\bstart\b|\bend\b|doubleellipse|ellipse|circle/.test(s)) return 'terminal';
  if (/parallelogram|manualinput|flowchart\.data|\bdocument\b|multi-?document|\bcard\b/.test(s)) return 'io';
  return 'node';
}

const isContainerStyle = (st) => 'swimlane' in st || st._shape === 'swimlane' || st.container === '1' || st._shape === 'group' || st._shape === 'table' || 'group' in st || 'pool' in st;
const isCardStyle = (st) => st.childLayout === 'stackLayout' || st._shape === 'table';
const isTextStyle = (st) => st._shape === 'text' || 'text' in st || 'edgeLabel' in st;

// --- import --------------------------------------------------------------------------

/**
 * Convert draw.io XML to a payload. `page` picks a page by 1-based number or by
 * name (default: the first, with a warning when there are several).
 */
export function fromDrawio(text, opts = {}) {
  const warnings = [];
  const root = documentRoot(String(text ?? ''));
  const pages = pageList(root);
  if (!pages.length) throw new Error('The draw.io file has no pages.');
  let index = 0;
  if (opts.page !== undefined && opts.page !== null && opts.page !== '') {
    const n = Number(opts.page);
    index = Number.isInteger(n) && String(opts.page).trim() === String(n) ? n - 1 : pages.findIndex((p) => p.name === String(opts.page));
    if (index < 0 || index >= pages.length) throw new Error(`No page "${opts.page}". Pages: ${pages.map((p, i) => `${i + 1} "${p.name}"`).join(', ')}.`);
  } else if (pages.length > 1) {
    warnings.push(`The file has ${pages.length} pages; imported page 1 "${pages[0].name}". Use --page <number|name> for another (${pages.slice(1).map((p, i) => `${i + 2} "${p.name}"`).join(', ')}).`);
  }
  const page = pages[index];
  const model = page.model();
  if (!model) throw new Error(`Page "${page.name}" is empty.`);
  try {
    return { ...convert(model, page.name, opts, warnings), pages: pages.map((p) => p.name) };
  } catch (err) {
    throw new Error(`Could not convert the draw.io page "${page.name}" (${err?.message || err}).`);
  }
}

function convert(model, pageName, opts, warnings) {
  const rootEl = child(model, 'root');
  if (!rootEl) throw new Error('no <root> element');

  // Cells, unwrapping <UserObject>/<object> (they carry the id and label)
  const cells = new Map();
  const order = [];
  for (const el of rootEl.children) {
    let cell;
    if (el.name === 'mxCell') cell = { ...el.attrs, el };
    else if (el.name === 'UserObject' || el.name === 'object') {
      const inner = child(el, 'mxCell') || { attrs: {} };
      cell = { ...inner.attrs, id: el.attrs.id, value: el.attrs.label ?? '', tooltip: el.attrs.tooltip, el: inner };
    } else continue;
    if (!cell.id || cells.has(cell.id)) continue;
    const geo = child(cell.el, 'mxGeometry')?.attrs || {};
    cell.geo = { x: Number(geo.x) || 0, y: Number(geo.y) || 0, w: Number(geo.width) || 0, h: Number(geo.height) || 0 };
    cell.st = parseStyle(cell.style);
    cell.html = cell.st.html === '1';
    cells.set(cell.id, cell);
    order.push(cell);
  }
  const labelOf = (c) => tidy(c.html ? htmlText(c.value) : decodeEntities(c.value ?? ''));
  const isEdge = (c) => c?.edge === '1';
  const isVertex = (c) => c?.vertex === '1';

  // Edge labels are vertices parented to an edge
  const edgeExtra = new Map();
  for (const c of order) {
    if (!isVertex(c) || !isEdge(cells.get(c.parent))) continue;
    c.kind = 'edge-label';
    const t = labelOf(c);
    if (t) edgeExtra.set(c.parent, [...(edgeExtra.get(c.parent) || []), t]);
  }

  const connected = new Set();
  for (const c of order) if (isEdge(c)) for (const end of [c.source, c.target]) if (end) connected.add(end);
  const vertexChildren = new Map();
  for (const c of order) if (isVertex(c) && c.kind !== 'edge-label' && cells.has(c.parent)) vertexChildren.set(c.parent, [...(vertexChildren.get(c.parent) || []), c]);

  // Classify vertices: card (stacked rows -> one node), container (-> group), node, or skipped
  let annotations = 0;
  let blanks = 0;
  const cardOf = new Map(); // descendant id -> card id
  const classify = (c, inCard) => {
    if (c.kind) return;
    if (inCard) {
      c.kind = 'card-row';
      cardOf.set(c.id, inCard);
    } else if (isCardStyle(c.st) && (vertexChildren.get(c.id) || []).length) c.kind = 'card';
    else if ((vertexChildren.get(c.id) || []).length || isContainerStyle(c.st)) c.kind = 'container';
    else if (isTextStyle(c.st) && !connected.has(c.id)) c.kind = 'annotation';
    else if (!labelOf(c) && !connected.has(c.id)) c.kind = 'blank';
    else c.kind = 'node';
    if (c.kind === 'annotation') annotations++;
    if (c.kind === 'blank') blanks++;
    for (const k of vertexChildren.get(c.id) || []) classify(k, c.kind === 'card' ? c.id : inCard);
  };
  for (const c of order) if (isVertex(c) && !isVertex(cells.get(c.parent))) classify(c, null);
  for (const c of order) if (isVertex(c) && !c.kind) classify(c, null);

  // Groups from containers; unlabeled containers are transparent (members go to the enclosing group)
  const groupOf = (c) => {
    for (let p = cells.get(c.parent); p; p = cells.get(p.parent)) if (p.kind === 'container' && labelOf(p)) return p.id;
    return undefined;
  };
  const groups = order
    .filter((c) => c.kind === 'container' && labelOf(c))
    .map((c) => {
      const color = hueOf(c.st.swimlaneFillColor) || hueOf(c.st.fillColor) || hueOf(c.st.strokeColor);
      const g = { raw: c.id, title: labelOf(c).replace(/\n/g, ' '), parent: groupOf(c), hint: slug(labelOf(c)) };
      if (color && color !== 'slate') g.color = color;
      return g;
    });

  const nodes = [];
  const nodeIds = new Set();
  for (const c of order) {
    if (c.kind !== 'node' && c.kind !== 'card') continue;
    const label = labelOf(c);
    const type = c.kind === 'card' ? 'card' : shapeType(c.st);
    const n = { raw: c.id, label: label || humanizeShape(c.st), type, group: groupOf(c), hint: slug(label) || undefined };
    const data = {};
    if (c.kind === 'card') {
      // One text per row: table rows join their cells ("PK" + "id" + "uuid")
      const rows = [];
      const cellsOf = (id) => (vertexChildren.get(id) || []).flatMap((k) => [labelOf(k).replace(/\n/g, ' '), ...cellsOf(k.id)]).filter(Boolean);
      for (const k of vertexChildren.get(c.id) || []) {
        const t = [labelOf(k).replace(/\n/g, ' '), ...cellsOf(k.id)].filter(Boolean).join(' ');
        if (t) rows.push(t);
      }
      const members = rows.map(memberOf);
      if (rows.length && members.every(Boolean)) {
        const fields = members.filter((x) => !x.method).map(({ method, ...f }) => f);
        const methods = members.filter((x) => x.method).map(({ method, ...f }) => f);
        if (fields.length) data.fields = fields;
        if (methods.length) data.methods = methods;
        n.type = methods.length || fields.some((f) => f.visibility) ? 'class' : 'table';
      } else if (rows.length) {
        data.subtitle = rows.slice(0, 3).join(', ') + (rows.length > 3 ? ', …' : '');
        data.description = rows.join('; ');
      }
    }
    if (type === 'store') data.icon = 'database';
    if (type === 'actor') data.icon = 'user';
    if (c.tooltip) data.description = tidy(htmlText(c.tooltip)).replace(/\n/g, ' ');
    if (Object.keys(data).length) n.data = data;
    nodes.push(n);
    nodeIds.add(c.id);
  }
  if (annotations) warnings.push(`Ignored ${annotations} free-standing text label${annotations > 1 ? 's' : ''} (not connected to anything).`);
  if (blanks) warnings.push(`Ignored ${blanks} unlabelled, unconnected shape${blanks > 1 ? 's' : ''}.`);

  // Edge ends: card rows resolve to their card, containers to their first node
  const firstNodeIn = (id) => {
    for (const k of vertexChildren.get(id) || []) {
      if (nodeIds.has(k.id)) return k.id;
      const deeper = k.kind === 'container' ? firstNodeIn(k.id) : null;
      if (deeper) return deeper;
    }
    return null;
  };
  let toContainer = 0;
  let dangling = 0;
  const resolve = (id) => {
    if (!id) return null;
    if (nodeIds.has(id)) return id;
    if (cardOf.has(id)) return cardOf.get(id);
    const c = cells.get(id);
    if (c?.kind === 'container') {
      const f = firstNodeIn(id);
      if (f) toContainer++;
      return f;
    }
    return null;
  };
  const edges = [];
  for (const c of order) {
    if (!isEdge(c)) continue;
    const from = resolve(c.source);
    const to = resolve(c.target);
    if (!from || !to) {
      dangling++;
      continue;
    }
    const label = [labelOf(c), ...(edgeExtra.get(c.id) || [])].filter(Boolean).join(' ');
    const dashed = c.st.dashed === '1';
    const notation = edgeNotation(c.st, dashed);
    if (notation) {
      // ER ends or a UML relation (whose triangle / diamond sits on the Yantra source)
      const e = notation.swap ? { from: to, to: from, label } : { from, to, label };
      Object.assign(e, notation.fields);
      edges.push(e);
      continue;
    }
    // Arrow heads: draw.io ends in an arrow unless endArrow=none; startArrow defaults to none
    const head = c.st.endArrow !== 'none';
    const tail = !!c.st.startArrow && c.st.startArrow !== 'none';
    const e = head || !tail ? { from, to, label } : { from: to, to: from, label };
    if (head && tail) e.arrow = 'both';
    else if (!head && !tail) e.arrow = 'none';
    if (dashed) e.style = 'dashed';
    edges.push(e);
  }
  if (toContainer) warnings.push(`${toContainer} edge end${toContainer > 1 ? 's' : ''} on a container ${toContainer > 1 ? 'were' : 'was'} attached to its first node.`);
  if (dangling) warnings.push(`Dropped ${dangling} edge${dangling > 1 ? 's' : ''} without a shape at both ends.`);
  const unlabeled = edges.filter((e) => !e.label).length;
  if (unlabeled) warnings.push(`${unlabeled} edge${unlabeled > 1 ? 's have' : ' has'} no label; label them in draw.io or in the JSON.`);

  const direction = guessDirection(edges, cells);
  const title = opts.title || (/^Page-\d+$/.test(pageName) ? 'Imported draw.io diagram' : pageName);
  return buildFlow({
    nodes,
    edges,
    groups,
    direction,
    title,
    description: `Imported from draw.io${/^Page-\d+$/.test(pageName) ? '' : ` page "${pageName}"`}: ${nodes.length} nodes, ${edges.length} edges.`,
    warnings
  });
}

/**
 * A class / table row as a member: `+ name: Type`, `- run(x: int): void`, `PK id uuid`,
 * `email varchar(255)`. Null when the row does not look like one.
 */
export function memberOf(row) {
  let s = row.trim();
  const key = /^((?:PK|FK|UK|U)(?:\s*,\s*(?:PK|FK|UK|U))*)\s+/i.exec(s);
  if (key) s = s.slice(key[0].length);
  let m;
  if ((m = /^([+\-#~])?\s*([\w$]+)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/.exec(s))) {
    const out = { method: true, name: m[2] };
    if (m[1]) out.visibility = m[1];
    if (m[3].trim()) out.params = m[3].trim();
    if (m[4]) out.type = m[4].trim();
    return out;
  }
  m = /^([+\-#~])?\s*([\w$]+)\s*(?::\s*(.+)|\s+([\w$.()<>,\[\]?]+(?:\s*\(\d+(?:,\s*\d+)?\))?))?$/.exec(s);
  if (!m) return null;
  const out = { name: m[2] };
  if (m[1]) out.visibility = m[1];
  if (m[3] || m[4]) out.type = (m[3] || m[4]).trim();
  if (key) {
    const k = key[1].toUpperCase();
    if (k.includes('PK')) out.pk = true;
    if (k.includes('FK')) out.fk = true;
    if (/\bUK?\b/.test(k)) out.unique = true;
  }
  return out;
}

const ER_ENDS = { ERone: 'one', ERmandOne: 'one', ERmany: 'many', ERzeroToOne: 'zero-or-one', ERoneToMany: 'one-or-many', ERzeroToMany: 'zero-or-many' };

/**
 * Edge end notation from draw.io arrow styles: ER cardinalities (ERmany, ERzeroToOne, ...)
 * become sourceEnd / targetEnd; UML heads become a relation. draw.io puts an inheritance
 * triangle on the parent (usually the target) while Yantra puts it on the source, so those
 * edges are swapped. Null for plain arrows.
 */
function edgeNotation(st, dashed) {
  const start = st.startArrow || 'none';
  const end = st.endArrow ?? 'classic';
  if (ER_ENDS[start] || ER_ENDS[end]) {
    return { fields: { sourceEnd: ER_ENDS[start] || 'none', targetEnd: ER_ENDS[end] || 'none' } };
  }
  const open = (fill) => fill === '0';
  const uml = (head, fill) =>
    head === 'block' && open(fill) ? (dashed ? 'realization' : 'inheritance')
      : /^diamond/.test(head) ? (open(fill) ? 'aggregation' : 'composition')
        : null;
  const atEnd = uml(end, st.endFill);
  if (atEnd) return { swap: true, fields: { relation: atEnd } };
  const atStart = uml(start, st.startFill);
  if (atStart) return { fields: { relation: atStart } };
  if (dashed && /^open/.test(end) && start === 'none') return { fields: { relation: 'dependency' } };
  return null;
}

const humanizeShape =(st) => String(st._shape || 'Shape').replace(/^mxgraph\.[\w]+\./, '').replace(/[_.]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** LR when edges mostly run sideways in the drawing, else TB. */
function guessDirection(edges, cells) {
  const abs = (id) => {
    let x = 0;
    let y = 0;
    for (let c = cells.get(id), k = 0; c && k < 50; c = cells.get(c.parent), k++) {
      x += c.geo.x;
      y += c.geo.y;
    }
    const c = cells.get(id);
    return { x: x + c.geo.w / 2, y: y + c.geo.h / 2 };
  };
  let dx = 0;
  let dy = 0;
  for (const e of edges) {
    const a = abs(e.from);
    const b = abs(e.to);
    dx += Math.abs(b.x - a.x);
    dy += Math.abs(b.y - a.y);
  }
  return dx > dy ? 'LR' : 'TB';
}
