# Changelog

All notable changes to Yantra are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The npm package
(`@niyankhadka/yantra`) and the Python SDK (`niyankhadka-yantra`) share one version number.

## [Unreleased]

### Added

- The Yantra website, https://yantra.nbk.com.np/ (`site/`, `npm run build:site`): a landing
  page with a live demo, the docs rendered from `docs/*.md` with search, eight step-by-step
  guides (`site/guides/`), a 404 page, a sitemap and social cards.
- The playground's **Copy prompt** follows the editor: with an empty editor it copies the
  instructions and a request line; with valid JSON it adds the diagram or page and asks for
  a change; with findings it adds them and asks for a fix. An options box takes the request
  and offers **Instructions only** (`playground/prompt.js`, docs/chat.md).
- Website search-engine support: a unique title and description per page, JSON-LD
  structured data (software, website with docs search, FAQ, articles and breadcrumbs), a
  sitemap with `lastmod` dates, a web manifest and touch icons, related guides at the end of
  each guide, `/docs/?q=` to open the docs search, and optional Google and Bing verification
  tags from `YANTRA_SITE_GOOGLE_VERIFICATION` / `YANTRA_SITE_BING_VERIFICATION`.

### Fixed

- The Pages workflow deploys the playground; its Pages check skipped the deploy even when
  Pages was enabled.

### Changed

- The README is reorganised around a gallery of diagram kinds and links to the website docs;
  its images use absolute URLs so they show on npm. The contributing, support, security,
  trademark and Python SDK pages and the docs intros are tidied, and the npm keywords and
  PyPI metadata are updated.
- The playground moved to https://yantra.nbk.com.np/playground/; old `/#example=...` links
  are forwarded there. The chat packs, README and docs link to the new address.
- `package.json` `homepage` and the Python package's Homepage and Documentation URLs point to
  the website.
- `npm run build:playground` builds the whole site (`site/vite.config.js`, which replaces
  `playground/vite.config.js`); the Pages workflow runs `npm run build:site`.

## [1.1.0] - 2026-10-21

Requires Node.js 20.19 or later (22.12 or later on Node 22); Node 18 is no longer supported.

### Added

- `TRADEMARKS.md`: the code is MIT; the Yantra name and logo follow the trademark policy.
- A Sponsor button (Buy Me a Coffee) and a "Support the project" section in the README.
- `yantra init` sets up a project for coding agents in one step: the portable Yantra skill
  (`/yantra`, and automatic use for diagram requests), the MCP server
  (`npx -y @niyankhadka/yantra mcp`, `cmd /c npx` on Windows) and short rules, for Claude
  Code, Cursor, Codex and Antigravity (`--claude`, `--cursor`, `--codex`, `--antigravity`,
  `--all`). Existing files are kept unless `--force`, MCP configs are merged, `AGENTS.md`
  gets a marked section, and `--dry-run` previews. See `docs/agents.md`.
- A portable skill in `skills/yantra/SKILL.md` (shipped in the npm package) with guidance for
  diagrams drawn from a codebase: architecture with drill-down, ERDs from the schema,
  sequence diagrams for auth and payment flows.
- `yantra schema [diagram|page]` and `yantra docs [authoring|pages|mermaid|import|agents]` print
  the schemas and guides, for agents without the MCP server.
- Python SDK: `yantra.init_project(path, agents=[...])`.
- A browser playground for JSON written by AI chats (`playground/`, deployed to GitHub Pages
  at https://yantra.nbk.com.np/ by `.github/workflows/pages.yml`): paste a diagram
  or answer page, see the validation findings (translatable) and the live result, and download
  standalone HTML, SVG, PNG, Markdown or JSON. It runs offline once loaded, has a "Copy prompt
  for your chat" button and loads any gallery example.
- Chat packs in `chat/`: a copyable prompt for any chat, a Claude.ai skill
  (`npm run pack:skill` writes `dist-chat/yantra-skill.zip`) and a custom GPT pack
  (instructions, conversation starters, knowledge files; `npm run pack:gpt`). See `docs/chat.md`.
- `yantra mcp --http [--port 8787] [--host 127.0.0.1]`: the MCP server over Streamable HTTP
  for clients that connect by URL. Binds localhost, checks `Origin` and `Host`, takes an
  optional bearer token (`YANTRA_MCP_TOKEN`) and has no file access unless
  `YANTRA_INPUT_ROOT` / `YANTRA_OUTPUT_ROOT` are set; `yantra_build` then returns the HTML
  as an embedded resource. Deploy guide and security model: `docs/remote-mcp.md`.

### Changed

- The single-file HTML assembly moved from `lib/build.js` to `src/core/standalone.js`, so the
  playground builds the same file in the browser. The MCP tools moved to `mcp/tools.js`,
  shared by both transports.
- Requires Node.js 20.19 or later (22.12 or later on Node 22); Node.js 18 reached end of
  life. CI tests Node 20, 22 and 24.
- The viewer is built with Vite 8.

### Fixed

- `yantra dev` from an installed package uses a Vite installed next to it.

## [1.0.1] - 2026-10-20

### Changed

- npm releases use trusted publishing and are staged for approval on npmjs.com; the
  release workflow no longer needs an npm token.
- The README installs from npm and PyPI and shows their version badges.
- CI and release workflows use `actions/checkout`, `setup-node` and `setup-python` v7.

### Fixed

- Tests run on Node.js 18, and failing tests are reported as CI annotations.

## [1.0.0] - 2026-10-20

First public release.

### Added

- Charts in diagrams: `data.chart` draws a mini chart inside any card, under the subtitle
  (sparkline, area, mini columns, labelled bars, share donut, progress ring, bullet against a
  target), and `"shape": "chart"` makes a chart card that draws any page chart kind (column,
  bar, line, area, pie, donut; series, stacking, axes and legend) at card scale. Cards grow to
  fit; light, dark, every zoom level, SVG and PNG export look the same (one style table for the
  viewer and the export). The Details tab shows the chart full size with its data table, the
  Markdown export lists the numbers, and the card's accessible name carries them.
- Lint: `chart/missing`, `chart/invalid`, `chart/unknown-kind`, `chart/mismatch`,
  `chart/negative`, `chart/out-of-range`, `chart/too-many-points`, `chart/too-many-series`,
  `budget/too-many-chart-cards` and `budget/too-many-mini-charts`.
- Python SDK: `add_node(..., chart=...)`, `add_chart_card(...)` and `mini_chart(...)`.
- Example `live-operations-dashboard` (services, chart cards and alerting, with an incident
  panel holding a gantt and a chart); mini charts on `cloud-architecture`, `sales-pipeline`
  and `smart-city-operations`.
- Strings `chart.kind.ring`, `chart.kind.bullet`, `chart.target`, `chart.remaining` and
  `node.chart` in every language.
- Chart targets: `target` on a page chart block (column, bar, line, area) draws a dashed
  reference line labelled "Target 160 ms" (vertical on bar charts), in light and dark; the
  chart's accessible name, hidden data table and Markdown list it. Lint `page/chart-target`
  (not a number; a warning on pie and donut). Python `blocks.chart(target=...)`.
  `chart-sla-monitoring` draws its restore-time target this way.
- Phones (below 560 px): a **More** (⋯) toolbar menu holds the example gallery in its three
  sections and **Keyboard shortcuts**, so both are reachable where the example dropdown and the
  help button are hidden; answer pages in the gallery switch from it too. Built files show
  only the shortcuts there. Keyboard accessible (opens on the current example), right to left
  aware; string `app.more` in every language.

- Deep hierarchies in one frame: groups nest up to six levels within budget (eight at most).
  From four levels the layered layout places each group as a block in its parent, so boxes
  never overlap and edges cross borders cleanly; padding tightens below the third level, boxes
  widen to show their whole title and fold button, and tints and outlines get calmer with
  depth in both themes (`GROUP_TONES`).
- Fold to depth: keys `1`-`6` (`0` opens everything; `Shift` with several scenarios), a toolbar
  menu and `#depth=n` in the link; `--depth n` for `build`, `export` and `screenshot`, `depth`
  for the MCP tools, `depth=` in the Python SDK. A folded group's card counts the cards and
  boxes inside ("9 cards · 3 groups"); unfolding an outer box restores the inner folds.
- Zoom to a group: double-click its title (or `G` on a selected card) frames the box, opens the
  folds around it and shows the path of its ancestors (`#focus=`, `Esc` zooms out,
  `screenshot --focus`). Steps take `focusGroup` (Python `focus_group=`).
- Drill-down goes eight levels deep; long breadcrumbs keep the first, parent and current level
  and list the rest in a menu.
- Lint: `budget/deep-nesting`, `ref/step-unknown-group`, `layout/focus-group-ignored`,
  `geometry/group-outside-parent`, `geometry/group-title-overlap`, `content/group-title-cut`
  and `geometry/edge-through-group-title`; deep diagrams are also checked at every fold depth.
- Examples: `smart-city-operations` (six nested levels), `global-retail-group` (six-level
  drill-down with nested boxes inside levels) and `hospital-trust-monitoring` (both).
- New interface strings (`fold.*`, `depth.*`, `focus.*`, `drill.more`) in every built-in language.
- The dev viewer's example menu has three labelled sections: Diagrams, Answer pages (Q&A)
  and Charts & dashboards (labels in every interface language). Answer pages open in the
  viewer shell (theme toggle and `#example=<id>` work; live diagram embeds run the viewer);
  canvas-only controls are hidden while a page is shown. Built files are unchanged.
- Seven chart pages (`examples/chart-*.json`: sales, marketing analytics, budget against
  actual, customer survey, project portfolio, service levels, headcount) and five more answer
  pages (card payment journey, what happens when you type a URL, safe feature rollout, build
  or buy a CRM, Black Friday slowdown). Every answer page is in the example menu.
- `renderPage(page, { frameSandbox })` sets the sandbox of live diagram embeds (default
  unchanged).
- Answer page contents: the chip of the section being read is highlighted
  (`aria-current`), links scroll smoothly (instantly with reduced motion) and move focus to
  the section heading, and on long pages the row sticks to the top when it fits in a few
  lines. Markdown export (`export -f md`) starts with the same contents list, with matching
  anchors. `pageContents(page)` returns the anchors and links.

### Changed

- Charts fitted to a narrow container (inspector panels) are drawn shorter, and column value
  labels that would collide are left to the tooltips.
- A card's mini chart `target` (line, area, column, bar, bullet) is drawn as a target line on
  the full-size chart in the inspector's Details tab; a bullet becomes its value against that
  line (was a second "Target" bar). Mini bar charts draw their target too.
- Gantt plans in narrow containers (inspector panels, phones and the 320 / 420 / 560 px page
  drawings) put each task name on its own line above its bar, starting where the bar starts,
  instead of cutting names short in a label column; group headings, milestones, dependency
  arrows and the today line follow. A name that still does not fit ends in an ellipsis with
  the full name in its tooltip (and, as before, in the data table). Axis dates that would run
  off the right edge are left out.
- The toolbar on phones is tighter (smaller gaps and buttons); with a mode switch, the brand
  gives way so every button fits.
- Keyboard shortcuts open in a side panel (`?` or the help button) in the inspector's place:
  same dock, theming and slide-in, on the left in right-to-left languages, a bottom sheet on
  phones. Grouped (walkthrough, navigate, view, fold and depth, drill-down and focus, mouse and
  touch), it lists only what applies to the open diagram; opening it closes the inspector and
  back. Mode buttons show their key (`M`) in the tooltip. String key `help.hint` is replaced by
  `help.footer` and the panel's group and gesture keys, translated in every built-in language.
- Limits: `group/too-deep` above 8 levels (was 3), `drill/too-deep` above 8 levels below the
  overview (was 3), `budget/too-many-groups` above 24 groups (was 6). A layered diagram whose
  groups open folded counts its cards as they show at first (budget 14, and 48 in all).
- Importers keep up to six levels of nested groups (draw.io, PlantUML, Visio and Mermaid
  subgraphs) and merge deeper ones.
- Routes and edge labels keep clear of group fold buttons as well as titles.

- `examples/platform-overview.json` keeps its search level in `examples/levels/` as a `$ref`.
- Contents anchors keep non-Latin titles (Arabic, CJK, Devanagari…) instead of
  `section`, `section-2`…; Latin anchors are unchanged. `examples/answer-order-fulfilment-arabic.json`
  shows its contents.
- The contents row lines wrapped chips up after the "Contents" label (the label sits above
  them on phones); long titles end in an ellipsis with the full title as a tooltip.

### Fixed

- Contents links on answer pages opened in the viewer's gallery loaded the viewer inside the
  page frame (a srcdoc frame resolves `#anchor` against the viewer's URL); they now scroll
  within the page, and the URL hash is only written in built files.
- Answer pages no longer scroll sideways on wide screens: a chart's hidden data table is
  clipped inside a wrapper (a table ignored the 1 px width).
- Bar chart and gantt labels are shortened only when their measured width does not fit;
  labels such as "Understood my problem" were cut to a few characters.
- Field-row edges: two edges between the same pair of rows run on separate tracks, and a
  self-relationship on a row that another edge leaves from the same side nests inside it
  (both were `geometry/route-failed`). The Mermaid staff schema keeps every key row; the
  card-side fallback remains only for geometry that still cannot be routed.
- Answer pages on phones: charts, gantt plans and matrices no longer scroll sideways. Pages
  carry narrower drawings and the page script swaps in the one that fits (on load and on
  resize); without JavaScript, and in print, the static drawing stays.
- `yantra screenshot --width` below 500 px now renders at that width (headless Chrome lays
  out narrow windows at 500 px; the page is framed at the exact width).
- Answer pages: the light and dark copies of a diagram no longer share marker, gradient or
  title ids (dark copies could lose their arrowheads); every SVG id is scoped per figure and theme.
- The viewer bundle is rebuilt whenever its sources change (a content fingerprint in
  `dist/`, one build at a time across processes), never reused stale.
- Test reliability on Windows: MCP servers are stopped and awaited before their folders are
  removed (with retries), timing checks compare against a baseline.

### Changed

- Built HTML carries English plus only the languages its payload uses (answer pages: those
  of their interactive diagrams); every interface table moved to `src/core/locales/`. An
  English diagram is about 389 kB instead of 469 kB, and adding languages no longer grows it.
- Title, edge-label and headline budgets measure display width: a full-width (CJK)
  character counts 2 and a combining mark 0, so 42 means about 21 Chinese characters.

### Added

- Several foreign keys referencing one key row leave its port on one shared trunk, then
  branch from a single spine.
- Import, gantt working days: Mermaid `excludes weekends` and excluded dates, PlantUML
  `saturday are closed` / `sunday are closed` and closed dates or date ranges become
  `workdays: true` and `holidays`; Mermaid `until <task>` ends a task the day before that one
  starts. Weekdays other than the weekend still warn.
- Import, Visio: fill (else line) colours become role colours, as for draw.io.
- Import, Mermaid state diagrams: a concurrent region takes its title from a note on one of
  its states, or from the one composite state it holds.
- Charts fit narrow containers: inspector panels draw them at the panel's measured width
  (no sideways scrolling). Legend items toggle a series or a pie / donut slice (the rest is
  redrawn with new shares and total) in the viewer and on pages; without JavaScript the
  static chart is unchanged.
- Gantt `workdays: true` (with optional `holidays`): durations, numeric starts and
  dependencies count working days, and weekends and holidays are shaded.
- `meta.views` (`["flow"]`, `["sequence"]`) chooses which views the reader can switch
  between; diagrams made only of table / class cards (ERDs, class diagrams) no longer offer
  the sequence view. New warning `sequence/not-offered`.
- Drill-down `$ref` levels load in the dev server's gallery (a Vite plugin, confined to the
  project) and in the Python SDK for a page diagram's `src` (`yantra.resolve_levels`,
  confined to `base_dir`). Mode-specific `data.modes.<id>.drill` is validated (new warning
  `drill/unknown-mode`), followed by the level order and listed in the Markdown export;
  `Node.drill(id, mode=...)` and `Diagram.views(...)` in the Python SDK.
- Optional browser tests (`tests/browser.test.js`): drill-down, fold, RTL, watermark and
  chart legends in headless Chrome / Edge over the DevTools pipe; skipped without a browser.
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
- `yantra import --from mermaid|drawio|plantuml|visio` with detection by extension or content,
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
- Import, Mermaid: `gantt`, `pie`, `timeline` and `quadrantChart` become answer pages (gantt,
  pie chart, timeline and 2x2 matrix blocks with a computed headline); `journey` becomes a flow
  with scores, actors, sections and a step per section. Class diagrams: multiplicities as end
  labels (`sourceLabel` / `targetLabel`), one-line `class A { ... }` blocks, lollipop
  interfaces (`A ()-- B`) as realizations, self-relationships as loops. ER diagrams: one-line
  entity blocks, self-relationships as loops, key-row attachment (`sourceField` /
  `targetField`) when a foreign key is named after the other entity. State diagrams:
  `<<fork>>` / `<<join>>` as fork bars and `--` concurrent regions as region groups.
- Import, PlantUML: `<->` / `<-->` two-way messages, object diagrams (`object`, `map`) as
  table cards, `entity` ER diagrams with crow's foot ends, `@startgantt` as a plan page, the
  old activity syntax (`(*) --> "Action"`), activity `fork` / `end fork` as fork and join bars,
  and a safe preprocessor subset: `!include` inside the input root (no URLs, cycle-safe, 8
  levels deep), `!define` and `!$var` substitution.
- Import, draw.io and Visio: fill colours become role colours, cloud and image icons become
  node icons, thin black bars become fork bars, edges to table rows keep their field, PNG
  exports with the embedded diagram are read; Visio `.vsdx` files (shapes, glued connectors,
  groups, pages) are read without new dependencies. `--from visio`; `.vsdx` and `.png` in the
  `yantra_import` MCP tool.
- Release tooling: npm `files` whitelist with a prebuilt viewer (`prepack`), Python
  packaging metadata, a tag-triggered release workflow, contribution and security guides,
  issue and pull request templates.

### Changed

- The npm package is named `@niyankhadka/yantra` (the unscoped `yantra` name on npm belongs to another
  project) and is published publicly; the command is still `yantra`. Vite is now a development dependency.
- The Python SDK can also run the CLI through `npx` when no local CLI is found.

### Added

- Automatic layered layout (cycle breaking, crossing reduction, aligned ports) and
  orthogonal edge routing with label placement; no coordinates needed.
- Validator with stable codes for schema, references, story consistency, budgets and the
  rendered geometry (overlaps, edges through cards, label collisions) in every mode and view.
- Walkthroughs: scenarios and steps that focus nodes and animate the active path, with
  autoplay, camera follow and a full-screen present mode.
- Groups: labelled boundaries (VPC, team, phase) drawn behind their cards, nested up to eight levels.
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

[Unreleased]: https://github.com/niyankhadka/yantra/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/niyankhadka/yantra/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/niyankhadka/yantra/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/niyankhadka/yantra/releases/tag/v1.0.0
