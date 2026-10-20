#!/usr/bin/env node
/**
 * Yantra MCP server (stdio, newline-delimited JSON-RPC 2.0).
 * stdout carries protocol messages only; diagnostics go to stderr.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { lint } from '../src/core/lint.js';
import { sceneForView } from '../src/core/sequence.js';
import { renderSvg } from '../src/core/svg.js';
import { toMarkdown } from '../src/core/markdown.js';
import { isPage, pageToMarkdown } from '../src/core/page.js';
import { fromMermaid } from '../src/core/mermaid.js';
import { collectDiagrams, getLevel } from '../src/core/drill.js';
import { buildAny, resolveAny, readLogos, ROOT } from '../lib/build.js';
import { screenshot } from '../lib/browser.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const EXAMPLES = path.join(ROOT, 'examples');

const source = {
  payload: { type: 'object', description: 'A Yantra diagram, or an answer page ({ "kind": "page", ... }). See yantra_get_schema.' },
  filePath: { type: 'string', description: 'Path to a .json file (alternative to payload). Page diagram `src` paths and drill-down `{ "$ref": "detail.json" }` entries resolve relative to it (and must stay inside the input root).' }
};
const level = { type: 'string', description: 'Id of a detail diagram (drill-down level, a key of the diagrams map) to use instead of the overview.' };

const TOOLS = [
  {
    name: 'yantra_get_schema',
    description: 'Return the JSON Schemas and authoring rules. kind "diagram" (default) for interactive diagrams, "page" for one-page answers to a question (answer first, then blocks such as points, steps, compare, metrics, charts (bar, column, line, area, pie, donut), gantt plans, 2x2 / heat-map matrices, embedded diagrams).',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['diagram', 'page'] } } }
  },
  {
    name: 'yantra_list_examples',
    description: 'List the built-in example diagrams.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'yantra_get_example',
    description: 'Return a built-in example payload to use as a structural reference.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'yantra_validate',
    description: 'Validate a diagram: schema, references, story consistency, and rendered geometry (overlaps, edges through nodes, label collisions). Detail diagrams (drill-down levels in `diagrams`) are checked too, plus drill targets, cycles, depth and $ref files. Returns errors/warnings with stable codes.',
    inputSchema: { type: 'object', properties: source }
  },
  {
    name: 'yantra_build',
    description: 'Validate and write a single offline HTML file (interactive diagram or one-page answer). Refuses on validation errors unless force is true.',
    inputSchema: {
      type: 'object',
      properties: { ...source, outputPath: { type: 'string' }, force: { type: 'boolean' } },
      required: ['outputPath']
    }
  },
  {
    name: 'yantra_export',
    description: 'Export a static SVG (diagrams) or Markdown (diagrams and pages) of the overview or one drill-down level. Writes outputPath when given, otherwise returns the content.',
    inputSchema: {
      type: 'object',
      properties: {
        ...source,
        format: { type: 'string', enum: ['svg', 'md'] },
        theme: { type: 'string', enum: ['light', 'dark'] },
        mode: { type: 'string' },
        view: { type: 'string', enum: ['flow', 'sequence'], description: 'Default meta.view; sequence draws the walkthrough as a sequence diagram.' },
        step: { type: 'number', description: '1-based step to highlight (sequence view)' },
        level,
        allLevels: { type: 'boolean', description: 'Markdown only: append every detail diagram after the overview.' },
        outputPath: { type: 'string' }
      },
      required: ['format']
    }
  },
  {
    name: 'yantra_import_mermaid',
    description: 'Convert Mermaid text (flowchart/graph or sequenceDiagram) into a Yantra diagram payload with roles, groups (from subgraphs) and a walkthrough, then validate it. Writes outputPath when given, otherwise returns the payload.',
    inputSchema: {
      type: 'object',
      properties: {
        mermaid: { type: 'string', description: 'Mermaid source, without the ``` fence.' },
        title: { type: 'string', description: 'Diagram title (default: Mermaid front-matter title, else a generic one).' },
        outputPath: { type: 'string', description: 'Optional .json path to write.' }
      },
      required: ['mermaid']
    }
  },
  {
    name: 'yantra_screenshot',
    description: 'Render a diagram or answer page in the local Chrome/Edge and save a PNG, for visual review.',
    inputSchema: {
      type: 'object',
      properties: {
        ...source,
        outputPath: { type: 'string' },
        theme: { type: 'string', enum: ['light', 'dark'] },
        step: { type: 'number', description: '1-based walkthrough step to show' },
        view: { type: 'string', enum: ['flow', 'sequence'], description: 'Flow graph or sequence diagram (default meta.view)' },
        level
      },
      required: ['outputPath']
    }
  }
];

/**
 * MCP clients are not trusted with the whole disk: reads stay inside
 * YANTRA_INPUT_ROOT and writes inside YANTRA_OUTPUT_ROOT (both default to the
 * server's working directory), with a fixed set of extensions.
 */
const INPUT_ROOT = path.resolve(process.env.YANTRA_INPUT_ROOT || process.cwd());
const OUTPUT_ROOT = path.resolve(process.env.YANTRA_OUTPUT_ROOT || process.cwd());

function realish(p) {
  // Resolve symlinks of the longest existing prefix, so a link cannot escape the root
  let head = p;
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) return p;
    tail.unshift(path.basename(head));
    head = up;
  }
  return path.join(fs.realpathSync(head), ...tail);
}

function within(root, file) {
  const rel = path.relative(realish(root), realish(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function inputPath(p, exts = ['.json']) {
  if (typeof p !== 'string' || !p) throw new Error('filePath must be a non-empty string.');
  const file = path.resolve(INPUT_ROOT, p); // relative paths are relative to the input root
  if (!exts.includes(path.extname(file).toLowerCase())) throw new Error(`filePath must end with ${exts.join(' or ')}.`);
  if (!within(INPUT_ROOT, file)) throw new Error(`filePath must be inside ${INPUT_ROOT} (set YANTRA_INPUT_ROOT to allow another folder).`);
  return file;
}

function outputPath(p, exts) {
  if (typeof p !== 'string' || !p) throw new Error('outputPath must be a non-empty string.');
  const file = path.resolve(OUTPUT_ROOT, p);
  if (!exts.includes(path.extname(file).toLowerCase())) throw new Error(`outputPath must end with ${exts.join(' or ')}.`);
  if (!within(OUTPUT_ROOT, file)) throw new Error(`outputPath must be inside ${OUTPUT_ROOT} (set YANTRA_OUTPUT_ROOT to allow another folder).`);
  return file;
}

function loadPayload(args) {
  let payload;
  let base = INPUT_ROOT; // inline payloads: page `src` and drill-down `$ref` paths resolve (and are confined) here
  if (args.payload && typeof args.payload === 'object') payload = args.payload;
  else if (args.filePath) {
    const file = inputPath(args.filePath);
    payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
    base = path.dirname(file);
  } else throw new Error('Provide either payload or filePath.');
  return resolveAny(payload, base, { root: INPUT_ROOT });
}

/** A drill-down level of a diagram payload (the overview when no id is given). */
function pickLevel(payload, id) {
  if (id === undefined || id === null || id === '') return payload;
  if (isPage(payload)) throw new Error('level applies to diagrams, not answer pages.');
  const lv = getLevel(payload, String(id));
  if (!lv) throw new Error(`Unknown level "${id}". Detail diagrams: ${[...collectDiagrams(payload).map.keys()].join(', ') || 'none'}.`);
  return lv;
}

function call(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  switch (name) {
    case 'yantra_get_schema': {
      const page = args.kind === 'page';
      return {
        schema: JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', page ? 'yantra-page.schema.json' : 'yantra-payload.schema.json'), 'utf-8')),
        rules: fs.readFileSync(path.join(ROOT, 'docs', page ? 'pages.md' : 'authoring.md'), 'utf-8')
      };
    }
    case 'yantra_list_examples':
      return fs
        .readdirSync(EXAMPLES)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ name: f.replace(/\.json$/, ''), title: JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), 'utf-8')).meta?.title }));
    case 'yantra_get_example': {
      const file = path.join(EXAMPLES, `${path.basename(String(args.name))}.json`);
      if (!fs.existsSync(file)) throw new Error(`Unknown example "${args.name}".`);
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    case 'yantra_validate':
      return lint(loadPayload(args));
    case 'yantra_build': {
      const payload = loadPayload(args);
      const out = outputPath(args.outputPath, ['.html']);
      const report = lint(payload);
      if (!report.valid && !args.force) return { written: false, ...report };
      fs.writeFileSync(out, buildAny(payload));
      return { written: true, outputPath: out, ...report };
    }
    case 'yantra_export': {
      const payload = loadPayload(args);
      if (args.format !== 'md' && isPage(payload)) throw new Error('Answer pages export to md, or to html with yantra_build.');
      const theme = args.theme === 'dark' ? 'dark' : 'light';
      const logos = readLogos();
      const lv = pickLevel(payload, args.level);
      const content =
        args.format === 'md'
          ? isPage(payload) ? pageToMarkdown(payload) : toMarkdown(lv, { levels: !!args.allLevels && lv === payload })
          : renderSvg(sceneForView(lv, { view: args.view, modeId: args.mode }), { theme, step: args.step > 0 ? args.step - 1 : null, logo: logos[theme] || logos.light || logos.dark });
      if (!args.outputPath) return { content };
      const out = outputPath(args.outputPath, args.format === 'md' ? ['.md'] : ['.svg']);
      fs.writeFileSync(out, content);
      return { outputPath: out };
    }
    case 'yantra_import_mermaid': {
      if (typeof args.mermaid !== 'string' || !args.mermaid.trim()) throw new Error('Provide mermaid (the diagram source text).');
      const { payload, warnings } = fromMermaid(args.mermaid, { title: args.title });
      const validation = lint(payload);
      if (!args.outputPath) return { payload, warnings, validation };
      const out = outputPath(args.outputPath, ['.json']);
      fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
      return { outputPath: out, warnings, validation };
    }
    case 'yantra_screenshot': {
      const png = outputPath(args.outputPath, ['.png']);
      let html = typeof args.filePath === 'string' && args.filePath.toLowerCase().endsWith('.html') ? inputPath(args.filePath, ['.html']) : null;
      let tmp = null;
      if (!html) {
        tmp = `${png}.tmp.html`;
        const payload = loadPayload(args);
        pickLevel(payload, args.level);
        fs.writeFileSync(tmp, buildAny(payload));
        html = tmp;
        if (isPage(payload)) args = { ...args, width: 1100, height: 2200 };
      }
      try {
        const out = screenshot(html, png, { theme: args.theme, hash: [args.level ? `level=${encodeURIComponent(args.level)}` : '', args.step ? `step=${args.step}` : '', args.view ? `view=${args.view}` : ''].filter(Boolean).join('&'), width: args.width, height: args.height });
        return { outputPath: out };
      } finally {
        if (tmp) fs.rmSync(tmp, { force: true });
      }
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
}

function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg))
    return send({ id: null, error: { code: -32600, message: 'Invalid Request: expected a JSON-RPC object.' } });
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'yantra', version: VERSION }
        }
      });
    case 'ping':
      return send({ id, result: {} });
    case 'tools/list':
      return send({ id, result: { tools: TOOLS } });
    case 'tools/call':
      try {
        const result = call(params?.name, params?.arguments);
        return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
      } catch (err) {
        if (err.code === -32602) return send({ id, error: { code: -32602, message: err.message } });
        return send({ id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } });
      }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

readline.createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    return send({ id: null, error: { code: -32700, message: `Parse error: ${err.message}` } });
  }
  try {
    handle(msg);
  } catch (err) {
    const id = msg && typeof msg === 'object' && !Array.isArray(msg) && msg.id !== undefined ? msg.id : null;
    send({ id, error: { code: -32603, message: `Internal error: ${err?.message || err}` } });
  }
});
