# Changelog

All notable changes to Yantra are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The npm package
(`yantra-diagrams`) and the Python SDK (`yantra-diagrams`) share one version number.

## [Unreleased]

### Changed

- Built HTML carries English plus only the languages its payload uses (answer pages: those
  of their interactive diagrams); every interface table moved to `src/core/locales/`. An
  English diagram is about 389 kB instead of 469 kB, and adding languages no longer grows it.
- Title, edge-label and headline budgets measure display width: a full-width (CJK)
  character counts 2 and a combining mark 0, so 42 means about 21 Chinese characters.

### Added

- Charts and plans on answer pages: bar, column, line, area, pie and donut charts,
  sparklines, `gantt` plans and `matrix` blocks (quadrants, risk heat maps).
- Drill-down: detail diagrams per node (`$ref` files or inline), level navigation and links
  on nodes, edges and steps; `--level` / `--all-levels` in the CLI and `level` in MCP tools.
- State machines: node `shape` (`state`, `initial`, `final`, `choice`), self-loops, edge
  `arrow` (`both`, `none`) and Mermaid `stateDiagram` import.
- Data models and class diagrams: table and class cards with `data.fields` / `data.methods`,
  crow's foot cardinality and UML relations at edge ends, Mermaid `erDiagram` and
  `classDiagram` import.
- Tree and mind-map layouts (`meta.layout.algorithm: "tree" | "mindmap"`) with collapsible
  branches, and Mermaid `mindmap` import.
- Org charts: compact stacks for wide trees (`meta.layout.compact`), assistant cards beside
  their manager (`data.assistant`), subtree dragging with tidy connectors, `+N` badges on
  folded pseudo-states, and `--collapsed` / `--expand-all` (CLI), `collapsed` / `expandAll`
  (MCP) and `collapsed=` / `expand_all=` (Python) for builds and exports.
- draw.io / diagrams.net import (`.drawio`, `.xml`, `.drawio.svg`, compressed pages):
  shapes to node types, containers and swimlanes to groups, edge labels, arrow heads,
  ER cardinalities, UML relations, class and table cards, page selection with `--page` or `--all`.
- PlantUML import: sequence diagrams to the sequence view; component, deployment, use-case
  and activity diagrams to flow diagrams with groups; state and class diagrams; mind maps and
  work breakdowns with the mind-map and tree layouts.
- `yantra import --from mermaid|drawio|plantuml` with detection by extension or content,
  the `yantra_import` MCP tool and `yantra.import_diagram()` in the Python SDK.
- Languages and right to left: `meta.lang` (BCP 47) translates the viewer, answer pages,
  charts and the SVG / Markdown exports (built in: English, Spanish, French, German,
  Portuguese, Hindi, Nepali, Chinese, Japanese, Arabic; `meta.strings` overrides any label),
  sets `<html lang>` / `xml:lang` and number formats; Arabic, Hebrew, Persian and Urdu (or
  `meta.dir: "rtl"`) mirror the chrome while diagrams keep their layout. Text is measured
  per script (full-width CJK, Devanagari, Arabic) and CJK wraps without spaces.
  `Diagram.language()` / `Page(lang=...)` in the Python SDK; Nepali and Arabic examples.
- More languages: Italian, Bengali, Korean, Indonesian, Hebrew, Persian, Urdu and
  Traditional Chinese (`zh-Hant`; `zh-TW`, `zh-HK` and `zh-MO` use it). Counted words follow
  `Intl.PluralRules` (tables may add `zero` / `two` / `few` / `many` forms, as Arabic and
  Hebrew do).
- `yantra validate --lang xx` (`auto`: the payload's language), a `lang` input on the MCP
  validate tool and `validate(lang=...)` in the Python SDK translate the content/, story/,
  ref/ and i18n/ messages; codes are unchanged and the English text stays in `messageEn`.
- Release tooling: npm `files` whitelist with a prebuilt viewer (`prepack`), Python
  packaging metadata, a tag-triggered release workflow, contribution and security guides,
  issue and pull request templates.

### Changed

- The npm package is named `yantra-diagrams` (the `yantra` name on npm belongs to another
  project); the command is still `yantra`. Vite is now a development dependency.
- The Python SDK can also run the CLI through `npx` when no local CLI is found.

## [2.0.0] - 2026-10-20

### Added

- Automatic layered layout (cycle breaking, crossing reduction, aligned ports) and
  orthogonal edge routing with label placement; no coordinates needed.
- Validator with stable codes for schema, references, story consistency, budgets and the
  rendered geometry (overlaps, edges through cards, label collisions) in every mode and view.
- Walkthroughs: scenarios and steps that focus nodes and animate the active path, with
  autoplay, camera follow and a full-screen present mode.
- Groups: labelled boundaries (VPC, team, phase) drawn behind their cards, nested up to three levels.
- Sequence view (`meta.view: "sequence"`): the same payload drawn as lifelines, one message per step.
- Modes: alternative views that hide nodes or override their details.
- Inspector with Summary, Step and Details tabs plus custom panels built from page blocks.
- Answer pages (`"kind": "page"`): the answer first, then blocks such as points, steps,
  metrics, charts, comparisons, tables, timelines and embedded diagrams (static or interactive).
- Mermaid import for flowcharts and sequence diagrams (`yantra import`).
- Exports: single-file offline HTML, SVG, PNG (local Chrome / Edge) and Markdown.
- Keyboard control, URL-hash state, print stylesheet, light and dark themes with WCAG
  contrast tests, custom brand logos.
- CLI (`validate`, `build`, `export`, `screenshot`, `import`, `new`, `examples`, `mcp`,
  `dev`), an MCP server with sandboxed file access, an agent skill and a Python SDK.

[Unreleased]: https://github.com/niyankhadka/yantra/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/niyankhadka/yantra/releases/tag/v2.0.0
