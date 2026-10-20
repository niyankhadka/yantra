# Yantra

Interactive, step-by-step diagrams for systems and processes, and one-page answers to
questions. Describe the parts, the connections and the story in JSON (or import Mermaid,
draw.io or PlantUML);
Yantra lays it out, routes the edges, checks the result and ships it as **one offline HTML file**.

## Features

- **Automatic layout and orthogonal routing**: layered placement, edges that avoid cards,
  spread their ports and carry their labels. No coordinates to hand-tune.
- **Validator with stable codes**: schema, references, story *and* rendered geometry
  (overlaps, edges through cards, label collisions) for every mode and view.
- **Walkthroughs**: scenarios with steps that focus nodes and animate the active path;
  storyboard with autoplay, camera follow and a full-screen present mode.
- **Groups**: 2-5 labelled boundaries (VPC, team, phase) drawn behind their cards.
- **Trees and mind maps**: `meta.layout.algorithm: "tree"` (org charts, decision trees,
  breakdowns; tidy layout with comb connectors, TB or LR) or `"mindmap"` (central topic,
  balanced branches, one colour per branch). Wide org charts list leaf teams in compact
  columns (`meta.layout.compact`), assistants (`data.assistant`) sit beside their manager, and
  dragging a card takes its subtree and tidy connectors along.
- **Big diagrams**: fold subtrees or groups into one card and back (`+N`, key `X`,
  `meta.layout.collapsed`, `#collapsed=` in the link); trees get a larger node budget.
- **State machines and lifecycles**: state cards, initial / final dots and choice diamonds,
  fork / join bars and concurrent regions, self-loops drawn on the card, two-way and
  undirected edges (`edge.arrow`), back-edges routed cleanly. See
  `examples/ticket-lifecycle.json` and `examples/parallel-checkout-states.json`.
- **Sequence view**: the same payload as a lifeline diagram (`meta.view: "sequence"`, key `V`,
  `--view sequence`), one message per step.
- **Modes**: alternative views (production vs local) that hide nodes or swap details.
- **Drill-down**: an overview whose cards open detail diagrams (`data.drill`, a `diagrams` map
  or `$ref` files), with a breadcrumb, Back/`Esc`, deep links (`#level=`) and up to 3 levels;
  big systems stay under the card budget at every level.
- **Links**: `url` on nodes, edges and steps opens runbooks, dashboards or specs from the
  inspector (http, https and mailto only).
- **Inspector**: tabs built from content (Summary, Step, Details) plus custom `panels`;
  `meta.inspector.onNodeClick` decides what a card click opens.
- **Answer pages** (`"kind": "page"`): the answer first, then blocks - points, steps, metrics,
  chart, compare, table, timeline, faq, checklist, quote, image, kv, callout, code, sources and
  diagrams (static, or `interactive: true` for the live viewer, max 2 per page). A contents
  row appears for longer pages.
- **Charts and plans**: bar, column, line, area, pie and donut charts (grouped or stacked
  series, nice axes, legends, hidden data tables for screen readers), metric sparklines,
  `gantt` plans (dates or relative days, working days and holidays, groups, milestones,
  dependencies, today line), legends that toggle series and slices, and
  `matrix` blocks (2x2 quadrants, 3x3-5x5 risk heat maps); inline SVG, both themes, no libraries. See [`docs/pages.md`](docs/pages.md).
- **Data models and class diagrams**: cards with field rows (PK / FK / UK, types) or attributes
  and methods (visibility, «stereotype»), growing with their rows; crow's foot cardinality and
  UML heads (inheritance, realization, composition, aggregation, dependency) at edge ends,
  edges attached to field rows (foreign key → key), multiplicity labels at either end.
- **Import**: `yantra import` turns Mermaid flowcharts, sequence, state, ER and class diagrams,
  mind maps and journeys, draw.io / diagrams.net files (and PNG exports), Visio `.vsdx` files
  and PlantUML sequence, component, use-case, activity, state, class, object, ER and
  mind-map / WBS diagrams into payloads, and Mermaid gantt / pie / timeline / quadrant charts
  and PlantUML Gantt charts into answer pages. See
  [`docs/mermaid.md`](docs/mermaid.md) and [`docs/import.md`](docs/import.md).
- **Accessible and shareable**: full keyboard control, state mirrored in the URL hash,
  print stylesheet, light and dark themes with WCAG contrast tests on the design tokens.
- **Exports**: standalone HTML, SVG, PNG and Markdown; a "Made with Yantra" badge
  (`meta.watermark: false` hides it, a string renames it).
- **Agent-ready**: CLI, MCP server, a Claude Code / Antigravity skill and a Python SDK.

## Installation

Yantra needs **Node.js 18 or later** for everything that validates or produces HTML.

```bash
npm i -g yantra-diagrams        # once published: puts `yantra` on PATH
yantra build diagram.json

pip install yantra-diagrams     # once published: Python SDK (import yantra)
```

The npm package ships a prebuilt viewer, so an installed copy needs no build step. The
Python SDK writes payloads in pure Python and calls the CLI to validate and build HTML; it
finds the CLI via `YANTRA_CLI`, a Yantra checkout it is installed from, `yantra` on PATH, or
`npx` (see [`python/README.md`](python/README.md)). Until the packages are published, work
from a clone as below.

## Import from

| Source | Command | Supported | Guide |
|---|---|---|---|
| Mermaid (`.mmd`, ```mermaid in `.md`) | `yantra import flow.mmd` | flowchart, sequence, state, ER, class, mind map, journey; gantt, pie, timeline, quadrant → pages | [`docs/mermaid.md`](docs/mermaid.md) |
| draw.io / diagrams.net (`.drawio`, `.xml`, `.drawio.svg`, `.drawio.png`, compressed or not) | `yantra import model.drawio [--page n]` | shapes, colours, icons, containers / swimlanes → groups, edge labels, ER and UML ends | [`docs/import.md`](docs/import.md) |
| Visio (`.vsdx`) | `yantra import process.vsdx [--page n]` | shapes, glued connectors, groups | [`docs/import.md`](docs/import.md) |
| PlantUML (`.puml`, ```plantuml in `.md`) | `yantra import login.puml` | sequence, component / deployment / use case, activity, state, class, object, ER, mind map, WBS, Gantt (page); `!include` inside the folder | [`docs/import.md`](docs/import.md) |

The format is detected from the extension or the content; `--from mermaid|drawio|plantuml|visio`
forces it. Every import is validated straight away.

## Quick start

```bash
npm install
npm run dev                                    # viewer with the built-in examples
node bin/yantra.js new diagram.json            # starter payload (--page for an answer page)
node bin/yantra.js validate diagram.json
node bin/yantra.js build diagram.json          # -> diagram.html (works offline)
node bin/yantra.js screenshot diagram.json     # -> diagram-light.png
```

`npm link` makes the `yantra` command available globally.

## Pick your output

| The question | Output | Start from |
|---|---|---|
| What states can it be in, and what moves it? | **Diagram** with `shape: "state"` and `initial` / `final` dots | `examples/ticket-lifecycle.json` |
| How do the parts connect / how does the flow run? | **Diagram** (flow view) | `yantra new x.json`, `examples/cloud-architecture.json` |
| Who calls whom, in what order? (protocols, APIs) | **Diagram** with `meta.view: "sequence"` | `examples/oauth-login.json` |
| What tables or classes exist and how do they relate? | **Diagram** with `fields` / `methods` and edge `relation` / `sourceEnd` / `targetEnd` | `examples/ecommerce-schema.json`, `examples/payment-classes.json` |
| What is the answer / which option / what happened? | **Answer page** (`"kind": "page"`) | `yantra new x.json --page`, `examples/answer-*.json` |
| I already have a Mermaid, draw.io, PlantUML or Visio sketch | `yantra import sketch.mmd` (or `.drawio`, `.puml`, `.vsdx`) | `examples/mermaid/`, `examples/drawio/`, `examples/plantuml/`, `examples/visio/` |

## A diagram in 20 lines

```json
{
  "meta": { "title": "Checkout", "description": "How an order is paid and stored." },
  "nodes": [
    { "id": "web", "type": "client", "data": { "title": "Web app", "subtitle": "Customer checkout" } },
    { "id": "api", "type": "service", "data": { "title": "Orders API", "tech": "Go" } },
    { "id": "db", "type": "data", "data": { "title": "Orders DB", "tech": "PostgreSQL", "icon": "database" } }
  ],
  "edges": [
    { "id": "web-api", "source": "web", "target": "api", "label": "POST /orders" },
    { "id": "api-db", "source": "api", "target": "db", "label": "INSERT order" }
  ],
  "steps": [
    { "title": "Overview" },
    { "title": "Submit", "highlightNodes": ["web", "api"], "highlightEdges": ["web-api"] },
    { "title": "Persist", "highlightNodes": ["api", "db"], "highlightEdges": ["api-db"] }
  ]
}
```

Full rules, budgets, groups, sequence view and validation codes: [`docs/authoring.md`](docs/authoring.md).

## CLI

| Command | |
|---|---|
| `yantra validate <file> [--json]` | Check schema, references, story and geometry. Exit code 1 on errors. |
| `yantra build <file> [-o out.html] [--force]` | Validate, then write a single offline HTML file. |
| `yantra export <file> -f svg\|md [--theme dark] [--mode id] [--view flow\|sequence] [--step n] [--level id] [--all-levels]` | Static SVG or Markdown, of the overview or one drill-down level (`--all-levels`: Markdown of every level). |
| `yantra screenshot <file.json\|file.html> [--step n] [--theme dark] [--view sequence] [--level id] [--width] [--height]` | PNG via the local Chrome/Edge (`YANTRA_BROWSER` overrides). `--width 390` shows a page at phone width. |
| `--collapsed id,id` / `--expand-all` | With `build`, `export` and `screenshot`: open with these subtrees or groups folded, or nothing folded, instead of `meta.layout.collapsed`. |
| `yantra import <file> [-o out.json] [--from mermaid\|drawio\|plantuml] [--page n\|name] [--title "..."] [--all]` | Convert Mermaid (flowchart, sequence, state, ER, class, mind map), draw.io or PlantUML, then validate. |
| `yantra new <file> [--page]` | Starter diagram or answer page. |
| `yantra examples [name] [-o file]` | List the examples or copy one. |
| `yantra mcp` / `yantra dev` | MCP server on stdio / live viewer. |

## Examples

21 diagrams, 13 answer pages and 7 chart pages in [`examples/`](examples) (`yantra examples`
lists them). In the dev viewer (`npm run dev`) the example menu has three sections: Diagrams,
Answer pages (Q&A) and Charts & dashboards; a page opens in the viewer with its own theme and
live diagram embeds.

- Diagrams: `cloud-architecture` (modes), `aws-serverless` (groups), `oauth-login` (sequence),
  `platform-overview` (drill-down into two detail diagrams, links),
  `ecommerce-schema` (ERD), `payment-classes` (UML class diagram),
  `ml-training-pipeline` (groups), `customer-support-escalation` (modes), `manufacturing-quality`
  (panels), `research-paper-lifecycle`, `sales-pipeline`, `supply-chain`, `academic-faculty`,
  `healthcare-clinical`, `ticket-lifecycle` (state machine), `parallel-checkout-states` (fork,
  join and concurrent regions), `org-chart` (tree),
  `study-plan-mindmap` (mind map), `incident-triage-decision-tree` (decision tree, opens folded),
  `health-referral-nepali` (Nepali), `order-fulfilment-arabic` (Arabic, right to left).
- Pages: `answer-checkout-saga`, `answer-how-to-choose-database` (interactive diagram),
  `answer-incident-review`, `answer-project-kickoff`, `answer-explain-photosynthesis`,
  `answer-quarterly-review` (line, area, column, bar and donut charts, sparklines),
  `answer-launch-plan` (gantt, 2x2 matrix, risk heat map),
  `answer-order-fulfilment-arabic` (Arabic, right to left), `answer-card-payment-journey`
  (interactive diagram), `answer-what-happens-url` (interactive sequence), `answer-safe-feature-rollout`
  (how-to), `answer-build-or-buy-crm` (decision with a cost chart), `answer-black-friday-slowdown`
  (incident explainer).
- Chart pages: `chart-sales-dashboard`, `chart-marketing-analytics` (donut, funnel, campaign
  return), `chart-budget-vs-actual` (variance with negative values, pie), `chart-survey-results`
  (NPS, agree/disagree bars, 2x2 matrix, quotes), `chart-portfolio-status` (working-day gantt,
  5x5 risk heat map), `chart-sla-monitoring` (incidents, restore time against target, timeline),
  `chart-hr-headcount` (stacked area, joiners and leavers). Companies and data are fictional.

## Viewer

| Key | | Key | |
|---|---|---|---|
| `→` / Space, `←` | next / previous step | `Home` / `End` | first / last step |
| `P` | play | `C` | camera follow |
| `1`-`9` | scenario | `M` / `V` | cycle mode / flow-sequence view |
| `I` | inspector | `L` | legend |
| `D` | open the card's detail diagram | `Esc` again | back up a drill-down level |
| `S` | collapse storyboard | `F` | present (full screen) |
| `X` | fold / unfold the selected branch | | |
| `R` / `+` / `-` | fit / zoom | `T` | theme |
| `?` | all shortcuts | `Esc` | close / clear focus |

Drag cards to rearrange (edges re-route live); **Export → Copy JSON with positions** writes
the arrangement back as a manual layout. The state is mirrored in the URL hash, so links
reopen the same view: `#level=payments&step=3&mode=dev&view=sequence&scenario=2&role=<type>&inspector=<tab>&collapsed=<id,id>&theme=dark`
(dev server also `#example=<name>`). Printing switches to the light theme and hides the chrome.

## Languages and right to left

Set `meta.lang` (BCP 47) on a diagram or page: the viewer chrome, answer-page labels, the
badge and the SVG / Markdown exports switch language, `<html lang>` and `xml:lang` are set,
and numbers in metrics and charts use that language's format. Built in: English, Spanish,
French, German, Portuguese, Italian, Hindi, Bengali, Nepali, Chinese (Simplified, and
Traditional for `zh-Hant`, `zh-TW`, `zh-HK`), Japanese, Korean, Indonesian, Arabic, Hebrew,
Persian and Urdu; other languages keep English labels (the validator warns) and
`meta.strings` overrides any label by key. A built file carries only English plus the
languages it uses. `yantra validate --lang ja` (MCP: `lang`) translates the common
validation messages; codes stay the same.
Arabic, Hebrew, Persian and Urdu (or `meta.dir: "rtl"`) mirror the toolbar, walkthrough,
inspector, legend and badge; the diagram itself keeps its layout direction. Card text is
measured per script (full-width CJK, Devanagari, Arabic) and CJK wraps without spaces.
See [`docs/authoring.md`](docs/authoring.md#languages-and-right-to-left).

## Branding

Put your logo in `src/assets/`: `logo-light.svg` (dark mark for the light theme) and
`logo-dark.svg` (light mark for the dark theme). They replace the default mark in the toolbar,
the badge and the tab icon, and are embedded into built HTML, SVG exports and answer pages
(once per file). If only one exists it is used for both. Use a square `viewBox` without
fixed `width`/`height`.

## Agents and integrations

- **Claude Code**: the `yantra` skill in `.claude/skills/yantra/`; `.mcp.json` registers the
  MCP server; guidance in `CLAUDE.md`.
- **Antigravity / Codex / others**: `AGENTS.md`, `.agents/skills/yantra/`, `.agents/rules/`,
  `.agents/mcp_config.json`.
- **MCP tools**: `yantra_get_schema`, `yantra_list_examples`, `yantra_get_example`,
  `yantra_validate`, `yantra_build`, `yantra_export`, `yantra_import` (Mermaid, draw.io,
  PlantUML), `yantra_import_mermaid`, `yantra_screenshot`.
- **Python**: `pip install -e python/`, then `from yantra import Diagram, Page`; see
  [`python/README.md`](python/README.md).
- **Embedding**: put the built HTML in an `<iframe>`; it makes no external requests.

Details: [`docs/architecture.md`](docs/architecture.md).

MCP file access is sandboxed: tools read `filePath` only inside `YANTRA_INPUT_ROOT` and write
`outputPath` only inside `YANTRA_OUTPUT_ROOT` (both default to the server's working
directory; relative paths resolve against the matching root), with fixed extensions
(`.html`, `.svg`/`.md`, `.png`, `.json`).

## Development

- `npm test` runs the Node suite (layout, routing, lint, pages, groups, sequence, Mermaid,
  contrast, CLI/MCP, builder); every example must validate with zero warnings.
- CI (`.github/workflows/ci.yml`): Node 18/20/22 on Linux plus Windows, validates and builds
  every example, and runs the Python SDK tests on Python 3.9 and 3.12.

## Project layout

```
bin/yantra.js          CLI
mcp/server.js          MCP server (stdio)
lib/                   Node-only: standalone HTML builder, headless screenshots
src/core/              Shared engine: model, layout, routing, scene, lint, SVG/Markdown, theme
  sequence.js          Sequence (lifeline) view
  tree.js              Tree and mind-map layouts, folding
  entity.js            Field / method rows of entity and class cards
  notation.js          Edge end markers: crow's foot cardinality, UML heads
  mermaid.js           Mermaid flowchart / sequence / state / ER / class / mind-map importer
  drawio.js            draw.io / diagrams.net importer (inflate.js: compressed pages)
  plantuml.js          PlantUML sequence / component / activity / state / class / mind-map importer
  import.js            Format detection and dispatch for `yantra import`
  page.js              Answer pages
  charts.js            Page charts, gantt plans, matrices (inline SVG)
  drill.js             Drill-down levels and link sanitising
  i18n.js              Interface strings (English; locales/: 17 more languages), RTL, plurals, number formats
  lintmessages.js      Translated validation messages (`validate --lang`)
src/app/               Browser viewer (engine state, renderer, interactions, UI)
src/styles/            Viewer CSS
src/assets/            Brand logos
schemas/               JSON Schemas: diagrams and answer pages
examples/              21 diagrams, 20 answer and chart pages, Mermaid / draw.io / PlantUML samples (all validate cleanly)
docs/                  Authoring (diagrams, pages, imports, languages) and architecture
python/                Python SDK (package yantra-diagrams)
tests/                 node --test suite
.github/workflows/     CI
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md); changes are listed in [`CHANGELOG.md`](CHANGELOG.md)
and security reports go through [`SECURITY.md`](SECURITY.md).

## License

MIT
