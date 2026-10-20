/**
 * Visio (.vsdx) import: a .vsdx file is a zip of XML parts. This reads the zip
 * (stored and deflated entries, with the pure-JS inflater), then a page's shapes
 * and connectors: shapes with text become nodes (type from the master name:
 * Decision, Start/End, Database, Document, Data, Actor ...), glued connectors
 * become edges, group shapes with text become groups. Geometry only hints the
 * direction. Fill (else line) colours become role colours as in draw.io; themes,
 * layers and images are not read. Pure (no DOM, no Node APIs).
 *
 *   unzip(bytes)                          -> Map<name, () => Uint8Array>
 *   isVsdx(bytes)                         -> boolean
 *   visioPages(bytes)                     -> string[]
 *   fromVisio(bytes, { title?, page? })   -> { payload, warnings, pages }
 */
import { inflateRaw } from './inflate.js';
import { parseXml, cellHue, colourRoles } from './drawio.js';
import { buildFlow, tidy, slug } from './importkit.js';

const MAX_ENTRY = 64 * 1024 * 1024;

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const utf8 = (bytes) => new TextDecoder().decode(bytes);

/** Entries of a zip archive, read lazily. Throws on a damaged or ZIP64 archive. */
export function unzip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--)
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory).');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw new Error('ZIP64 archives are not supported.');
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('damaged zip central directory.');
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const full = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const skip = nameLen + u16(b, p + 30) + u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = utf8(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + skip;
    out.set(name, () => {
      if (u32(b, local) !== 0x04034b50) throw new Error(`damaged zip entry "${name}".`);
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const data = b.subarray(start, start + size);
      if (full > MAX_ENTRY) throw new Error(`zip entry "${name}" is too large.`);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error(`zip entry "${name}" uses an unsupported compression method (${method}).`);
    });
  }
  return out;
}

export const isZip = (b) => b?.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
export const isVsdx = (b) => {
  if (!isZip(b)) return false;
  try {
    return unzip(b).has('visio/document.xml');
  } catch {
    return false;
  }
};

const kids = (el, name) => (el?.children || []).filter((c) => c.name === name);
const kid = (el, name) => kids(el, name)[0];
const allText = (el) => (el ? el.text + el.children.map(allText).join('') : '');
const cell = (shape, n) => kids(shape, 'Cell').find((c) => c.attrs.N === n)?.attrs.V;

/** Visio's legacy colour indices (0-7) as hex; documents usually store #rrggbb. */
const COLOUR_INDEX = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
const colour = (v) => (/^\d+$/.test(String(v ?? '')) ? COLOUR_INDEX[Number(v)] ?? null : v ?? null);

/** Role hue of a shape from its own fill, else line, colour (as draw.io cells); null when none. */
function shapeHue(el) {
  const fill = cell(el, 'FillPattern') === '0' ? null : colour(cell(el, 'FillForegnd'));
  const line = cell(el, 'LinePattern') === '0' ? null : colour(cell(el, 'LineColor'));
  return cellHue({ fillColor: fill, strokeColor: line });
}

function openVsdx(bytes) {
  const zip = unzip(bytes);
  const read = (name) => {
    const get = zip.get(name);
    return get ? parseXml(utf8(get())) : null;
  };
  if (!zip.has('visio/document.xml')) throw new Error('Not a Visio file: no visio/document.xml in the archive. Save it as .vsdx (Visio 2013 or later), or export it from draw.io as .drawio.');
  const pagesXml = read('visio/pages/pages.xml');
  const rels = read('visio/pages/_rels/pages.xml.rels');
  const targets = new Map();
  for (const r of rels?.children.flatMap((c) => kids(c, 'Relationship')) || []) targets.set(r.attrs.Id, r.attrs.Target);
  const root = pagesXml?.children.find((c) => c.name === 'Pages');
  const pages = kids(root, 'Page')
    .filter((p) => p.attrs.Background !== '1')
    .map((p, i) => {
      const rel = kid(p, 'Rel');
      const rid = rel && Object.entries(rel.attrs).find(([k]) => /(^|:)id$/.test(k))?.[1];
      const target = targets.get(rid) || `page${i + 1}.xml`;
      return { name: p.attrs.NameU || p.attrs.Name || `Page-${i + 1}`, file: `visio/pages/${target.replace(/^.*\//, '')}` };
    });
  const masters = new Map();
  const mx = read('visio/masters/masters.xml');
  for (const m of kids(mx?.children.find((c) => c.name === 'Masters'), 'Master')) masters.set(m.attrs.ID, m.attrs.NameU || m.attrs.Name || '');
  return { read, pages, masters };
}

export function visioPages(bytes) {
  return openVsdx(bytes).pages.map((p) => p.name);
}

/** Node type from a Visio master or shape name (Basic Flowchart, Basic Shapes, ...). */
export function visioType(name) {
  const s = String(name || '').toLowerCase().replace(/\.\d+$/, '');
  if (/actor|person|user|customer/.test(s)) return 'actor';
  if (/database|data store|datastore|stored data|disk|direct data|cylinder/.test(s)) return 'store';
  if (/decision|diamond/.test(s)) return 'decision';
  if (/start\/end|terminator|start|end|ellipse|circle|oval/.test(s)) return 'terminal';
  if (/document|^data$|manual input|parallelogram|card/.test(s)) return 'io';
  return 'node';
}

export function fromVisio(bytes, opts = {}) {
  const warnings = [];
  const { read, pages, masters } = openVsdx(bytes);
  if (!pages.length) throw new Error('The Visio file has no foreground pages.');
  let index = 0;
  if (opts.page !== undefined && opts.page !== null && opts.page !== '') {
    const n = Number(opts.page);
    index = Number.isInteger(n) && String(opts.page).trim() === String(n) ? n - 1 : pages.findIndex((p) => p.name === String(opts.page));
    if (index < 0 || index >= pages.length) throw new Error(`No page "${opts.page}". Pages: ${pages.map((p, i) => `${i + 1} "${p.name}"`).join(', ')}.`);
  } else if (pages.length > 1) warnings.push(`The file has ${pages.length} pages; imported page 1 "${pages[0].name}". Use --page <number|name> for another.`);
  const page = pages[index];
  const doc = read(page.file);
  if (!doc) throw new Error(`Page "${page.name}" (${page.file}) is missing from the file.`);
  const contents = doc.children.find((c) => c.name === 'PageContents');

  // Shapes, flattened with their parent group
  const shapes = new Map();
  const walk = (el, parent, ox, oy) => {
    for (const s of kids(kid(el, 'Shapes'), 'Shape')) {
      const x = ox + Number(cell(s, 'PinX') || 0) - (parent ? Number(cell(parent.el, 'LocPinX') || 0) : 0);
      const y = oy + Number(cell(s, 'PinY') || 0) - (parent ? Number(cell(parent.el, 'LocPinY') || 0) : 0);
      const master = masters.get(s.attrs.Master) || parent?.master || '';
      const shape = { id: s.attrs.ID, el: s, parent, master, name: s.attrs.NameU || s.attrs.Name || master, text: tidy(allText(kid(s, 'Text'))), x, y, type: s.attrs.Type };
      shapes.set(shape.id, shape);
      if (kid(s, 'Shapes')) walk(s, shape, x, y);
    }
  };
  walk(contents, null, 0, 0);

  // Connections: a connector's BeginX / EndX glued to shapes
  const ends = new Map();
  for (const c of kids(kid(contents, 'Connects'), 'Connect')) {
    const e = ends.get(c.attrs.FromSheet) || {};
    if (/^Begin/.test(c.attrs.FromCell)) e.from = c.attrs.ToSheet;
    else if (/^End/.test(c.attrs.FromCell)) e.to = c.attrs.ToSheet;
    ends.set(c.attrs.FromSheet, e);
  }
  const isConnector = (s) => ends.has(s.id) || (cell(s.el, 'BeginX') !== undefined && cell(s.el, 'EndX') !== undefined) || /connector|^line|arrow/i.test(s.master);

  let blanks = 0;
  const groups = [];
  const groupOf = (s) => {
    for (let p = s.parent; p; p = p.parent) if (p.kind === 'group') return p.id;
    return undefined;
  };
  const ordered = [...shapes.values()];
  const isInside = (c, g) => {
    for (let p = c.parent; p; p = p.parent) if (p === g) return true;
    return false;
  };
  for (const s of ordered) {
    if (isConnector(s)) s.kind = 'connector';
    else if (s.type === 'Group' && kid(s.el, 'Shapes')) {
      // A group whose parts carry no text is one shape (a master drawn from parts)
      const texty = ordered.some((c) => c !== s && c.text && isInside(c, s));
      s.kind = texty ? (s.text ? 'group' : 'transparent') : undefined;
    }
  }
  for (const s of ordered.filter((x) => x.kind === 'group')) {
    const g = { raw: s.id, title: s.text.replace(/\n/g, ' '), parent: groupOf(s), hint: slug(s.text) || undefined };
    const hue = shapeHue(s.el);
    if (hue && hue !== 'slate') g.color = hue;
    groups.push(g);
  }
  const connected = new Set([...ends.values()].flatMap((e) => [e.from, e.to]).filter(Boolean));
  const nodes = [];
  const nodeIds = new Set();
  for (const s of ordered) {
    if (s.kind) continue;
    if (s.parent && s.parent.kind !== 'group' && s.parent.kind !== 'transparent') continue; // parts of a shape
    if (!s.text && !connected.has(s.id)) {
      blanks++;
      continue;
    }
    const type = visioType(s.master || s.name);
    const n = { raw: s.id, label: s.text || s.master.replace(/\.\d+$/, '') || 'Shape', type, group: groupOf(s), hint: slug(s.text) || undefined, hue: shapeHue(s.el) };
    if (type === 'store') n.data = { icon: 'database' };
    if (type === 'actor') n.data = { icon: 'user' };
    nodes.push(n);
    nodeIds.add(s.id);
  }
  // Glue to a sub-shape lands on its top-level shape
  const resolve = (id) => {
    for (let s = shapes.get(id); s; s = s.parent) if (nodeIds.has(s.id)) return s.id;
    return null;
  };
  const edges = [];
  let dangling = 0;
  for (const s of ordered.filter((x) => x.kind === 'connector')) {
    const e = ends.get(s.id) || {};
    const from = resolve(e.from);
    const to = resolve(e.to);
    if (!from || !to) {
      dangling++;
      continue;
    }
    const head = Number(cell(s.el, 'EndArrow') ?? 1) > 0;
    const tail = Number(cell(s.el, 'BeginArrow') ?? 0) > 0;
    const edge = head || !tail ? { from, to, label: s.text } : { from: to, to: from, label: s.text };
    if (head && tail) edge.arrow = 'both';
    else if (!head && !tail) edge.arrow = 'none';
    if (Number(cell(s.el, 'LinePattern') ?? 1) > 1) edge.style = 'dashed';
    edges.push(edge);
  }
  if (blanks) warnings.push(`Ignored ${blanks} shape${blanks > 1 ? 's' : ''} without text or connections.`);
  if (dangling) warnings.push(`Dropped ${dangling} connector${dangling > 1 ? 's' : ''} not glued to a shape at both ends.`);
  const unlabeled = edges.filter((e) => !e.label).length;
  if (unlabeled) warnings.push(`${unlabeled} connector${unlabeled > 1 ? 's have' : ' has'} no text; label them in Visio or in the JSON.`);
  if (!nodes.length) throw new Error(`Page "${page.name}" has no shapes with text.`);

  // Visio's y axis points up; only the main direction is taken from the drawing
  const pos = new Map(ordered.map((s) => [s.id, s]));
  let dx = 0;
  let dy = 0;
  for (const e of edges) {
    dx += Math.abs(pos.get(e.to).x - pos.get(e.from).x);
    dy += Math.abs(pos.get(e.to).y - pos.get(e.from).y);
  }
  const named = !/^Page-\d+$/.test(page.name);
  const res = buildFlow({
    nodes,
    edges,
    groups,
    direction: dx > dy ? 'LR' : 'TB',
    title: opts.title || (named ? page.name : 'Imported Visio diagram'),
    description: `Imported from Visio${named ? ` page "${page.name}"` : ''}: ${nodes.length} shapes, ${edges.length} connectors.`,
    warnings,
    roleOverrides: colourRoles(nodes)
  });
  return { ...res, pages: pages.map((p) => p.name) };
}
