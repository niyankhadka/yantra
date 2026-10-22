/**
 * The prompt the playground's "Copy prompt" button puts on the clipboard. A pure function
 * (no DOM, no imports) so tests can run it: the instructions (chat/prompt.md) followed by
 * what the editor holds.
 *
 *   empty editor             -> instructions + "Describe what you want: ..."
 *   valid JSON, no findings  -> instructions + the JSON + "Change this diagram (page): ..."
 *   errors or warnings       -> instructions + the JSON + the findings + "Fix these problems ..."
 *
 * The parts after the instructions are in English, like the instructions themselves.
 */

export const PLACEHOLDER = '<your request here>';
/** Findings listed in the prompt; the rest are counted. */
export const MAX_FINDINGS = 20;
/** Above this many characters the JSON is copied without indentation. */
export const COMPACT_ABOVE = 40_000;
/** Above this many characters the whole prompt is flagged as large (some chats cut it). */
export const LARGE_PROMPT = 60_000;

const WHERE_KEYS = ['diagram', 'mode', 'block', 'step', 'node', 'edge', 'group', 'role'];

/** "node api, edge api-db" from a finding's context fields. */
function whereOf(f) {
  return WHERE_KEYS.filter((k) => f[k] !== undefined && f[k] !== null && f[k] !== '')
    .map((k) => `${k} ${f[k]}`)
    .join(', ');
}

function findingLine(level, f) {
  const where = whereOf(f);
  return `- ${level} \`${f.code}\`${where ? ` (${where})` : ''}: ${String(f.message || '').replace(/\s+/g, ' ').trim()}`;
}

/** A fence longer than any run of backticks inside the text. */
function fence(text, lang) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

/**
 * Build the prompt.
 * @param {object} o
 * @param {string} o.instructions  chat/prompt.md
 * @param {string} [o.text]        the editor text (used as is when it is not valid JSON)
 * @param {*} [o.value]            the parsed JSON, when the text parsed
 * @param {Error|string} [o.jsonError] the parse error, when it did not
 * @param {{errors: object[], warnings: object[]}} [o.report] lint() of `value`
 * @param {string} [o.request]     what the user wants; replaces the placeholder
 * @param {boolean} [o.instructionsOnly] copy the instructions alone
 * @returns {{ text: string, mode: 'new'|'edit'|'fix', kind: 'diagram'|'page'|null, findings: number, large: boolean, compact: boolean }}
 */
export function buildPrompt({ instructions, text = '', value, jsonError, report, request = '', instructionsOnly = false }) {
  const base = String(instructions || '').trim();
  const ask = String(request || '').trim() || PLACEHOLDER;
  const result = (body, extra) => {
    const out = `${body.trimEnd()}\n`;
    return { text: out, findings: 0, compact: false, kind: null, ...extra, large: out.length > LARGE_PROMPT };
  };
  if (instructionsOnly) return result(base, { mode: 'new' });

  const hasValue = value !== undefined && !jsonError;
  if (!hasValue && !String(text).trim()) return result(`${base}\n\n---\n\nDescribe what you want: ${ask}`, { mode: 'new' });

  const kind = hasValue && value && typeof value === 'object' && (value.kind === 'page' || value.kind === 'book') ? value.kind : 'diagram';
  const noun = { page: 'answer page', book: 'book' }[kind] || 'diagram';
  let json = hasValue ? JSON.stringify(value, null, 2) : String(text).trim();
  let compact = false;
  if (hasValue && json.length > COMPACT_ABOVE) {
    json = JSON.stringify(value);
    compact = true;
  }

  const items = [];
  if (!hasValue) items.push(['error', { code: 'json/syntax', message: `Not valid JSON: ${jsonError?.message || jsonError || 'parse error'}` }]);
  for (const f of report?.errors || []) items.push(['error', f]);
  for (const f of report?.warnings || []) items.push(['warning', f]);

  const parts = [base, '---', `## My current ${noun}`, fence(json, hasValue ? 'json' : '')];
  if (!items.length) {
    parts.push(`Change this ${noun}: ${ask}`, 'Reply with the full updated JSON in one ```json block.');
    return result(parts.join('\n\n'), { mode: 'edit', kind, compact });
  }
  const errors = items.filter(([l]) => l === 'error').length;
  const warnings = items.length - errors;
  const counts = [errors && `${errors} error${errors === 1 ? '' : 's'}`, warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  const lines = items.slice(0, MAX_FINDINGS).map(([l, f]) => findingLine(l, f));
  if (items.length > MAX_FINDINGS) lines.push(`- ...and ${items.length - MAX_FINDINGS} more.`);
  parts.push(`## Validation findings (${counts})`, lines.join('\n'), 'Fix these problems and return the full corrected JSON in one ```json block.');
  if (ask !== PLACEHOLDER) parts.push(`Also: ${ask}`);
  return result(parts.join('\n\n'), { mode: 'fix', kind, compact, findings: items.length });
}
