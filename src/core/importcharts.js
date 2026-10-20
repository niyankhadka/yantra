/**
 * Chart-like imports. Mermaid `gantt`, `pie`, `timeline` and `quadrantChart`, and
 * PlantUML `@startgantt` (parsed in plantuml.js), become one-page answers
 * (`"kind": "page"`) with a gantt, chart, timeline or matrix block; Mermaid
 * `journey` becomes a flow diagram with one step per section. The headline is
 * computed from the data (span of the plan, largest slice, ...); rewrite it into
 * the real answer before sharing. Pure (no DOM, no Node APIs).
 *
 *   ganttPage({ title, items, today?, workdays?, holidays?, source, warnings })  -> { payload, warnings }
 *     (an item's `until: ref` ends it the day before task `ref` starts)
 *   fromMermaidGantt / fromMermaidPie / fromMermaidTimeline / fromMermaidQuadrant /
 *   fromMermaidJourney (lines, ctx)                        -> { payload, warnings }
 */
import { resolveGantt, fmtDay, parseDay } from './charts.js';
import { buildFlow, tidy, shorten, slug, ignoredCollector } from './importkit.js';

const MAX_SLICES = 8;
const MAX_STEPS = 7; // walkthrough steps after the overview

const unquote = (s) => String(s ?? '').trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
const text = (s) => tidy(String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\n/g, ' ');
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmt = (v) => String(Math.round(v * 100) / 100);

function page({ title, kicker, question, headline, text: body, points, blocks, source }) {
  const answer = { headline: shorten(headline, 220) };
  if (body) answer.text = body;
  if (points?.length) answer.points = points.slice(0, 5);
  return {
    kind: 'page',
    meta: { title, kicker, question, footer: `Imported from ${source}. The headline is computed from the data: rewrite it as the answer before sharing.` },
    answer,
    blocks
  };
}

// --- gantt (Mermaid and PlantUML) ------------------------------------------------

/**
 * A plan page from gantt items ({ title, id?, group?, start?, end? | days?, after?,
 * milestone?, progress?, tone? }). Dependencies that name no task are dropped.
 */
export function ganttPage({ title, items, today, workdays = false, holidays = [], source, warnings }) {
  if (!items.length) throw new Error('The gantt chart has no tasks.');
  const ids = new Set(items.map((it) => it.id).filter(Boolean));
  const titles = new Set(items.map((it) => it.title));
  let lost = 0;
  for (const it of items) {
    if (it.after === undefined) continue;
    const refs = (Array.isArray(it.after) ? it.after : [it.after]).filter((r) => ids.has(r) || titles.has(r));
    lost += (Array.isArray(it.after) ? it.after.length : 1) - refs.length;
    if (!refs.length) delete it.after;
    else it.after = refs.length === 1 ? refs[0] : refs;
  }
  if (lost) warnings.push(`Dropped ${plural(lost, 'dependency', 'dependencies')} on tasks that do not exist; those tasks follow the task above them.`);
  const block = { type: 'gantt', title: 'Schedule', items };
  if (today) block.today = today;
  if (workdays) {
    block.workdays = true;
    const days = [...new Set(holidays)].sort((a, b) => a - b);
    if (days.length) block.holidays = days.map(fmtDay);
  }
  untilEnds(block, warnings);

  const g = resolveGantt(block);
  for (const p of g.problems) warnings.push(`Gantt: ${p.message}`);
  const placed = g.tasks.filter((t) => t.s !== null);
  const dated = g.mode === 'date';
  const at = (d) => (dated ? fmtDay(d) : `day ${d}`);
  const lastDay = (t) => (t.item.milestone ? t.s : Math.max(t.s, t.e - 1));
  const span = (ts) => {
    const lo = Math.min(...ts.map((t) => t.s));
    const hi = Math.max(...ts.map(lastDay));
    return { lo, hi, text: lo === hi ? at(lo) : `${at(lo)} to ${at(hi)}` };
  };
  const milestones = g.tasks.filter((t) => t.item.milestone);
  const work = g.tasks.filter((t) => !t.item.milestone);
  let headline = `${title || 'The plan'}: ${plural(work.length, 'task')}${milestones.length ? ` and ${plural(milestones.length, 'milestone')}` : ''}.`;
  const points = [];
  if (placed.length) {
    const all = span(placed);
    const last = placed.filter((t) => lastDay(t) === all.hi).pop();
    const days = all.hi - all.lo + 1;
    const weeks = days >= 14 ? ` (about ${Math.round(days / 7)} weeks)` : ` (${plural(days, 'day')})`;
    headline = `The plan runs from ${all.text}${weeks}: ${plural(work.length, 'task')}${g.groups.length > 1 ? ` in ${g.groups.length} sections` : ''}, finishing with ${last.item.title}.`;
    for (const grp of g.groups.slice(0, milestones.length ? 4 : 5)) {
      const ts = placed.filter((t) => t.group === grp);
      if (ts.length) points.push(`${grp}: ${span(ts).text} (${plural(ts.length, 'item')})`);
    }
    if (milestones.length) points.push(`Milestones: ${milestones.slice(0, 4).map((t) => `${t.item.title}${t.s !== null ? ` (${at(t.s)})` : ''}`).join(', ')}${milestones.length > 4 ? ', …' : ''}`);
    if (!points.length) points.push(...placed.slice(0, 4).map((t) => `${t.item.title}: ${span([t]).text}`));
  }
  const done = work.filter((t) => t.item.progress === 100).length;
  const payload = page({
    title: title || 'Imported plan',
    kicker: 'Project plan',
    question: `What is the plan${title ? ` for ${title}` : ''}?`,
    headline,
    text: done ? `${plural(done, 'task')} of ${work.length} ${done === 1 ? 'is' : 'are'} marked done.` : undefined,
    points,
    blocks: [block],
    source
  });
  return { payload, warnings };
}

/**
 * Tasks that run `until` another task starts: each ends the day before it
 * (resolved on the plan, a few passes since the ends move later tasks).
 */
function untilEnds(block, warnings) {
  const open = block.items.filter((it) => it.until !== undefined);
  if (!open.length) return;
  for (const it of open) if (it.days === undefined && it.end === undefined) it.days = 1;
  for (let pass = 0; pass < 4; pass++) {
    const g = resolveGantt(block);
    let moved = false;
    for (const it of open) {
      const ref = g.tasks.find((t) => t.item.id === it.until);
      if (!ref || ref.s === null || g.mode !== 'date') continue;
      const end = fmtDay(ref.s - 1);
      if (it.end === end) continue;
      delete it.days;
      it.end = end;
      moved = true;
    }
    if (!moved) break;
  }
  for (const it of open) {
    if (it.end === undefined) warnings.push(`Gantt: "${it.title}" runs until "${it.until}", which is not a dated task; it lasts one day.`);
    delete it.until;
  }
}

/** Mermaid dateFormat ("YYYY-MM-DD", "DD.MM.YYYY HH:mm", ...) -> a parser to day numbers. */
function dateParser(format) {
  const order = [];
  let times = false;
  const re = String(format || 'YYYY-MM-DD')
    .split(/(YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|A|a|X|x|Q|Do|ddd|dddd|MMM|MMMM)/)
    .map((tok) => {
      if (tok === 'YYYY') return order.push('y'), '(\\d{4})';
      if (tok === 'YY') return order.push('yy'), '(\\d{2})';
      if (tok === 'MM' || tok === 'M') return order.push('m'), '(\\d{1,2})';
      if (tok === 'DD' || tok === 'D') return order.push('d'), '(\\d{1,2})';
      if (/^(HH|H|hh|h|mm|m|ss|s|A|a)$/.test(tok)) return (times = true), '\\S*?';
      if (/^(X|x|Q|Do|ddd|dddd|MMM|MMMM)$/.test(tok)) return '\\S+?';
      return tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  const full = new RegExp(`^${re}$`);
  return {
    times,
    parse(s) {
      const m = full.exec(String(s).trim());
      if (!m) return null;
      const v = {};
      order.forEach((k, i) => (v[k] = Number(m[i + 1])));
      const y = v.y ?? (v.yy !== undefined ? 2000 + v.yy : undefined);
      if (y === undefined || v.m === undefined) return null;
      return parseDay(`${y}-${v.m}-${v.d ?? 1}`);
    }
  };
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** "3d", "2w", "36h", "1.5d" -> days (rounded up), or null. */
function duration(s, warn) {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|M|y)$/.exec(String(s).trim());
  if (!m) return null;
  const n = Number(m[1]);
  const per = { d: 1, w: 7, M: 30, y: 365 }[m[2]];
  if (per) {
    if (m[2] === 'M' || m[2] === 'y') warn('months and years are counted as 30 and 365 days');
    if (!Number.isInteger(n * per)) warn('part days are rounded up');
    return Math.ceil(n * per);
  }
  warn('hours and minutes are rounded up to whole days');
  const hours = m[2] === 'h' ? n : m[2] === 'm' ? n / 60 : m[2] === 's' ? n / 3600 : n / 3.6e6;
  return Math.max(1, Math.ceil(hours / 24));
}

export function fromMermaidGantt(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  const notes = new Set();
  let parser = dateParser('YYYY-MM-DD');
  let inclusive = false;
  let title;
  let section;
  const items = [];
  const off = new Set(); // excluded weekdays
  const closed = []; // excluded dates (day numbers)
  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if ((m = /^title\s+(.+)$/.exec(line))) title = text(m[1]);
    else if ((m = /^dateFormat\s+(.+)$/.exec(line))) {
      parser = dateParser(m[1].trim());
      if (parser.times) notes.add('times of day are dropped: the plan is drawn in whole days');
    } else if (/^inclusiveEndDates\b/.test(line)) inclusive = true;
    else if ((m = /^excludes\s+(.+)$/.exec(line))) {
      // weekends and dates become non-working days; other weekdays cannot be drawn
      for (const tok of m[1].split(/[\s,]+/).filter(Boolean)) {
        const word = tok.toLowerCase().replace(/s$/, '');
        const day = parser.parse(tok);
        if (word === 'weekend') off.add('saturday').add('sunday');
        else if (WEEKDAYS.includes(word)) off.add(word);
        else if (day !== null) closed.push(day);
        else warnings.push(`Line ${no}: excluded day "${tok}" is neither a weekday nor a date; ignored.`);
      }
    } else if ((m = /^weekend\s+(\w+)/.exec(line))) {
      if (m[1].toLowerCase() !== 'saturday') ignored.add('weekend');
    } else if ((m = /^(axisFormat|tickInterval|todayMarker|weekday|includes|click|displayMode|topAxis|accTitle|accDescr|classDef|class)\b/.exec(line))) ignored.add(m[1]);
    else if ((m = /^section\s+(.+)$/.exec(line))) section = text(m[1]);
    else if ((m = /^(.+?)\s*:\s*(.*)$/.exec(line))) {
      const parts = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      const tags = new Set();
      while (parts.length && /^(done|active|crit|milestone|vert)$/.test(parts[0])) tags.add(parts.shift());
      const it = { title: shorten(text(m[1]) || `Task ${items.length + 1}`, 60) };
      let id;
      let start;
      let end;
      if (parts.length >= 3) [id, start, end] = parts;
      else if (parts.length === 2) [start, end] = parts;
      else [end] = parts;
      if (id) it.id = id;
      if (start) {
        const after = /^after\s+(.+)$/.exec(start);
        if (after) {
          const refs = after[1].split(/\s+/);
          it.after = refs.length === 1 ? refs[0] : refs;
        } else {
          const d = parser.parse(start);
          if (d === null) warnings.push(`Line ${no}: start "${start}" does not match dateFormat; the task follows the one above.`);
          else it.start = fmtDay(d);
        }
      }
      if (end && !tags.has('milestone')) {
        const days = duration(end, (why) => notes.add(why));
        const until = /^until\s+(\S+)/.exec(end);
        if (days !== null) it.days = days;
        else if (until) it.until = until[1];
        else {
          const d = parser.parse(end);
          if (d === null) {
            warnings.push(`Line ${no}: end "${end}" is neither a date nor a duration; the task lasts one day.`);
            it.days = 1;
          } else {
            const s = it.start ? parseDay(it.start) : null;
            const last = inclusive ? d : d - 1;
            if (s !== null) it.days = Math.max(1, last - s + 1);
            else it.end = fmtDay(last);
          }
        }
      } else if (!tags.has('milestone')) it.days = 1;
      if (tags.has('milestone')) it.milestone = true;
      if (tags.has('vert')) it.milestone = true;
      if (tags.has('done') && !it.milestone) it.progress = 100;
      if (tags.has('crit')) it.tone = 'bad';
      if (section) it.group = section;
      items.push(it);
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush({
    weekend: 'weekends are Saturday and Sunday',
    includes: 'excluded days stay excluded',
    todayMarker: 'pages are static; add `today` to the gantt block',
    click: 'links are not imported'
  });
  for (const why of notes) warnings.push(`Gantt: ${why}.`);
  // Working days: Saturday and Sunday together, plus excluded dates
  const workdays = off.has('saturday') && off.has('sunday');
  const kept = [...off].filter((d) => !(workdays && (d === 'saturday' || d === 'sunday')));
  if (kept.length) warnings.push(`Gantt: only weekends (Saturday and Sunday together) and dates can be excluded; ${kept.join(', ')} still count${kept.length > 1 ? '' : 's'} as working.`);
  if (closed.length && !workdays) warnings.push('Gantt: excluded dates only count together with "excludes weekends"; they still count as working days.');
  return ganttPage({ title: ctx.title || title, items, workdays, holidays: workdays ? closed : [], source: 'a Mermaid gantt chart', warnings });
}

// --- pie --------------------------------------------------------------------------

export function fromMermaidPie(lines, ctx) {
  const { warnings } = ctx;
  let title = /^pie\b.*?\btitle\s+(.+)$/.exec(lines[0].text)?.[1];
  const showData = /^pie\s+showData\b/.test(lines[0].text);
  let data = [];
  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if ((m = /^title\s+(.+)$/.exec(line))) title = m[1];
    else if ((m = /^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(-?[\d.]+)\s*$/.exec(line))) {
      const value = Number(m[2]);
      if (!Number.isFinite(value) || value < 0) warnings.push(`Line ${no}: "${line}" is not a positive number; slice dropped.`);
      else data.push({ label: text(unquote(m[1])) || `Slice ${data.length + 1}`, value });
    } else if (/^showData$/.test(line) || /^(accTitle|accDescr)\b/.test(line)) {
      // nothing to draw
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  if (!data.length) throw new Error('The pie chart has no slices ("Label" : value).');
  title = ctx.title || (title ? text(unquote(title)) : '');
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!(total > 0)) throw new Error('The pie chart values add up to 0.');
  data.sort((a, b) => b.value - a.value);
  if (data.length > MAX_SLICES) {
    const rest = data.slice(MAX_SLICES - 1);
    warnings.push(`${data.length} slices: the ${rest.length} smallest are merged into "Other" (a pie reads well up to ${MAX_SLICES}).`);
    data = [...data.slice(0, MAX_SLICES - 1), { label: 'Other', value: Math.round(rest.reduce((s, d) => s + d.value, 0) * 100) / 100 }];
  }
  const pct = (v) => `${Math.round((v / total) * 1000) / 10}%`;
  const top = data[0];
  const points = data.slice(0, 4).map((d) => `${d.label}: ${pct(d.value)}${showData ? ` (${fmt(d.value)})` : ''}`);
  const block = { type: 'chart', kind: 'pie', title: title || 'Breakdown', data };
  const payload = page({
    title: title || 'Imported pie chart',
    kicker: 'Breakdown',
    question: `How does ${title ? title.replace(/^./, (c) => c.toLowerCase()) : 'the total'} break down?`,
    headline: `${top.label} is the largest share at ${pct(top.value)} of the total${data.length > 1 ? `, ahead of ${data[1].label} at ${pct(data[1].value)}` : ''}.`,
    text: `${plural(data.length, 'slice')}; total ${fmt(total)}.`,
    points,
    blocks: [block],
    source: 'a Mermaid pie chart'
  });
  return { payload, warnings };
}

// --- timeline -----------------------------------------------------------------------

export function fromMermaidTimeline(lines, ctx) {
  const { warnings } = ctx;
  let title;
  const sections = [];
  let current = null;
  let period = null;
  const sectionNow = () => {
    if (!current) sections.push((current = { title: '', periods: [] }));
    return current;
  };
  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if ((m = /^title\s+(.+)$/.exec(line))) title = text(m[1]);
    else if ((m = /^section\s+(.+)$/.exec(line))) {
      sections.push((current = { title: text(m[1]), periods: [] }));
      period = null;
    } else if (line.startsWith(':')) {
      if (!period) warnings.push(`Line ${no}: event "${line}" has no period before it.`);
      else period.events.push(...line.slice(1).split(/\s*:\s*/).map(text).filter(Boolean));
    } else if ((m = /^([^:]+?)\s*:\s*(.*)$/.exec(line))) {
      period = { date: text(m[1]), events: m[2].split(/\s*:\s*/).map(text).filter(Boolean) };
      sectionNow().periods.push(period);
    } else if (/^(accTitle|accDescr|direction)\b/.test(line)) {
      // nothing to draw
    } else if (line) {
      period = { date: text(line), events: [] };
      sectionNow().periods.push(period);
    }
  }
  const all = sections.flatMap((s) => s.periods);
  if (!all.length) throw new Error('The timeline has no periods ("2024 : event").');
  title = ctx.title || title;
  const item = (p) => {
    const events = p.events.length ? p.events : [p.date];
    const joined = events.join(', ');
    const out = { date: p.date, title: shorten(joined.length <= 60 ? joined : events[0], 80) };
    if (joined.length > 60 && events.length > 1) out.text = events.slice(1).map((e) => `- ${e}`).join('\n');
    return out;
  };
  const named = sections.filter((s) => s.periods.length);
  const blocks = named.map((s, i) => ({ type: 'timeline', title: s.title || (named.length > 1 ? `Part ${i + 1}` : title || 'Timeline'), items: s.periods.map(item) }));
  if (blocks.length > 11) {
    warnings.push(`${blocks.length} sections: merged into one timeline (a page reads best with up to 12 blocks).`);
    blocks.splice(0, blocks.length, { type: 'timeline', title: title || 'Timeline', items: all.map(item) });
  }
  const events = all.reduce((n, p) => n + Math.max(1, p.events.length), 0);
  const first = all[0];
  const last = all[all.length - 1];
  const payload = page({
    title: title || 'Imported timeline',
    kicker: 'Timeline',
    question: title ? `What happened in ${title.replace(/^./, (c) => c.toLowerCase())}?` : 'What happened, and when?',
    headline: all.length > 1 ? `From ${first.date} to ${last.date}: ${plural(events, 'event')} in ${plural(all.length, 'period')}${named.length > 1 ? ` across ${named.length} sections` : ''}.` : `${first.date}: ${plural(events, 'event')}.`,
    points: named.length > 1 ? named.slice(0, 5).map((s) => `${s.title || 'Untitled'}: ${s.periods[0].date}${s.periods.length > 1 ? ` to ${s.periods[s.periods.length - 1].date}` : ''}`) : all.slice(0, 4).map((p) => `${p.date}: ${item(p).title}`),
    blocks,
    source: 'a Mermaid timeline'
  });
  return { payload, warnings };
}

// --- quadrant chart -----------------------------------------------------------------

export function fromMermaidQuadrant(lines, ctx) {
  const { warnings } = ctx;
  const ignored = ignoredCollector(warnings);
  let title;
  const axes = {};
  const quads = [];
  const items = [];
  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if ((m = /^title\s+(.+)$/.exec(line))) title = text(m[1]);
    else if ((m = /^([xy])-axis\s+(.+?)(?:\s*-->\s*(.*))?$/.exec(line))) axes[m[1]] = { low: text(unquote(m[2])), high: m[3] !== undefined ? text(unquote(m[3])) : null };
    else if ((m = /^quadrant-([1-4])\s+(.+)$/.exec(line))) quads[Number(m[1])] = text(unquote(m[2]));
    else if ((m = /^("[^"]*"|[^:[]+?)(?::::[\w-]+)?\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\](.*)$/.exec(line))) {
      if (m[4].trim()) ignored.add('point style');
      if (line.includes(':::')) ignored.add('classDef');
      items.push({ label: text(unquote(m[1])) || `Point ${items.length + 1}`, x: Number(m[2]), y: Number(m[3]) });
    } else if ((m = /^(classDef|accTitle|accDescr)\b/.exec(line))) ignored.add(m[1]);
    else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  ignored.flush({ 'point style': 'colours come from the page theme', classDef: 'colours come from the page theme' });
  if (!items.length) throw new Error('The quadrant chart has no points ("Name: [0.3, 0.6]").');
  title = ctx.title || title;
  const axis = (a, fallback) => {
    if (!a) return { label: fallback, min: 0, max: 1 };
    return a.high ? { label: '', low: a.low, high: a.high, min: 0, max: 1 } : { label: a.low, min: 0, max: 1 };
  };
  // Mermaid numbers quadrants 1 top right, 2 top left, 3 bottom left, 4 bottom right;
  // the matrix block lists top left, top right, bottom left, bottom right
  const names = [quads[2], quads[1], quads[3], quads[4]];
  const block = { type: 'matrix', title: title || 'Quadrants', x: axis(axes.x, 'x'), y: axis(axes.y, 'y'), items };
  if (names.some(Boolean)) block.quadrants = names.map((n, i) => ({ title: n || ['Top left', 'Top right', 'Bottom left', 'Bottom right'][i] }));
  const corner = (it) => (it.y >= 0.5 ? 0 : 2) + (it.x >= 0.5 ? 1 : 0);
  const where = ['top left', 'top right', 'bottom left', 'bottom right'];
  const counts = [0, 1, 2, 3].map((q) => items.filter((it) => corner(it) === q));
  const most = counts.reduce((best, c, q) => (c.length > counts[best].length ? q : best), 0);
  const qName = (q) => (names[q] ? `“${names[q]}” (${where[q]})` : `the ${where[q]} quadrant`);
  const payload = page({
    title: title || 'Imported quadrant chart',
    kicker: 'Prioritisation',
    question: title ? `Where does each item sit on ${title.replace(/^./, (c) => c.toLowerCase())}?` : 'Where does each item sit?',
    headline: `${counts[most].length} of ${plural(items.length, 'item')} fall in ${qName(most)}: ${list(counts[most].slice(0, 4).map((it) => it.label))}${counts[most].length > 4 ? ' and others' : ''}.`,
    points: [0, 1, 2, 3].filter((q) => counts[q].length).map((q) => `${names[q] || where[q][0].toUpperCase() + where[q].slice(1)}: ${counts[q].map((it) => it.label).join(', ')}`),
    blocks: [block],
    source: 'a Mermaid quadrant chart'
  });
  return { payload, warnings };
}

// --- user journey ---------------------------------------------------------------------

const MOODS = {
  good: { label: 'Good moment (4-5)', color: 'green' },
  neutral: { label: 'Neutral (3)', color: 'amber' },
  pain: { label: 'Pain point (1-2)', color: 'rose' }
};

export function fromMermaidJourney(lines, ctx) {
  const { warnings } = ctx;
  let title;
  let section = null;
  const sections = [];
  const tasks = [];
  for (const { text: line, no } of lines.slice(1)) {
    let m;
    if ((m = /^title\s+(.+)$/.exec(line))) title = text(m[1]);
    else if ((m = /^section\s+(.+)$/.exec(line))) sections.push((section = { raw: `s${sections.length}`, title: text(m[1]) }));
    else if ((m = /^(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*(?::\s*(.*))?$/.exec(line))) {
      const score = Math.max(1, Math.min(5, Math.round(Number(m[2]))));
      if (String(score) !== m[2]) warnings.push(`Line ${no}: score ${m[2]} is drawn as ${score} (scores are 1-5).`);
      const actors = (m[3] || '').split(',').map(text).filter(Boolean);
      tasks.push({ raw: `t${tasks.length}`, label: text(m[1]), score, actors, section });
    } else if (/^(accTitle|accDescr)\b/.test(line)) {
      // nothing to draw
    } else warnings.push(`Line ${no}: could not parse "${line}".`);
  }
  if (!tasks.length) throw new Error('The journey has no tasks ("Task: 5: Actor").');
  title = ctx.title || title || 'Imported user journey';
  const mood = (s) => (s >= 4 ? 'good' : s === 3 ? 'neutral' : 'pain');
  const nodes = tasks.map((t) => {
    const data = { badge: `${t.score}/5` };
    if (t.actors.length) data.subtitle = t.actors.join(', ');
    return { raw: t.raw, label: t.label, type: mood(t.score), group: t.section?.raw, hint: slug(t.label) || undefined, data };
  });
  const edges = tasks.slice(1).map((t, i) => ({ from: tasks[i].raw, to: t.raw, label: t.section !== tasks[i].section ? 'next stage' : 'then' }));
  const res = buildFlow({
    nodes,
    edges,
    groups: sections.map((s) => ({ raw: s.raw, title: s.title, hint: slug(s.title) || undefined })),
    direction: 'LR',
    title,
    description: `Imported from a Mermaid user journey: ${plural(tasks.length, 'task')} in ${plural(Math.max(1, sections.length), 'section')}; scores 1 (painful) to 5 (great).`,
    warnings
  });
  const { payload } = res;
  payload.roles = Object.fromEntries(Object.keys(payload.roles).map((k) => [k, { ...MOODS[k] }]));
  const idOf = new Map(tasks.map((t, i) => [t.raw, payload.nodes[i].id]));
  const edgeInto = new Map(payload.edges.map((e) => [e.target, e.id]));
  const describe = (t) => `${t.label} (${t.score}/5${t.actors.length ? `, ${t.actors.join(', ')}` : ''})`;
  const pains = tasks.filter((t) => t.score <= 2);
  const avg = tasks.reduce((s, t) => s + t.score, 0) / tasks.length;
  const steps = [
    {
      id: 'overview',
      title: 'Overview',
      description: `${plural(tasks.length, 'task')}, average score ${fmt(avg)} of 5.${pains.length ? ` Pain points: ${list(pains.map(describe))}.` : ' No pain points (scores of 2 or less).'}`
    }
  ];
  // One step per section (or per task without sections), bucketed to the budget
  const chunks = sections.length ? sections.map((s) => tasks.filter((t) => t.section === s)).filter((c) => c.length) : tasks.map((t) => [t]);
  const unsectioned = sections.length ? tasks.filter((t) => !t.section) : [];
  if (unsectioned.length) chunks.unshift(unsectioned);
  const per = Math.ceil(chunks.length / MAX_STEPS);
  for (let i = 0; i < chunks.length; i += per) {
    const ts = chunks.slice(i, i + per).flat();
    const names = [...new Set(ts.map((t) => t.section?.title).filter(Boolean))];
    const low = ts.reduce((a, t) => (t.score < a.score ? t : a));
    steps.push({
      id: `step-${steps.length}`,
      title: shorten(names.length ? list(names) : ts.map((t) => t.label).join(', '), 60),
      description: `${ts.map(describe).join('; ')}.${ts.length > 1 && low.score <= 2 ? ` Lowest: ${low.label}.` : ''}`,
      highlightNodes: ts.map((t) => idOf.get(t.raw)),
      highlightEdges: ts.map((t) => edgeInto.get(idOf.get(t.raw))).filter((e) => {
        const src = payload.edges.find((x) => x.id === e)?.source;
        return e && ts.some((t) => idOf.get(t.raw) === src);
      })
    });
  }
  payload.scenarios = [{ id: 'main', name: 'Journey', steps }];
  return res;
}
