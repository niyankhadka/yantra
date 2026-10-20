#!/usr/bin/env node
/**
 * Yantra CLI.
 *   yantra validate <diagram.json> [--json]
 *   yantra build <diagram.json> [-o out.html]
 *   yantra export <diagram.json> -f svg|md [-o file] [--theme light|dark] [--mode id] [--view flow|sequence] [--step n] [--level id] [--all-levels]
 *   yantra screenshot <diagram.json|page.html> [-o out.png] [--theme light|dark] [--step n] [--view flow|sequence] [--level id]
 *   yantra import <file.mmd|file.md> [-o out.json] [--title "..."] [--all]
 *   yantra new <file.json> [--page]  yantra examples [name]   yantra mcp   yantra dev
 * Works with diagrams and with one-page answers ({ "kind": "page" }).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lint } from '../src/core/lint.js';
import { renderSvg } from '../src/core/svg.js';
import { sceneForView } from '../src/core/sequence.js';
import { toMarkdown } from '../src/core/markdown.js';
import { isPage, pageToMarkdown } from '../src/core/page.js';
import { fromMermaid, mermaidBlocks } from '../src/core/mermaid.js';
import { collectDiagrams, getLevel } from '../src/core/drill.js';
import { buildAny, resolveAny, readLogos, ROOT } from '../lib/build.js';
import { screenshot } from '../lib/browser.js';

const HELP = `Yantra - interactive, step-by-step diagrams

Works with diagrams and with one-page answers (payloads with "kind": "page").

Usage
  yantra validate <file.json> [--json]         Check schema, references and rendered geometry
  yantra build <file.json> [-o out.html]       Validate, then write a single offline HTML file
  yantra export <file.json> -f svg|md          Static SVG (diagrams) or Markdown  [-o file] [--theme light|dark] [--mode id] [--view flow|sequence] [--step n] [--level id] [--all-levels]
  yantra screenshot <diagram.json|page.html>   PNG via local Chrome/Edge  [-o out.png] [--theme] [--step n] [--view flow|sequence] [--level id] [--width] [--height]
  yantra new <file.json> [--page]              Write a starter diagram (or answer page)
  yantra import <file.mmd|file.md>             Convert a Mermaid flowchart, sequence, state, ER or class diagram  [-o out.json] [--title "..."] [--all]
  yantra examples [name] [-o file]             List built-in examples, or copy one
  yantra mcp                                   Start the MCP server (stdio)
  yantra dev                                   Start the live editor at http://localhost:3000

Options
  --force       build even when validation reports errors
  --json        machine-readable validation output
  --level id    a detail diagram (drill-down level) instead of the overview
  --all-levels  Markdown export: append every detail diagram after the overview

Detail diagrams: a card with data.drill opens a diagram from the payload's "diagrams" map;
{ "$ref": "./detail.json" } entries are loaded relative to the input file.`;

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') out.output = argv[++i];
    else if (a === '-i' || a === '--input') out._.push(argv[++i]);
    else if (a === '-f' || a === '--format') out.format = argv[++i];
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-') && ['theme', 'mode', 'step', 'view', 'width', 'height', 'title', 'level'].includes(key)) out[key] = argv[++i];
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function readPayload(file) {
  if (!file) fail('Missing input file. Run `yantra help`.');
  const p = path.resolve(file);
  if (!fs.existsSync(p)) fail(`File not found: ${p}`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    fail(`${file} is not valid JSON: ${err.message}`);
  }
}

function fail(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

function printReport(report, file) {
  for (const e of report.errors) console.error(`  error   ${e.code.padEnd(30)} ${e.message}`);
  for (const w of report.warnings) console.error(`  warning ${w.code.padEnd(30)} ${w.message}`);
  if (report.valid) console.error(`✓ ${file} is valid${report.warnings.length ? ` (${report.warnings.length} warning${report.warnings.length > 1 ? 's' : ''})` : ''}`);
  else console.error(`✗ ${file}: ${report.errors.length} error${report.errors.length > 1 ? 's' : ''}`);
}

const outName = (input, ext) => path.join(path.dirname(path.resolve(input)), `${path.parse(input).name}${ext}`);

const STARTER = {
  meta: { title: 'New diagram', description: 'What this diagram explains, in one sentence.', layout: { direction: 'LR' } },
  roles: { actor: { label: 'Actor', color: 'amber' }, service: { label: 'Service', color: 'blue' }, store: { label: 'Data', color: 'violet' } },
  nodes: [
    { id: 'user', type: 'actor', data: { title: 'User', subtitle: 'Starts the flow', icon: 'user' } },
    { id: 'api', type: 'service', data: { title: 'API', subtitle: 'Validates and routes', tech: 'Node.js' } },
    { id: 'db', type: 'store', data: { title: 'Database', subtitle: 'Source of truth', tech: 'PostgreSQL', icon: 'database' } }
  ],
  edges: [
    { id: 'user-api', source: 'user', target: 'api', label: 'HTTPS request' },
    { id: 'api-db', source: 'api', target: 'db', label: 'SQL write' }
  ],
  scenarios: [
    {
      id: 'main',
      name: 'Happy path',
      steps: [
        { id: 'overview', title: 'Overview', description: 'The whole system at a glance.' },
        { id: 'request', title: 'Request arrives', description: 'The user calls the API.', highlightNodes: ['user', 'api'], highlightEdges: ['user-api'] },
        { id: 'persist', title: 'Data is stored', description: 'The API writes to the database.', highlightNodes: ['api', 'db'], highlightEdges: ['api-db'] }
      ]
    }
  ]
};

const STARTER_PAGE = {
  kind: 'page',
  meta: { question: 'What question does this page answer?', title: 'Short title', kicker: 'Explainer' },
  answer: {
    headline: 'The answer in one or two sentences - the conclusion comes first.',
    text: 'One short paragraph of context: why this is the answer.',
    points: ['First supporting point', 'Second supporting point', 'Third supporting point']
  },
  blocks: [
    { type: 'points', title: 'Key ideas', items: [{ title: 'Idea one', text: 'One sentence.' }, { title: 'Idea two', text: 'One sentence.' }, { title: 'Idea three', text: 'One sentence.' }] },
    { type: 'steps', title: 'How it works', span: 'half', items: [{ title: 'First', text: 'What happens.' }, { title: 'Then', text: 'What happens next.' }] },
    { type: 'callout', tone: 'warn', label: 'Watch out', span: 'half', body: 'The one thing people get wrong.' }
  ]
};

/**
 * Read a payload; page diagram `src` files and drill-down `$ref` files are
 * loaded relative to the input (and must stay inside its folder).
 */
function load(file) {
  return resolveAny(readPayload(file), path.dirname(path.resolve(file)));
}

/** The payload of `--level id` (a detail diagram), or the overview. */
function pickLevel(payload, id) {
  if (!id || id === true) return payload;
  if (isPage(payload)) fail('--level applies to diagrams, not answer pages.');
  const level = getLevel(payload, id);
  if (!level) fail(`Unknown level "${id}". Detail diagrams: ${[...collectDiagrams(payload).map.keys()].join(', ') || 'none'}.`);
  return level;
}

const args = parse(process.argv.slice(2));
const [cmd = 'help', input] = args._;

try {
  switch (cmd) {
    case 'validate': {
      const report = lint(load(input));
      if (args.json) console.log(JSON.stringify(report, null, 2));
      else printReport(report, input);
      process.exit(report.valid ? 0 : 1);
      break;
    }

    case 'build': {
      const payload = load(input);
      const report = lint(payload);
      printReport(report, input);
      if (!report.valid && !args.force) fail('Fix the errors above, or pass --force to build anyway.');
      const out = path.resolve(args.output || outName(input, '.html'));
      fs.writeFileSync(out, buildAny(payload));
      console.error(`✓ Wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} kB)`);
      break;
    }

    case 'export': {
      const payload = load(input);
      const format = (args.format || (isPage(payload) ? 'md' : 'svg')).toLowerCase();
      const level = pickLevel(payload, args.level);
      let content;
      if (format === 'svg') {
        if (isPage(payload)) fail('Answer pages export to html (yantra build) or md.');
        const theme = args.theme === 'dark' ? 'dark' : 'light';
        const logos = readLogos();
        const step = Number(args.step) > 0 ? Number(args.step) - 1 : null;
        content = renderSvg(sceneForView(level, { view: args.view, modeId: args.mode }), { theme, step, logo: logos[theme] || logos.light || logos.dark });
      } else if (format === 'md' || format === 'markdown') {
        content = isPage(payload) ? pageToMarkdown(payload) : toMarkdown(level, { levels: !!args['all-levels'] && level === payload });
      } else fail(`Unknown format "${format}" (use svg or md).`);
      const out = path.resolve(args.output || outName(input, format === 'svg' ? '.svg' : '.md'));
      fs.writeFileSync(out, content);
      console.error(`✓ Wrote ${out}`);
      break;
    }

    case 'screenshot': {
      if (!input) fail('Missing input file.');
      let html = path.resolve(input);
      let tmp;
      let page = false;
      if (input.endsWith('.json')) {
        const payload = load(input);
        page = isPage(payload);
        pickLevel(payload, args.level); // fails early on an unknown level
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-'));
        html = path.join(tmp, 'diagram.html');
        fs.writeFileSync(html, buildAny(payload));
      }
      const hash = [args.level ? `level=${encodeURIComponent(args.level)}` : '', args.step ? `step=${args.step}` : '', args.mode ? `mode=${args.mode}` : '', args.view ? `view=${args.view}` : ''].filter(Boolean).join('&');
      const theme = args.theme === 'dark' ? 'dark' : 'light';
      const out = args.output || outName(input, `-${theme}.png`);
      try {
        screenshot(html, out, { theme, hash, width: Number(args.width) || (page ? 1100 : 1600), height: Number(args.height) || (page ? 2200 : 1000) });
      } finally {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      }
      console.error(`✓ Wrote ${path.resolve(out)}`);
      break;
    }

    case 'new': {
      const out = path.resolve(input || 'diagram.json');
      if (fs.existsSync(out)) fail(`${out} already exists.`);
      fs.writeFileSync(out, `${JSON.stringify(args.page ? STARTER_PAGE : STARTER, null, 2)}\n`);
      console.error(`✓ Wrote ${out}. Next: yantra validate ${path.basename(out)}`);
      break;
    }

    case 'examples': {
      const dir = path.join(ROOT, 'examples');
      const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
      if (!input) {
        for (const n of names) console.log(`${n.padEnd(22)} ${JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf-8')).meta?.title || ''}`);
        break;
      }
      if (!names.includes(input)) fail(`Unknown example "${input}". Available: ${names.join(', ')}`);
      const out = path.resolve(args.output || `${input}.json`);
      fs.copyFileSync(path.join(dir, `${input}.json`), out);
      console.error(`✓ Wrote ${out}`);
      break;
    }

    case 'import': {
      if (!input) fail('Missing input file: yantra import <file.mmd|file.md> [-o out.json] [--title "..."] [--all]');
      const src = path.resolve(input);
      if (!fs.existsSync(src)) fail(`File not found: ${src}`);
      const text = fs.readFileSync(src, 'utf-8');
      let sources = [text];
      if (/\.(md|markdown)$/i.test(input)) {
        const blocks = mermaidBlocks(text);
        if (!blocks.length) fail(`${input} has no \`\`\`mermaid fenced block.`);
        sources = args.all ? blocks : blocks.slice(0, 1);
      }
      const base = args.output ? path.resolve(args.output) : outName(input, '.json');
      let failed = false;
      sources.forEach((mmd, i) => {
        const out = sources.length > 1 ? base.replace(/(\.json)?$/i, `-${i + 1}.json`) : base;
        const { payload, warnings } = fromMermaid(mmd, { title: typeof args.title === 'string' ? args.title : undefined });
        for (const w of warnings) console.error(`  import  ${w}`);
        fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
        console.error(`✓ Wrote ${out} (${payload.nodes.length} nodes, ${payload.edges.length} edges)`);
        const report = lint(payload);
        printReport(report, path.basename(out));
        if (!report.valid) failed = true;
      });
      process.exit(failed ? 1 : 0);
      break;
    }

    case 'mcp': {
      await import('../mcp/server.js');
      break;
    }

    case 'dev': {
      const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
      if (!fs.existsSync(vite)) fail('Vite is not installed. Run `npm install` first.');
      spawnSync(process.execPath, [vite], { cwd: ROOT, stdio: 'inherit' });
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;

    default:
      fail(`Unknown command "${cmd}".\n\n${HELP}`);
  }
} catch (err) {
  fail(err.message);
}
