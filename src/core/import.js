/**
 * One entry point for every importer: picks Mermaid, draw.io or PlantUML from
 * the file name or the text, splits multi-diagram sources, and converts.
 * Pure (no DOM, no Node APIs); the CLI and the MCP server both call it.
 *
 *   detectFormat(text, filename?)                       -> 'mermaid' | 'drawio' | 'plantuml'
 *   importText(text, { format?, filename?, title?, page?, all? })
 *     -> { format, results: [{ payload, warnings }] }
 */
import { fromMermaid, mermaidBlocks } from './mermaid.js';
import { fromDrawio, drawioPages } from './drawio.js';
import { fromPlantUml, plantUmlBlocks } from './plantuml.js';

export const FORMATS = ['mermaid', 'drawio', 'plantuml'];

const EXT = [
  [/\.(drawio|dio)$|\.drawio\.(xml|svg)$/i, 'drawio'],
  [/\.(puml|plantuml|pu|iuml|wsd)$/i, 'plantuml'],
  [/\.(mmd|mermaid)$/i, 'mermaid']
];

export function detectFormat(text, filename = '') {
  for (const [re, format] of EXT) if (re.test(filename)) return format;
  const src = String(text ?? '');
  if (/<mxfile[\s>]|<mxGraphModel[\s>]|content="[^"]*(?:&lt;|<)mxfile/.test(src)) return 'drawio';
  if (/^[ \t]*@start(uml|mindmap|wbs)\b/m.test(src) || /^[ \t]*```(?:plantuml|puml)\b/m.test(src)) return 'plantuml';
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

export function importText(text, opts = {}) {
  const src = String(text ?? '');
  const filename = opts.filename || '';
  const format = opts.format || detectFormat(src, filename);
  if (!FORMATS.includes(format)) throw new Error(`Unknown import format "${format}" (use ${FORMATS.join(', ')}).`);
  const markdown = /\.(md|markdown)$/i.test(filename);
  const title = opts.title;

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
    const results = chosen.map((b) => fromPlantUml(b, { title }));
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
