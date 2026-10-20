# Yantra

Interactive, step-by-step diagrams for systems and processes, and one-page answers to
questions. Describe the parts, the connections and the story in JSON (or import Mermaid);
Yantra lays it out, routes the edges, checks the result and ships it as **one offline HTML file**.

## Features

- **Automatic layout and orthogonal routing**: layered placement, edges that avoid cards,
  spread their ports and carry their labels. No coordinates to hand-tune.
- **Validator with stable codes**: schema, references, story *and* rendered geometry
  (overlaps, edges through cards, label collisions) for every mode and view.
- **Walkthroughs**: scenarios with steps that focus nodes and animate the active path;
  storyboard with autoplay, camera follow and a full-screen present mode.
- **Groups**: 2-5 labelled boundaries (VPC, team, phase) drawn behind their cards.
- **State machines and lifecycles**: state cards, initial / final dots and choice diamonds,
  self-loops drawn on the card, two-way and undirected edges (`edge.arrow`), back-edges
  routed cleanly. See `examples/ticket-lifecycle.json`.
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
  `gantt` plans (dates or relative days, groups, milestones, dependencies, today line) and
  `matrix` blocks (2x2 quadrants, 3x3-5x5 risk heat maps); inline SVG, both themes, no libraries. See [`docs/pages.md`](docs/pages.md).
- **Data models and class diagrams**: cards with field rows (PK / FK / UK, types) or attributes
  and methods (visibility, «stereotype»), growing with their rows; crow's foot cardinality and
  UML heads (inheritance, realization, composition, aggregation, dependency) at edge ends.
- **Mermaid import**: `yantra import` turns flowcharts, sequence, state, ER and class diagrams
  into payloads.
  See [`docs/mermaid.md`](docs/mermaid.md).
- **Accessible and shareable**: full keyboard control, state mirrored in the URL hash,
  print stylesheet, light and dark themes with WCAG contrast tests on the design tokens.
- **Exports**: standalone HTML, SVG, PNG and Markdown; a "Made with Yantra" badge
  (`meta.watermark: false` hides it, a string renames it).
- **Agent-ready**: CLI, MCP server, a Claude Code / Antigravity skill and a Python SDK.

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
| I already have a Mermaid sketch | `yantra import sketch.mmd` | `examples/mermaid/*.mmd` |

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
| `yantra screenshot <file.json\|file.html> [--step n] [--theme dark] [--view sequence] [--level id] [--width] [--height]` | PNG via the local Chrome/Edge (`YANTRA_BROWSER` overrides). |
| `yantra import <file.mmd\|file.md> [-o out.json] [--title "..."] [--all]` | Convert Mermaid flowcharts / sequence / state / ER / class diagrams, then validate. |
| `yantra new <file> [--page]` | Starter diagram or answer page. |
| `yantra examples [name] [-o file]` | List the examples or copy one. |
| `yantra mcp` / `yantra dev` | MCP server on stdio / live viewer. |

## Examples

15 diagrams and 7 answer pages in [`examples/`](examples) (`yantra examples` lists them):

- Diagrams: `cloud-architecture` (modes), `aws-serverless` (groups), `oauth-login` (sequence),
  `platform-overview` (drill-down into two detail diagrams, links),
  `ecommerce-schema` (ERD), `payment-classes` (UML class diagram),
  `ml-training-pipeline` (groups), `customer-support-escalation` (modes), `manufacturing-quality`
  (panels), `research-paper-lifecycle`, `sales-pipeline`, `supply-chain`, `academic-faculty`,
  `healthcare-clinical`, `ticket-lifecycle` (state machine).
- Pages: `answer-checkout-saga`, `answer-how-to-choose-database` (interactive diagram),
  `answer-incident-review`, `answer-project-kickoff`, `answer-explain-photosynthesis`,
  `answer-quarterly-review` (line, area, column, bar and donut charts, sparklines),
  `answer-launch-plan` (gantt, 2x2 matrix, risk heat map).

## Viewer

| Key | | Key | |
|---|---|---|---|
| `→` / Space, `←` | next / previous step | `Home` / `End` | first / last step |
| `P` | play | `C` | camera follow |
| `1`-`9` | scenario | `M` / `V` | cycle mode / flow-sequence view |
| `I` | inspector | `L` | legend |
| `D` | open the card's detail diagram | `Esc` again | back up a drill-down level |
| `S` | collapse storyboard | `F` | present (full screen) |
| `R` / `+` / `-` | fit / zoom | `T` | theme |
| `?` | all shortcuts | `Esc` | close / clear focus |

Drag cards to rearrange (edges re-route live); **Export → Copy JSON with positions** writes
the arrangement back as a manual layout. The state is mirrored in the URL hash, so links
reopen the same view: `#level=payments&step=3&mode=dev&view=sequence&scenario=2&role=<type>&inspector=<tab>&theme=dark`
(dev server also `#example=<name>`). Printing switches to the light theme and hides the chrome.

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
  `yantra_validate`, `yantra_build`, `yantra_export`, `yantra_import_mermaid`, `yantra_screenshot`.
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
  entity.js            Field / method rows of entity and class cards
  notation.js          Edge end markers: crow's foot cardinality, UML heads
  mermaid.js           Mermaid flowchart / sequence / state / ER / class importer
  page.js              Answer pages
  charts.js            Page charts, gantt plans, matrices (inline SVG)
  drill.js             Drill-down levels and link sanitising
src/app/               Browser viewer (engine state, renderer, interactions, UI)
src/styles/            Viewer CSS
src/assets/            Brand logos
schemas/               JSON Schemas: diagrams and answer pages
examples/              15 diagrams, 7 answer pages, Mermaid samples (all validate cleanly)
docs/                  Authoring (diagrams, pages, Mermaid) and architecture
python/                Python SDK (package yantra-diagrams)
tests/                 node --test suite
.github/workflows/     CI
```

## License

MIT
