/** Companion Markdown spec generated from a payload. */
import { normalize, groupIndex, roleKey } from './model.js';
import { pageToMarkdown } from './page.js';
import { mdInline as md, mdBlock } from './text.js';

const cell = (v) => md(v ?? '—').replace(/\|/g, '\\|') || '—';

export function toMarkdown(payload) {
  const model = normalize(payload);
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
    out.push(`| **${cell(d.title || n.id)}** | ${cell(role)} | ${cell(d.tech)} | ${cell(d.description || d.subtitle)} |`);
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

  out.push('', '## Connections', '', '| From | To | Label |', '|---|---|---|');
  for (const e of model.edges) out.push(`| ${cell(title(e.source))} | ${cell(title(e.target))} | ${cell(e.label)} |`);

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
