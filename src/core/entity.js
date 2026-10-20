/**
 * Entity / class cards: a card with rows for table columns (ER diagrams) or
 * attributes and methods (class diagrams). The rows are measured here, so the
 * layout, the HTML card, the SVG export and the validator agree on the height.
 *
 *   data.fields:  [{ name, type?, pk?, fk?, unique?, nullable?, ref?, note?, visibility? }]
 *   data.methods: [{ name, params?, type?, visibility?, static?, abstract? }]
 *   data.stereotype: "interface" -> «interface» in place of the kicker
 */
import { textWidth, truncate } from './text.js';

/** Row metrics. src/styles/diagram.css mirrors them (.y-node-rows). */
export const ROWS = {
  line: 20, // one row
  nameSize: 12,
  typeSize: 11, // monospace, right-aligned
  keySize: 9.5, // PK / FK / UK or visibility column, monospace bold
  keyGap: 6, // key column -> name
  typeGap: 10, // name -> type
  sectionGap: 12, // space above each section; its divider sits `rule` px into it
  rule: 6,
  max: 12 // rows shown per card (fields + methods); the rest become "+ N more"
};

export const VISIBILITY = ['+', '-', '#', '~'];
export const VISIBILITY_NAMES = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Member entries as objects with a name; a bare string is a name. */
export function members(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => (typeof m === 'string' ? { name: m } : isObj(m) ? m : null))
    .filter((m) => m && str(m.name).trim());
}

/** True when a node draws as an entity / class card. */
export const isEntity = (data) => isObj(data) && (Array.isArray(data.fields) || Array.isArray(data.methods));

/** Key column text: PK / FK / UK for columns, the visibility symbol for class members. */
export function memberKey(m, kind) {
  if (kind === 'fields') {
    const keys = [m.pk && 'PK', m.fk && 'FK', m.unique && !m.pk && 'UK'].filter(Boolean);
    if (keys.length) return keys.join(' ');
  }
  return VISIBILITY.includes(m.visibility) ? m.visibility : '';
}

/** Name as shown: methods get their parameter list. */
export function memberName(m, kind) {
  const name = str(m.name).trim();
  if (kind !== 'methods' || name.includes('(')) return name;
  return `${name}(${str(m.params)})`;
}

/** Type as shown: nullable columns end in "?". */
export const memberType = (m) => {
  const t = str(m.type).trim();
  return t && m.nullable ? `${t}?` : t;
};

const keyWidth = (k) => textWidth(k, ROWS.keySize, { mono: true });
const nameWidth = (n, pk) => textWidth(n, ROWS.nameSize, { weight: pk ? 600 : 400 });
const typeWidth = (t) => textWidth(t, ROWS.typeSize, { mono: true });

/** Rows shown per section under the ROWS.max cap; methods keep a few rows when fields overflow. */
function allocate(nf, nm) {
  if (nf + nm <= ROWS.max) return [nf, nm];
  const m = nm ? Math.min(nm, Math.max(4, ROWS.max - nf)) : 0;
  const f = Math.min(nf, ROWS.max - m);
  return [f, Math.min(nm, ROWS.max - f)];
}

/**
 * Row centre (from the card top) of every field of a measured card, for edges
 * that attach to a field row (sourceField / targetField). Fields cut off by the
 * row cap attach to the "+ N more" row. Null for cards without fields.
 */
export function fieldRows(data, lines) {
  const sec = lines?.rows?.sections.find((s) => s.kind === 'fields');
  if (!sec) return null;
  const out = new Map();
  const more = sec.rows.find((r) => r.more);
  for (const r of sec.rows) if (!r.more) out.set(r.member, r.y + ROWS.line / 2);
  for (const m of members(data.fields)) if (!out.has(str(m.name).trim()) && more) out.set(str(m.name).trim(), more.y + ROWS.line / 2);
  return out;
}

/** Width an entity card needs so its rows fit without cutting (callers clamp it). */
export function entityWidth(data, padX) {
  let need = 0;
  for (const kind of ['fields', 'methods']) {
    const list = members(data[kind]);
    const kw = Math.max(0, ...list.map((m) => keyWidth(memberKey(m, kind))));
    const keyCol = kw ? kw + ROWS.keyGap : 0;
    for (const m of list) {
      const t = memberType(m);
      need = Math.max(need, keyCol + nameWidth(memberName(m, kind), m.pk) + (t ? ROWS.typeGap + typeWidth(t) : 0));
    }
  }
  return Math.ceil(need + padX * 2);
}

/**
 * Lay out the member sections of a card.
 * @param data  node data
 * @param inner width inside the card padding
 * @param top   y (from the card top) where the sections start
 * @returns { height, nameX (name offset from the padding: key column + gap), sections: [{ kind, rule, rows: [{ y, member, key, name, type, pk, static, abstract } | { y, more }] }] }
 */
export function measureMembers(data, inner, top) {
  const fields = members(data.fields);
  const methods = members(data.methods);
  const [nf, nm] = allocate(fields.length, methods.length);
  const all = [
    ['fields', fields, nf],
    ['methods', methods, nm]
  ].filter(([, list]) => list.length);
  const keyW = Math.ceil(Math.max(0, ...all.flatMap(([kind, list]) => list.map((m) => keyWidth(memberKey(m, kind))))));
  const keyCol = keyW ? keyW + ROWS.keyGap : 0;

  const sections = [];
  let y = top;
  for (const [kind, list, shown] of all) {
    const rule = y + ROWS.rule;
    y += ROWS.sectionGap;
    const cut = shown < list.length;
    const rows = [];
    for (const m of list.slice(0, cut ? shown - 1 : shown)) {
      // The type keeps what the name leaves, and at least 45% of the row
      const fullType = memberType(m);
      const typeRoom = Math.max(inner * 0.45, inner - keyCol - nameWidth(memberName(m, kind), m.pk) - ROWS.typeGap);
      const type = fullType ? truncate(fullType, typeRoom, ROWS.typeSize, { mono: true }) : '';
      const room = inner - keyCol - (type ? typeWidth(type) + ROWS.typeGap : 0);
      rows.push({
        y,
        member: str(m.name).trim(),
        key: memberKey(m, kind),
        name: truncate(memberName(m, kind), room, ROWS.nameSize, { weight: m.pk ? 600 : 400 }),
        type,
        pk: !!m.pk,
        static: !!m.static,
        abstract: !!m.abstract
      });
      y += ROWS.line;
    }
    if (cut) {
      rows.push({ y, more: list.length - (shown - 1) });
      y += ROWS.line;
    }
    sections.push({ kind, rule, rows });
  }
  return { height: y - top, nameX: keyCol, sections };
}
