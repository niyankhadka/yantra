/**
 * Translated validator messages, for people reading `yantra validate --lang xx`
 * or the MCP validate tool with `lang`. Codes and the English messages stay the
 * stable interface for tooling; translation only rewrites `message` (the English
 * text moves to `messageEn`) for the most common codes, the content/, story/,
 * ref/ and i18n/ ones listed in LINT_EN. Every other message stays in English.
 *
 * Each English message is matched against its template here ({name} captures a
 * value), and the same values fill the language's template from the `LINT`
 * export of src/core/locales/<lang>.js. Prefixes added for detail diagrams and
 * page blocks ("diagrams.pay: ", "blocks[2] (diagram): ") are kept as they are.
 * Node-only: the viewer bundle does not import this module.
 */
import { LINT_TABLES } from './locales/index.js';
import { shippedLang } from './i18n.js';

/**
 * English templates by message key: a code, or "code#variant" when one code has
 * several wordings. An array lists extra English forms of the same message
 * (e.g. singular and plural); the first one is the canonical text.
 */
export const LINT_EN = {
  'content/summary-too-long': 'meta.summary has {n} points; keep it to 3-5.',
  'content/text-too-long#node': 'Node "{id}" {field} is over {max} chars and is cut on the card; move detail to description.',
  'content/text-too-long#edge': 'Edge "{id}" label is over {max} chars and is cut on the card; move detail to description.',
  'content/text-too-long#group': 'Group "{id}" title is over {max} chars and is cut on the card; move detail to description.',
  'content/unknown-color#role': 'Role "{role}" color "{color}" is not one of {list}; a palette colour is used.',
  'content/unknown-color#group': 'Group "{id}" color "{color}" is not one of {list}; slate is used.',
  'content/unknown-icon#role': 'Role "{role}" icon "{icon}" is not built in; a default is used.',
  'content/unknown-icon#node': 'Node "{id}" icon "{icon}" is not built in; a default is used.',
  'content/title-too-long': 'Node "{id}" title is {n} chars; keep titles under {max} and move detail to subtitle/description.',
  'content/title-too-long#wide': 'Node "{id}" title is {n} columns wide (full-width characters count as 2); keep titles under {max} columns and move detail to subtitle/description.',
  'content/edge-missing-label': 'Edge "{id}" has no label; say what flows along it.',
  'content/label-too-long': 'Edge "{id}" label is {n} chars; keep labels under {max}.',
  'content/label-too-long#wide': 'Edge "{id}" label is {n} columns wide (full-width characters count as 2); keep labels under {max} columns.',
  'content/too-many-fields': 'Node "{id}" has {n} fields and methods; the card shows {max} and "+ N more". Keep the columns that explain the relationships and list the rest in description.',
  'content/duplicate-field': 'Node "{id}" lists field "{field}" twice.',
  'story/initial-has-incoming': 'Initial state "{id}" has an incoming edge; point transitions at the first real state instead.',
  'story/final-has-outgoing': 'Final state "{id}" has an outgoing edge; nothing leaves a final state.',
  'story/choice-needs-branches': [
    'Choice "{id}" has {n} outgoing edges; a choice needs two or more guarded branches.',
    'Choice "{id}" has {n} outgoing edge; a choice needs two or more guarded branches.'
  ],
  'story/edge-endpoint-dimmed': 'Scenario "{scenario}" step {n} highlights edge "{edge}" but not both of its nodes.',
  'story/no-steps': 'No walkthrough steps: add scenarios[].steps so the diagram tells a story.',
  'ref/node-missing-id': 'nodes[{i}] has no id.',
  'ref/edge-missing-id': 'edges[{i}] has no id.',
  'ref/duplicate-node-id': 'Duplicate node id "{id}".',
  'ref/duplicate-edge-id': 'Duplicate edge id "{id}".',
  'ref/edge-unknown-source': 'Edge "{id}" source "{ref}" is not a node.',
  'ref/edge-unknown-target': 'Edge "{id}" target "{ref}" is not a node.',
  'ref/collapsed-unknown': 'meta.layout.collapsed lists "{id}", which is neither a node nor a group.',
  'ref/default-mode-unknown': 'meta.defaultMode "{id}" is not a mode id.',
  'ref/mode-unknown-node': 'Mode "{mode}" hides unknown node "{id}".',
  'ref/mode-unknown-edge': 'Mode "{mode}" hides unknown edge "{id}".',
  'ref/step-unknown-node': 'Scenario "{scenario}" step {n} highlights unknown node "{id}".',
  'ref/step-unknown-edge': 'Scenario "{scenario}" step {n} highlights unknown edge "{id}".',
  'ref/inspector-unknown-tab': 'meta.inspector.tabs lists "{id}", which is neither {list} nor a panel id.',
  'ref/inspector-unknown-click-target': 'meta.inspector.onNodeClick is "{id}"; use "node", "stay" or a panel id.',
  'ref/inspector-click-tab-hidden': 'meta.inspector.onNodeClick targets "{id}", which meta.inspector.tabs does not show.',
  'ref/panel-unknown-node': 'panels[{i}].blocks[{j}] lists unknown node "{id}" in nodes.',
  'ref/field-unknown-ref#field': 'Node "{id}" field "{field}" refers to "{ref}", which is not a field of that node; use "nodeId" or "nodeId.field".',
  'ref/field-unknown-ref#node': 'Node "{id}" field "{field}" refers to "{ref}", which is not a node; use "nodeId" or "nodeId.field".',
  'i18n/bad-lang': 'meta.lang "{lang}" is not a BCP 47 tag such as "en", "pt-BR" or "zh-Hans"; "en" is used.',
  'i18n/unknown-lang': 'meta.lang "{lang}" has no built-in interface strings ({list}); English labels are used. Translate them with meta.strings.'
};

/** Message keys (LINT_EN keys); every language's LINT table has exactly these (a test checks). */
export const LINT_KEYS = Object.keys(LINT_EN);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUMERIC = new Set(['n', 'max', 'i', 'j']);

/** Template -> RegExp matching the end of a message, {name} as a named group. */
function pattern(template) {
  const src = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      return m ? `(?<${m[1]}>${NUMERIC.has(m[1]) ? '\\d+' : '[\\s\\S]*?'})` : escapeRe(part);
    })
    .join('');
  return new RegExp(`(?:^|: )${src}$`);
}

const PATTERNS = new Map();
for (const [key, t] of Object.entries(LINT_EN)) {
  const code = key.split('#')[0];
  if (!PATTERNS.has(code)) PATTERNS.set(code, []);
  for (const form of Array.isArray(t) ? t : [t]) PATTERNS.get(code).push({ key, re: pattern(form) });
}

/** Languages with translated validator messages (English is the default). */
export const LINT_LANGUAGES = ['en', ...Object.keys(LINT_TABLES)];

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : m));

/** One message in a language, or null when the code is not translated or the text does not match. */
export function translateMessage(code, message, lang) {
  const ui = shippedLang(lang);
  const table = ui && ui !== 'en' ? LINT_TABLES[ui] : null;
  if (!table || typeof message !== 'string') return null;
  for (const { key, re } of PATTERNS.get(code) || []) {
    const m = re.exec(message);
    if (!m || typeof table[key] !== 'string') continue;
    const start = m[0].startsWith(': ') ? m.index + 2 : m.index;
    return message.slice(0, start) + fill(table[key], m.groups || {});
  }
  return null;
}

/**
 * Validation result with messages in a language: each translated finding gets the
 * new `message` and keeps the English one as `messageEn`; untranslated findings
 * and English ("en", missing or unknown lang) come back unchanged.
 */
export function localizeFindings(result, lang) {
  if (!result || !shippedLang(lang) || shippedLang(lang) === 'en') return result;
  const tr = (f) => {
    const message = translateMessage(f.code, f.message, lang);
    return message === null ? f : { ...f, message, messageEn: f.message };
  };
  return { ...result, errors: (result.errors || []).map(tr), warnings: (result.warnings || []).map(tr) };
}
