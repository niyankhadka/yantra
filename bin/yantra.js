#!/usr/bin/env node
/**
 * Yantra CLI.
 *   yantra validate <diagram.json> [--json] [--lang xx]
 *   yantra build <diagram.json> [-o out.html] [--collapsed id,id | --expand-all | --depth n]
 *   yantra export <diagram.json> -f svg|md [-o file] [--theme light|dark] [--mode id] [--view flow|sequence] [--step n] [--level id] [--all-levels] [--collapsed id,id | --expand-all | --depth n]
 *   yantra screenshot <diagram.json|page.html> [-o out.png] [--theme light|dark] [--step n] [--view flow|sequence] [--level id] [--collapsed id,id | --expand-all | --depth n] [--focus group]
 *   yantra import <file.mmd|file.md|file.drawio|file.puml|file.vsdx|file.drawio.png> [-o out.json] [--from mermaid|drawio|plantuml|visio] [--page n] [--title "..."] [--all]
 *   yantra new <file.json> [--page | --book | --kind k]  yantra examples [name]   yantra mcp [--http]   yantra dev
 *   yantra init [--claude] [--cursor] [--codex] [--antigravity] [--all] [--dir path] [--force] [--dry-run] [--json]
 *   yantra schema [diagram|page|book]   yantra docs [authoring|pages|books|mermaid|import|agents]
 * Works with diagrams, one-page answers ({ "kind": "page" }) and books ({ "kind": "book" }).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lint } from '../src/core/lint.js';
import { localizeFindings } from '../src/core/lintmessages.js';
import { renderSvg } from '../src/core/svg.js';
import { sceneForView } from '../src/core/sequence.js';
import { toMarkdown } from '../src/core/markdown.js';
import { isPage, isBook, pageToMarkdown } from '../src/core/page.js';
import { bookToMarkdown } from '../src/core/book.js';
import { STARTER_DIAGRAM, STARTER_PAGE, STARTER_BOOK, STARTERS } from '../src/core/starters.js';
import { importText, FORMATS } from '../src/core/import.js';
import { collectDiagrams, getLevel } from '../src/core/drill.js';
import { foldsForDepth } from '../src/core/nesting.js';
import { buildAny, resolveAny, readLogos, ROOT } from '../lib/build.js';
import { screenshot } from '../lib/browser.js';
import { fileIncluder } from '../lib/includes.js';
import { init, formatInit, AGENTS } from '../lib/init.js';

const HELP = `Yantra - interactive, step-by-step diagrams

Works with diagrams, one-page answers ("kind": "page") and books ("kind": "book").

Usage
  yantra validate <file.json> [--json]         Check schema, references and rendered geometry  [--lang xx]
  yantra build <file.json> [-o out.html]       Validate, then write a single offline HTML file
  yantra export <file.json> -f svg|md          Static SVG (diagrams) or Markdown  [-o file] [--theme light|dark] [--mode id] [--view flow|sequence] [--step n] [--level id] [--all-levels]
  yantra screenshot <diagram.json|page.html>   PNG via local Chrome/Edge  [-o out.png] [--theme] [--step n] [--view flow|sequence] [--level id] [--focus group] [--width] [--height]
  yantra new <file.json> [--page | --book]     Write a starter diagram (or answer page, or book)
                                               --kind flow|sequence|state|er|class|tree|mindmap|page|book
  yantra import <file>                         Convert Mermaid (.mmd/.md; diagrams, or gantt / pie / timeline / quadrant pages), draw.io (.drawio/.xml/.png), PlantUML (.puml) or Visio (.vsdx)  [-o out.json] [--from mermaid|drawio|plantuml|visio] [--page n|name] [--title "..."] [--all]
  yantra examples [name] [-o file]             List built-in examples, or copy one
  yantra schema [diagram|page|book]            Print the JSON Schema for diagrams (default), answer pages or books
  yantra docs [authoring|pages|books|mermaid|import|agents]  Print a guide (default: authoring)
  yantra init [agents] [--dir path]            Set up a project for coding agents: skill, MCP server, rules
                                               agents: --claude --cursor --codex --antigravity or --all
                                               (none: the agents whose folders exist, else --claude)
                                               [--force] [--dry-run] [--json] [--windows | --posix]
  yantra mcp [--http]                          Start the MCP server (stdio; --http: Streamable HTTP  [--port 8787] [--host 127.0.0.1])
  yantra dev                                   Start the live editor at http://localhost:3000

Options
  --force       build even when validation reports errors
  --json        machine-readable validation output
  --lang xx     validation messages in a built-in language (es, ja, ar...; codes stay the same);
                "auto" uses the payload's meta.lang. Untranslated messages stay in English
  --level id    a detail diagram (drill-down level) instead of the overview
  --all-levels  Markdown export: append every detail diagram after the overview
  --collapsed a,b   build / export / screenshot: open with these subtrees (tree, mindmap) or
                    groups (layered) folded, instead of meta.layout.collapsed
  --expand-all      build / export / screenshot: open with nothing folded
  --depth n         build / export / screenshot: fold to depth n (n levels of group boxes,
                    or of a tree, stay open; 0 folds the outermost boxes too)
  --focus group     screenshot: zoom the camera to a group (its folded boxes open)

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
      if (next !== undefined && !next.startsWith('-') && ['theme', 'mode', 'step', 'view', 'width', 'height', 'title', 'level', 'from', 'page', 'lang', 'collapsed', 'depth', 'focus', 'dir', 'kind'].includes(key)) out[key] = argv[++i];
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

/**
 * Read a payload; page diagram `src` files and drill-down `$ref` files are
 * loaded relative to the input (and must stay inside its folder).
 */
function load(file) {
  return resolveAny(readPayload(file), path.dirname(path.resolve(file)));
}

/** Answer pages and books: read as documents (no levels, folds or SVG). */
const isDoc = (p) => isPage(p) || isBook(p);
const docName = (p) => (isBook(p) ? 'books' : 'answer pages');

/** The payload of `--level id` (a detail diagram), or the overview. */
function pickLevel(payload, id) {
  if (!id || id === true) return payload;
  if (isDoc(payload)) fail(`--level applies to diagrams, not ${docName(payload)}.`);
  const level = getLevel(payload, id);
  if (!level) fail(`Unknown level "${id}". Detail diagrams: ${[...collectDiagrams(payload).map.keys()].join(', ') || 'none'}.`);
  return level;
}

/**
 * --collapsed a,b / --expand-all / --depth n: the ids folded when the diagram (or
 * the level `target`) opens (null: keep meta.layout.collapsed). Diagrams only; an
 * answer page keeps its embeds as authored.
 */
function folds(payload, target = payload) {
  const depth = depthArg();
  if (!args['expand-all'] && args.collapsed === undefined && depth === null) return null;
  if (isDoc(payload)) fail(`--collapsed, --expand-all and --depth apply to diagrams, not ${docName(payload)}.`);
  if ([args['expand-all'], args.collapsed !== undefined, depth !== null].filter(Boolean).length > 1) fail('Use one of --collapsed, --expand-all and --depth.');
  if (depth !== null) return foldsForDepth(target, depth);
  if (args['expand-all']) return [];
  if (typeof args.collapsed !== 'string') fail('--collapsed needs a comma-separated list of ids, e.g. --collapsed eng,ops.');
  return [...new Set(args.collapsed.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** --depth n as a number (null when not given); "all" unfolds everything. */
function depthArg() {
  if (args.depth === undefined) return null;
  if (args.depth === 'all') return Infinity;
  if (typeof args.depth !== 'string' || !/^\d+$/.test(args.depth)) fail('--depth needs a whole number of levels to keep open, e.g. --depth 2 (or all).');
  return Number(args.depth);
}

/** The payload opening with `ids` folded (null: unchanged). */
function withFolds(payload, ids) {
  if (!ids) return payload;
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const layout = meta.layout && typeof meta.layout === 'object' ? meta.layout : {};
  return { ...payload, meta: { ...meta, layout: { ...layout, collapsed: ids } } };
}

const args = parse(process.argv.slice(2));
const [cmd = 'help', input] = args._;

try {
  switch (cmd) {
    case 'validate': {
      const payload = load(input);
      const lang = args.lang === 'auto' ? payload?.meta?.lang : args.lang;
      const report = localizeFindings(lint(payload), lang);
      if (args.json) console.log(JSON.stringify(report, null, 2));
      else printReport(report, input);
      process.exit(report.valid ? 0 : 1);
      break;
    }

    case 'build': {
      const raw = load(input);
      const payload = withFolds(raw, folds(raw));
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
      const format = (args.format || (isDoc(payload) ? 'md' : 'svg')).toLowerCase();
      const picked = pickLevel(payload, args.level);
      const level = withFolds(picked, folds(payload, picked));
      let content;
      if (format === 'svg') {
        if (isDoc(payload)) fail(`${isBook(payload) ? 'Books' : 'Answer pages'} export to html (yantra build) or md.`);
        const theme = args.theme === 'dark' ? 'dark' : 'light';
        const logos = readLogos();
        const step = Number(args.step) > 0 ? Number(args.step) - 1 : null;
        content = renderSvg(sceneForView(level, { view: args.view, modeId: args.mode }), { theme, step, logo: logos[theme] || logos.light || logos.dark });
      } else if (format === 'md' || format === 'markdown') {
        content = isBook(payload) ? bookToMarkdown(payload) : isPage(payload) ? pageToMarkdown(payload) : toMarkdown(level, { levels: !!args['all-levels'] && level === payload });
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
      let fold = null;
      if (input.endsWith('.json')) {
        const payload = load(input);
        page = isDoc(payload);
        pickLevel(payload, args.level); // fails early on an unknown level
        // --depth goes in the link (depth=n), so it applies to whichever level opens
        if (depthArg() === null) fold = folds(payload);
        else folds(payload);
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-'));
        html = path.join(tmp, 'diagram.html');
        fs.writeFileSync(html, buildAny(payload));
      } else if (args['expand-all']) fold = [];
      else if (typeof args.collapsed === 'string') fold = args.collapsed.split(',').map((s) => s.trim()).filter(Boolean);
      // Folds go in the link (#collapsed=a,b; empty unfolds all), so they apply to --level too
      const depth = depthArg();
      const hash = [
        args.level ? `level=${encodeURIComponent(args.level)}` : '',
        fold ? `collapsed=${fold.map(encodeURIComponent).join(',')}` : '',
        depth !== null ? `depth=${depth === Infinity ? 'all' : depth}` : '',
        args.step ? `step=${args.step}` : '',
        args.mode ? `mode=${args.mode}` : '',
        args.view ? `view=${args.view}` : '',
        typeof args.focus === 'string' ? `focus=${encodeURIComponent(args.focus)}` : ''
      ].filter(Boolean).join('&');
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
      if ([args.page, args.book, args.kind].filter(Boolean).length > 1) fail('Use one of --page, --book and --kind.');
      const kinds = STARTERS.map((s) => s.id.replace(/^new-/, ''));
      if (args.kind !== undefined && !kinds.includes(args.kind)) fail(`Unknown kind "${args.kind}" (use ${kinds.join(', ')}).`);
      const starter = args.kind ? STARTERS.find((s) => s.id === `new-${args.kind}`).data : args.book ? STARTER_BOOK : args.page ? STARTER_PAGE : STARTER_DIAGRAM;
      fs.writeFileSync(out, `${JSON.stringify(starter, null, 2)}\n`);
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
      if (!input) fail('Missing input file: yantra import <file.mmd|file.md|file.drawio|file.puml|file.vsdx|file.drawio.png> [-o out.json] [--from mermaid|drawio|plantuml|visio] [--page n] [--title "..."] [--all]');
      if (args.from !== undefined && !FORMATS.includes(args.from)) fail(`Unknown --from "${args.from}" (use ${FORMATS.join(', ')}).`);
      const src = path.resolve(input);
      if (!fs.existsSync(src)) fail(`File not found: ${src}`);
      const { format, results } = importText(fs.readFileSync(src), {
        format: args.from,
        filename: path.basename(src),
        include: fileIncluder(path.dirname(src)), // PlantUML !include: files next to the input only
        path: src,
        title: typeof args.title === 'string' ? args.title : undefined,
        page: typeof args.page === 'string' ? args.page : undefined,
        all: !!args.all
      });
      const base = args.output ? path.resolve(args.output) : outName(input, '.json');
      let failed = false;
      results.forEach(({ payload, warnings }, i) => {
        const out = results.length > 1 ? base.replace(/(\.json)?$/i, `-${i + 1}.json`) : base;
        for (const w of warnings) console.error(`  import  ${w}`);
        fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
        console.error(`✓ Wrote ${out} (${format}: ${isPage(payload) ? `answer page, ${payload.blocks.length} block${payload.blocks.length === 1 ? '' : 's'}` : `${payload.nodes.length} nodes, ${payload.edges.length} edges`})`);
        const report = lint(payload);
        printReport(report, path.basename(out));
        if (!report.valid) failed = true;
      });
      process.exit(failed ? 1 : 0);
      break;
    }

    case 'schema': {
      const kind = input || 'diagram';
      const SCHEMAS = { diagram: 'yantra-payload.schema.json', page: 'yantra-page.schema.json', book: 'yantra-book.schema.json' };
      if (!Object.hasOwn(SCHEMAS, kind)) fail(`Unknown schema "${kind}" (use diagram, page or book).`);
      process.stdout.write(fs.readFileSync(path.join(ROOT, 'schemas', SCHEMAS[kind]), 'utf-8'));
      break;
    }

    case 'docs': {
      const DOCS = ['authoring', 'pages', 'books', 'mermaid', 'import', 'agents'];
      const name = input || 'authoring';
      if (!DOCS.includes(name)) fail(`Unknown guide "${name}" (use ${DOCS.join(', ')}).`);
      process.stdout.write(fs.readFileSync(path.join(ROOT, 'docs', `${name}.md`), 'utf-8'));
      break;
    }

    case 'init': {
      if (input) fail(`Unexpected argument "${input}". Use --dir <path> to choose the project folder.`);
      if (args.dir === true) fail('--dir needs a folder.');
      if (args.windows && args.posix) fail('Use one of --windows and --posix.');
      const known = new Set(['_', ...AGENTS, 'all', 'dir', 'force', 'dry-run', 'json', 'windows', 'posix']);
      const extra = Object.keys(args).find((k) => !known.has(k));
      if (extra) fail(`Unknown option --${extra} for init. Run \`yantra help\`.`);
      const agents = args.all ? AGENTS : AGENTS.filter((a) => args[a]);
      const res = init({ dir: args.dir, agents, force: !!args.force, dryRun: !!args['dry-run'], windows: args.windows ? true : args.posix ? false : undefined });
      if (args.json) console.log(JSON.stringify({ ...res, dryRun: !!args['dry-run'] }, null, 2));
      else console.log(formatInit(res, { dryRun: !!args['dry-run'] }));
      process.exit(res.ok ? 0 : 1);
      break;
    }

    case 'mcp': {
      await import('../mcp/server.js');
      break;
    }

    case 'dev': {
      // A clone has Vite in node_modules/; an installed package finds one installed next to it
      let vite = null;
      try {
        vite = path.join(path.dirname(createRequire(path.join(ROOT, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js');
      } catch {}
      if (!vite || !fs.existsSync(vite)) fail('Vite is not installed. Run `npm install` in a Yantra clone, or `npm i -D vite` next to an installed Yantra.');
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
