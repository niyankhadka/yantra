/**
 * Interface strings for the viewer, answer pages and exports, selected by
 * `meta.lang` (BCP 47) with English fallback, plus `meta.strings` overrides.
 * Pure data and functions (no DOM), shared by the browser, CLI, MCP and tests.
 *
 * The English table lives here; every other language is a module in
 * ./locales/ (one file each). A built single-file HTML carries only English plus
 * the languages its payload uses: the app bundle is built without ./locales/
 * (see vite.config.js), lib/build.js embeds the tables it needs and
 * registerStrings() adds them at load. Node (CLI, MCP, tests) always has them all.
 *
 * Placeholders are written {name}. Keyboard keys (Space, Esc, Home...) and the
 * brand names Yantra and GitHub are never translated.
 */

import { TABLES } from './locales/index.js';

/** Primary subtags written right to left; meta.dir overrides. */
export const RTL_LANGS = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ckb', 'dv', 'ug'];

const en = {
  // Toolbar and header
  'app.untitled': 'Untitled diagram',
  'app.examples': 'Example diagram',
  'app.galleryDiagrams': 'Diagrams',
  'app.galleryPages': 'Answer pages (Q&A)',
  'app.galleryCharts': 'Charts & dashboards',
  'app.mode': 'Mode',
  'app.view': 'View',
  'view.flow': 'Flow',
  'view.flowTip': 'Flow: the system as a graph',
  'view.sequence': 'Sequence',
  'view.sequenceTip': 'Sequence: messages in time order',
  'view.flowToast': 'Flow view',
  'view.sequenceToast': 'Sequence view',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.fit': 'Fit to screen',
  'inspector.title': 'Inspector',
  'inspector.toggle': 'Toggle inspector',
  'inspector.sections': 'Inspector sections',
  'inspector.close': 'Close inspector',
  'theme.title': 'Light / dark',
  'theme.toggle': 'Toggle theme',
  'export.title': 'Export',
  'export.png': 'PNG image',
  'export.svg': 'SVG vector',
  'export.html': 'Standalone HTML',
  'export.md': 'Markdown spec',
  'export.json': 'Copy JSON with positions',
  'export.reset': 'Reset layout',
  'help.title': 'Keyboard shortcuts',
  'help.close': 'Close keyboard shortcuts',
  'common.close': 'Close',
  'canvas.label': 'Diagram canvas',
  // Roles legend
  'legend.title': 'Roles',
  'legend.label': 'Roles legend',
  'legend.filter': 'Filter by role',
  'legend.all': 'All roles',
  'legend.showing': 'Showing: {role}',
  'legend.labelShowing': 'Roles legend, showing {role}',
  // Walkthrough (storyboard)
  'story.label': 'Walkthrough',
  'story.steps': 'Steps',
  'story.scenario': 'Scenario',
  'story.scenarioN': 'Scenario {n}',
  'story.follow': 'Camera follows each step',
  'story.followOff': 'Camera stays where you put it',
  'story.present': 'Present full screen',
  'story.collapse': 'Collapse',
  'story.collapseLabel': 'Collapse walkthrough',
  'story.expand': 'Expand',
  'story.more': 'Show more',
  'story.less': 'Show less',
  'story.restart': 'Back to the first step',
  'story.play': 'Play',
  'story.pause': 'Pause',
  'story.replay': 'Replay',
  'story.autoplay': 'Autoplay',
  'story.speed': 'Autoplay speed',
  'story.back': 'Back',
  'story.next': 'Next',
  'story.prevStep': 'Previous step',
  'story.nextStep': 'Next step',
  'story.step': 'Step {n}',
  'story.stepOf': 'Step {n} of {total}: {title}',
  'story.empty': 'No steps in this scenario',
  // Inspector
  'tab.summary': 'Summary',
  'tab.step': 'Step',
  'tab.node': 'Details',
  'summary.components': 'Components',
  'summary.connections': 'Connections',
  'summary.steps': 'Steps',
  'summary.modes': 'Modes',
  'summary.points': 'Key points',
  'summary.facts': 'Facts',
  'summary.roles': 'Roles',
  'summary.scenarios': 'Scenarios',
  'step.none': 'This diagram has no walkthrough steps.',
  'step.payload': 'Payload',
  'step.copy': 'Copy',
  'node.none': 'Select a card to see its details and connections.',
  'node.tech': 'Technology',
  'node.runtime': 'Runtime',
  'node.ports': 'Ports',
  'node.status': 'Status',
  'node.source': 'Source',
  'node.connections': 'Connections',
  'node.noConnections': 'No connections.',
  'panel.for': 'For {name}',
  'panel.showAll': 'Show all cards',
  'panel.hint': 'Select a card to see the items for that component.',
  'panel.empty': 'Nothing recorded for this component.',
  // Keyboard shortcuts dialog
  'help.next': 'Next step',
  'help.prev': 'Previous step',
  'help.play': 'Play / pause',
  'help.ends': 'First / last step',
  'help.follow': 'Camera follows steps',
  'help.view': 'Flow / sequence view',
  'help.scenario': 'Switch scenario',
  'help.mode': 'Next mode',
  'help.inspector': 'Inspector',
  'help.legend': 'Roles legend',
  'help.story': 'Collapse walkthrough',
  'help.fit': 'Fit to screen',
  'help.zoom': 'Zoom',
  'help.theme': 'Light / dark',
  'help.fullscreen': 'Fullscreen',
  'help.clear': 'Clear selection, then back up a level',
  // Toasts
  'toast.payloadCopied': 'Payload copied',
  'toast.jsonCopied': 'JSON copied with current positions',
  'toast.layoutReset': 'Layout reset',
  'toast.buildHint': 'Run `yantra build diagram.json` to produce a standalone file',
  'toast.pngFailed': 'PNG export failed; exported SVG instead',
  'toast.noFullscreen': 'Full screen is not available here',
  // Watermark badge (viewer, pages, SVG)
  'watermark.text': 'Made with Yantra',
  'watermark.title': 'Yantra on GitHub',
  'watermark.label': '{text} – Yantra on GitHub (opens in a new tab)',
  // Answer pages
  'page.answer': 'Answer',
  'page.question': 'Question',
  'page.contents': 'Contents',
  'page.updated': 'Updated {date}',
  'page.theme': 'Toggle light or dark theme',
  'page.recommended': 'Recommended',
  'page.done': 'Done:',
  'page.todo': 'To do:',
  'page.diagram': 'Diagram',
  'page.interactive': '{title} (interactive)',
  'page.diagramMissing': 'Diagram missing.',
  'page.imageOmitted': 'Image omitted: only https: and data:image/ sources are allowed.',
  'page.diagramNote': 'Diagram: {title}',
  'page.seeHtml': 'see the HTML page',
  'page.image': 'Image: {alt}',
  // SVG and Markdown exports
  'export.diagram': 'Diagram',
  'md.component': 'Component',
  'md.role': 'Role',
  'md.description': 'Description',
  'md.groups': 'Groups',
  'md.group': 'Group',
  'md.inside': 'Inside',
  'md.members': 'Members',
  'md.groupSuffix': '{name} (group)',
  'md.from': 'From',
  'md.to': 'To',
  'md.label': 'Label',
  'md.hides': 'hides: {list}',
  'md.version': 'Version {v}',
  'export.mdAll': 'Markdown, all levels',
  'help.drill': "Open the card's detail diagram",
  'drill.crumbs': 'Diagram levels',
  'drill.back': 'Back to {title}',
  'drill.open': 'Open detail: {title}',
  'drill.cardHint': 'opens a detail diagram',
  'drill.opened': 'Opened {title}',
  'drill.details': 'Detail diagrams',
  'drill.link': 'Open link',
  'drill.newTab': '(opens in a new tab)',
  'drill.edgeLink': 'Open link for {label}',
  'drill.overview': 'Overview',
  'drill.hasDetail': 'Has a detail diagram',
  'card.more': '+ {n} more',
  'md.fields': 'Fields',
  'md.methods': 'Methods',
  'md.field': 'Field',
  'md.method': 'Method',
  'md.type': 'Type',
  'md.returns': 'Returns',
  'md.key': 'Key',
  'md.visibility': 'Visibility',
  'md.notes': 'Notes',
  'md.nullable': 'nullable',
  'md.static': 'static',
  'md.abstract': 'abstract',
  'vis.public': 'public',
  'vis.private': 'private',
  'vis.protected': 'protected',
  'vis.package': 'package',
  'md.direction': 'Direction',
  'md.relationship': 'Relationship',
  'md.both': 'both ways',
  'md.undirected': 'undirected',
  'md.selfLoop': 'self-loop',
  'md.link': 'link',
  'md.more': 'More: {url}',
  'md.detail': 'detail: {title}',
  'end.one': 'exactly one',
  'end.zero-or-one': 'zero or one',
  'end.many': 'many',
  'end.one-or-many': 'one or more',
  'end.zero-or-many': 'zero or more',
  'end.any': 'any',
  'end.between': '{a} to {b}',
  'chart.total': 'Total',
  'chart.today': 'Today',
  'chart.day': 'Day {n}',
  'chart.day1': '{n} day',
  'chart.days': '{n} days',
  'chart.trend': 'trend',
  'chart.value': 'Value',
  'chart.share': 'Share',
  'chart.task': 'Task',
  'chart.group': 'Group',
  'chart.start': 'Start',
  'chart.end': 'End',
  'chart.after': 'After',
  'chart.milestone': 'Milestone',
  'chart.item': 'Item',
  'chart.noData': 'No data to chart.',
  'chart.series': 'Series {n}',
  'chart.more': '+{n} more',
  'chart.topLeft': 'Top left',
  'chart.topRight': 'Top right',
  'chart.bottomLeft': 'Bottom left',
  'chart.bottomRight': 'Bottom right',
  'chart.kind.bar': 'Bar chart',
  'chart.kind.column': 'Column chart',
  'chart.kind.line': 'Line chart',
  'chart.kind.area': 'Area chart',
  'chart.kind.pie': 'Pie chart',
  'chart.kind.donut': 'Donut chart',
  'chart.kind.gantt': 'Gantt chart',
  'chart.kind.matrix': 'Matrix',
  'chart.kind.heat': 'Heat map',
  'chart.kind.trend': 'Trend',
  'chart.point1': '{n} point',
  'chart.points': '{n} points',
  'chart.seriesCount': '{n} series',
  'chart.summary': '{kind}, {points}; values in the table that follows.',
  'chart.kind.ring': 'Progress ring',
  'chart.kind.bullet': 'Bullet chart',
  'chart.target': 'Target',
  'chart.remaining': 'Remaining',
  'node.chart': 'Chart',
  'help.fold': 'Fold / unfold selected branch',
  'fold.expand': 'Expand {title} ({n} hidden)',
  'fold.collapse': 'Collapse {title}',
  'fold.folded': 'Folded',
  'fold.expanded': 'Expanded',
  'fold.badge': 'Group',
  'fold.card': '{n} card folded',
  'fold.cards': '{n} cards folded',
  'fold.cardCount1': '{n} card',
  'fold.cardCount': '{n} cards',
  'fold.groupCount1': '{n} group',
  'fold.groupCount': '{n} groups',
  'depth.title': 'Fold to depth',
  'depth.level1': '{n} level open',
  'depth.level': '{n} levels open',
  'depth.none': 'Everything folded',
  'depth.all': 'Everything open',
  'help.depth': 'Fold to depth (0 opens everything)',
  'focus.crumbs': 'Group path',
  'focus.whole': 'Whole diagram',
  'focus.hint': 'Double-click to zoom to {title}',
  'focus.focused': 'Zoomed to {title}',
  'help.focus': "Zoom to the selected card's group (Esc zooms out)",
  'help.gWalk': 'Walkthrough',
  'help.gNav': 'Navigate',
  'help.gView': 'View',
  'help.gFold': 'Fold & depth',
  'help.gDrill': 'Drill-down & focus',
  'help.gPointer': 'Mouse & touch',
  'help.panel': 'Show or hide this panel',
  'help.footer': 'Press ? to show or hide this panel. Toolbar buttons show their key in the tooltip.',
  'help.click': 'Click a card',
  'help.clickDo': 'Select it',
  'help.dragCard': 'Drag a card',
  'help.dragCardDo': 'Move it; edges re-route live',
  'help.dragBg': 'Drag the background',
  'help.dragBgDo': 'Pan',
  'help.wheel': 'Scroll or pinch',
  'help.wheelDo': 'Zoom',
  'help.dblGroup': 'Double-click a group title',
  'help.dblGroupDo': 'Zoom to the group',
  'help.dblCard': 'Double-click a card',
  'help.dblCardDo': 'Open its detail diagram',
  'drill.more': 'Show {n} hidden levels'
};

/** Every shipped language, in table order; each table has exactly the keys of `en` (a test checks this). */
export const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'hi', 'bn', 'ne', 'zh', 'zh-Hant', 'ja', 'ko', 'id', 'ar', 'he', 'fa', 'ur'];
/** Loaded tables: all of them in Node and the dev viewer; English plus the embedded ones in a built file. */
export const STRINGS = { en, ...TABLES };
export const STRING_KEYS = Object.keys(en);

/** CLDR plural categories a table may add to a counted key, e.g. "chart.days.two" (see plural() below). */
export const PLURAL_FORMS = ['zero', 'two', 'few', 'many'];
const PLURAL_KEY = new RegExp(`^(.+)\\.(${PLURAL_FORMS.join('|')})$`);
/** True for an optional plural variant of a counted key ("chart.days.few"). */
export const isPluralKey = (key) => {
  const m = PLURAL_KEY.exec(key);
  return !!m && Object.hasOwn(en, m[1]) && en[m[1]].includes('{n}');
};

/** Add tables at run time (a built file's embedded languages, the gallery's full set). Unknown languages are ignored. */
export function registerStrings(tables) {
  if (!tables || typeof tables !== 'object') return;
  for (const [lang, table] of Object.entries(tables))
    if (lang !== 'en' && LANGUAGES.includes(lang) && table && typeof table === 'object' && !Array.isArray(table)) STRINGS[lang] = table;
}

/** Loose BCP 47 shape: a 2-3 letter language, then subtags of 1-8 letters or digits. */
export const isLangTag = (tag) => typeof tag === 'string' && /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(tag);

/** Primary language subtag, lower-cased ("pt-BR" -> "pt"); "" when the tag is not usable. */
export const primaryLang = (tag) => (isLangTag(tag) ? tag.split('-')[0].toLowerCase() : '');

// Chinese: Traditional for the Hant script, and for Taiwan, Hong Kong and Macau unless Hans is given
const HANT_REGIONS = ['tw', 'hk', 'mo'];

/** Built-in table for a tag ("pt-BR" -> "pt", "zh-TW" -> "zh-Hant"), or null (the caller falls back to English). */
export const shippedLang = (tag) => {
  const p = primaryLang(tag);
  if (!p) return null;
  if (p === 'zh') {
    const sub = tag.toLowerCase().split('-').slice(1);
    return sub.includes('hant') || (!sub.includes('hans') && sub.some((s) => HANT_REGIONS.includes(s))) ? 'zh-Hant' : 'zh';
  }
  return LANGUAGES.includes(p) ? p : null;
};

/** The shipped tables a list of language tags needs, English left out: { he: {...} }. */
export function stringsFor(tags) {
  const out = {};
  for (const tag of tags || []) {
    const ui = shippedLang(tag);
    if (ui && ui !== 'en' && STRINGS[ui]) out[ui] = STRINGS[ui];
  }
  return out;
}

/** 'rtl' for RTL languages or meta.dir "rtl"; meta.dir "ltr" forces left to right. */
export function textDir(lang, dir) {
  if (dir === 'rtl' || dir === 'ltr') return dir;
  return RTL_LANGS.includes(primaryLang(lang)) ? 'rtl' : 'ltr';
}

const FORMATS = new Map();
function numberFormat(lang, opts) {
  const key = `${lang}|${JSON.stringify(opts || {})}`;
  if (!FORMATS.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat(lang, opts);
    } catch {
      f = new Intl.NumberFormat('en', opts);
    }
    FORMATS.set(key, f);
  }
  return FORMATS.get(key);
}

const RULES = new Map();
function pluralRules(lang) {
  if (!RULES.has(lang)) {
    let r;
    try {
      r = new Intl.PluralRules(lang);
    } catch {
      r = new Intl.PluralRules('en');
    }
    RULES.set(lang, r);
  }
  return RULES.get(lang);
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m)) : s);
const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Locale for a payload's meta: { lang, dir, ui, overrides, t, tHtml, num, plural }.
 *   lang  the tag written to <html lang> / xml:lang ("en" when missing or malformed)
 *   ui    the built-in table used for interface strings (English when not shipped or not loaded)
 *   t(key, vars)      plain text; meta.strings overrides the table
 *   tHtml(key, vars)  escaped template; vars are inserted as given (already HTML)
 *   num(value, opts)  Intl.NumberFormat in the page language (non-numbers pass through)
 *   plural(n, oneKey, otherKey, vars)  counted text by Intl.PluralRules: category "one"
 *         uses oneKey; zero/two/few/many use "<otherKey>.<category>" when the table or
 *         meta.strings has it; anything else uses otherKey
 */
export function localeOf(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const lang = isLangTag(m.lang) ? m.lang : 'en';
  const shipped = shippedLang(lang);
  const ui = shipped && STRINGS[shipped] ? shipped : 'en';
  const table = STRINGS[ui];
  const overrides = m.strings && typeof m.strings === 'object' && !Array.isArray(m.strings) ? m.strings : {};
  const own = (key) => Object.hasOwn(overrides, key) && typeof overrides[key] === 'string';
  const raw = (key) => (own(key) ? overrides[key] : Object.hasOwn(table, key) ? table[key] : Object.hasOwn(en, key) ? en[key] : key);
  const t = (key, vars) => fill(raw(key), vars);
  return {
    lang,
    ui,
    overrides,
    dir: textDir(lang, m.dir),
    t,
    tHtml: (key, vars) => fill(escape(raw(key)), vars),
    num: (value, opts) => (typeof value === 'number' && Number.isFinite(value) ? numberFormat(lang, opts).format(value) : value),
    plural: (n, oneKey, otherKey, vars) => {
      const cat = typeof n === 'number' && Number.isFinite(n) ? pluralRules(ui === 'en' ? 'en' : lang).select(n) : 'other';
      if (cat === 'one') return t(oneKey, vars);
      const form = `${otherKey}.${cat}`;
      return t(PLURAL_FORMS.includes(cat) && (own(form) || Object.hasOwn(table, form)) ? form : otherKey, vars);
    }
  };
}
