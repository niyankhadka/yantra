/**
 * URL-hash state helpers (no DOM access, so Node tests can import them).
 */

/**
 * A hash such as `#step=3&mode=dev` as an ordered key -> value map. Values are
 * URI-decoded when `decode` is set (ids may contain any character; the viewer
 * encodes them when it writes the hash); raw values are kept for rewriting.
 */
export function hashParams(hash, decode = true) {
  const params = new Map();
  for (const kv of String(hash || '').replace(/^#/, '').split('&')) {
    if (!kv) continue;
    const at = kv.indexOf('=');
    const key = at < 0 ? kv : kv.slice(0, at);
    const raw = at < 0 ? '' : kv.slice(at + 1);
    let value = raw;
    if (decode) {
      try {
        value = decodeURIComponent(raw);
      } catch {
        // malformed escape: keep the raw text
      }
    }
    params.set(key, value);
  }
  return params;
}

/**
 * Storage key for dragged positions. The title alone is not enough: two
 * different diagrams with the same title (or none) would share positions, so
 * the key also carries a short hash of the node ids.
 */
export function layoutStorageKey(payload) {
  const title = String(payload?.meta?.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const ids = (payload?.nodes || []).map((n) => String(n?.id)).sort().join('\n');
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < ids.length; i++) {
    h ^= ids.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `yantra:layout:${title}:${(h >>> 0).toString(36)}`;
}
