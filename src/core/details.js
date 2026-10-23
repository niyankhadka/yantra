/**
 * Detail pages: an answer page (or a book chapter) can keep deeper pages in a
 * `details` map ({ id: page }), and any block opens one with `"detail": "id"`.
 * Details link on to other details of the same map, so they form levels below
 * the page, read in the order a reader meets them. Pure: used by the renderer,
 * the Markdown export and the validator.
 */
import { walkBlocks } from './page.js';

/** Details past this many are a budget warning (that much detail is documentation). */
export const DETAIL_BUDGET = { details: 12 };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** The page's details map ({} when it has none). */
export const detailsOf = (page) => (isObj(page?.details) ? page.details : {});

/** A detail as a page: its own meta, with the parent page's language when it sets none. */
export function detailPage(detail, parentMeta = {}) {
  const d = isObj(detail) ? detail : {};
  const meta = isObj(d.meta) ? d.meta : {};
  const lang = meta.lang ? {} : { ...(parentMeta.lang ? { lang: parentMeta.lang } : {}), ...(parentMeta.dir ? { dir: parentMeta.dir } : {}), ...(parentMeta.strings ? { strings: parentMeta.strings } : {}) };
  return { ...d, kind: 'page', details: undefined, meta: { ...lang, ...meta } };
}

/** Detail ids the blocks link to, in reading order (sections included), without repeats. */
export function detailLinks(blocks) {
  const out = [];
  walkBlocks(list(blocks), (b) => {
    if (typeof b?.detail === 'string' && b.detail && !out.includes(b.detail)) out.push(b.detail);
  });
  return out;
}

/** A detail's title, for links and the back bar. */
export function detailTitle(detail, id) {
  const m = isObj(detail?.meta) ? detail.meta : {};
  return String(m.title || m.question || id);
}

/**
 * The details a reader can reach, breadth first from the page: [{ id, page, parent }]
 * (parent: the detail id that first links to it, or null for the page itself).
 * Unknown ids and details nobody links to are left out (the validator reports them).
 */
export function detailTree(page) {
  const map = detailsOf(page);
  const out = [];
  const seen = new Set();
  const queue = detailLinks(page?.blocks).map((id) => [id, null]);
  while (queue.length) {
    const [id, parent] = queue.shift();
    if (seen.has(id) || !isObj(map[id]) || map[id].$ref) continue;
    seen.add(id);
    out.push({ id, page: map[id], parent });
    for (const next of detailLinks(map[id].blocks)) if (!seen.has(next)) queue.push([next, id]);
  }
  return out;
}

/** The trail of detail ids from the page down to `id` (the page itself not included). */
export function detailTrail(tree, id) {
  const byId = new Map(tree.map((d) => [d.id, d]));
  const trail = [];
  for (let d = byId.get(id); d; d = d.parent ? byId.get(d.parent) : null) trail.unshift(d.id);
  return trail;
}
