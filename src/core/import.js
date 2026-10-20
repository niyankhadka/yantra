/**
 * One entry point for every importer: picks Mermaid, draw.io, PlantUML or Visio
 * from the file name or the content, splits multi-diagram sources, and converts.
 * Pure (no DOM, no Node APIs); the CLI and the MCP server both call it.
 *
 *   detectFormat(text | bytes, filename?)          -> 'mermaid' | 'drawio' | 'plantuml' | 'visio'
 *   importText(text | bytes, { format?, filename?, title?, page?, all?, include?, path? })
 *     -> { format, results: [{ payload, warnings }] }
 *
 * Bytes (Uint8Array / Buffer) may be a .vsdx (zip), a PNG with an embedded draw.io
 * diagram, or UTF-8 text. `include(target, fromPath)` resolves PlantUML `!include`
 * (Node callers pass one confined to the input folder; see lib/includes.js).
 */
import { fromMermaid, mermaidBlocks } from './mermaid.js';
import { fromDrawio, drawioPages, drawioFromPng, isPng } from './drawio.js';
import { fromPlantUml, plantUmlBlocks } from './plantuml.js';
import { fromVisio, visioPages, isZip } from './visio.js';

export const FORMATS = ['mermaid', 'drawio', 'plantuml', 'visio'];

const EXT = [
  [/\.vsdx$/i, 'visio'],
  [/\.(drawio|dio)$|\.drawio\.(xml|svg|png)$/i, 'drawio'],
  [/\.(puml|plantuml|pu|iuml|wsd)$/i, 'plantuml'],
  [/\.(mmd|mermaid)$/i, 'mermaid']
];

const isBytes = (x) => x instanceof Uint8Array;

export function detectFormat(input, filename = '') {
  if (isBytes(input)) {
    if (isZip(input)) return 'visio';
    if (isPng(input)) return 'drawio';
  }
  for (const [re, format] of EXT) if (re.test(filename)) return format;
  const src = isBytes(input) ? new TextDecoder().decode(input) : String(input ?? '');
  if (/<mxfile[\s>]|<mxGraphModel[\s>]|content="[^"]*(?:&lt;|<)mxfile/.test(src)) return 'drawio';
  if (/^[ \t]*@start(uml|mindmap|wbs|gantt)\b/m.test(src) || /^[ \t]*```(?:plantuml|puml)\b/m.test(src)) return 'plantuml';
  return 'mermaid';
}

/** ```plantuml / ```puml fenced blocks of a Markdown document. */
function fencedPlantUml(markdown) {
  const out = [];
  const re = /^[ \t]*(`{3,}|~{3,})[ \t]*(?:plantuml|puml)[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(String(markdown || '')))) out.push(m[2]);
  return out;
}

export function importText(input, opts = {}) {
  const filename = opts.filename || '';
  const format = opts.format || detectFormat(input, filename);
  if (!FORMATS.includes(format)) throw new Error(`Unknown import format "${format}" (use ${FORMATS.join(', ')}).`);
  const title = opts.title;

  if (format === 'visio') {
    if (!isBytes(input) || !isZip(input))
      throw new Error('Visio import needs the .vsdx file itself (a zip archive). Older .vsd files are not supported: save as .vsdx, or export from draw.io as .drawio.');
    if (!opts.all) return { format, results: [fromVisio(input, { title, page: opts.page })] };
    return { format, results: visioPages(input).map((_, i) => fromVisio(input, { title, page: i + 1 })) };
  }
  if (isBytes(input) && isZip(input)) throw new Error('This file is a zip archive; only Visio .vsdx archives can be imported.');
  const src = isBytes(input) ? (isPng(input) ? drawioFromPng(input) : new TextDecoder().decode(input)) : String(input ?? '');
  if (format !== 'drawio' && isBytes(input) && isPng(input)) throw new Error('A PNG can only be imported as draw.io (a PNG export with the diagram embedded).');
  const markdown = /\.(md|markdown)$/i.test(filename);

  if (format === 'drawio') {
    if (!opts.all) return { format, results: [fromDrawio(src, { title, page: opts.page })] };
    const pages = drawioPages(src);
    return { format, results: pages.map((_, i) => fromDrawio(src, { title, page: i + 1 })) };
  }

  if (format === 'plantuml') {
    let blocks = markdown ? fencedPlantUml(src) : [src];
    if (markdown && !blocks.length) blocks = plantUmlBlocks(src).map((b) => `@startuml\n${b}\n@enduml`);
    if (!blocks.length) throw new Error('No PlantUML diagram found (```plantuml block or @startuml ... @enduml).');
    // Several @startuml blocks in one file count as several diagrams
    const split = blocks.flatMap((b) => {
      const inner = plantUmlBlocks(b);
      return inner.length > 1 ? inner.map((x) => `@startuml\n${x}\n@enduml`) : [b];
    });
    const chosen = opts.all ? split : split.slice(0, 1);
    const results = chosen.map((b) => fromPlantUml(b, { title, include: opts.include, path: opts.path }));
    if (!opts.all && split.length > 1) results[0].warnings.unshift(`Found ${split.length} PlantUML diagrams; imported the first (use --all for every one).`);
    return { format, results };
  }

  let blocks = [src];
  if (markdown) {
    blocks = mermaidBlocks(src);
    if (!blocks.length) throw new Error('No ```mermaid fenced block found.');
    if (!opts.all) blocks = blocks.slice(0, 1);
  }
  return { format, results: blocks.map((b) => fromMermaid(b, { title })) };
}
