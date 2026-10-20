/**
 * Text helpers shared by the browser renderer, the SVG exporter and the
 * Node-side validator. Widths are estimated (no DOM), so card heights are
 * deterministic everywhere; CSS line-clamps keep the browser inside them.
 */

const NARROW = new Set("il.,:;'|!ijtfrI()[]{}` ");
const WIDE = new Set('mwMW@%');

function charEm(ch) {
  if (ch === ' ') return 0.28;
  if (NARROW.has(ch)) return 0.3;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.66;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch.charCodeAt(0) > 0x2e80) return 1.0; // CJK and other wide scripts
  return 0.53;
}

export function textWidth(str, fontSize, { weight = 400, mono = false } = {}) {
  const s = String(str ?? '');
  if (mono) return s.length * fontSize * 0.6;
  let em = 0;
  for (const ch of s) em += charEm(ch);
  return em * fontSize * (weight >= 600 ? 1.05 : 1);
}

/**
 * Greedy word wrap. Returns at most maxLines lines; the last line gets an
 * ellipsis when text is cut. Linear in the text length: words too long for a
 * line are cut by accumulating character widths, and wrapping stops as soon
 * as the text is known to overflow maxLines.
 */
export function wrapText(str, maxWidth, fontSize, opts = {}, maxLines = Infinity) {
  const words = String(str ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const fits = (s) => textWidth(s, fontSize, opts) <= maxWidth;
  const full = () => lines.length > maxLines;

  for (let word of words) {
    if (full()) break;
    // Hard-break words that cannot fit on a line of their own
    if (!fits(word)) {
      if (line) { lines.push(line); line = ''; }
      const pieces = hardBreak(word, maxWidth, fontSize, opts, maxLines - lines.length + 1);
      word = pieces.pop();
      lines.push(...pieces);
      if (full()) break;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line && !full()) lines.push(line);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

/**
 * Cut one long word into pieces that each fit maxWidth (at least one
 * character per piece). The last piece is returned unfinished so the caller
 * can continue the line with it. Stops after `limit` full pieces.
 */
function hardBreak(word, maxWidth, fontSize, opts, limit) {
  const chars = [...word];
  const scale = opts.mono ? 0.6 * fontSize : fontSize * ((opts.weight ?? 400) >= 600 ? 1.05 : 1);
  const pieces = [];
  let start = 0;
  let em = 0;
  for (let k = 0; k < chars.length; k++) {
    const w = opts.mono ? 1 : charEm(chars[k]);
    if (k > start && (em + w) * scale > maxWidth) {
      pieces.push(chars.slice(start, k).join(''));
      if (pieces.length >= limit) return [...pieces, chars.slice(k).join('')];
      start = k;
      em = 0;
    }
    em += w;
  }
  pieces.push(chars.slice(start).join(''));
  return pieces;
}

/** Longest text kept for card titles, subtitles and edge labels (longer text is cut with an ellipsis; lint warns). */
export const TEXT_CAP = 200;

export function clampText(value, cap = TEXT_CAP) {
  if (typeof value !== 'string' || value.length <= cap) return value;
  return `${value.slice(0, cap)}…`;
}

export function truncate(str, maxWidth, fontSize, opts = {}) {
  return wrapText(String(str ?? '').replace(/\s+/g, ' '), maxWidth, fontSize, opts, 1)[0] || '';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const escapeXml = escapeHtml;

/**
 * Markdown-safe inline text: newlines collapse to spaces, and "<", "[", "]"
 * and a leading "#" or ">" are escaped, so payload text cannot open a
 * heading, a quote, raw HTML or a link in the generated .md.
 */
export function mdInline(value) {
  return String(value ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/[\\<[\]]/g, '\\$&')
    .replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)#/, '$1\\#');
}

/** Multi-line Markdown-safe text (paragraphs keep their line breaks). */
export function mdBlock(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => (line.trim() ? mdInline(line) : ''))
    .join('\n');
}
