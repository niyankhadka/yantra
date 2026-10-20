/**
 * Node-only file access for imports: a PlantUML `!include` resolver that only
 * reads text files inside a root folder. Used by the CLI (root: the folder of
 * the file being imported) and the MCP server (root: YANTRA_INPUT_ROOT).
 *
 *   fileIncluder(root) -> (target, fromPath | null) -> { path, text }   (throws a short reason)
 */
import fs from 'node:fs';
import path from 'node:path';

const INCLUDE_EXTS = ['.puml', '.plantuml', '.pu', '.iuml', '.wsd', '.txt', '.inc', '.ipu', '.uml'];
const MAX_BYTES = 1024 * 1024;

/** Resolve symlinks of the longest existing prefix, so a link cannot escape the root. */
export function realish(p) {
  let head = p;
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) return p;
    tail.unshift(path.basename(head));
    head = up;
  }
  return path.join(fs.realpathSync(head), ...tail);
}

export function within(root, file) {
  const rel = path.relative(realish(root), realish(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function fileIncluder(root) {
  const base = path.resolve(root);
  return (target, from) => {
    const t = String(target ?? '').trim();
    if (!t) throw new Error('empty path.');
    if (/^[a-z][\w+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) throw new Error('URLs are never fetched.');
    if (path.isAbsolute(t) || /^[a-z]:/i.test(t)) throw new Error('use a path relative to the including file.');
    const file = path.resolve(from ? path.dirname(from) : base, t);
    if (!within(base, file)) throw new Error(`outside ${base}; only files in that folder can be included.`);
    if (!INCLUDE_EXTS.includes(path.extname(file).toLowerCase())) throw new Error(`only ${INCLUDE_EXTS.join(' ')} files can be included.`);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new Error('file not found.');
    }
    if (!stat.isFile()) throw new Error('not a file.');
    if (stat.size > MAX_BYTES) throw new Error('larger than 1 MB.');
    return { path: file, text: fs.readFileSync(file, 'utf-8') };
  };
}
