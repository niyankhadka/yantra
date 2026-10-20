/** Companion Markdown spec generated from a payload; headings and labels follow meta.lang. */
import { normalize, groupIndex, roleKey, arrowOf } from './model.js';
import { pageToMarkdown } from './page.js';
import { mdInline as md, mdBlock } from './text.js';
import { isEntity, members, memberKey, memberName, memberType, VISIBILITY_NAMES } from './entity.js';
import { hasNotation, notationText } from './notation.js';
import { collectDiagrams, drillOf, levelOrder, safeUrl } from './drill.js';
import { localeOf } from './i18n.js';

const cell = (v) => md(v ?? '—').replace(/\|/g, '\\|') || '—';
/** Markdown link target (safe URLs only), bare unless it has spaces or brackets. */
const href = (u) => {
  const t = safeUrl(u);
  return t && (/[\s()<>]/.test(t) ? `<${t.replace(/[<>\s]/g, encodeURIComponent)}>` : t);
};

/**
 * Markdown spec of one level. `levels: true` appends every detail diagram
 * (drill-down levels), each under a heading with its breadcrumb.
 */
export function toMarkdown(payload, { levels = false } = {}) {
  let text = levelMarkdown(payload, payload);
  if (!levels) return text;
  const titles = collectDiagrams(payload).map;
  const rootTitle = payload?.meta?.title || localeOf(payload?.meta).t('drill.overview');
  for (const lv of levelOrder(payload)) {
    const crumbs = [rootTitle, ...lv.trail.map((id) => titles.get(id)?.meta?.title || id)].map(md).join(' › ');
    // One heading level down; the level title becomes its breadcrumb
    const body = levelMarkdown(lv.payload, payload).replace(/^# .*$/m, () => `# ${crumbs}`).replace(/^(#+) /gm, '#$1 ');
    text += `\n---\n\n${body}`;
  }
  return text;
}

function levelMarkdown(payload, root) {
  const model = normalize(payload);
  const details = collectDiagrams(root).map;
  const { meta } = model;
  const L = localeOf(meta);
  const { t } = L;
  const visibility = (key) => (VISIBILITY_NAMES[key] ? t(`vis.${VISIBILITY_NAMES[key]}`) : '');
  const title = (id) => model.nodes.find((n) => n.id === id)?.data?.title || id;
  const row = (...cells) => `| ${cells.join(' | ')} |`;
  const out = [];

  out.push(`# ${md(meta.title || t('export.diagram'))}`, '');
  if (meta.description) out.push(`> ${md(meta.description)}`, '');
  if (meta.version) out.push(md(t('md.version', { v: meta.version })), '');
  const summary = meta.summary && typeof meta.summary === 'object' ? meta.summary : null;
  if (summary) {
    out.push(`## ${md(t('tab.summary'))}`, '');
    if (summary.headline) out.push(`**${md(summary.headline)}**`, '');
    (Array.isArray(summary.points) ? summary.points : []).forEach((pt) => out.push(`- ${md(pt)}`));
    Object.entries(summary.facts && typeof summary.facts === 'object' ? summary.facts : {}).forEach(([k, v]) => out.push(`- **${md(k)}:** ${md(v)}`));
    out.push('');
  }

  out.push(`## ${md(t('summary.components'))}`, '', row(...['md.component', 'md.role', 'node.tech', 'md.description'].map((k) => cell(t(k)))), '|---|---|---|---|');
  for (const n of model.nodes) {
    const d = n.data || {};
    const role = model.roles[roleKey(n)]?.label || n.type;
    const name = href(d.url) ? `[**${cell(d.title || n.id)}**](${href(d.url)})` : `**${cell(d.title || n.id)}**`;
    const drill = drillOf(n);
    const detail = drill && details.has(drill) ? ` (${cell(t('md.detail', { title: details.get(drill).meta?.title || drill }))})` : '';
    out.push(`| ${name}${detail} | ${cell(role)} | ${cell(d.tech)} | ${cell(d.description || d.subtitle)} |`);
  }

  const gi = groupIndex(model.groups, new Set(model.nodes.map((n) => n.id)));
  if (gi.list.length) {
    out.push('', `## ${md(t('md.groups'))}`, '', row(...['md.group', 'md.inside', 'md.members', 'md.description'].map((k) => cell(t(k)))), '|---|---|---|---|');
    for (const g of gi.list) {
      const direct = g.nodes.filter((id) => gi.nodeGroup.get(id) === g.id).map(title);
      const sub = gi.list.filter((c) => c.parent === g.id).map((c) => t('md.groupSuffix', { name: c.title }));
      out.push(`| **${cell(g.title)}** | ${cell(g.parent ? gi.byId.get(g.parent)?.title : '')} | ${cell([...direct, ...sub].join(', '))} | ${cell(g.group.description)} |`);
    }
  }

  // Entity / class cards: one table of columns or members each
  const entities = model.nodes.filter((n) => isEntity(n.data));
  if (entities.length) {
    out.push('', `## ${md(t('md.fields'))}`, '');
    for (const n of entities) {
      const d = n.data;
      out.push(`### ${md(d.stereotype ? `«${d.stereotype}» ` : '')}${md(d.title || n.id)}`, '');
      const fields = members(d.fields);
      if (fields.length) {
        const keyed = fields.some((f) => f.pk || f.fk || f.unique);
        out.push(row(...['md.field', 'md.type', keyed ? 'md.key' : 'md.visibility', 'md.notes'].map((k) => cell(t(k)))), '|---|---|---|---|');
        for (const f of fields) {
          const notes = [f.ref && `→ ${f.ref}`, f.nullable && t('md.nullable'), f.note].filter(Boolean).join('; ');
          const key = memberKey(f, 'fields');
          out.push(`| ${cell(memberName(f, 'fields'))} | ${cell(f.type)} | ${cell(keyed ? key : visibility(key))} | ${cell(notes)} |`);
        }
      }
      const methods = members(d.methods);
      if (methods.length) {
        if (fields.length) out.push('');
        out.push(row(...['md.method', 'md.returns', 'md.visibility'].map((k) => cell(t(k)))), '|---|---|---|');
        for (const m of methods) {
          const flags = [m.static && t('md.static'), m.abstract && t('md.abstract')].filter(Boolean).join(', ');
          out.push(`| ${cell(memberName(m, 'methods'))}${flags ? ` (${md(flags)})` : ''} | ${cell(memberType(m))} | ${cell(visibility(memberKey(m, 'methods')))} |`);
        }
      }
      out.push('');
    }
    out.pop();
  }

  // Extra columns appear only when needed: Direction when some edge is not a
  // plain one-way arrow, Relationship when some edge carries notation
  const ARROW_TEXT = { forward: '→', both: `↔ ${t('md.both')}`, none: `— ${t('md.undirected')}` };
  const directed = model.edges.some((e) => !hasNotation(e) && (arrowOf(e) !== 'forward' || e.source === e.target));
  // End labels (multiplicities, roles) join the Relationship column, as "1 → 0..*"
  const endText = (e) => {
    const lab = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const [a, b] = [lab(e.sourceLabel), lab(e.targetLabel)];
    return a || b ? `${a || '—'} → ${b || '—'}` : '';
  };
  const notation = model.edges.some((e) => hasNotation(e) || endText(e));
  // An end that attaches to a field row names it: "Orders.customer_id"
  const endName = (id, field) => (typeof field === 'string' && field ? `${title(id)}.${field}` : title(id));
  out.push('', `## ${md(t('summary.connections'))}`, '', row(...['md.from', 'md.to', ...(directed ? ['md.direction'] : []), 'md.label', ...(notation ? ['md.relationship'] : [])].map((k) => cell(t(k)))), `|---|---|${directed ? '---|' : ''}---|${notation ? '---|' : ''}`);
  for (const e of model.edges) {
    const dir = hasNotation(e) ? '' : e.source === e.target ? `↻ ${t('md.selfLoop')}${arrowOf(e) === 'forward' ? '' : ` (${ARROW_TEXT[arrowOf(e)].slice(2)})`}` : ARROW_TEXT[arrowOf(e)];
    const rel = [notationText(e, L), endText(e)].filter(Boolean).join('; ');
    out.push(`| ${cell(endName(e.source, e.sourceField))} | ${cell(endName(e.target, e.targetField))} |${directed ? ` ${cell(dir)} |` : ''} ${href(e.url) ? `[${cell(e.label || t('md.link'))}](${href(e.url)})` : cell(e.label)} |${notation ? ` ${cell(rel)} |` : ''}`);
  }

  if (model.modes.length > 1) {
    out.push('', `## ${md(t('summary.modes'))}`, '');
    for (const m of model.modes) {
      const hidden = (Array.isArray(m.hideNodes) ? m.hideNodes : []).map(title);
      out.push(`- **${md(m.name || m.id)}**${m.description ? ` - ${md(m.description)}` : ''}${hidden.length ? ` (${md(t('md.hides', { list: hidden.join(', ') }))})` : ''}`);
    }
  }

  for (const panel of model.panels) {
    if (!panel.title || !Array.isArray(panel.blocks)) continue;
    // Panels reuse the page block renderer for Markdown too
    const body = pageToMarkdown({ meta: { lang: meta.lang, dir: meta.dir, strings: meta.strings }, blocks: panel.blocks }).replace(/^# .*\n+/, '').replace(/^## /gm, '### ');
    out.push('', `## ${md(panel.title)}`, '', body.trim());
  }

  for (const sc of model.scenarios) {
    if (!sc.steps?.length) continue;
    out.push('', `## ${md(sc.name && !(sc.id === 'main' && !payload?.scenarios) ? sc.name : t('story.label'))}`, '');
    if (sc.description) out.push(mdBlock(sc.description), '');
    sc.steps.forEach((st, i) => {
      out.push(`### ${i + 1}. ${md(st.title)}`, '');
      if (st.description) out.push(mdBlock(st.description), '');
      if (href(st.url)) out.push(`[${md(t('md.more', { url: st.url }))}](${href(st.url)})`, '');
      const p = st.payload;
      if (p && (p.method || p.endpoint)) out.push(`${code([p.method, p.endpoint].filter(Boolean).join(' '))}${p.status ? ` → ${md(p.status)}` : ''}${p.latency ? ` (${md(p.latency)})` : ''}`, '');
    });
  }
  return `${out.join('\n')}\n`;
}

/** Inline code span that payload backticks cannot close early. */
function code(v) {
  const t = String(v).replace(/[\r\n]+/g, ' ');
  const fence = '`'.repeat(Math.max(0, ...[...t.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return `${fence}${fence.length > 1 ? ' ' : ''}${t}${fence.length > 1 ? ' ' : ''}${fence}`;
}
