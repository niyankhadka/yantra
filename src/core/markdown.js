/** Companion Markdown spec generated from a payload. */
import { normalize, groupIndex, roleKey, arrowOf } from './model.js';
import { pageToMarkdown } from './page.js';
import { mdInline as md, mdBlock } from './text.js';
import { isEntity, members, memberKey, memberName, memberType, VISIBILITY_NAMES } from './entity.js';
import { hasNotation, notationText } from './notation.js';
import { collectDiagrams, drillOf, levelOrder, safeUrl } from './drill.js';

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
  const rootTitle = payload?.meta?.title || 'Overview';
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
  const title = (id) => model.nodes.find((n) => n.id === id)?.data?.title || id;
  const out = [];

  out.push(`# ${md(meta.title || 'Diagram')}`, '');
  if (meta.description) out.push(`> ${md(meta.description)}`, '');
  if (meta.version) out.push(`Version ${md(meta.version)}`, '');
  const summary = meta.summary && typeof meta.summary === 'object' ? meta.summary : null;
  if (summary) {
    out.push('## Summary', '');
    if (summary.headline) out.push(`**${md(summary.headline)}**`, '');
    (Array.isArray(summary.points) ? summary.points : []).forEach((pt) => out.push(`- ${md(pt)}`));
    Object.entries(summary.facts && typeof summary.facts === 'object' ? summary.facts : {}).forEach(([k, v]) => out.push(`- **${md(k)}:** ${md(v)}`));
    out.push('');
  }

  out.push('## Components', '', '| Component | Role | Technology | Description |', '|---|---|---|---|');
  for (const n of model.nodes) {
    const d = n.data || {};
    const role = model.roles[roleKey(n)]?.label || n.type;
    const name = href(d.url) ? `[**${cell(d.title || n.id)}**](${href(d.url)})` : `**${cell(d.title || n.id)}**`;
    const drill = drillOf(n);
    const detail = drill && details.has(drill) ? ` (detail: ${cell(details.get(drill).meta?.title || drill)})` : '';
    out.push(`| ${name}${detail} | ${cell(role)} | ${cell(d.tech)} | ${cell(d.description || d.subtitle)} |`);
  }

  const gi = groupIndex(model.groups, new Set(model.nodes.map((n) => n.id)));
  if (gi.list.length) {
    out.push('', '## Groups', '', '| Group | Inside | Members | Description |', '|---|---|---|---|');
    for (const g of gi.list) {
      const direct = g.nodes.filter((id) => gi.nodeGroup.get(id) === g.id).map(title);
      const sub = gi.list.filter((c) => c.parent === g.id).map((c) => `${c.title} (group)`);
      out.push(`| **${cell(g.title)}** | ${cell(g.parent ? gi.byId.get(g.parent)?.title : '')} | ${cell([...direct, ...sub].join(', '))} | ${cell(g.group.description)} |`);
    }
  }

  // Entity / class cards: one table of columns or members each
  const entities = model.nodes.filter((n) => isEntity(n.data));
  if (entities.length) {
    out.push('', '## Fields', '');
    for (const n of entities) {
      const d = n.data;
      out.push(`### ${md(d.stereotype ? `«${d.stereotype}» ` : '')}${md(d.title || n.id)}`, '');
      const fields = members(d.fields);
      if (fields.length) {
        const keyed = fields.some((f) => f.pk || f.fk || f.unique);
        out.push(`| Field | Type | ${keyed ? 'Key' : 'Visibility'} | Notes |`, '|---|---|---|---|');
        for (const f of fields) {
          const notes = [f.ref && `→ ${f.ref}`, f.nullable && 'nullable', f.note].filter(Boolean).join('; ');
          const key = memberKey(f, 'fields');
          out.push(`| ${cell(memberName(f, 'fields'))} | ${cell(f.type)} | ${cell(keyed ? key : VISIBILITY_NAMES[key])} | ${cell(notes)} |`);
        }
      }
      const methods = members(d.methods);
      if (methods.length) {
        if (fields.length) out.push('');
        out.push('| Method | Returns | Visibility |', '|---|---|---|');
        for (const m of methods) {
          const flags = [m.static && 'static', m.abstract && 'abstract'].filter(Boolean).join(', ');
          out.push(`| ${cell(memberName(m, 'methods'))}${flags ? ` (${md(flags)})` : ''} | ${cell(memberType(m))} | ${cell(VISIBILITY_NAMES[memberKey(m, 'methods')])} |`);
        }
      }
      out.push('');
    }
    out.pop();
  }

  // Extra columns appear only when needed: Direction when some edge is not a
  // plain one-way arrow, Relationship when some edge carries notation
  const ARROW_TEXT = { forward: '→', both: '↔ both ways', none: '— undirected' };
  const directed = model.edges.some((e) => !hasNotation(e) && (arrowOf(e) !== 'forward' || e.source === e.target));
  const notation = model.edges.some(hasNotation);
  out.push('', '## Connections', '', `| From | To |${directed ? ' Direction |' : ''} Label |${notation ? ' Relationship |' : ''}`, `|---|---|${directed ? '---|' : ''}---|${notation ? '---|' : ''}`);
  for (const e of model.edges) {
    const dir = hasNotation(e) ? '' : e.source === e.target ? `↻ self-loop${arrowOf(e) === 'forward' ? '' : ` (${ARROW_TEXT[arrowOf(e)].slice(2)})`}` : ARROW_TEXT[arrowOf(e)];
    out.push(`| ${cell(title(e.source))} | ${cell(title(e.target))} |${directed ? ` ${cell(dir)} |` : ''} ${href(e.url) ? `[${cell(e.label || 'link')}](${href(e.url)})` : cell(e.label)} |${notation ? ` ${cell(notationText(e))} |` : ''}`);
  }

  if (model.modes.length > 1) {
    out.push('', '## Modes', '');
    for (const m of model.modes) {
      const hidden = (Array.isArray(m.hideNodes) ? m.hideNodes : []).map(title);
      out.push(`- **${md(m.name || m.id)}**${m.description ? ` - ${md(m.description)}` : ''}${hidden.length ? ` (hides: ${hidden.map(md).join(', ')})` : ''}`);
    }
  }

  for (const panel of model.panels) {
    if (!panel.title || !Array.isArray(panel.blocks)) continue;
    // Panels reuse the page block renderer for Markdown too
    const body = pageToMarkdown({ blocks: panel.blocks }).replace(/^# .*\n+/, '').replace(/^## /gm, '### ');
    out.push('', `## ${md(panel.title)}`, '', body.trim());
  }

  for (const sc of model.scenarios) {
    if (!sc.steps?.length) continue;
    out.push('', `## ${md(sc.name || 'Walkthrough')}`, '');
    if (sc.description) out.push(mdBlock(sc.description), '');
    sc.steps.forEach((st, i) => {
      out.push(`### ${i + 1}. ${md(st.title)}`, '');
      if (st.description) out.push(mdBlock(st.description), '');
      if (href(st.url)) out.push(`[More: ${md(st.url)}](${href(st.url)})`, '');
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
