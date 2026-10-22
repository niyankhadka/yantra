/**
 * Yantra MCP tools and JSON-RPC dispatch, shared by the stdio transport
 * (mcp/server.js) and the Streamable HTTP transport (mcp/http.js).
 *
 * File access is an option of the tool set, not of the tools:
 *   inputRoot   folder that filePath arguments (and page `src` / drill-down `$ref`
 *               files) are read from; null = no reads, payloads come inline only
 *   outputRoot  folder that outputPath arguments write to; null = no writes,
 *               results (HTML, SVG, Markdown, payloads) come back in the reply
 *   screenshot  offer yantra_screenshot (launches the local browser; needs both roots)
 * stdio uses the working directory for both roots (YANTRA_INPUT_ROOT /
 * YANTRA_OUTPUT_ROOT override); HTTP uses only roots set explicitly in the environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { lint } from '../src/core/lint.js';
import { localizeFindings } from '../src/core/lintmessages.js';
import { sceneForView } from '../src/core/sequence.js';
import { renderSvg } from '../src/core/svg.js';
import { toMarkdown } from '../src/core/markdown.js';
import { isPage, isBook, pageToMarkdown } from '../src/core/page.js';
import { bookToMarkdown } from '../src/core/book.js';

/** Answer pages and books are documents: no levels, folds or SVG. */
const isDoc = (p) => isPage(p) || isBook(p);
import { fromMermaid } from '../src/core/mermaid.js';
import { importText, FORMATS } from '../src/core/import.js';
import { collectDiagrams, getLevel } from '../src/core/drill.js';
import { foldsForDepth } from '../src/core/nesting.js';
import { buildAny, resolveAny, readLogos, ROOT } from '../lib/build.js';
import { screenshot } from '../lib/browser.js';
import { fileIncluder } from '../lib/includes.js';

export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;
export const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const EXAMPLES = path.join(ROOT, 'examples');

/** Extra MCP content items for a tool result (e.g. a built HTML file as an embedded resource). */
export const ATTACH = Symbol('attach');

const level = { type: 'string', description: 'Id of a detail diagram (drill-down level, a key of the diagrams map) to use instead of the overview.' };
const fold = {
  collapsed: { type: 'array', items: { type: 'string' }, description: 'Ids folded when the diagram opens, instead of meta.layout.collapsed: subtree roots (tree, mindmap) or groups (layered). Diagrams only.' },
  expandAll: { type: 'boolean', description: 'Open with nothing folded (overrides collapsed and meta.layout.collapsed).' },
  depth: { type: 'number', minimum: 0, description: 'Fold to depth: this many levels of nested group boxes (layered) or tree levels stay open, deeper ones fold into summary cards; 0 folds the outermost boxes too. Use one of collapsed, expandAll and depth.' }
};

function toolList({ read, write, shots }) {
  const source = {
    payload: { type: 'object', description: 'A Yantra diagram, an answer page ({ "kind": "page", ... }) or a book of answer pages ({ "kind": "book", ... }). See yantra_get_schema.' },
    ...(read
      ? { filePath: { type: 'string', description: 'Path to a .json file (alternative to payload). Page diagram `src` paths, book chapter and drill-down `{ "$ref": "file.json" }` entries resolve relative to it (and must stay inside the input root).' } }
      : {})
  };
  const out = (desc) => (write ? { outputPath: { type: 'string', ...(desc ? { description: desc } : {}) } } : {});
  const list = [
    {
      name: 'yantra_get_schema',
      description: 'Return the JSON Schemas and authoring rules. kind "diagram" (default) for interactive diagrams, "page" for one-page answers to a question (answer first, then blocks such as points, steps, compare, metrics, charts (bar, column, line, area, pie, donut), gantt plans, 2x2 / heat-map matrices, sections, embedded diagrams), "book" for several answer pages read in order (chapters, with scroll, book and present reading modes).',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['diagram', 'page', 'book'] } } }
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
      description: 'Validate a diagram: schema, references, story consistency, and rendered geometry (overlaps, edges through nodes, label collisions). Detail diagrams (drill-down levels in `diagrams`) are checked too, plus drill targets, cycles, depth and $ref files. Returns errors/warnings with stable codes. Pass lang (e.g. "es", "ja", "ar", or "auto" for its meta.lang) to get the common content/story/ref/i18n messages translated; each translated finding keeps the English text in messageEn.',
      inputSchema: { type: 'object', properties: { ...source, lang: { type: 'string', description: 'BCP 47 tag of a built-in language for the messages, or "auto" (the payload meta.lang). Codes do not change; untranslated messages stay in English.' } } }
    },
    {
      name: 'yantra_build',
      description: write
        ? 'Validate and write a single offline HTML file (interactive diagram or one-page answer). Refuses on validation errors unless force is true.'
        : 'Validate and build a single offline HTML file (interactive diagram or one-page answer). The HTML comes back as an embedded text/html resource next to the validation report. Refuses on validation errors unless force is true.',
      inputSchema: {
        type: 'object',
        properties: { ...source, ...out(), force: { type: 'boolean' }, ...fold },
        ...(write ? { required: ['outputPath'] } : {})
      }
    },
    {
      name: 'yantra_export',
      description: `Export a static SVG (diagrams) or Markdown (diagrams and pages) of the overview or one drill-down level. ${write ? 'Writes outputPath when given, otherwise returns the content.' : 'Returns the content.'}`,
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
          ...fold,
          ...out()
        },
        required: ['format']
      }
    },
    {
      name: 'yantra_import_mermaid',
      description: `Convert Mermaid text (flowchart/graph, sequenceDiagram, stateDiagram, erDiagram or classDiagram) into a Yantra diagram payload with roles, groups (from subgraphs / namespaces), state shapes and self-loops, entity and class cards with fields and methods, relationship markers and a walkthrough, then validate it. ${write ? 'Writes outputPath when given, otherwise returns the payload.' : 'Returns the payload.'}`,
      inputSchema: {
        type: 'object',
        properties: {
          mermaid: { type: 'string', description: 'Mermaid source, without the ``` fence.' },
          title: { type: 'string', description: 'Diagram title (default: Mermaid front-matter title, else a generic one).' },
          ...out('Optional .json path to write.')
        },
        required: ['mermaid']
      }
    },
    {
      name: 'yantra_import',
      description: `Convert a Mermaid (flowchart, sequence, state, ER, class, mind map, journey; gantt / pie / timeline / quadrantChart become answer pages), draw.io / diagrams.net (.drawio, .xml, .drawio.svg, PNG with the diagram embedded), PlantUML (sequence, component / deployment / use case, activity, state, class, object, ER, mind map, WBS, gantt) or Visio (.vsdx) diagram into a Yantra payload with roles, groups and a walkthrough, then validate it. ${read ? 'Pass the source as text or filePath; the format is detected from the file name or content unless given.' : 'Pass the source as text (binary formats need file access, which this server does not offer); the format is detected from the content unless given.'} ${write ? 'Writes outputPath when given, otherwise returns the payload.' : 'Returns the payload.'}`,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: read ? 'Diagram source text (alternative to filePath).' : 'Diagram source text.' },
          ...(read
            ? { filePath: { type: 'string', description: 'Path to a .mmd, .md, .drawio, .xml, .drawio.svg, .drawio.png, .puml or .vsdx file (inside the input root). PlantUML !include is resolved inside the input root.' } }
            : {}),
          format: { type: 'string', enum: FORMATS, description: 'Source format (default: detected).' },
          page: { type: 'string', description: 'draw.io or Visio page to import: 1-based number or page name (default: the first).' },
          all: { type: 'boolean', description: `Import every page / diagram block; returns results[]${write ? ' and writes name-1.json, name-2.json, ...' : ''}` },
          title: { type: 'string', description: 'Diagram title (default: from the source, else a generic one).' },
          ...out('Optional .json path to write.')
        }
      }
    }
  ];
  if (shots)
    list.push({
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
          level,
          ...fold,
          focus: { type: 'string', description: 'Group id: zoom the camera to that group (its folded boxes open), as a double-click on its title does.' }
        },
        required: ['outputPath']
      }
    });
  return list;
}

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

const IMPORT_EXTS = ['.mmd', '.mermaid', '.md', '.markdown', '.drawio', '.dio', '.xml', '.svg', '.png', '.vsdx', '.puml', '.plantuml', '.pu', '.iuml', '.wsd', '.txt'];

/** A short file name for a built page, from its title. */
const fileName = (payload, ext) =>
  `${String(payload?.meta?.title || payload?.meta?.question || 'yantra').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'yantra'}${ext}`;

/**
 * A tool set: { tools, call(name, args), handle(message) -> reply or null }.
 * See the top of this file for the options.
 */
export function createToolset({ inputRoot = null, outputRoot = null, screenshot: shots = false } = {}) {
  const INPUT_ROOT = inputRoot ? path.resolve(inputRoot) : null;
  const OUTPUT_ROOT = outputRoot ? path.resolve(outputRoot) : null;
  const tools = toolList({ read: !!INPUT_ROOT, write: !!OUTPUT_ROOT, shots: shots && !!INPUT_ROOT && !!OUTPUT_ROOT });
  const offered = new Set(tools.map((t) => t.name));

  function inputPath(p, exts = ['.json']) {
    if (!INPUT_ROOT) throw new Error('filePath is not available on this server: send the payload or text inline.');
    if (typeof p !== 'string' || !p) throw new Error('filePath must be a non-empty string.');
    const file = path.resolve(INPUT_ROOT, p); // relative paths are relative to the input root
    if (!exts.includes(path.extname(file).toLowerCase())) throw new Error(`filePath must end with ${exts.join(' or ')}.`);
    if (!within(INPUT_ROOT, file)) throw new Error(`filePath must be inside ${INPUT_ROOT} (set YANTRA_INPUT_ROOT to allow another folder).`);
    return file;
  }

  function outputPath(p, exts) {
    if (!OUTPUT_ROOT) throw new Error('outputPath is not available on this server: results come back in the reply.');
    if (typeof p !== 'string' || !p) throw new Error('outputPath must be a non-empty string.');
    const file = path.resolve(OUTPUT_ROOT, p);
    if (!exts.includes(path.extname(file).toLowerCase())) throw new Error(`outputPath must end with ${exts.join(' or ')}.`);
    if (!within(OUTPUT_ROOT, file)) throw new Error(`outputPath must be inside ${OUTPUT_ROOT} (set YANTRA_OUTPUT_ROOT to allow another folder).`);
    return file;
  }

  /** True when the caller asked to write a file (an empty or missing outputPath means "return it"). */
  const wantsFile = (args) => args.outputPath !== undefined && args.outputPath !== null && args.outputPath !== '';

  function loadPayload(args) {
    let payload;
    let base = INPUT_ROOT; // inline payloads: page `src` and drill-down `$ref` paths resolve (and are confined) here
    if (args.payload && typeof args.payload === 'object') payload = args.payload;
    else if (args.filePath) {
      const file = inputPath(args.filePath);
      payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
      base = path.dirname(file);
    } else throw new Error(INPUT_ROOT ? 'Provide either payload or filePath.' : 'Provide payload (the diagram or page JSON).');
    // Without an input root nothing is read from disk: `src` / `$ref` stay unresolved and lint reports them
    return INPUT_ROOT ? resolveAny(payload, base, { root: INPUT_ROOT }) : payload;
  }

  /** A drill-down level of a diagram payload (the overview when no id is given). */
  function pickLevel(payload, id) {
    if (id === undefined || id === null || id === '') return payload;
    if (isDoc(payload)) throw new Error(`level applies to diagrams, not ${isBook(payload) ? 'books' : 'answer pages'}.`);
    const lv = getLevel(payload, String(id));
    if (!lv) throw new Error(`Unknown level "${id}". Detail diagrams: ${[...collectDiagrams(payload).map.keys()].join(', ') || 'none'}.`);
    return lv;
  }

  function call(name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    if (!offered.has(name)) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
    switch (name) {
      case 'yantra_get_schema': {
        const files = { page: ['yantra-page.schema.json', 'pages.md'], book: ['yantra-book.schema.json', 'books.md'] }[args.kind] || ['yantra-payload.schema.json', 'authoring.md'];
        return {
          schema: JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', files[0]), 'utf-8')),
          rules: fs.readFileSync(path.join(ROOT, 'docs', files[1]), 'utf-8')
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
      case 'yantra_validate': {
        const payload = loadPayload(args);
        return localizeFindings(lint(payload), args.lang === 'auto' ? payload?.meta?.lang : args.lang);
      }
      case 'yantra_build': {
        const payload = withFolds(loadPayload(args), args);
        const out = OUTPUT_ROOT || wantsFile(args) ? outputPath(args.outputPath, ['.html']) : null;
        const report = lint(payload);
        if (!report.valid && !args.force) return { written: false, ...report };
        const html = buildAny(payload);
        if (out) {
          fs.writeFileSync(out, html);
          return { written: true, outputPath: out, ...report };
        }
        const name = fileName(payload, '.html');
        return {
          built: true,
          fileName: name,
          bytes: Buffer.byteLength(html),
          note: 'The HTML is attached as a text/html resource: save it as a .html file and open it in any browser.',
          ...report,
          [ATTACH]: [{ type: 'resource', resource: { uri: `yantra://build/${encodeURIComponent(name)}`, mimeType: 'text/html', text: html } }]
        };
      }
      case 'yantra_export': {
        const payload = loadPayload(args);
        if (args.format !== 'md' && isDoc(payload)) throw new Error(`${isBook(payload) ? 'Books' : 'Answer pages'} export to md, or to html with yantra_build.`);
        const theme = args.theme === 'dark' ? 'dark' : 'light';
        const logos = readLogos();
        const picked = pickLevel(payload, args.level);
        const lv = withFolds(picked, args, picked);
        const content =
          args.format === 'md'
            ? isBook(payload) ? bookToMarkdown(payload) : isPage(payload) ? pageToMarkdown(payload) : toMarkdown(lv, { levels: !!args.allLevels && lv === payload })
            : renderSvg(sceneForView(lv, { view: args.view, modeId: args.mode }), { theme, step: args.step > 0 ? args.step - 1 : null, logo: logos[theme] || logos.light || logos.dark });
        if (!wantsFile(args)) return { content };
        const out = outputPath(args.outputPath, args.format === 'md' ? ['.md'] : ['.svg']);
        fs.writeFileSync(out, content);
        return { outputPath: out };
      }
      case 'yantra_import_mermaid': {
        if (typeof args.mermaid !== 'string' || !args.mermaid.trim()) throw new Error('Provide mermaid (the diagram source text).');
        const { payload, warnings } = fromMermaid(args.mermaid, { title: args.title });
        const validation = lint(payload);
        if (!wantsFile(args)) return { payload, warnings, validation };
        const out = outputPath(args.outputPath, ['.json']);
        fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
        return { outputPath: out, warnings, validation };
      }
      case 'yantra_import': {
        let text = args.text;
        let filename = '';
        let file = null;
        if (typeof text !== 'string' || !text.trim()) {
          if (!args.filePath) throw new Error(INPUT_ROOT ? 'Provide text (the diagram source) or filePath.' : 'Provide text (the diagram source).');
          file = inputPath(args.filePath, IMPORT_EXTS);
          text = fs.readFileSync(file); // bytes: .vsdx and .png are binary
          filename = path.basename(file);
        }
        if (args.format !== undefined && !FORMATS.includes(args.format)) throw new Error(`format must be one of ${FORMATS.join(', ')}.`);
        const { format, results } = importText(text, {
          format: args.format,
          filename,
          title: args.title,
          page: args.page === undefined ? undefined : String(args.page),
          all: !!args.all,
          include: INPUT_ROOT ? fileIncluder(INPUT_ROOT) : undefined,
          path: file
        });
        const out = results.map(({ payload, warnings }) => ({ payload, warnings, validation: lint(payload) }));
        if (wantsFile(args)) {
          const base = outputPath(args.outputPath, ['.json']);
          out.forEach((r, i) => {
            r.outputPath = out.length > 1 ? base.replace(/\.json$/i, `-${i + 1}.json`) : base;
            fs.writeFileSync(r.outputPath, `${JSON.stringify(r.payload, null, 2)}\n`);
            delete r.payload;
          });
        }
        return args.all ? { format, results: out } : { format, ...out[0] };
      }
      case 'yantra_screenshot': {
        const png = outputPath(args.outputPath, ['.png']);
        let html = typeof args.filePath === 'string' && args.filePath.toLowerCase().endsWith('.html') ? inputPath(args.filePath, ['.html']) : null;
        let tmp = null;
        if (!html) {
          tmp = `${png}.tmp.html`;
          const payload = loadPayload(args);
          pickLevel(payload, args.level);
          foldsOf(payload, args); // pages refuse folds early; depth goes in the link below
          fs.writeFileSync(tmp, buildAny(payload));
          html = tmp;
          if (isDoc(payload)) args = { ...args, width: 1100, height: 2200 };
        }
        try {
          // Folds go in the link (#collapsed=a,b; empty unfolds all), so they apply to a level too
          const ids = args.expandAll === true ? [] : Array.isArray(args.collapsed) ? args.collapsed.map(String) : null;
          const hash = [
            args.level ? `level=${encodeURIComponent(args.level)}` : '',
            ids ? `collapsed=${ids.map(encodeURIComponent).join(',')}` : '',
            depthOf(args) !== null ? `depth=${depthOf(args)}` : '',
            args.step ? `step=${args.step}` : '',
            args.view ? `view=${args.view}` : '',
            typeof args.focus === 'string' && args.focus ? `focus=${encodeURIComponent(args.focus)}` : ''
          ];
          const out = screenshot(html, png, { theme: args.theme, hash: hash.filter(Boolean).join('&'), width: args.width, height: args.height });
          return { outputPath: out };
        } finally {
          if (tmp) fs.rmSync(tmp, { force: true });
        }
      }
      default:
        throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
    }
  }

  /** The reply to one JSON-RPC message (without the jsonrpc field), or null for a notification. */
  function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { id: null, error: { code: -32600, message: 'Invalid Request: expected a JSON-RPC object.' } };
    const { id, method, params } = msg;
    if (id === undefined) return null; // notification
    switch (method) {
      case 'initialize':
        return {
          id,
          result: {
            protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'yantra', version: VERSION }
          }
        };
      case 'ping':
        return { id, result: {} };
      case 'tools/list':
        return { id, result: { tools } };
      case 'tools/call':
        try {
          const result = call(params?.name, params?.arguments);
          const extra = (result && result[ATTACH]) || [];
          return { id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...extra] } };
        } catch (err) {
          if (err.code === -32602) return { id, error: { code: -32602, message: err.message } };
          return { id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } };
        }
      default:
        return { id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  /** handle(), with unexpected exceptions turned into a JSON-RPC internal error. */
  function reply(msg) {
    try {
      return handle(msg);
    } catch (err) {
      const id = msg && typeof msg === 'object' && !Array.isArray(msg) && msg.id !== undefined ? msg.id : null;
      return { id, error: { code: -32603, message: `Internal error: ${err?.message || err}` } };
    }
  }

  return { tools, call, handle: reply, inputRoot: INPUT_ROOT, outputRoot: OUTPUT_ROOT };
}

/** The depth option as a whole number, or null when not given. */
function depthOf(args) {
  if (args.depth === undefined || args.depth === null) return null;
  if (!Number.isInteger(args.depth) || args.depth < 0) throw new Error('depth must be a whole number of levels to keep open (0 or more).');
  return args.depth;
}

/**
 * Ids folded when the diagram (or the level `target`) opens (collapsed / expandAll /
 * depth), or null to keep meta.layout.collapsed.
 */
function foldsOf(payload, args, target = payload) {
  const depth = depthOf(args);
  if (args.expandAll !== true && args.collapsed === undefined && depth === null) return null;
  if (isDoc(payload)) throw new Error(`collapsed, expandAll and depth apply to diagrams, not ${isBook(payload) ? 'books' : 'answer pages'}.`);
  if ([args.expandAll === true, args.collapsed !== undefined, depth !== null].filter(Boolean).length > 1) throw new Error('Use one of collapsed, expandAll and depth.');
  if (depth !== null) return foldsForDepth(target, depth);
  if (args.expandAll === true) return [];
  if (!Array.isArray(args.collapsed) || !args.collapsed.every((id) => typeof id === 'string')) throw new Error('collapsed must be an array of node or group ids.');
  return [...new Set(args.collapsed)];
}

function withFolds(payload, args, target = payload) {
  const ids = foldsOf(payload, args, target);
  if (!ids) return payload;
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const layout = meta.layout && typeof meta.layout === 'object' ? meta.layout : {};
  return { ...payload, meta: { ...meta, layout: { ...layout, collapsed: ids } } };
}
