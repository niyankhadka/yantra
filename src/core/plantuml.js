/**
 * PlantUML import: sequence diagrams become a sequence-view payload; component,
 * deployment and use-case diagrams (`[A] --> [B] : label`) and activity
 * diagrams (start/stop, :action;, if/else, while, repeat, fork, swimlanes)
 * become flow payloads. Pure (no DOM, no Node APIs) and dependency-free.
 *
 *   fromPlantUml(text, { title? })  -> { payload, warnings: string[] }
 *   plantUmlBlocks(text)            -> string[]   (@startuml ... @enduml bodies)
 *
 * Best effort, like the Mermaid importer: anything unsupported is skipped with
 * one warning per kind.
 */
import { buildFlow, buildSequence, ignoredCollector, decodeEntities, tidy, slug } from './importkit.js';
import { fromMermaid } from './mermaid.js';
import { ganttPage } from './importcharts.js';
import { fmtDay, parseDay } from './charts.js';

const IGNORED_WHY = {
  skinparam: 'styling comes from roles',
  style: 'styling comes from roles',
  hide: 'not imported',
  show: 'not imported',
  note: 'notes on diagrams are not imported',
  legend: 'not imported',
  header: 'not imported',
  footer: 'not imported',
  caption: 'not imported',
  '!preprocessor': 'includes, themes and macros are not expanded',
  destroy: 'lifelines are not drawn',
  create: 'participants are created on first use',
  newpage: 'pages are merged',
  'found/lost message': 'messages from or to outside the diagram are not drawn',
  delay: 'not drawn',
  backward: 'repeat loops go straight back to their first action',
  detach: 'treated as an end of the branch',
  connector: 'goto-style connectors are not imported',
  together: 'layout is automatic',
  'arrow direction hint': 'layout is automatic'
};

/** Every @startuml ... @enduml body (the whole text when there are no markers). */
export function plantUmlBlocks(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const out = [];
  const re = /^[ \t]*@startuml\b[^\n]*\n([\s\S]*?)^[ \t]*@enduml\b/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out.length ? out : /@start(?!uml)\w+/.test(src) ? [] : [src];
}

/** Strip comments; keep 1-based line numbers (relative to the block). */
function preprocess(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\/'[\s\S]*?'\//g, (c) => c.replace(/[^\n]/g, ''));
  const lines = [];
  src.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line && !line.startsWith("'") && !/^@(start|end)uml\b/.test(line)) lines.push({ text: line, no: i + 1 });
  });
  return lines;
}

/** Plain text from a PlantUML label: `\n`, creole markup and HTML-ish tags removed. */
export function umlText(raw) {
  return tidy(
    decodeEntities(
      String(raw ?? '')
        .replace(/^"([\s\S]*)"$/, '$1')
        .replace(/\\n/g, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[a-z]+(?::[^>]*)?>/gi, '')
        .replace(/<<[^>]*>>/g, '')
        .replace(/\[\[[^\]]*\]\]/g, '')
        .replace(/(\*\*|\/\/|""|__|--|~~)(.+?)\1/g, '$2')
    )
  );
}

const SEQ_ONLY = /^(participant|boundary|control|collections|autonumber|activate|deactivate|return|alt|opt|loop|par|break|critical|ref\s+over|==.*==$|\.\.\.|\|\|\|)/;
const COMPONENT_KW = 'component|usecase|actor|node|database|cloud|package|rectangle|folder|frame|artifact|storage|interface|card|file|agent|queue|stack|hexagon|boundary|control|entity|collections|person|circle|label';
const COMPONENT_SIGNAL = new RegExp(`^(${COMPONENT_KW.replace(/\|actor|\|database|\|queue|\|boundary|\|control|\|entity|\|collections/g, '')})\\s|^(left to right|top to bottom) direction$|^\\[[^\\]*]+\\]|^\\([^)]+\\)|^:[^:]+:|[-.]>?\\s*(\\[[^\\]]+\\]|\\([^)]+\\))|\\{$|^allowmixing$`);
const ACTIVITY_SIGNAL = /^(start|stop)$|^:|^(if|while|switch)\s*\(|^repeat\b|^fork$|^split$|^\|[^|]+\|(\s*\S.*)?$|^partition\s/;
const STATE_SIGNAL = /\[\*\]|^state\s/;
// `interface X` alone is also a component-diagram element; with a body it is a class
const CLASS_SIGNAL = /^(abstract\s+class|abstract|class|enum|annotation)\s+\S|^interface\s+.*\{$/;
const UNSUPPORTED = /^(json|yaml)\s|^@start(?!uml)/;
const OLD_ACTIVITY_SIGNAL = /\(\*(top)?\)/;
const OBJECT_SIGNAL = /^(object|map)\s+\S/;
const ER_SYMBOL_L = String.raw`\|\||\|o|o\||\}o|\}\|`;
const ER_SYMBOL_R = String.raw`\|\||o\||\|o|o\{|\|\{`;
const ER_LINK = new RegExp(String.raw`^("[^"]+"|[\w.$]+)\s*(${ER_SYMBOL_L})?((?:-+|\.+)(?:\[[^\]]*\]|left|right|up|down|le|ri|do|l|r|u|d)?(?:-*|\.*))(${ER_SYMBOL_R})?\s*("[^"]+"|[\w.$]+)\s*(?::\s*(.*))?$`);
const erLink = (t) => {
  const m = ER_LINK.exec(t);
  return m && (m[2] || m[4]) ? m : null;
};
const ER_SIGNAL = (t) => /^entity\s+.+\{\s*$/.test(t) || !!erLink(t);

export function fromPlantUml(text, opts = {}) {
  const pre = preprocessPlantUml(text, opts);
  const src = pre.text;
  const blocks = plantUmlBlocks(src);
  if (!blocks.length) {
    const kind = /@start(\w+)/.exec(src)?.[1];
    const body = new RegExp(String.raw`^[ \t]*@start${kind}\b[^\n]*\n([\s\S]*?)^[ \t]*@end${kind}\b`, 'm').exec(src);
    const done = (res) => ({ ...res, warnings: [...pre.warnings, ...res.warnings] });
    if ((kind === 'mindmap' || kind === 'wbs') && body) return done(fromOutline(body[1], kind, opts));
    if (kind === 'gantt' && body) return done(fromGantt(body[1], opts));
    throw new Error(`Unsupported PlantUML diagram "@start${kind}". Supported: @startuml (sequence, component / deployment / use case, activity, state, class, object, entity-relationship), @startmindmap, @startwbs, @startgantt.`);
  }
  const lines = preprocess(blocks[0]);
  if (!lines.length) throw new Error('The PlantUML text is empty.');
  const warnings = [...pre.warnings];
  if (blocks.length > 1) warnings.push(`The text has ${blocks.length} @startuml blocks; imported the first (use --all for every block).`);
  const bad = lines.find((l) => UNSUPPORTED.test(l.text));
  if (bad) throw new Error(`Unsupported PlantUML diagram (line ${bad.no}: "${bad.text.split(/\s/)[0]}"). Supported: sequence, component / deployment / use case, activity, state, class, object, entity-relationship.`);
  const ctx = { warnings, title: opts.title };
  const parse = lines.some((l) => OLD_ACTIVITY_SIGNAL.test(l.text))
    ? parseOldActivity
    : lines.some((l) => ER_SIGNAL(l.text))
    ? parseEntities
    : lines.some((l) => OBJECT_SIGNAL.test(l.text)) && !lines.some((l) => CLASS_SIGNAL.test(l.text))
    ? parseObjects
    : lines.some((l) => CLASS_SIGNAL.test(l.text))
    ? parseClass
    : lines.some((l) => STATE_SIGNAL.test(l.text))
    ? parseState
    : lines.some((l) => ACTIVITY_SIGNAL.test(l.text) && !/^\|\|\|$/.test(l.text))
    ? parseActivity
    : !lines.some((l) => SEQ_ONLY.test(l.text)) && lines.some((l) => COMPONENT_SIGNAL.test(l.text) && !/^(skinparam|style|<style>)/i.test(l.text))
      ? parseComponents
      : parseSequence;
  try {
    return parse(lines, ctx);
  } catch (err) {
    throw new Error(`Could not convert the PlantUML text (${err?.message || err}). Simplify the offending line or build the JSON directly.`);
  }
}

// --- shared ----------------------------------------------------------------------

/** Handle lines every diagram kind shares; returns true when consumed. */
function common(line, ctx, ignored, state) {
  let m;
  if ((m = /^title\s*:?\s*(.*)$/i.exec(line))) {
    if (m[1]) ctx.title = ctx.title || umlText(m[1]).replace(/\n/g, ' ');
    else state.skipUntil = /^end\s*title$/i;
    return true;
  }
  if ((m = /^(skinparam|hide|show|header|footer|caption|legend|style)\b/i.exec(line))) {
    const kw = m[1].toLowerCase();
    ignored.add(kw);
    if (kw === 'legend') state.skipUntil = /^end\s*legend$/i;
    else if (kw === 'skinparam' && line.endsWith('{')) state.skipUntil = /^\}$/;
    else if (kw === 'style' && line.endsWith('{')) state.skipUntil = /^\}$/;
    return true;
  }
  if (/^<style>/i.test(line)) {
    ignored.add('style');
    if (!/<\/style>/i.test(line)) state.skipUntil = /^<\/style>$/i;
    return true;
  }
  if (/^!/.test(line)) {
    ignored.add('!preprocessor');
    return true;
  }
  return false;
}

/** Note text, collecting multi-line bodies. Returns { text } or null when not a note. */
function readNote(lines, k) {
  const line = lines[k].text;
  const m = /^(?:floating\s+)?(?:[rh]?note|ref)\b(.*)$/i.exec(line);
  if (!m) return null;
  const colon = m[1].indexOf(':');
  if (colon >= 0) return { text: umlText(m[1].slice(colon + 1)), head: m[1].slice(0, colon), next: k + 1 };
  const body = [];
  let j = k + 1;
  for (; j < lines.length && !/^end\s*([rh]?note|ref)$/i.test(lines[j].text); j++) body.push(lines[j].text);
  return { text: umlText(body.join('\n')).replace(/\n/g, ' '), head: m[1], next: j + 1 };
}

/** "Name" | Name as Alias | "Name" as Alias | Alias as "Name", with stereotypes/colours dropped. */
function nameSpec(spec) {
  const s = spec
    .replace(/\s*<<[^>]*>>/g, '')
    .replace(/\s*\[\[[^\]]*\]\]/g, '')
    .replace(/\s+#[\w#:;.]+/g, '')
    .replace(/\s+order\s+-?\d+$/, '')
    .trim();
  const strip = (x) => x.replace(/^"([\s\S]*)"$/, '$1').replace(/^\[([\s\S]*)\]$/, '$1').replace(/^\(([\s\S]*)\)$/, '$1').replace(/^:([\s\S]*):$/, '$1').trim();
  const m = /^(.+?)\s+as\s+(.+)$/.exec(s);
  if (m) {
    const [a, b] = [m[1].trim(), m[2].trim()];
    if (/^"/.test(b) && !/^"/.test(a)) return { code: strip(a), label: umlText(strip(b)), shape: a };
    return { code: strip(b), label: umlText(strip(a)), shape: a };
  }
  return { code: strip(s), label: umlText(strip(s)), shape: s, implicit: !/^["[(:]/.test(s) };
}

// --- sequence diagrams -------------------------------------------------------------

const PART_KW = /^(?:create\s+)?(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/i;
const SEQ_ARROW = /^("[^"]+"|\[|[^\s"<>\\/\[\]:-]+)\s*(<<?|[ox]<?)?(-{1,2}(?:\[[^\]]*\])?-?)(>>?|\\\\?|\/\/?)?([ox](?=[\s\]"]|$))?\s*(\]|"[^"]+"|[^\s"<>:]+)\s*(\+\+|--|\*\*|!!)?\s*(?::\s*(.*))?$/;

function parseSequence(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const parts = new Map();
  const boxes = [];
  let box = null;
  const blocks = [];
  const messages = [];
  const preNotes = [];
  const state = {};
  let section = null;

  const participant = (code, kind, label) => {
    let p = parts.get(code);
    if (!p) {
      p = { raw: code, label: label || code, kind: kind || 'service' };
      parts.set(code, p);
    }
    // Declared (or first used) inside a box: a member of its first box only
    if (box && !p.boxed) {
      box.members.push(code);
      p.boxed = true;
    }
    if (kind) p.kind = kind;
    if (label) p.label = label;
    return p;
  };
  const ref = (tok) => tok.replace(/^"([\s\S]*)"$/, '$1');
  const addNote = (text) => {
    if (!text) return;
    if (messages.length) messages[messages.length - 1].notes.push(text);
    else preNotes.push(text);
  };

  for (let k = 0; k < lines.length; k++) {
    const { text: line, no } = lines[k];
    if (state.skipUntil) {
      if (state.skipUntil.test(line)) state.skipUntil = null;
      continue;
    }
    let m;
    const note = /^([rh]?note|ref)\b/i.test(line) ? readNote(lines, k) : null;
    if (note) {
      k = note.next - 1;
      if (/^ref/i.test(line)) addNote(note.text ? `See “${note.text}”.` : '');
      else addNote(note.text);
      continue;
    }
    if (common(line, ctx, ignored, state)) continue;
    if ((m = PART_KW.exec(line))) {
      const kw = m[1].toLowerCase();
      const spec = nameSpec(m[2]);
      participant(spec.code, kw === 'actor' ? 'actor' : /database|collections|queue/.test(kw) ? 'store' : 'service', spec.implicit ? undefined : spec.label);
    } else if ((m = /^box\b\s*(.*)$/i.exec(line))) {
      box = { title: umlText(m[1].replace(/\s*#\S+\s*$/, '')), members: [] };
      boxes.push(box);
    } else if (/^end\s*box$/i.test(line)) box = null;
    else if ((m = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/i.exec(line))) blocks.push({ kind: m[1].toLowerCase(), label: umlText(m[2].replace(/^\[|\]$/g, '')) });
    else if ((m = /^else\b\s*(.*)$/i.exec(line))) {
      const b = blocks[blocks.length - 1];
      if (b) b.label = umlText(m[1]) || 'else';
      else warnings.push(`Line ${no}: "else" outside a block.`);
    } else if (/^end(\s+(alt|opt|loop|par|break|critical|group))?$/i.test(line)) {
      if (!blocks.pop()) warnings.push(`Line ${no}: "end" without a block.`);
    } else if ((m = /^==+\s*(.*?)\s*==+$/.exec(line))) section = umlText(m[1]);
    else if (/^(\.\.\.|\|\|\|?|\|\|\d+\|\|)/.test(line) || /^\.\.\..*\.\.\.$/.test(line)) {
      // delays and spacers
    } else if (/^(autonumber|activate|deactivate|autoactivate|hide\s+footbox|mainframe|scale)\b/i.test(line)) {
      // layout-only
    } else if ((m = /^(destroy|create|newpage)\b/i.exec(line))) ignored.add(m[1].toLowerCase());
    else if ((m = /^return\b\s*(.*)$/i.exec(line))) {
      const last = messages[messages.length - 1];
      if (!last) warnings.push(`Line ${no}: "return" before any message.`);
      else messages.push({ from: last.to, to: last.from, text: umlText(m[1]) || 'return', dashed: true, context: context(blocks), notes: [] });
    } else if ((m = SEQ_ARROW.exec(line))) {
      const [, a, head1 = '', , head2 = '', , b, , text = ''] = m;
      if (a === '[' || b === ']') {
        ignored.add('found/lost message');
        continue;
      }
      const left = head1.includes('<');
      const right = !!head2;
      const [from, to] = left && !right ? [ref(b), ref(a)] : [ref(a), ref(b)];
      participant(from);
      participant(to);
      const msg = { from, to, text: umlText(text).replace(/\n/g, ' '), dashed: m[3].replace(/\[[^\]]*\]/g, '').length > 1, context: context(blocks), notes: [] };
      if (left && right) msg.both = true; // A <-> B, A <--> B
      if (section) {
        msg.notes.push(`Section “${section}”.`);
        section = null;
      }
      messages.push(msg);
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush(IGNORED_WHY);
  return buildSequence({ participants: [...parts.values()], messages, boxes, preNotes, title: ctx.title, source: 'PlantUML', warnings });
}

const context = (blocks) => blocks.map((b) => `${b.kind}${b.label ? ` “${b.label}”` : ''}`);

// --- component / deployment / use-case diagrams --------------------------------------

const ELEMENT = new RegExp(`^(${COMPONENT_KW}|${'participant'})\\s+(.+?)\\s*(\\{)?$`, 'i');
const END = String.raw`(\[[^\]]+\]|\(\)\s*"[^"]+"|\(\)\s*[\w.]+|\([^)]+\)|:[^:]+:|"[^"]+"|[\w.$@À-￿]+)`;
const REL = new RegExp(String.raw`^${END}\s*(?:"[^"]*"\s*)?((?:<\|?|[*o#x+}^(])?)((?:[-.=](?:\[[^\]]*\]|left|right|up|down|le|ri|do|l|r|u|d)?)+)((?:\|?>|[*o#x+{^)])?)\s*(?:"[^"]*"\s*)?${END}\s*(?::\s*(.*))?$`, 'i');

const KIND_TYPE = {
  actor: 'actor',
  person: 'actor',
  database: 'store',
  storage: 'store',
  queue: 'event',
  collections: 'store',
  usecase: 'usecase',
  interface: 'interface',
  circle: 'interface'
};

function parseComponents(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const nodes = new Map(); // code -> { raw, label, type, group }
  const groups = []; // { raw, title, parent }
  const groupCodes = new Map(); // code -> group
  const stack = [];
  const edges = [];
  const state = {};
  let direction = 'TB';

  const currentGroup = () => [...stack].reverse().find(Boolean);
  const touch = (code, type, label) => {
    let n = nodes.get(code);
    if (!n) {
      n = { raw: code, label: label || code, type: type || 'component', hint: /^[\w-]+$/.test(code) ? code : slug(code) || undefined };
      const g = currentGroup();
      if (g) n.group = g.raw;
      nodes.set(code, n);
    }
    if (type) n.type = type;
    if (label) n.label = label;
    return n;
  };
  // An endpoint token: [Comp], (Use case), :Actor:, () Interface, "Name" or a code
  const endpoint = (tok) => {
    let m;
    if ((m = /^\[([^\]]+)\]$/.exec(tok))) return touch(m[1].trim(), nodes.get(m[1].trim())?.type || 'component', umlText(m[1]));
    if ((m = /^\(\)\s*"?([^"]+?)"?$/.exec(tok))) return touch(m[1].trim(), 'interface', umlText(m[1]));
    if ((m = /^\(([^)]+)\)$/.exec(tok))) return touch(m[1].trim(), nodes.get(m[1].trim())?.type || 'usecase', umlText(m[1]));
    if ((m = /^:([^:]+):$/.exec(tok))) return touch(m[1].trim(), 'actor', umlText(m[1]));
    const code = tok.replace(/^"([\s\S]*)"$/, '$1');
    if (!nodes.has(code) && groupCodes.has(code)) return { toGroup: groupCodes.get(code) };
    return nodes.get(code) || touch(code);
  };

  for (let k = 0; k < lines.length; k++) {
    const { text: line, no } = lines[k];
    if (state.skipUntil) {
      if (state.skipUntil.test(line)) state.skipUntil = null;
      continue;
    }
    let m;
    if (/^([rh]?note|ref)\b/i.test(line)) {
      k = readNote(lines, k).next - 1;
      ignored.add('note');
      continue;
    }
    if (common(line, ctx, ignored, state)) continue;
    if (/^left to right direction$/i.test(line)) direction = 'LR';
    else if (/^top to bottom direction$/i.test(line)) direction = 'TB';
    else if (/^allowmixing$/i.test(line)) {
      // no-op
    } else if (/^together\s*\{$/i.test(line)) {
      ignored.add('together');
      stack.push(null);
    } else if (line === '}') {
      if (!stack.length) warnings.push(`Line ${no}: "}" without an open group.`);
      stack.pop();
    } else if ((m = REL.exec(line))) {
      const [, a, head1, body, head2, b, label = ''] = m;
      if (/[a-z]/i.test(body)) ignored.add('arrow direction hint');
      const left = head1.startsWith('<') || head1 === '<|';
      const right = head2.endsWith('>');
      let from = endpoint(a);
      let to = endpoint(b);
      if (left && !right) [from, to] = [to, from];
      edges.push({ from, to, label: umlText(label).replace(/\n/g, ' '), style: body.includes('.') ? 'dashed' : undefined, arrow: left && right ? 'both' : !head1 && !head2 ? 'none' : undefined, no });
    } else if ((m = ELEMENT.exec(line)) || (m = /^((?:\[[^\]]+\]|\([^)]+\)|:[^:]+:|\(\)\s*\S+)(?:\s+as\s+\S+)?)()\s*(\{)?$/.exec(line))) {
      const kw = m[1].toLowerCase();
      const spec = m[2] ? nameSpec(m[2]) : nameSpec(m[1]);
      const shape = m[2] ? spec.shape : m[1];
      const type = /^\(\)/.test(shape) ? 'interface' : /^\(/.test(shape) ? 'usecase' : /^:/.test(shape) ? 'actor' : Object.hasOwn(KIND_TYPE, kw) ? KIND_TYPE[kw] : 'component';
      if (m[3]) {
        const g = { raw: `group:${groups.length}`, title: spec.label, parent: currentGroup()?.raw, hint: slug(spec.label) || undefined };
        groups.push(g);
        groupCodes.set(spec.code, g);
        stack.push(g);
      } else touch(spec.code, type, spec.label);
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush(IGNORED_WHY);
  if (stack.filter(Boolean).length) warnings.push(`${stack.length} group${stack.length > 1 ? 's were' : ' was'} not closed with "}".`);

  // Edges to a group go to its first node
  const firstNode = (g) => [...nodes.values()].find((n) => n.group === g.raw) || groups.filter((c) => c.parent === g.raw).map(firstNode).find(Boolean);
  let toGroup = 0;
  const flat = [];
  for (const e of edges) {
    const ends = [e.from, e.to].map((x) => (x.toGroup ? (toGroup++, firstNode(x.toGroup)) : x));
    if (ends.every(Boolean)) flat.push({ from: ends[0].raw, to: ends[1].raw, label: e.label, style: e.style, arrow: e.arrow });
  }
  if (toGroup) warnings.push(`${toGroup} edge end${toGroup > 1 ? 's' : ''} on a group ${toGroup > 1 ? 'were' : 'was'} attached to its first element.`);
  const unlabeled = flat.filter((e) => !e.label).length;
  if (unlabeled) warnings.push(`${unlabeled} edge${unlabeled > 1 ? 's have' : ' has'} no label; add ": label" in PlantUML or label them in the JSON.`);

  const all = [...nodes.values()];
  for (const n of all) {
    n.data = n.type === 'store' ? { icon: 'database' } : n.type === 'actor' ? { icon: 'user' } : undefined;
  }
  const usecase = all.some((n) => n.type === 'usecase');
  return buildFlow({
    nodes: all,
    edges: flat,
    groups,
    direction,
    title: ctx.title || (usecase ? 'Imported use case diagram' : 'Imported component diagram'),
    description: `Imported from a PlantUML ${usecase ? 'use case' : 'component'} diagram: ${all.length} elements, ${flat.length} relations.`,
    warnings
  });
}

// --- activity diagrams -----------------------------------------------------------------

function parseActivity(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const nodes = [];
  const edges = [];
  const groups = [];
  const lanes = new Map(); // lane title -> group
  let lane = null;
  const partitions = [];
  const frames = [];
  const state = {};
  let frontier = []; // open tails: { from, label }
  let pendingLabel = '';
  let endNode = null;
  let counter = 0;

  const groupNow = () => partitions[partitions.length - 1] || lane;
  const add = (label, type, hint) => {
    const raw = `n${++counter}`;
    const n = { raw, label, type, hint: hint || slug(label) || undefined };
    const g = groupNow();
    if (g) n.group = g.raw;
    nodes.push(n);
    connect(raw);
    for (const f of frames) if (f.type === 'repeat' && !f.first) f.first = raw;
    return raw;
  };
  const connect = (raw) => {
    for (const t of frontier) edges.push({ from: t.from, to: raw, label: t.label || pendingLabel });
    pendingLabel = '';
    frontier = [{ from: raw }];
  };
  const toEnd = () => {
    if (!frontier.length) return;
    if (!endNode) {
      endNode = `n${++counter}`;
      nodes.push({ raw: endNode, label: 'End', type: 'terminal', hint: 'end' });
    }
    for (const t of frontier) edges.push({ from: t.from, to: endNode, label: t.label || pendingLabel });
    pendingLabel = '';
    frontier = [];
  };
  const cond = (s) => umlText(s.replace(/^\(|\)$/g, ''));
  const paren = (s) => (s ? umlText(/\(([^)]*)\)/.exec(s)?.[1] || '') : '');
  const frame = (type) => {
    const f = frames[frames.length - 1];
    return f && f.type === type ? f : null;
  };

  for (let k = 0; k < lines.length; k++) {
    let { text: line, no } = lines[k];
    if (state.skipUntil) {
      if (state.skipUntil.test(line)) state.skipUntil = null;
      continue;
    }
    let m;
    if (/^(floating\s+)?([rh]?note)\b/i.test(line)) {
      k = readNote(lines, k.valueOf()).next - 1;
      ignored.add('note');
      continue;
    }
    if (common(line, ctx, ignored, state)) continue;
    // Multi-line actions run until a line ending in ; (or an SDL shape terminator)
    if (line.startsWith(':') && !/[;|<>/\]}]$/.test(line)) {
      const parts = [line];
      while (k + 1 < lines.length && !/[;|<>/\]}]$/.test(parts[parts.length - 1])) parts.push(lines[++k].text);
      line = parts.join('\n');
    }
    if (line === 'start') add('Start', 'terminal', 'start');
    else if (/^(stop|end)$/.test(line)) toEnd();
    else if (/^(kill|detach)$/.test(line)) {
      if (line === 'detach') ignored.add('detach');
      frontier = [];
    } else if ((m = /^:([\s\S]*?)[;|<>/\]}]\s*(<<[^>]*>>)?$/.exec(line))) add(umlText(m[1]) || 'Action', 'node');
    else if ((m = /^-+(?:\[[^\]]*\]-*)?>\s*(.*?);?$/.exec(line))) pendingLabel = umlText(m[1]);
    else if ((m = /^if\s*(\(.*?\))\s*(?:is\s*(\(.*?\)))?\s*then\s*(\(.*?\))?\s*$/i.exec(line))) {
      const d = add(`${cond(m[1])}${m[2] ? ` ${paren(m[2])}` : ''}`.trim(), 'decision');
      frames.push({ type: 'if', decision: d, tails: [], hasElse: false });
      frontier = [{ from: d, label: paren(m[3]) || 'yes' }];
    } else if ((m = /^else\s*if\s*(\(.*?\))\s*(?:is\s*(\(.*?\)))?\s*then\s*(\(.*?\))?\s*$/i.exec(line))) {
      const f = frame('if');
      if (!f) {
        warnings.push(`Line ${no}: "elseif" outside an if.`);
        continue;
      }
      f.tails.push(...frontier);
      frontier = [{ from: f.decision, label: 'no' }];
      f.decision = add(cond(m[1]), 'decision');
      frontier = [{ from: f.decision, label: paren(m[3]) || 'yes' }];
    } else if ((m = /^else\b\s*(\(.*\))?\s*$/i.exec(line))) {
      const f = frame('if');
      if (!f) {
        warnings.push(`Line ${no}: "else" outside an if.`);
        continue;
      }
      f.tails.push(...frontier);
      f.hasElse = true;
      frontier = [{ from: f.decision, label: paren(m[1]) || 'no' }];
    } else if (/^end\s*if$/i.test(line)) {
      const f = frame('if');
      if (!f) {
        warnings.push(`Line ${no}: "endif" without an if.`);
        continue;
      }
      frames.pop();
      frontier = [...f.tails, ...frontier, ...(f.hasElse ? [] : [{ from: f.decision, label: 'no' }])];
    } else if ((m = /^switch\s*(\(.*\))\s*$/i.exec(line))) {
      const d = add(cond(m[1]), 'decision');
      frames.push({ type: 'switch', decision: d, tails: [], started: false });
      frontier = [];
    } else if ((m = /^case\s*(\(.*\))\s*$/i.exec(line))) {
      const f = frame('switch');
      if (!f) {
        warnings.push(`Line ${no}: "case" outside a switch.`);
        continue;
      }
      if (f.started) f.tails.push(...frontier);
      f.started = true;
      frontier = [{ from: f.decision, label: paren(m[1]) }];
    } else if (/^end\s*switch$/i.test(line)) {
      const f = frame('switch');
      if (!f) continue;
      frames.pop();
      frontier = [...f.tails, ...frontier];
    } else if ((m = /^while\s*(\(.*?\))\s*(?:is\s*(\(.*?\)))?\s*$/i.exec(line))) {
      const d = add(cond(m[1]), 'decision');
      frames.push({ type: 'while', decision: d });
      frontier = [{ from: d, label: paren(m[2]) || 'yes' }];
    } else if ((m = /^end\s*while\s*(\(.*\))?\s*$/i.exec(line))) {
      const f = frame('while');
      if (!f) {
        warnings.push(`Line ${no}: "endwhile" without a while.`);
        continue;
      }
      frames.pop();
      for (const t of frontier) edges.push({ from: t.from, to: f.decision, label: t.label || pendingLabel || 'repeat' });
      pendingLabel = '';
      frontier = [{ from: f.decision, label: paren(m[1]) || 'no' }];
    } else if ((m = /^repeat\s*$/i.exec(line)) || (m = /^repeat\s*(:[\s\S]*)$/i.exec(line))) {
      frames.push({ type: 'repeat', first: null });
      if (m[1]) {
        const a = /^:([\s\S]*?)[;|<>/\]}]$/.exec(m[1]);
        if (a) add(umlText(a[1]), 'node');
      }
    } else if ((m = /^repeat\s*while\s*(\(.*?\))?\s*(?:is\s*(\(.*?\)))?\s*(?:not\s*(\(.*?\)))?\s*$/i.exec(line))) {
      const f = frame('repeat');
      if (!f) {
        warnings.push(`Line ${no}: "repeat while" without a repeat.`);
        continue;
      }
      frames.pop();
      const d = add(m[1] ? cond(m[1]) : 'Repeat?', 'decision');
      if (f.first) edges.push({ from: d, to: f.first, label: paren(m[2]) || 'repeat' });
      frontier = [{ from: d, label: paren(m[3]) || 'no' }];
    } else if ((m = /^backward\s*:/i.exec(line))) ignored.add('backward');
    else if ((m = /^(fork|split)$/i.exec(line))) {
      // fork: a bar the branches leave from; split: branches straight from the last step
      const bar = /^fork$/i.test(m[1]) ? add('Fork', 'fork', 'fork') : null;
      if (bar) nodes[nodes.length - 1].shape = 'fork';
      frames.push({ type: m[1].toLowerCase(), origin: bar ? [{ from: bar }] : frontier, tails: [] });
    } else if ((m = /^(fork|split)\s+again$/i.exec(line))) {
      const f = frame(m[1].toLowerCase());
      if (!f) continue;
      f.tails.push(...frontier);
      frontier = f.origin;
    } else if ((m = /^end\s*(fork|split|merge)\b.*$/i.exec(line))) {
      const f = frame('fork') || frame('split');
      if (!f) continue;
      frames.pop();
      frontier = [...f.tails, ...frontier];
      if (f.type === 'fork' && frontier.length) {
        add('Join', 'fork', 'join'); // the branches meet at a join bar
        nodes[nodes.length - 1].shape = 'fork';
      }
    } else if ((m = /^\|(?:#?[\w#]+\|)?([^|]+)\|$/.exec(line))) {
      const title = umlText(m[1]);
      if (!lanes.has(title)) {
        const g = { raw: `lane:${lanes.size}`, title, hint: slug(title) || undefined };
        lanes.set(title, g);
        groups.push(g);
      }
      lane = lanes.get(title);
    } else if ((m = /^(partition|group|package|rectangle|card)\s+(.+?)\s*\{?$/i.exec(line))) {
      const title = umlText(m[2].replace(/\s*#\S+$/, '').replace(/^"|"$/g, ''));
      const g = { raw: `part:${groups.length}`, title, parent: groupNow()?.raw, hint: slug(title) || undefined };
      groups.push(g);
      partitions.push(g);
    } else if (line === '}' || /^end\s*group$/i.test(line)) partitions.pop();
    else if (/^\(\w+\)$/.test(line) || /^label\s/.test(line) || /^goto\s/.test(line)) ignored.add('connector');
    else warnings.push(`Line ${no}: could not parse "${line.split('\n')[0]}".`);
  }
  ignored.flush(IGNORED_WHY);
  if (frames.length) warnings.push(`${frames.length} block${frames.length > 1 ? 's were' : ' was'} not closed (endif / endwhile / end fork).`);

  // Activity arrows are rarely labelled; name the transition so every edge says something
  const decisions = new Set(nodes.filter((n) => n.type === 'decision').map((n) => n.raw));
  const bars = new Set(nodes.filter((n) => n.shape === 'fork').map((n) => n.raw));
  let named = 0;
  for (const e of edges) {
    if (e.label || bars.has(e.from) || bars.has(e.to)) continue; // edges at a fork or join bar need no label
    e.label = decisions.has(e.from) ? 'otherwise' : e.to === endNode ? 'done' : 'then';
    named++;
  }
  if (named) warnings.push(`Labelled ${named} unlabelled transition${named > 1 ? 's' : ''} "then" / "otherwise" / "done"; use "-> label;" in PlantUML for better ones.`);

  return buildFlow({
    nodes,
    edges,
    groups,
    direction: 'TB',
    title: ctx.title || 'Imported activity diagram',
    description: `Imported from a PlantUML activity diagram: ${nodes.length} steps, ${edges.length} transitions.`,
    warnings
  });
}

// --- state and class diagrams (through the Mermaid importer) ---------------------------

const ARROW_HINT = String.raw`(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|do|l|r|u|d)?`;
const STATE_BACK = new RegExp(String.raw`^(\S+)\s*<-+${ARROW_HINT}-*\s*(\S+)`);
const STATE_FORWARD = new RegExp(String.raw`^(\S+)\s*-+${ARROW_HINT}-*>\s*(\S+)`);
// Direction hints and colours inside class relations: A -up-|> B, A -[#red]-> B
const CLASS_HINT = new RegExp(String.raw`([-.])${ARROW_HINT}(?=[-.])`);

/**
 * PlantUML state and class diagrams are close to Mermaid's stateDiagram-v2 and
 * classDiagram: rewrite the few differences line by line, then reuse the Mermaid
 * importer (state shapes and composites; class cards, members and UML relations).
 */
function viaMermaid(lines, ctx, header, rewrite, kind) {
  const out = [header];
  const origin = [0]; // Mermaid line index -> PlantUML line number
  const skipped = new Map();
  const skip = (k) => skipped.set(k, (skipped.get(k) || 0) + 1);
  for (let k = 0; k < lines.length; k++) {
    const { text, no } = lines[k];
    let m;
    if ((m = /^title\s*:?\s*(.+)$/i.exec(text))) {
      ctx.title = ctx.title || umlText(m[1]).replace(/\n/g, ' ');
      continue;
    }
    if ((m = /^(skinparam|hide|show|legend|header|footer|caption|scale|!\w*)/i.exec(text))) {
      skip(m[1].startsWith('!') ? '!preprocessor' : m[1].toLowerCase());
      continue;
    }
    if (/^(floating\s+)?note\b/i.test(text) && kind !== 'state') {
      k = readNote(lines, k).next - 1;
      skip('note');
      continue;
    }
    if (/^left to right direction$/i.test(text)) out.push('direction LR');
    else if (/^top to bottom direction$/i.test(text)) out.push('direction TB');
    else out.push(rewrite(text));
    origin.push(no);
  }
  const { payload, warnings } = fromMermaid(out.join('\n'), { title: ctx.title });
  for (const [k, n] of skipped) warnings.unshift(`Ignored ${n} \`${k}\` line${n > 1 ? 's' : ''} (${IGNORED_WHY[k] || 'not supported'}).`);
  payload.meta.description = payload.meta.description.replace(/a Mermaid (\w+) diagram/, 'a PlantUML $1 diagram');
  return { payload, warnings: [...ctx.warnings, ...warnings.map((w) => w.replace(/^Line (\d+):/, (_, n) => `Line ${origin[n - 1] ?? n}:`))] };
}

function parseState(lines, ctx) {
  return viaMermaid(lines, ctx, 'stateDiagram-v2', (line) => {
    if (line === '||') return '--';
    // A -[#red]right-> B, A -> B  ->  A --> B ; B <-- A  ->  A --> B
    let out = line.replace(STATE_BACK, '$2 --> $1').replace(STATE_FORWARD, '$1 --> $2');
    out = out.replace(/\s+#[\w#]+(?=\s*(\{|$|:))/, '');
    const m = /^state\s+([\w.]+)\s*:\s*(.*)$/.exec(out);
    return m ? `${m[1]} : ${m[2]}` : out;
  }, 'state');
}

function parseClass(lines, ctx) {
  return viaMermaid(lines, ctx, 'classDiagram', (line) => {
    let m;
    // abstract class A, interface B <<x>>, enum C { ... }, class "Long name" as D
    if ((m = /^(abstract\s+class|abstract|class|interface|enum|annotation)\s+("[^"]+"|[\w.$]+)(?:\s+as\s+([\w.$]+))?\s*(?:<<\s*([^>]+?)\s*>>)?\s*(?:#\S+)?\s*(\{)?\s*(\})?$/.exec(line))) {
      const id = (m[3] || m[2]).replace(/^"|"$/g, '').replace(/[^\w$]/g, '_');
      const stereo = m[4] || (/^interface/.test(m[1]) ? 'interface' : /^abstract/.test(m[1]) ? 'abstract' : /^enum/.test(m[1]) ? 'enumeration' : '');
      const decl = `class ${id}${m[3] ? `["${m[2].replace(/^"|"$/g, '')}"]` : ''}${m[5] && !m[6] ? ' {' : ''}`;
      if (!stereo) return decl;
      // Inside an opened body Mermaid takes the bare annotation; otherwise `<<x>> Id`
      return m[5] && !m[6] ? `${decl}\n<<${stereo}>>` : `${decl}\n<<${stereo}>> ${id}`;
    }
    if ((m = /^(package|namespace)\s+("[^"]+"|[\w.]+)[^{]*\{$/.exec(line))) return `namespace ${m[2].replace(/^"|"$/g, '').replace(/[^\w]/g, '_')} {`;
    // Members: drop {static} / {abstract} / {field} / {method} modifiers
    let out = line.replace(/\{(static|abstract|classifier|field|method)\}\s*/g, '');
    out = out.replace(CLASS_HINT, '$1');
    return out;
  }, 'class');
}

// --- mind maps and work breakdowns -------------------------------------------------------

/**
 * @startmindmap / @startwbs outlines (`*`, `**`, `+` / `-` sides, `_` boxless) become a
 * Mermaid mind map by indentation and go through the Mermaid importer; a WBS is drawn
 * with the tree layout instead of the mind-map one.
 */
function fromOutline(body, kind, opts) {
  const warnings = [];
  const out = ['mindmap'];
  let title = opts.title;
  let skipped = 0;
  let multi = null;
  for (const raw of String(body).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith("'")) continue;
    let m;
    if (multi) {
      // `* :multi-line text;` keeps its first line as the title
      if (/;\s*$/.test(line)) multi = null;
      continue;
    }
    if ((m = /^title\s+(.+)$/i.exec(line))) {
      title = title || umlText(m[1]);
      continue;
    }
    if ((m = /^([*+-]+)(?:\[#?\w+\])?_?\s*(.*)$/.exec(line))) {
      let text = m[2];
      if (text.startsWith(':')) {
        text = text.slice(1).replace(/;\s*$/, '');
        if (!/;\s*$/.test(m[2])) multi = true;
      }
      const label = umlText(text.replace(/<<[^>]*>>/g, '')).split('\n')[0].replace(/[()[\]{}]/g, '').trim() || 'Topic';
      out.push(`${'  '.repeat(m[1].length)}${label}`);
    } else skipped++;
  }
  if (out.length < 2) throw new Error(`The PlantUML ${kind} has no topics.`);
  if (skipped) warnings.push(`Ignored ${skipped} line${skipped > 1 ? 's' : ''} that are not outline items (styles, notes, captions).`);
  const res = fromMermaid(out.join('\n'), { title });
  const payload = res.payload;
  payload.meta.description = payload.meta.description.replace('a Mermaid mind map', kind === 'wbs' ? 'a PlantUML work breakdown' : 'a PlantUML mind map');
  if (kind === 'wbs') payload.meta.layout = { ...payload.meta.layout, algorithm: 'tree', direction: 'TB' };
  return { payload, warnings: [...warnings, ...res.warnings] };
}

// --- preprocessor ------------------------------------------------------------------------

const MAX_INCLUDE_DEPTH = 8;
const PRE_IGNORED_WHY = {
  '!theme': 'styling comes from roles',
  '!pragma': 'not needed',
  '!if': 'conditions are not evaluated; every branch is kept',
  '!procedure': 'procedures and functions are not expanded',
  '!include <stdlib>': 'the PlantUML standard library is not bundled',
  '!includeurl': 'URLs are never fetched',
  '!define with arguments': 'macros with arguments are not expanded',
  other: 'not supported'
};

/**
 * A safe subset of the PlantUML preprocessor, run before parsing:
 * `!include file` / `!include_once` / `!include_many` / `!includesub file!PART` (the
 * file's @startuml body, or the named !startsub block), `!define NAME value`,
 * `!undef NAME`, `!$var = value` / `!$var ?= value` with `$var` substitution.
 * Includes need `opts.include(target, fromPath) -> { path, text }` (the CLI and MCP
 * server pass one that stays inside the input root); without it they are skipped
 * with a warning. URLs and `<stdlib>` are never fetched; cycles and nesting deeper
 * than 8 are stopped. Conditions, procedures, functions and themes are not run.
 *   preprocessPlantUml(text, { include?, path? }) -> { text, warnings }
 */
export function preprocessPlantUml(text, opts = {}) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const warnings = [];
  if (!/^[ \t]*!/m.test(src)) return { text: src, warnings };
  const defines = new Map();
  const vars = new Map();
  const ignored = new Map();
  const skip = (kind) => ignored.set(kind, (ignored.get(kind) || 0) + 1);
  const seen = new Set();
  const out = [];
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expand = (line) => {
    let s = line;
    for (const [name, value] of vars) s = s.replace(new RegExp(`${escape(name)}(?![\\w])`, 'g'), () => value);
    for (const [name, value] of defines) s = s.replace(new RegExp(`\\b${escape(name)}\\b`, 'g'), () => value);
    return s;
  };
  const value = (raw) => expand(raw.trim()).replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
  const bodyOf = (inc, part) => {
    if (part) {
      const sub = new RegExp(`^[ \\t]*!startsub\\s+${escape(part)}\\s*$([\\s\\S]*?)^[ \\t]*!endsub\\b`, 'm').exec(inc);
      if (sub) return sub[1];
      const n = Number(part);
      const blocks = [...inc.matchAll(/^[ \t]*@start\w+[^\n]*\n([\s\S]*?)^[ \t]*@end\w+/gm)].map((b) => b[1]);
      if (Number.isInteger(n) && blocks[n]) return blocks[n];
      warnings.push(`!include: no part "${part}" found; included the whole file.`);
    }
    const first = /^[ \t]*@start\w+[^\n]*\n([\s\S]*?)^[ \t]*@end\w+/m.exec(inc);
    return (first ? first[1] : inc).replace(/^[ \t]*!(start|end)sub\b.*$/gm, '');
  };
  const run = (body, from, depth, chain) => {
    let skipUntil = null;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (skipUntil) {
        if (skipUntil.test(line)) skipUntil = null;
        continue;
      }
      let m;
      if (!line.startsWith('!')) {
        out.push(expand(raw));
        continue;
      }
      if ((m = /^!(include(?:_once|_many|sub)?|includeurl|includedef)\s+(.+)$/i.exec(line))) {
        const kind = m[1].toLowerCase();
        let target = m[2].trim().replace(/^"([\s\S]*)"$/, '$1');
        if (/^</.test(target)) {
          skip('!include <stdlib>');
          continue;
        }
        if (kind === 'includeurl' || /^[a-z][\w+.-]*:\/\//i.test(target)) {
          skip('!includeurl');
          continue;
        }
        let part = null;
        const bang = target.lastIndexOf('!');
        if (bang > 0) [target, part] = [target.slice(0, bang), target.slice(bang + 1)];
        if (!opts.include) {
          warnings.push(`!include ${target}: not read (no file context; import the file from disk to resolve includes).`);
          continue;
        }
        if (depth >= MAX_INCLUDE_DEPTH) {
          warnings.push(`!include ${target}: includes nested deeper than ${MAX_INCLUDE_DEPTH} levels are not read.`);
          continue;
        }
        let res;
        try {
          res = opts.include(target, from);
        } catch (err) {
          warnings.push(`!include ${target}: ${err?.message || err}`);
          continue;
        }
        if (chain.includes(res.path)) {
          warnings.push(`!include ${target}: skipped, it would include itself (a cycle).`);
          continue;
        }
        if (kind === 'include_once' && seen.has(res.path)) continue;
        seen.add(res.path);
        run(bodyOf(String(res.text ?? '').replace(/\r\n?/g, '\n'), part), res.path, depth + 1, [...chain, res.path]);
      } else if ((m = /^!define\s+([A-Za-z_]\w*)(\([^)]*\))?\s*(.*)$/.exec(line))) {
        if (m[2]) skip('!define with arguments');
        else defines.set(m[1], expand(m[3]));
      } else if ((m = /^!undef\s+(\w+)/.exec(line))) {
        defines.delete(m[1]);
      } else if ((m = /^!(?:(?:global|local)\s+)?(\$\w+)\s*(\?)?=\s*(.*)$/.exec(line))) {
        if (!(m[2] && vars.has(m[1]))) vars.set(m[1], value(m[3]));
      } else if (/^!(unquoted\s+)?(procedure|function)\b/.test(line)) {
        skip('!procedure');
        skipUntil = /^!end(procedure|function)\b/;
      } else if ((m = /^!(theme|pragma)\b/.exec(line))) {
        skip(`!${m[1]}`);
      } else if (/^!(if|ifdef|ifndef|else|elseif|endif)\b/.test(line)) {
        if (/^!(if|ifdef|ifndef)\b/.test(line)) skip('!if');
      } else if (/^!(startsub|endsub)\b/.test(line)) {
        // markers of an includable part
      } else skip('other');
    }
  };
  run(src, opts.path || null, 0, opts.path ? [opts.path] : []);
  for (const [kind, n] of ignored) warnings.push(`Ignored ${n} \`${kind === 'other' ? '!' : kind}\` preprocessor line${n > 1 ? 's' : ''} (${PRE_IGNORED_WHY[kind]}).`);
  return { text: out.join('\n'), warnings };
}

// --- activity diagrams, old syntax ((*) --> "Action") ---------------------------------

const OLD_ARROW = /^(.*?)\s*(-+(?:\[[^\]]*\]|left|right|up|down|le|ri|do|l|r|u|d)?-*>|\.+>)\s*(?:\[([^\]]*)\])?\s*(.*)$/i;

function parseOldActivity(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const nodes = new Map(); // key -> { raw, label, type, group }
  const aliases = new Map();
  const edges = [];
  const groups = [];
  const stack = [];
  const frames = [];
  const state = {};
  let frontier = [];
  let decisions = 0;

  const add = (key, label, type) => {
    if (!nodes.has(key)) {
      const n = { raw: key, label, type, hint: slug(label) || undefined };
      const g = stack[stack.length - 1];
      if (g && type !== 'terminal') n.group = g.raw;
      nodes.set(key, n);
    }
    return key;
  };
  const ref = (tok, asTarget) => {
    const t = tok.trim().replace(/\s*<<[^>]*>>\s*$/, '');
    let m;
    if (/^\(\*(top)?\)$/.test(t)) return asTarget ? add('(end)', 'End', 'terminal') : add('(start)', 'Start', 'terminal');
    if ((m = /^=+\s*(.+?)\s*=+$/.exec(t))) return add(`bar:${m[1]}`, humanBar(m[1]), 'node');
    if ((m = /^"([\s\S]*?)"(?:\s+as\s+([\w.]+))?$/.exec(t))) {
      const label = umlText(m[1]) || 'Action';
      const key = m[2] || label;
      if (m[2]) aliases.set(m[2], key);
      return add(key, label, 'node');
    }
    const key = aliases.get(t) || t;
    return add(key, nodes.get(key)?.label || umlText(t), 'node');
  };
  const connect = (froms, to, label) => {
    for (const f of froms) edges.push({ from: f.from, to, label: label || f.label || '' });
    frontier = to === '(end)' ? [] : [{ from: to }];
  };

  for (let k = 0; k < lines.length; k++) {
    const { text: line, no } = lines[k];
    if (state.skipUntil) {
      if (state.skipUntil.test(line)) state.skipUntil = null;
      continue;
    }
    let m;
    if (/^(floating\s+)?note\b/i.test(line)) {
      k = readNote(lines, k).next - 1;
      ignored.add('note');
      continue;
    }
    if (common(line, ctx, ignored, state)) continue;
    if ((m = /^if\s+(?:"([^"]*)"|(.+?))(?:\s+as\s+[\w.]+)?\s+then$/i.exec(line))) {
      const d = add(`if:${++decisions}`, umlText(m[1] ?? m[2]) || 'Decision', 'decision');
      connect(frontier, d, '');
      frames.push({ decision: d, tails: [] });
      frontier = [{ from: d }];
    } else if (/^else$/i.test(line)) {
      const f = frames[frames.length - 1];
      if (!f) warnings.push(`Line ${no}: "else" outside an if.`);
      else {
        f.tails.push(...frontier);
        frontier = [{ from: f.decision }];
      }
    } else if (/^end\s*if$/i.test(line)) {
      const f = frames.pop();
      if (!f) warnings.push(`Line ${no}: "endif" without an if.`);
      else frontier = [...f.tails, ...frontier];
    } else if ((m = /^partition\s+(.+?)\s*\{?$/i.exec(line))) {
      const g = { raw: `part:${groups.length}`, title: umlText(m[1].replace(/\s*#\S+$/, '').replace(/^"|"$/g, '')), parent: stack[stack.length - 1]?.raw };
      g.hint = slug(g.title) || undefined;
      groups.push(g);
      stack.push(g);
    } else if (line === '}' || /^end\s*partition$/i.test(line)) stack.pop();
    else if ((m = OLD_ARROW.exec(line)) && m[4]) {
      const [, src, arrow, label = '', dst] = m;
      if (/[a-z]/i.test(arrow.replace(/\[[^\]]*\]/g, ''))) ignored.add('arrow direction hint');
      const froms = src.trim() ? [{ from: ref(src, false) }] : frontier;
      if (!froms.length) {
        warnings.push(`Line ${no}: arrow with nothing before it; start with (*) --> "First step".`);
        continue;
      }
      connect(froms, ref(dst, true), umlText(label));
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush(IGNORED_WHY);
  if (frames.length) warnings.push(`${frames.length} if block${frames.length > 1 ? 's were' : ' was'} not closed with endif.`);
  if (!nodes.size) throw new Error('No activities found; check the (*) --> "Action" syntax.');

  // Unlabelled transitions are named, as in the new activity syntax
  const isDecision = (raw) => nodes.get(raw)?.type === 'decision';
  let named = 0;
  for (const e of edges) {
    if (e.label) continue;
    e.label = isDecision(e.from) ? 'otherwise' : e.to === '(end)' ? 'done' : 'then';
    named++;
  }
  if (named) warnings.push(`Labelled ${named} unlabelled transition${named > 1 ? 's' : ''} "then" / "otherwise" / "done"; use "-->[label]" in PlantUML for better ones.`);
  const all = [...nodes.values()];
  return buildFlow({
    nodes: all,
    edges,
    groups,
    direction: 'TB',
    title: ctx.title || 'Imported activity diagram',
    description: `Imported from a PlantUML activity diagram (old syntax): ${all.length} steps, ${edges.length} transitions.`,
    warnings
  });
}

const humanBar = (name) => (/^[A-Z]?\d+$/i.test(name) ? 'Synchronise' : umlText(name.replace(/_/g, ' ')));

// --- object diagrams -----------------------------------------------------------------------

function parseObjects(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const nodes = new Map();
  const edges = [];
  const groups = [];
  const stack = [];
  const state = {};
  let open = null;
  let direction = 'TB';

  const touch = (code, type, label) => {
    let n = nodes.get(code);
    if (!n) {
      n = { raw: code, label: label || code, type: type || 'object', hint: /^[\w-]+$/.test(code) ? code : slug(code) || undefined, data: { fields: [] } };
      const g = stack[stack.length - 1];
      if (g) n.group = g.raw;
      nodes.set(code, n);
    }
    if (type) n.type = type;
    if (label) n.label = label;
    return n;
  };
  const field = (n, text) => {
    const m = /^([^=:]+?)\s*(?:=|:)\s*(.+)$/.exec(text);
    const f = m ? { name: umlText(m[1]), type: umlText(m[2]) } : { name: umlText(text) };
    if (f.name) n.data.fields.push(f);
  };
  const endpoint = (tok) => {
    const code = tok.replace(/^"([\s\S]*)"$/, '$1').replace(/^\[([\s\S]*)\]$/, '$1');
    return nodes.get(code) || touch(code);
  };

  for (let k = 0; k < lines.length; k++) {
    const { text: line, no } = lines[k];
    if (state.skipUntil) {
      if (state.skipUntil.test(line)) state.skipUntil = null;
      continue;
    }
    let m;
    if (open) {
      if (line === '}') open = null;
      else if (open.type === 'map' && (m = /^(.+?)\s*\*-+>\s*(.+)$/.exec(line))) {
        const key = umlText(m[1]);
        open.data.fields.push({ name: key });
        edges.push({ from: open.raw, to: endpoint(m[2].trim()).raw, label: key });
      } else if (open.type === 'map' && (m = /^(.+?)\s*=>\s*(.*)$/.exec(line))) open.data.fields.push({ name: umlText(m[1]), type: umlText(m[2]) });
      else field(open, line);
      continue;
    }
    if (/^(floating\s+)?note\b/i.test(line)) {
      k = readNote(lines, k).next - 1;
      ignored.add('note');
      continue;
    }
    if (common(line, ctx, ignored, state)) continue;
    if (/^left to right direction$/i.test(line)) direction = 'LR';
    else if (/^top to bottom direction$/i.test(line)) direction = 'TB';
    else if ((m = /^(object|map|diamond)\s+(.+?)\s*(\{)?\s*(\})?$/i.exec(line))) {
      const kind = m[1].toLowerCase();
      const spec = nameSpec(m[2]);
      const n = touch(spec.code, kind === 'diamond' ? 'object' : kind, spec.label);
      if (m[3] && !m[4]) open = n;
    } else if ((m = /^(package|namespace|rectangle|frame|folder|node|cloud)\s+(.+?)\s*\{$/i.exec(line))) {
      const title = umlText(m[2].replace(/\s*#\S+$/, '').replace(/^"|"$/g, ''));
      const g = { raw: `group:${groups.length}`, title, parent: stack[stack.length - 1]?.raw, hint: slug(title) || undefined };
      groups.push(g);
      stack.push(g);
    } else if (line === '}') stack.pop();
    else if ((m = REL.exec(line))) {
      const [, a, head1, body, head2, b, label = ''] = m;
      if (/\[hidden\]/i.test(body)) continue;
      if (/[a-z]/i.test(body.replace(/\[[^\]]*\]/g, ''))) ignored.add('arrow direction hint');
      let from = endpoint(a);
      let to = endpoint(b);
      const e = { label: umlText(label).replace(/\n/g, ' ') };
      const whole = { '*': 'composition', o: 'aggregation', '<|': 'inheritance', '|>': 'inheritance' };
      if (whole[head1] || whole[head2]) {
        e.relation = whole[head1] || whole[head2];
        if (!whole[head1]) [from, to] = [to, from]; // the whole / parent is the source
        if (e.relation === 'inheritance' && body.includes('.')) e.relation = 'realization';
      } else {
        const left = head1.startsWith('<');
        const right = head2.endsWith('>');
        if (left && !right) [from, to] = [to, from];
        if (left && right) e.arrow = 'both';
        else if (!left && !right) e.arrow = 'none';
        if (body.includes('.')) e.style = 'dashed';
      }
      edges.push({ ...e, from: from.raw, to: to.raw });
    } else if ((m = /^("[^"]+"|[\w.$]+)\s*:\s*(.+)$/.exec(line)) && nodes.has(m[1].replace(/^"|"$/g, ''))) {
      field(nodes.get(m[1].replace(/^"|"$/g, '')), m[2]);
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush(IGNORED_WHY);
  if (open) warnings.push(`Object "${open.raw}" has no closing "}".`);
  const all = [...nodes.values()];
  for (const n of all) if (!n.data.fields.length) delete n.data;
  const unlabeled = edges.filter((e) => !e.label && !e.relation).length;
  if (unlabeled) warnings.push(`${unlabeled} link${unlabeled > 1 ? 's have' : ' has'} no label; add ": label" in PlantUML or label them in the JSON.`);
  return buildFlow({
    nodes: all,
    edges,
    groups,
    direction,
    title: ctx.title || 'Imported object diagram',
    description: `Imported from a PlantUML object diagram: ${all.length} objects, ${edges.length} links.`,
    warnings
  });
}

// --- entity-relationship diagrams (entity blocks, crow's foot links) ------------------------

/**
 * `entity Name { ... }` blocks and `A ||--o{ B : label` links, rewritten to a Mermaid
 * erDiagram and converted by the Mermaid ER importer. Attributes above the `--`
 * separator are the primary key; `<<PK>>`, `<<FK>>`, `<<UK>>` mark keys; other
 * stereotypes (`<<generated>>`) become the attribute note.
 */
function parseEntities(lines, ctx) {
  const out = [];
  const codes = new Map(); // PlantUML code -> Mermaid-safe id
  const types = new Map(); // placeholder -> real type ('' = none)
  const code = (raw) => {
    const c = raw.replace(/^"|"$/g, '');
    if (!codes.has(c)) codes.set(c, c.replace(/[^\w$-]+/g, '_') || `E${codes.size}`);
    return codes.get(c);
  };
  let skipped = 0;
  for (let k = 0; k < lines.length; k++) {
    const { text, no } = lines[k];
    let m;
    if ((m = /^entity\s+(.+?)\s*(\{)?\s*(\})?$/i.exec(text))) {
      const spec = nameSpec(m[1]);
      const id = code(spec.code);
      const head = spec.label && spec.label !== spec.code ? `${id}["${spec.label.replace(/["\]]/g, '')}"]` : id;
      if (!m[2] || m[3]) {
        out.push({ text: head, no });
        continue;
      }
      out.push({ text: `${head} {`, no });
      const body = [];
      for (k++; k < lines.length && lines[k].text !== '}'; k++) body.push(lines[k]);
      const isSep = (t) => /^(--+|==+|\.\.+|__+)(.*?)(--+|==+|\.\.+|__+)?$/.test(t);
      const sep = body.findIndex((l) => isSep(l.text));
      body.forEach((l, i) => {
        if (isSep(l.text)) return;
        const f = /^(\*)?\s*([\w$]+)\s*(?::\s*(.*?))?\s*((?:<<[^>]*>>\s*)*)$/.exec(l.text.replace(/^[+\-#~]\s*/, '').replace(/^\{\w+\}\s*/, ''));
        if (!f) {
          ctx.warnings.push(`Line ${l.no}: could not parse attribute "${l.text}".`);
          return;
        }
        const stereo = [...(f[4] || '').matchAll(/<<\s*([^>]*?)\s*>>/g)].map((x) => x[1]);
        const keys = [];
        if ((sep > 0 && i < sep) || stereo.some((s) => /^PK$/i.test(s))) keys.push('PK');
        if (stereo.some((s) => /^FK$/i.test(s))) keys.push('FK');
        if (stereo.some((s) => /^(UK|unique)$/i.test(s))) keys.push('UK');
        const note = stereo.filter((s) => !/^(PK|FK|UK|unique)$/i.test(s)).join(', ');
        const t = `T${types.size}`;
        types.set(t, umlText(f[3] || ''));
        out.push({ text: `${t} ${f[2]}${keys.length ? ` ${keys.join(', ')}` : ''}${note ? ` "${note.replace(/"/g, '')}"` : ''}`, no: l.no });
      });
      out.push({ text: '}', no: lines[k]?.no ?? no });
    } else if ((m = ER_LINK.exec(text))) {
      const [, a, l, body, r, b, label = ''] = m;
      if (/hidden/i.test(body)) continue;
      if (!l || !r) {
        skipped++;
        continue;
      }
      const left = { 'o|': '|o' }[l] || l;
      const right = { '|o': 'o|' }[r] || r;
      out.push({ text: `${code(a)} ${left}${body.startsWith('.') ? '..' : '--'}${right} ${code(b)} : "${umlText(label).replace(/"/g, '')}"`, no });
    } else out.push({ text, no });
  }
  if (skipped) ctx.warnings.push(`Skipped ${skipped} link${skipped > 1 ? 's' : ''} without a crow's foot symbol at both ends (e.g. ||--o{).`);
  const res = viaMermaid(out, ctx, 'erDiagram', (line) => line, 'er');
  for (const n of res.payload.nodes)
    for (const f of n.data.fields || []) {
      if (!types.has(f.type)) continue;
      const t = types.get(f.type);
      if (t) f.type = t;
      else delete f.type;
    }
  return res;
}

// --- gantt charts (@startgantt) ---------------------------------------------------------------

const GANTT_DATE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
const ganttDate = (s) => {
  const m = GANTT_DATE.exec(String(s));
  return m ? parseDay(`${m[1]}-${Number(m[2])}-${Number(m[3])}`) : null;
};

/** @startgantt: tasks, durations, dependencies, milestones and separators -> a plan page. */
function fromGantt(body, opts) {
  const warnings = [];
  const ignored = ignoredCollector(warnings);
  const tasks = new Map();
  const aliases = new Map();
  let projectStart = null;
  let today = null;
  let title;
  let section;
  let prev = null;
  const task = (name) => {
    const key = aliases.get(name.trim()) || name.trim();
    if (!tasks.has(key)) tasks.set(key, { key, title: umlText(key) || 'Task', group: section, after: [] });
    return tasks.get(key);
  };
  const lines = String(body).replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const no = i + 1;
    if (!line || line.startsWith("'")) return;
    let m;
    if ((m = /^title\s+(.+)$/i.exec(line))) title = umlText(m[1]);
    else if ((m = /^--\s*(.*?)\s*--$/.exec(line))) section = umlText(m[1]) || undefined;
    else if ((m = /^project\s+starts\s+(?:on\s+|the\s+)*(.+)$/i.exec(line))) {
      projectStart = ganttDate(m[1]);
      if (projectStart === null) warnings.push(`Line ${no}: project start "${m[1]}" is not a YYYY-MM-DD date.`);
    } else if ((m = /^today\s+is\s+(.+)$/i.exec(line))) {
      if (/colou?red/i.test(m[1])) ignored.add('colour');
      else today = ganttDate(m[1]);
    } else if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}[-/.]\d)/i.test(line) && /\b(are|is)\s+(closed|open)\b/i.test(line)) ignored.add('closed days');
    else if ((m = /^(printscale|projectscale|ganttscale|language|hide|show|skinparam|scale|footer|header|caption|legend|<style>|style|zoom|separator)\b/i.exec(line))) ignored.add(m[1].toLowerCase());
    else if ((m = /^(then\s+)?\[([^\]]+)\](?:\s+as\s+\[([^\]]+)\])?\s*(.*)$/i.exec(line))) {
      const t = task(m[2]);
      if (m[3]) aliases.set(m[3].trim(), t.key);
      if (m[1] && prev && prev !== t) t.after.push(prev.key);
      const rest = m[4].replace(/\s*\bon\s+\{[^}]*\}(\s*\{[^}]*\})*/gi, () => (ignored.add('resources'), ''));
      for (const clause of rest.split(/\s+and\s+/i).map((c) => c.trim()).filter(Boolean)) {
        let c;
        if ((c = /^->\s*\[([^\]]+)\]/.exec(clause))) task(c[1]).after.push(t.key);
        else if ((c = /^(?:lasts|requires)\s+(\d+)\s*(day|week)s?\b/i.exec(clause))) t.days = Number(c[1]) * (/^week/i.test(c[2]) ? 7 : 1);
        else if ((c = /^(starts|happens)\s+(?:on\s+|at\s+)?(\d+)\s+days?\s+after\s+\[([^\]]+)\]'s\s+end/i.exec(clause))) {
          t.after.push(task(c[3]).key);
          if (/happens/i.test(c[1])) t.milestone = true;
          ignored.add('lag');
        } else if ((c = /^(starts|happens)\s+(?:on\s+|at\s+)?\[([^\]]+)\]'s\s+end/i.exec(clause))) {
          t.after.push(task(c[2]).key);
          if (/happens/i.test(c[1])) t.milestone = true;
        } else if ((c = /^(starts|happens)\s+(?:on\s+|at\s+|the\s+)*(.+)$/i.exec(clause)) && ganttDate(c[2]) !== null) {
          t.start = ganttDate(c[2]);
          if (/happens/i.test(c[1])) t.milestone = true;
        } else if ((c = /^ends\s+(?:on\s+|at\s+|the\s+)*(.+)$/i.exec(clause)) && ganttDate(c[1]) !== null) t.end = ganttDate(c[1]);
        else if ((c = /^is\s+(\d+)\s*%\s*complete/i.exec(clause))) t.progress = Math.min(100, Number(c[1]));
        else if (/^is\s+colou?red\b/i.test(clause)) ignored.add('colour');
        else if (/^(starts|ends)\s+at\s+\[[^\]]+\]'s\s+(start|end)/i.test(clause)) ignored.add('start / end alignment');
        else warnings.push(`Line ${no}: could not parse "${clause}".`);
      }
      prev = t;
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  });
  ignored.flush({
    colour: 'colours come from sections',
    'closed days': 'durations count calendar days',
    resources: 'resources are not drawn',
    lag: 'the task starts right after the other one ends',
    'start / end alignment': 'the task keeps its own dates',
    printscale: 'the scale is automatic',
    projectscale: 'the scale is automatic',
    ganttscale: 'the scale is automatic'
  });
  const ids = new Map();
  const used = new Set();
  for (const t of tasks.values()) {
    const base = slug(t.title) || 'task';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    ids.set(t.key, id);
  }
  let guessed = 0;
  const items = [...tasks.values()].map((t) => {
    const it = { id: ids.get(t.key), title: t.title };
    if (t.group) it.group = t.group;
    if (t.start !== undefined) it.start = fmtDay(t.start);
    const after = [...new Set(t.after)].map((k) => ids.get(k)).filter(Boolean);
    if (after.length) it.after = after.length === 1 ? after[0] : after;
    // PlantUML tasks with no start and no dependency begin with the project
    if (it.start === undefined && !after.length) it.start = projectStart !== null ? fmtDay(projectStart) : 0;
    if (t.milestone) it.milestone = true;
    else if (t.days !== undefined) it.days = t.days;
    else if (t.end !== undefined) it.end = fmtDay(t.end);
    else {
      it.days = 1;
      guessed++;
    }
    if (t.progress !== undefined) it.progress = t.progress;
    return it;
  });
  if (guessed) warnings.push(`${guessed} task${guessed > 1 ? 's have' : ' has'} no duration ("lasts N days"); drawn as one day.`);
  if (items.some((it) => it.start === 0) && items.some((it) => typeof it.start === 'string')) {
    warnings.push('Some tasks have dates and others none; add "Project starts YYYY-MM-DD" so undated tasks start with the project.');
    for (const it of items) if (it.start === 0) delete it.start;
  }
  return ganttPage({ title: opts.title || title, items, today: today !== null ? fmtDay(today) : undefined, source: 'a PlantUML gantt chart', warnings });
}
