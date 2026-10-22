# Architecture

How Yantra turns a JSON payload into a diagram: the shared geometry core, the viewer, the
standalone build and the tests, and where each part lives.

```
payload.json ──► src/core ─────────────────────────────► scene ──► browser renderer (src/app)
                 normalize → measure → autoLayout              ├─► renderSvg  (CLI export, PNG)
                 → routeEdges → placeLabels → computeScene     └─► lint       (validator)
```

`src/core/` has no DOM dependency, so the browser, the CLI, the MCP server and the tests all
compute the **same** scene. What the validator checks is exactly what the viewer draws.

## Core modules

| Module | Responsibility |
|---|---|
| `model.js` | Defaults (single mode, single scenario), role → colour resolution, mode visibility and per-mode data overrides. |
| `text.js` | Width estimation per script (full-width CJK, Devanagari, Arabic, zero-width marks) and word wrapping without a DOM (CJK breaks between characters, with kinsoku), HTML/XML escaping. |
| `entity.js` | Entity / class cards: field and method rows (`ROWS` metrics, the "+ N more" cap), measured so the card height is known before layout. |
| `notation.js` | Edge end markers: ER cardinality (crow's foot), UML heads, `relation` defaults; marker SVG shared by the viewer and the export. |
| `layout.js` | Card sizing (`CARD` metrics) and the layered layout: DFS cycle breaking, longest-path ranking, dummy nodes for long edges, barycentre crossing reduction, cross-axis placement by weighted isotonic regression, rank gaps sized for labels, corridors for return edges. Positions snap to the 10px grid; card sizes are multiples of 20 so aligned centres stay aligned. Groups nested four or more deep (or that one pass cannot keep apart) are laid out as blocks: each group on its own, boxed with its depth's padding (`groupPad`) and wide enough for its title, then placed as one card in its parent. |
| `nesting.js` | Deep hierarchies: fold levels of a diagram, ids for "fold to depth n" (`foldsForDepth`, `depthOfFolds`), a group's ancestor trail and the folds that hide it, breadcrumb truncation (`crumbWindow`). Used by the viewer, CLI, MCP and lint. |
| `tree.js` | Hierarchical layouts and folding: the spanning forest of a graph (`treeIndex`), the tidy tree (contour packing, parents centred over children, comb connectors), the mind map (balanced halves, curved connectors, branch hues), and `collapseGraph`, which hides folded subtrees or turns folded groups into summary cards with id aliases for steps. |
| `route.js` | Port assignment (isotonic fit so facing ports line up), A* over a sparse orthogonal grid with node obstacles, a soft halo, and penalties for bends, shared or adjacent tracks and crossings; jog removal and centring; rounded elbows; label placement on the route. Self-loops are fixed loops on a free side; ends at dots and diamonds are clipped to the outline. |
| `scene.js` | `computeScene(payload, { modeId, overrides, layoutCache, collapsed })`: the single entry point. Picks the layered, tree or mind-map layout from `meta.layout.algorithm`; hierarchy edges of trees and mind maps are drawn directly (comb or curve), the rest go through the router. |
| `sequence.js` | `computeSequenceScene(payload, { modeId, scenarioIndex })`: the sequence view (participants by first appearance, one message per step `highlightEdges` id, numbered rows, group boxes over adjacent columns; gaps widen to fit labels). `sceneForView` picks flow or sequence. |
| `lint.js` | Structural, reference, story, budget and geometry checks with stable codes; nested boxes are checked as the diagram opens, fully unfolded and at every fold depth. |
| `svg.js` / `markdown.js` | Static exports. SVG is plain SVG (no `foreignObject`), so it rasterises to PNG cleanly. `renderSequenceSvg` draws the sequence view. |
| `drill.js` | Drill-down levels: `collectDiagrams` (the flat `diagrams` namespace), `levelPath` (repairs deep links), `levelOrder` (Markdown, all levels), `replaceLevel`; `safeUrl` for node/edge/step links. `drillTargets` / `modeDrills` (mode-specific `data.modes.<id>.drill`). File `$ref`s are loaded by `resolveLevels` in `lib/build.js` (confined to the input root) before lint and build, and by the `yantra-drill-refs` plugin in `vite.config.js` for the dev server's gallery. |
| `page.js` | Answer pages: block renderers (shared with inspector panels), `pageParts` and `pageDocument` (shared with books), `renderPage`, Markdown export. Diagram blocks render a static SVG figure; `interactive: true` asks the builder for a live viewer. Sections nest one level (`walkBlocks`). |
| `book.js` | Books: `renderBook` (a cover, then each chapter through `pageParts` with `c<n>-` prefixed ids), `bookToMarkdown`, `bookContents`, `chapterPage` (language inheritance). Chapter `$ref`s are loaded by `resolveBook` in `lib/build.js`; book lint is `lintBook` in `lint.js`. |
| `reader.js` | Reading modes for pages and books: the header controls and bottom bar, and `readerRuntime`, inlined as source into built pages. It splits a page into units (lead, blocks, section headings), groups units in one grid row, and pages them by measuring in the browser. |
| `starters.js` | The smallest valid payload of each kind, for `yantra new` and the playground. |
| `mermaid.js` | `fromMermaid(text, { title })`: flowchart, sequence, state, ER and class diagram importer (nodes, edges, subgraphs / namespaces / composite states to groups, state shapes, fields and methods, relationship markers, a generated walkthrough) with warnings for anything skipped. |
| `i18n.js` | Interface strings: the English table plus `locales/<lang>.js` for 17 more (`STRINGS`, `STRING_KEYS`, `LANGUAGES`), `localeOf(meta)` -> `{ lang, dir, t, tHtml, num, plural }` with `meta.strings` overrides and English fallback, `Intl.PluralRules`, RTL detection, `Intl.NumberFormat`. Used by the viewer, pages, SVG and Markdown exports and lint. The viewer bundle is built without `locales/` (a plugin in `vite.config.js`); `lib/build.js` embeds the tables a payload needs as `<script id="yantra-strings">` and `registerStrings()` loads them, while the gallery chunk registers them all. |
| `lintmessages.js` | Translated validation messages for `validate --lang` and MCP `lang`: English templates (`LINT_EN`) are matched against lint messages and refilled from each locale's `LINT` table. Node only. |
| `drawio.js` / `inflate.js` | `fromDrawio(text, { title, page })`: draw.io / diagrams.net importer (small XML reader, compressed pages inflated in JS, shapes to types, containers to groups). See `docs/import.md`. |
| `plantuml.js` | `fromPlantUml(text, { title })`: PlantUML sequence, component / use-case, activity and state importer. |
| `importkit.js` / `import.js` | Shared payload assembly for the importers; `importText` detects the format and dispatches (used by the CLI and MCP). |
| `theme.js` / `icons.js` | Design tokens for both themes (including the group tints per nesting depth, `GROUP_TONES`) and the icon set; the app injects the tokens as CSS variables. |

## Viewer

- `src/app/engine.js`: state (scenario, step, mode, selection, autoplay, dragged positions
  persisted in `localStorage`), caches the auto layout per mode.
- `src/app/renderer.js`: HTML cards over one SVG edge layer, opaque label pills, packets
  that follow the active edges (skipped under `prefers-reduced-motion`), and fold buttons in
  their own layer (cards stay single focusable controls).
- `src/app/interact.js`: pointer pan, wheel/pinch zoom, drag with live re-routing, fit-to-view
  that subtracts the toolbar, walkthrough, legend and inspector.
- `src/app/main.js`: UI wiring, keyboard shortcuts, URL-hash state (step, mode, view,
  scenario, role, inspector tab, theme, folded ids), print handling (light theme, chrome hidden), exports.
  The inspector shows Summary / Step / Details tabs and custom `panels`; `meta.inspector.onNodeClick`
  picks what a card click opens. Closed panels are `inert` / `hidden`, so they are neither
  visible nor focusable. The keyboard shortcuts panel (`?`) is a sibling aside in the inspector's
  dock that replaces it while open; its rows come from `src/app/shortcuts.js` (a pure table, each
  row with a condition so keys that do not apply to the open diagram are left out).
- Group focus and fold to depth (`main.js`): double-click a group title or press `G` to zoom to a
  group (its ancestors' path under the toolbar, `focus=` hash key, `Esc` zooms out); keys `0`-`6`
  and the toolbar menu fold to a depth (`depth=` hash key); `step.focusGroup` does the same per step.
- `src/app/levels.js`: drill-down navigation (the level stack, breadcrumb, `level=` hash key,
  state restored on the way back up) and the feature's UI strings (`DRILL_TEXT`). Changing level
  reloads the engine with that level's payload and adds a history entry (not inside embeds),
  so the browser's Back button returns.
- `src/app/examples.js`: the built-in gallery, loaded with a dynamic `import()` only when no
  payload is embedded (the dev server). `vite build` puts it in its own chunk, which built
  files never include.

Card text is wrapped by the core (not the browser), so the HTML card, the SVG export and the
validator agree on every card's height.

## Standalone build

`lib/build.js` runs `vite build` when `dist/` is missing or was built from other sources (a
content fingerprint in `dist/.yantra-sources`, written after every build; one build at a time
across processes via a lock folder), inlines
the single JS and CSS file, escapes `</script` inside the code, and writes the payload into
`<script type="application/json" id="yantra-payload">` (with `<` escaped). No fonts or other
requests are made at runtime; the system font stack is used.

Answer pages (`buildPage`) and books (`buildBook`) render through `src/core/page.js` (books
through `book.js`), then:

- **Interactive diagrams share one viewer.** The page carries the viewer shell once, as JSON
  text in `<script type="application/json" id="yantra-viewer-shell">`, and each diagram's
  payload in its own `yantra-embed-<n>` script. A small script splices each payload into the
  shell and sets the sandboxed iframe's `srcdoc` at load, passing the page theme so the
  viewer paints in the right theme. Without JavaScript a `<noscript>` style shows the static
  figures instead; print always uses them. The host keeps the frames in sync with the page
  theme by `postMessage`.
- **Large `data:` URIs (logos) are kept once.** The first `<img>` copy stays inline; the
  favicon and other copies are filled from it by script.

For `examples/answer-how-to-choose-database.json` this took the file from 677 kB to 411 kB;
each further interactive diagram adds only its own JSON.

## Tests

`npm test` runs `node --test tests/`: every example must validate with zero warnings,
dense LR/TB stress graphs must produce no geometry errors, plus groups, sequence view,
Mermaid import, answer pages, WCAG contrast of the theme tokens (`contrast.test.js`), the
viewer build (`viewer-build.test.js`: shared embed shell, logo de-duplication, closed
inspector) and CLI / MCP checks. CI (`.github/workflows/ci.yml`) runs the suite on Node
18/20/22 (Linux) and 22 (Windows), validates and builds every example, and runs the Python
SDK tests (`python -m unittest discover -s python/tests`).
