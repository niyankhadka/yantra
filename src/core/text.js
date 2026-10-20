/**
 * Text helpers shared by the browser renderer, the SVG exporter and the
 * Node-side validator. Widths are estimated (no DOM), so card heights are
 * deterministic everywhere; CSS line-clamps keep the browser inside them.
 * Han, kana and Hangul count as full-width, combining marks (Devanagari vowel
 * signs, Arabic harakat) as zero width, and CJK text wraps between characters.
 */

const NARROW = new Set("il.,:;'|!ijtfrI()[]{}` ");
const WIDE = new Set('mwMW@%');
// Zero width: non-spacing and enclosing marks, format characters (ZWJ, bidi marks)
const MARK = /[\p{Mn}\p{Me}\p{Cf}]/u;
const SPACING_MARK = /\p{Mc}/u;

/** Full-width (East Asian wide) code points: Han, kana, Hangul, full-width forms, emoji. */
export function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, symbols and punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // kana, Bopomofo, CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // full-width forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Lines may break before and after these without a space: Han and kana (Hangul and emoji wrap at spaces). */
const isCjkBreak = (cp) => isWide(cp) && cp < 0x1f300 && !(cp >= 0xac00 && cp <= 0xd7a3) && !(cp >= 0x1100 && cp <= 0x115f);

// Kinsoku: a line never starts with closing punctuation or small kana, never ends with an opening bracket
const NO_START = new Set('、。，．,.・：；？！!?)ー〜～」』）】〕〉》〗〙〛］｝”’ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ…‥%％');
const NO_END = new Set('「『（【〔〈《〖〘〚［｛“‘(');
// Quick test: a word without any Han or kana is one unit
const HAS_CJK = /[\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;

function charEm(ch) {
  if (ch === ' ') return 0.28;
  if (NARROW.has(ch)) return 0.3;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.66;
  if (ch >= '0' && ch <= '9') return 0.56;
  const cp = ch.codePointAt(0);
  if (cp < 0x300) return 0.53;
  if (MARK.test(ch)) return 0;
  if (isWide(cp)) return cp >= 0x1f300 ? 1.15 : 1.0;
  if (SPACING_MARK.test(ch)) return 0.38; // Devanagari ा ी ो and similar
  if (cp >= 0x0900 && cp <= 0x0dff) return 0.66; // Devanagari, Bengali, Tamil and other Indic scripts
  if ((cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return 0.5; // Hebrew, Arabic
  if (cp >= 0x0e00 && cp <= 0x0eff) return 0.58; // Thai, Lao
  return 0.56;
}

const monoEm = (ch) => (MARK.test(ch) ? 0 : isWide(ch.codePointAt(0)) ? 1.0 : 0.6);

export function textWidth(str, fontSize, { weight = 400, mono = false } = {}) {
  const s = String(str ?? '');
  let em = 0;
  if (mono) {
    for (const ch of s) em += monoEm(ch);
    return em * fontSize;
  }
  for (const ch of s) em += charEm(ch);
  return em * fontSize * (weight >= 600 ? 1.05 : 1);
}

/**
 * Break units: words between spaces, and inside a word one unit per Han or
 * kana character, so CJK text without spaces wraps between characters.
 * `sp` says whether a space joins the unit to the one before it.
 */
function breakUnits(str) {
  const units = [];
  let last = null;
  for (const word of String(str ?? '').trim().split(/\s+/).filter(Boolean)) {
    if (!HAS_CJK.test(word)) {
      last = { text: word, sp: units.length > 0, cjk: false, end: '' };
      units.push(last);
      continue;
    }
    let first = true;
    for (const ch of word) {
      const cjk = isCjkBreak(ch.codePointAt(0));
      if (!first && (NO_START.has(ch) || NO_END.has(last.end) || (!cjk && !last.cjk))) {
        last.text += ch;
      } else {
        last = { text: ch, sp: first && units.length > 0 };
        units.push(last);
      }
      last.cjk = cjk;
      last.end = ch;
      first = false;
    }
  }
  return units;
}

/**
 * Greedy word wrap. Returns at most maxLines lines; the last line gets an
 * ellipsis when text is cut. Linear in the text length: words too long for a
 * line are cut by accumulating character widths, and wrapping stops as soon
 * as the text is known to overflow maxLines.
 */
export function wrapText(str, maxWidth, fontSize, opts = {}, maxLines = Infinity) {
  const lines = [];
  let line = '';
  const fits = (s) => textWidth(s, fontSize, opts) <= maxWidth;
  const full = () => lines.length > maxLines;

  for (const unit of breakUnits(str)) {
    if (full()) break;
    let word = unit.text;
    // Hard-break words that cannot fit on a line of their own
    if (!fits(word)) {
      if (line) { lines.push(line); line = ''; }
      const pieces = hardBreak(word, maxWidth, fontSize, opts, maxLines - lines.length + 1);
      word = pieces.pop();
      lines.push(...pieces);
      if (full()) break;
    }
    const candidate = line ? `${line}${unit.sp ? ' ' : ''}${word}` : word;
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
    const last = [...kept[maxLines - 1]];
    while (last.length > 1 && !fits(`${last.join('')}…`)) last.pop();
    kept[maxLines - 1] = `${last.join('').trimEnd()}…`;
    return kept;
  }
  return lines;
}

/**
 * Cut one long word into pieces that each fit maxWidth (at least one
 * character per piece). The last piece is returned unfinished so the caller
 * can continue the line with it. Stops after `limit` full pieces. A
 * zero-width mark never starts a piece, so it stays with its base letter.
 */
function hardBreak(word, maxWidth, fontSize, opts, limit) {
  const chars = [...word];
  const scale = opts.mono ? fontSize : fontSize * ((opts.weight ?? 400) >= 600 ? 1.05 : 1);
  const pieces = [];
  let start = 0;
  let em = 0;
  for (let k = 0; k < chars.length; k++) {
    const w = opts.mono ? monoEm(chars[k]) : charEm(chars[k]);
    if (k > start && w > 0 && (em + w) * scale > maxWidth) {
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
