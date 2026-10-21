/**
 * `yantra init`: set up a project so coding agents can use Yantra.
 *
 * Writes the portable skill, an MCP server entry and short rules for each agent,
 * only inside the target folder. Existing files are kept unless `force` is set;
 * JSON MCP configs are merged (other servers stay), AGENTS.md gets a marked section.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './build.js';

export const AGENTS = ['claude', 'cursor', 'codex', 'antigravity'];
export const NPM_PACKAGE = '@niyankhadka/yantra';
export const SKILL_SOURCE = path.join(ROOT, 'skills', 'yantra', 'SKILL.md');
const MARK_START = '<!-- yantra:start -->';
const MARK_END = '<!-- yantra:end -->';

/** The MCP launch command: `cmd /c npx` on Windows, where `npx` is a .cmd shim that clients cannot spawn directly. */
export function mcpCommand(windows) {
  const args = ['-y', NPM_PACKAGE, 'mcp'];
  return windows ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: 'npx', args };
}

const RULES = `- Follow the \`yantra\` skill: plan the story (an overview step, then focused steps that list
  nodes and edges), keep within budgets (about 6-14 cards, 3-5 roles, 1-3 word edge labels)
  and split big systems into an overview plus drill-down detail diagrams.
- Never write node coordinates; layout and routing are automatic.
- Protocols and call orders (auth, payments, webhooks) use \`meta.view: "sequence"\`; data
  models use \`data.fields\` cards with field-to-field edges; one-page answers
  (\`"kind": "page"\`) put the headline first.
- For codebase diagrams, read the routes, services, schema and migrations first and cite
  files in \`data.sourceFile\`. Keep files in \`docs/diagrams/\` unless the project has a place.
- Validate before building and look at a screenshot before calling it done. Use the
  \`yantra_*\` MCP tools when connected, otherwise \`npx -y ${NPM_PACKAGE} <validate|build|screenshot|schema|examples>\`.`;

const RULE_DESCRIPTION = 'Yantra diagrams and one-page answers: architecture, flows, sequence diagrams, ERDs, state machines, org charts, mind maps, explainers, Mermaid/PlantUML/draw.io import';

const cursorRule = () => `---
description: ${JSON.stringify(RULE_DESCRIPTION)}
globs:
alwaysApply: false
---

# Yantra diagrams

${RULES}
`;

const antigravityRule = () => `# Yantra diagrams

${RULES}
`;

const agentsSection = () => `${MARK_START}
## Diagrams with Yantra

Use Yantra for diagrams (architecture, flows, sequence, ERD, state machines, org charts,
mind maps) and one-page answers. The full workflow is the \`yantra\` skill in
\`.agents/skills/yantra/SKILL.md\`.

${RULES}
${MARK_END}`;

const codexToml = (cmd) => `[mcp_servers.yantra]
command = ${JSON.stringify(cmd.command)}
args = [${cmd.args.map((a) => JSON.stringify(a)).join(', ')}]
`;

/** Agents whose folders already exist in `dir` (an empty list when none do). */
export function detectAgents(dir) {
  const has = (p) => fs.existsSync(path.join(dir, p));
  const found = [];
  if (has('.claude') || has('CLAUDE.md') || has('.mcp.json')) found.push('claude');
  if (has('.cursor') || has('.cursorrules')) found.push('cursor');
  if (has('.codex') || has('AGENTS.md')) found.push('codex');
  if (has('.agents') || has('.agent')) found.push('antigravity');
  return found;
}

/** Throw unless `file` (and the real location of its nearest existing parent) is inside `root`. */
function assertInside(root, file) {
  const realRoot = fs.realpathSync(root);
  const inside = (base, p) => {
    const rel = path.relative(base, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (!inside(root, file)) throw new Error(`Refusing to write ${file}: outside ${root}.`);
  let p = file;
  while (!fs.existsSync(p)) p = path.dirname(p);
  if (!inside(realRoot, fs.realpathSync(p))) throw new Error(`Refusing to write ${file}: ${p} links outside ${root}.`);
}

/**
 * Plan (and unless `dryRun`, apply) the setup.
 * @param {{ dir?: string, agents?: string[], force?: boolean, dryRun?: boolean, windows?: boolean }} opts
 * @returns {{ dir: string, agents: string[], detected: boolean, files: {path: string, agent: string, action: string, note?: string}[], notes: string[], ok: boolean }}
 */
export function init(opts = {}) {
  const dir = path.resolve(opts.dir || process.cwd());
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Folder not found: ${dir}`);
  const unknown = (opts.agents || []).filter((a) => !AGENTS.includes(a));
  if (unknown.length) throw new Error(`Unknown agent "${unknown[0]}" (use ${AGENTS.join(', ')}).`);
  let agents = AGENTS.filter((a) => (opts.agents || []).includes(a));
  let detected = false;
  if (!agents.length) {
    agents = detectAgents(dir);
    detected = agents.length > 0;
    if (!detected) agents = ['claude'];
  }
  const windows = opts.windows ?? process.platform === 'win32';
  const cmd = mcpCommand(windows);
  const skill = fs.readFileSync(SKILL_SOURCE, 'utf-8').replace(/\r\n/g, '\n');
  const files = [];
  const notes = [];
  let ok = true;

  const target = (rel) => {
    const abs = path.join(dir, rel);
    assertInside(dir, abs);
    return abs;
  };
  // Writes wait until every path has been checked, so a refusal leaves the project untouched.
  const pending = [];
  const write = (abs, text) => pending.push([abs, text]);
  const record = (agent, rel, action, note) => files.push({ path: rel.replace(/\\/g, '/'), agent, action, ...(note ? { note } : {}) });

  /** A whole file Yantra owns: written when missing, replaced only with force. */
  const putFile = (agent, rel, text) => {
    if (files.some((f) => f.path === rel)) return record(agent, rel, 'shared');
    const abs = target(rel);
    if (!fs.existsSync(abs)) {
      write(abs, text);
      return record(agent, rel, 'created');
    }
    const old = fs.readFileSync(abs, 'utf-8');
    if (old.replace(/\r\n/g, '\n') === text) return record(agent, rel, 'unchanged');
    if (!opts.force) return record(agent, rel, 'skipped', 'exists and differs; --force replaces it');
    write(abs, text);
    return record(agent, rel, 'replaced');
  };

  /** A JSON MCP config: add `mcpServers.yantra`, keep every other key and server. */
  const putMcpJson = (agent, rel, entry) => {
    if (files.some((f) => f.path === rel)) return record(agent, rel, 'shared');
    const abs = target(rel);
    let data = {};
    let exists = false;
    if (fs.existsSync(abs)) {
      exists = true;
      const text = fs.readFileSync(abs, 'utf-8');
      try {
        data = text.trim() ? JSON.parse(text) : {};
      } catch (err) {
        ok = false;
        return record(agent, rel, 'error', `not valid JSON (${err.message}); add the yantra server by hand`);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        ok = false;
        return record(agent, rel, 'error', 'not a JSON object; add the yantra server by hand');
      }
    }
    const servers = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {};
    const old = servers.yantra;
    if (old && JSON.stringify(old) === JSON.stringify(entry)) return record(agent, rel, 'unchanged');
    if (old && !opts.force) return record(agent, rel, 'skipped', 'already has a yantra server; --force replaces it');
    write(abs, `${JSON.stringify({ ...data, mcpServers: { ...servers, yantra: entry } }, null, 2)}\n`);
    return record(agent, rel, !exists ? 'created' : old ? 'replaced' : 'merged');
  };

  /** A marked section in a Markdown or TOML file: appended once, replaced only with force. */
  const putSection = (agent, rel, section, { start, end, fresh }) => {
    const abs = target(rel);
    if (!fs.existsSync(abs)) {
      write(abs, `${fresh ? `${fresh}\n\n` : ''}${section}\n`);
      return record(agent, rel, 'created');
    }
    const old = fs.readFileSync(abs, 'utf-8');
    const norm = old.replace(/\r\n/g, '\n');
    const i = norm.indexOf(start);
    if (i >= 0) {
      const j = end ? norm.indexOf(end, i) : -1;
      const stop = end ? (j < 0 ? -1 : j + end.length) : nextTomlTable(norm, i);
      const current = stop < 0 ? norm.slice(i) : norm.slice(i, stop);
      if (current.trim() === section.trim()) return record(agent, rel, 'unchanged');
      if (!opts.force) return record(agent, rel, 'skipped', 'already has a Yantra section; --force replaces it');
      const rest = stop < 0 ? '\n' : end ? norm.slice(stop) || '\n' : `\n\n${norm.slice(stop)}`;
      write(abs, `${norm.slice(0, i)}${section.trimEnd()}${rest}`);
      return record(agent, rel, 'replaced');
    }
    write(abs, `${norm.replace(/\s*$/, '')}\n\n${section}\n`);
    return record(agent, rel, 'merged');
  };

  for (const agent of agents) {
    if (agent === 'claude') {
      putFile(agent, '.claude/skills/yantra/SKILL.md', skill);
      putMcpJson(agent, '.mcp.json', { ...cmd });
      notes.push('Claude Code: restart it in this folder, approve the "yantra" MCP server, then type /yantra or just ask for a diagram.');
    }
    if (agent === 'cursor') {
      putFile(agent, '.cursor/rules/yantra.mdc', cursorRule());
      // Cursor also loads skills from .claude/skills and .agents/skills: one copy is enough.
      if (agents.some((a) => a !== 'cursor') || fs.existsSync(path.join(dir, '.claude/skills/yantra/SKILL.md')) || fs.existsSync(path.join(dir, '.agents/skills/yantra/SKILL.md')))
        record(agent, '.cursor/skills/yantra/SKILL.md', 'skipped', 'Cursor reads the skill from .claude/skills or .agents/skills');
      else putFile(agent, '.cursor/skills/yantra/SKILL.md', skill);
      putMcpJson(agent, '.cursor/mcp.json', { ...cmd, env: { YANTRA_INPUT_ROOT: '${workspaceFolder}', YANTRA_OUTPUT_ROOT: '${workspaceFolder}' } });
      notes.push('Cursor: enable the "yantra" server under Settings > MCP, then type /yantra or ask for a diagram.');
    }
    if (agent === 'codex') {
      putFile(agent, '.agents/skills/yantra/SKILL.md', skill);
      putSection(agent, 'AGENTS.md', agentsSection(), { start: MARK_START, end: MARK_END, fresh: '# Agent guide' });
      putSection(agent, '.codex/config.toml', codexToml(cmd), { start: '[mcp_servers.yantra]' });
      notes.push(`Codex: .codex/config.toml is read only in trusted projects. To use Yantra everywhere, add this to ~/.codex/config.toml:\n\n${codexToml(cmd).trimEnd().replace(/^/gm, '    ')}`);
    }
    if (agent === 'antigravity') {
      putFile(agent, '.agents/skills/yantra/SKILL.md', skill);
      putFile(agent, '.agents/rules/yantra.md', antigravityRule());
      putMcpJson(agent, '.agents/mcp_config.json', { ...cmd, description: 'Yantra interactive diagrams and one-page answers' });
      notes.push('Antigravity: if the server does not appear, add the same entry under Manage MCP Servers > View raw config.');
    }
  }
  if (!opts.dryRun) {
    for (const [abs, text] of pending) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
  }
  return { dir, agents, detected, windows, files, notes, ok };
}

/** End of the TOML table whose header starts at `i` (its own sub-tables included): the next table header, or -1. */
function nextTomlTable(text, i) {
  const after = text.indexOf('\n', i);
  if (after < 0) return -1;
  const re = /^[ \t]*\[(?!mcp_servers\.yantra\.)/gm;
  re.lastIndex = after + 1;
  const m = re.exec(text);
  return m ? m.index : -1;
}

const VERB = { created: 'wrote', replaced: 'replaced', merged: 'merged', unchanged: 'unchanged', skipped: 'skipped', shared: 'shared', error: 'error' };

/** Human summary of an init result. */
export function formatInit(res, { dryRun } = {}) {
  const lines = [];
  const how = res.detected ? `detected ${res.agents.join(', ')}` : res.agents.join(', ');
  lines.push(`${dryRun ? 'Dry run: would set up' : 'Set up'} Yantra for ${how} in ${res.dir}`);
  for (const f of res.files.filter((x) => x.action !== 'shared')) {
    const verb = dryRun && ['created', 'replaced', 'merged'].includes(f.action) ? `would ${f.action === 'created' ? 'write' : f.action === 'merged' ? 'merge' : 'replace'}` : VERB[f.action];
    lines.push(`  ${verb.padEnd(14)} ${f.path}${f.note ? `  (${f.note})` : ''}`);
  }
  lines.push(`MCP server: ${mcpCommand(res.windows).command} ${mcpCommand(res.windows).args.join(' ')}${res.windows ? '  (Windows form; --posix writes plain npx)' : ''}`);
  lines.push('', 'Next steps:');
  for (const n of res.notes) lines.push(`- ${n}`);
  return lines.join('\n');
}
