# Architecture

```
payload.json ──► src/core ─────────────────────────────► scene ──► browser renderer (src/app)
                 normalize → measure → autoLayout              ├─► renderSvg  (CLI export, PNG)
                 → routeEdges → placeLabels → computeScene     └─► lint       (validator)
```

Everything that decides geometry lives in `src/core/` and has no DOM dependency, so the
browser, the CLI, the MCP server and the tests all compute the **same** scene. What the
validator checks is exactly what the viewer draws.

## Core modules

| Module | Responsibility |
|---|---|
| `model.js` | Defaults (single mode, single scenario), role → colour resolution, mode visibility and per-mode data overrides. |
| `text.js` | Width estimation and word wrapping without a DOM, HTML/XML escaping. |
| `layout.js` | Card sizing (`CARD` metrics) and the layered layout: DFS cycle breaking, longest-path ranking, dummy nodes for long edges, barycentre crossing reduction, cross-axis placement by weighted isotonic regression, rank gaps sized for labels, corridors for return edges. Positions snap to the 10px grid; card sizes are multiples of 20 so aligned centres stay aligned. |
| `route.js` | Port assignment (isotonic fit so facing ports line up), A* over a sparse orthogonal grid with node obstacles, a soft halo, and penalties for bends, shared or adjacent tracks and crossings; jog removal and centring; rounded elbows; label placement on the route. |
| `scene.js` | `computeScene(payload, { modeId, overrides, layoutCache })`: the single entry point. |
| `sequence.js` | `computeSequenceScene(payload, { modeId, scenarioIndex })`: the sequence view (participants by first appearance, one message per step `highlightEdges` id, numbered rows, group boxes over adjacent columns; gaps widen to fit labels). `sceneForView` picks flow or sequence. |
| `lint.js` | Structural, reference, story, budget and geometry checks with stable codes. |
| `svg.js` / `markdown.js` | Static exports. SVG is plain SVG (no `foreignObject`), so it rasterises to PNG cleanly. `renderSequenceSvg` draws the sequence view. |
| `drill.js` | Drill-down levels: `collectDiagrams` (the flat `diagrams` namespace), `levelPath` (repairs deep links), `levelOrder` (Markdown, all levels), `replaceLevel`; `safeUrl` for node/edge/step links. File `$ref`s are loaded by `resolveLevels` in `lib/build.js` (confined to the input root) before lint and build. |
| `page.js` | Answer pages: block renderers (shared with inspector panels), `renderPage`, page lint, Markdown export. Diagram blocks render a static SVG figure; `interactive: true` asks the builder for a live viewer. |
| `mermaid.js` | `fromMermaid(text, { title })`: flowchart and sequence-diagram importer (nodes, edges, subgraphs to groups, a generated walkthrough) with warnings for anything skipped. |
| `theme.js` / `icons.js` | Design tokens for both themes and the icon set; the app injects the tokens as CSS variables. |

## Viewer

- `src/app/engine.js`: state (scenario, step, mode, selection, autoplay, dragged positions
  persisted in `localStorage`), caches the auto layout per mode.
- `src/app/renderer.js`: HTML cards over one SVG edge layer, opaque label pills, packets
  that follow the active edges (skipped under `prefers-reduced-motion`).
- `src/app/interact.js`: pointer pan, wheel/pinch zoom, drag with live re-routing, fit-to-view
  that subtracts the toolbar, walkthrough, legend and inspector.
- `src/app/main.js`: UI wiring, keyboard shortcuts, URL-hash state (step, mode, view,
  scenario, role, inspector tab, theme), print handling (light theme, chrome hidden), exports.
  The inspector shows Summary / Step / Details tabs and custom `panels`; `meta.inspector.onNodeClick`
  picks what a card click opens. Closed panels are `inert` / `hidden`, so they are neither
  visible nor focusable.
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

`lib/build.js` runs `vite build` when `dist/` is missing or older than the sources, inlines
the single JS and CSS file, escapes `</script` inside the code, and writes the payload into
`<script type="application/json" id="yantra-payload">` (with `<` escaped). No fonts or other
requests are made at runtime; the system font stack is used.

Answer pages (`buildPage`) render through `src/core/page.js`, then:

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
