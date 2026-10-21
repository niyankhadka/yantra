import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, tempDir, removeDir } from './support.js';
import { init, detectAgents, mcpCommand, SKILL_SOURCE } from '../lib/init.js';

const CLI = path.join(ROOT, 'bin', 'yantra.js');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8' });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
const json = (dir, rel) => JSON.parse(read(dir, rel));
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const actions = (res) => Object.fromEntries(res.files.map((f) => [f.path, f.action]));

/** Frontmatter as key -> value; values are plain words or JSON-style double-quoted strings. */
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, '\n'));
  assert.ok(m, 'starts with a --- frontmatter block');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-zA-Z]+):(?: (.*))?$/.exec(line);
    assert.ok(kv, `frontmatter line is key: value: ${line}`);
    const v = kv[2] ?? '';
    if (v.startsWith('"')) out[kv[1]] = JSON.parse(v);
    else {
      assert.doesNotMatch(v, /: |#/, `unquoted value is plain YAML: ${line}`);
      out[kv[1]] = v;
    }
  }
  return out;
}

test('portable skill: valid frontmatter, trigger keywords, no repo-only paths', () => {
  const text = fs.readFileSync(SKILL_SOURCE, 'utf-8');
  const fm = frontmatter(text);
  assert.equal(fm.name, 'yantra');
  assert.ok(fm.description.length <= 1024, 'description fits the 1024-character limit');
  for (const word of ['diagram', 'visualise', 'visualize', 'architecture', 'flow', 'sequence', 'ERD', 'data model', 'state machine', 'org chart', 'mind map', 'explain', 'step by step', 'one-page answer', 'Mermaid', 'PlantUML', 'draw.io'])
    assert.ok(fm.description.includes(word), `description mentions ${word}`);
  for (const repoOnly of ['node bin/yantra.js', 'docs/authoring.md', 'docs/pages.md', 'schemas/', 'examples/'])
    assert.ok(!text.includes(repoOnly), `portable skill does not mention ${repoOnly}`);
  for (const tool of ['yantra_get_schema', 'yantra_list_examples', 'yantra_get_example', 'yantra_validate', 'yantra_build', 'yantra_screenshot', 'npx -y @niyankhadka/yantra'])
    assert.ok(text.includes(tool), `skill mentions ${tool}`);
  // Every MCP tool the skill names exists
  const server = fs.readFileSync(path.join(ROOT, 'mcp', 'server.js'), 'utf-8');
  for (const [name] of text.matchAll(/yantra_[a-z_]+/g)) assert.ok(server.includes(`'${name}'`), `${name} is an MCP tool`);
});

test('init --all writes every agent file, merges nothing it should not and is idempotent', () => {
  const dir = tempDir();
  try {
    const first = init({ dir, agents: ['claude', 'cursor', 'codex', 'antigravity'], windows: false });
    assert.ok(first.ok);
    const skill = fs.readFileSync(SKILL_SOURCE, 'utf-8').replace(/\r\n/g, '\n');
    assert.equal(read(dir, '.claude/skills/yantra/SKILL.md'), skill);
    assert.equal(read(dir, '.agents/skills/yantra/SKILL.md'), skill);
    assert.ok(!exists(dir, '.cursor/skills/yantra/SKILL.md'), 'Cursor reuses .claude/.agents skills');
    const npx = { command: 'npx', args: ['-y', '@niyankhadka/yantra', 'mcp'] };
    assert.deepEqual(json(dir, '.mcp.json').mcpServers.yantra, npx);
    assert.deepEqual(json(dir, '.cursor/mcp.json').mcpServers.yantra.args, npx.args);
    assert.equal(json(dir, '.cursor/mcp.json').mcpServers.yantra.env.YANTRA_OUTPUT_ROOT, '${workspaceFolder}');
    assert.equal(json(dir, '.agents/mcp_config.json').mcpServers.yantra.command, 'npx');
    const rule = frontmatter(read(dir, '.cursor/rules/yantra.mdc'));
    assert.equal(rule.alwaysApply, 'false');
    assert.match(rule.description, /diagram/i);
    assert.match(read(dir, '.agents/rules/yantra.md'), /^# Yantra diagrams/);
    assert.match(read(dir, 'AGENTS.md'), /<!-- yantra:start -->[\s\S]*<!-- yantra:end -->/);
    assert.match(read(dir, '.codex/config.toml'), /^\[mcp_servers\.yantra\]\ncommand = "npx"\nargs = \["-y", "@niyankhadka\/yantra", "mcp"\]/);

    const snapshot = () => Object.fromEntries(first.files.filter((f) => exists(dir, f.path)).map((f) => [f.path, read(dir, f.path)]));
    const before = snapshot();
    const second = init({ dir, agents: ['claude', 'cursor', 'codex', 'antigravity'], windows: false });
    assert.ok(second.files.every((f) => ['unchanged', 'shared', 'skipped'].includes(f.action)), JSON.stringify(second.files));
    assert.deepEqual(snapshot(), before, 'a second run changes nothing');
  } finally {
    removeDir(dir);
  }
});

test('init merges existing MCP configs and AGENTS.md instead of replacing them', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other-mcp' } }, extra: 1 }));
    fs.mkdirSync(path.join(dir, '.cursor'));
    fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), '{\r\n  "mcpServers": {}\r\n}\r\n');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# My project\n\nRun `make test`.\n');
    fs.mkdirSync(path.join(dir, '.codex'));
    fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), 'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n');
    const res = init({ dir, agents: ['claude', 'cursor', 'codex'], windows: true });
    const a = actions(res);
    assert.equal(a['.mcp.json'], 'merged');
    assert.equal(a['.cursor/mcp.json'], 'merged');
    assert.equal(a['AGENTS.md'], 'merged');
    assert.equal(a['.codex/config.toml'], 'merged');
    const mcp = json(dir, '.mcp.json');
    assert.deepEqual(mcp.mcpServers.other, { command: 'other-mcp' });
    assert.equal(mcp.extra, 1);
    assert.deepEqual(mcp.mcpServers.yantra, { command: 'cmd', args: ['/c', 'npx', '-y', '@niyankhadka/yantra', 'mcp'] }, 'Windows form');
    assert.match(read(dir, 'AGENTS.md'), /^# My project\n\nRun `make test`\.\n\n<!-- yantra:start -->/);
    const toml = read(dir, '.codex/config.toml');
    assert.match(toml, /\[mcp_servers\.other\]\ncommand = "o"\n\n\[mcp_servers\.yantra\]\ncommand = "cmd"/);
    // Run again: the sections are found, not appended twice
    init({ dir, agents: ['claude', 'cursor', 'codex'], windows: true });
    assert.equal(read(dir, 'AGENTS.md').match(/yantra:start/g).length, 1);
    assert.equal(read(dir, '.codex/config.toml').match(/mcp_servers\.yantra\]/g).length, 1);
  } finally {
    removeDir(dir);
  }
});

test('existing files are kept unless --force, which replaces only the Yantra parts', () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'skills', 'yantra'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'skills', 'yantra', 'SKILL.md'), 'my own skill\n');
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { yantra: { command: 'node', args: ['x.js'] }, other: { command: 'o' } } }));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Intro\n\n<!-- yantra:start -->\nold\n<!-- yantra:end -->\n\nOutro\n');
    fs.mkdirSync(path.join(dir, '.codex'));
    fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), '[mcp_servers.yantra]\ncommand = "old"\n\n[mcp_servers.yantra.env]\nA = "1"\n\n[other]\nk = 1\n');

    const kept = init({ dir, agents: ['claude', 'codex'], windows: false });
    const a = actions(kept);
    assert.equal(a['.claude/skills/yantra/SKILL.md'], 'skipped');
    assert.equal(a['.mcp.json'], 'skipped');
    assert.equal(a['AGENTS.md'], 'skipped');
    assert.equal(a['.codex/config.toml'], 'skipped');
    assert.equal(read(dir, '.claude/skills/yantra/SKILL.md'), 'my own skill\n');
    assert.ok(kept.ok, 'skipping is not an error');

    const forced = init({ dir, agents: ['claude', 'codex'], windows: false, force: true });
    const f = actions(forced);
    assert.equal(f['.claude/skills/yantra/SKILL.md'], 'replaced');
    assert.equal(f['.mcp.json'], 'replaced');
    assert.match(read(dir, '.claude/skills/yantra/SKILL.md'), /^---\nname: yantra/);
    assert.deepEqual(json(dir, '.mcp.json').mcpServers.other, { command: 'o' });
    assert.equal(json(dir, '.mcp.json').mcpServers.yantra.command, 'npx');
    const agents = read(dir, 'AGENTS.md');
    assert.match(agents, /^Intro\n\n<!-- yantra:start -->\n## Diagrams with Yantra[\s\S]*<!-- yantra:end -->\n\nOutro\n$/);
    assert.doesNotMatch(agents, /\nold\n/);
    const toml = read(dir, '.codex/config.toml');
    assert.equal(toml, '[mcp_servers.yantra]\ncommand = "npx"\nargs = ["-y", "@niyankhadka/yantra", "mcp"]\n\n[other]\nk = 1\n');
  } finally {
    removeDir(dir);
  }
});

test('invalid JSON config is reported and left alone', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), '{ "mcpServers": { // comment\n } }');
    const res = init({ dir, agents: ['claude'], windows: false });
    assert.equal(res.ok, false);
    assert.equal(actions(res)['.mcp.json'], 'error');
    assert.equal(read(dir, '.mcp.json'), '{ "mcpServers": { // comment\n } }');
    assert.ok(exists(dir, '.claude/skills/yantra/SKILL.md'), 'the other files are still written');
  } finally {
    removeDir(dir);
  }
});

test('no agent flags: detect agent folders, else default to Claude Code', () => {
  const empty = tempDir();
  const some = tempDir();
  try {
    assert.deepEqual(detectAgents(empty), []);
    const res = init({ dir: empty, windows: false });
    assert.deepEqual(res.agents, ['claude']);
    assert.equal(res.detected, false);
    fs.mkdirSync(path.join(some, '.cursor'));
    fs.writeFileSync(path.join(some, 'AGENTS.md'), '# x\n');
    const found = init({ dir: some, windows: false });
    assert.deepEqual(found.agents, ['cursor', 'codex']);
    assert.ok(found.detected);
    assert.ok(!exists(some, '.claude'), 'Claude Code was not set up');
    assert.ok(!exists(some, '.cursor/skills/yantra/SKILL.md'), 'Codex writes .agents/skills, which Cursor reads');
    assert.ok(exists(some, '.agents/skills/yantra/SKILL.md'));
  } finally {
    removeDir(empty);
    removeDir(some);
  }
});

test('Cursor alone gets its own skill copy', () => {
  const dir = tempDir();
  try {
    init({ dir, agents: ['cursor'], windows: false });
    assert.ok(exists(dir, '.cursor/skills/yantra/SKILL.md'));
    assert.ok(exists(dir, '.cursor/rules/yantra.mdc'));
    assert.ok(!exists(dir, '.claude') && !exists(dir, '.agents'));
  } finally {
    removeDir(dir);
  }
});

test('Windows MCP entries use cmd /c npx', () => {
  assert.deepEqual(mcpCommand(true), { command: 'cmd', args: ['/c', 'npx', '-y', '@niyankhadka/yantra', 'mcp'] });
  assert.deepEqual(mcpCommand(false), { command: 'npx', args: ['-y', '@niyankhadka/yantra', 'mcp'] });
});

test('CLI init: --dry-run writes nothing, --json reports, bad options fail', () => {
  const dir = tempDir();
  try {
    const dry = run('init', '--all', '--dir', dir, '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Dry run/);
    assert.match(dry.stdout, /would write\s+\.mcp\.json/);
    assert.deepEqual(fs.readdirSync(dir), [], 'dry run wrote nothing');

    const res = run('init', '--claude', '--codex', '--dir', dir, '--json', '--posix');
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.deepEqual(report.agents, ['claude', 'codex']);
    assert.equal(report.windows, false);
    assert.ok(report.files.some((f) => f.path === '.claude/skills/yantra/SKILL.md' && f.action === 'created'));
    assert.equal(json(dir, '.mcp.json').mcpServers.yantra.command, 'npx');

    assert.notEqual(run('init', '--clade', '--dir', dir).status, 0, 'unknown option');
    assert.notEqual(run('init', 'somewhere').status, 0, 'positional argument');
    assert.notEqual(run('init', '--dir', path.join(dir, 'missing')).status, 0, 'missing folder');
    assert.notEqual(run('init', '--windows', '--posix', '--dir', dir).status, 0);
  } finally {
    removeDir(dir);
  }
});

test('init refuses to write through a link that leaves --dir', () => {
  const dir = tempDir();
  const outside = tempDir();
  try {
    fs.symlinkSync(outside, path.join(dir, '.claude'), 'junction');
    assert.throws(() => init({ dir, agents: ['claude'], windows: false }), /Refusing to write/);
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing written outside');
    const cli = run('init', '--claude', '--dir', dir);
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /Refusing to write/);
  } finally {
    removeDir(dir);
    removeDir(outside);
  }
});

test('CLI schema and docs print the shipped references', () => {
  assert.deepEqual(JSON.parse(run('schema').stdout), JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'yantra-payload.schema.json'), 'utf-8')));
  assert.deepEqual(JSON.parse(run('schema', 'page').stdout), JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'yantra-page.schema.json'), 'utf-8')));
  assert.match(run('docs').stdout, /Budgets/);
  assert.match(run('docs', 'pages').stdout, /# Answer pages/);
  assert.match(run('docs', 'agents').stdout, /yantra init/);
  assert.notEqual(run('docs', 'nope').status, 0);
  assert.notEqual(run('schema', 'nope').status, 0);
});
