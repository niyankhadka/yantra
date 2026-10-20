# Yantra - agent guide

Yantra turns a JSON description of a system or process into an interactive, step-by-step
diagram, or a question into a one-page answer, in a single offline HTML file. Layout, edge
routing and label placement are automatic; a validator checks the rendered geometry.

## Making a diagram or page

Follow `.claude/skills/yantra/SKILL.md` (same file in `.agents/skills/yantra/`). In short:

```bash
node bin/yantra.js new diagram.json          # starter payload (--page for an answer page)
node bin/yantra.js import sketch.mmd         # or start from Mermaid, draw.io (.drawio, .png), Visio (.vsdx) or PlantUML (.puml)
node bin/yantra.js validate diagram.json     # schema, references, story, geometry
node bin/yantra.js build diagram.json        # -> diagram.html
node bin/yantra.js screenshot diagram.json   # -> diagram-light.png, then look at it
```

Rules and validation codes: `docs/authoring.md` (diagrams: groups, sequence view, inspector
panels), `docs/pages.md` (one-page answers, `"kind": "page"`), `docs/mermaid.md` (Mermaid
import) and `docs/import.md` (draw.io and PlantUML import).
Schemas: `schemas/yantra-payload.schema.json`, `schemas/yantra-page.schema.json`.
MCP server: `node mcp/server.js` (registered in `.mcp.json` and `.agents/mcp_config.json`).
Python SDK: `pip install -e python/` (see `python/README.md`).

## Working on Yantra itself

- `src/core/` - pure ES modules shared by browser, CLI and MCP: model, layout, routing,
  scene, sequence view (`sequence.js`), lint, SVG and Markdown export, answer pages
  (`page.js`), importers (`mermaid.js`, `drawio.js` + `inflate.js`, `visio.js`, `plantuml.js`, chart pages in `importcharts.js`, shared
  assembly in `importkit.js`, dispatch in `import.js`), theme tokens. No DOM access here.
- `src/app/` + `src/styles/` - the browser viewer. Card metrics in `src/styles/diagram.css`
  must match `CARD` in `src/core/layout.js`.
- `lib/` - Node-only: standalone HTML builder (both kinds; answer pages share one viewer
  shell across interactive embeds; logos from `src/assets/`) and headless screenshots.
- `bin/yantra.js` - CLI. `mcp/server.js` - MCP server. `python/` - Python SDK.
- `npm test` must pass; every file in `examples/` must validate with zero warnings. CI:
  `.github/workflows/ci.yml` (Node 18/20/22, Windows, Python 3.9/3.12).
- After editing the skill, copy `.claude/skills/yantra/SKILL.md` to `.agents/skills/yantra/SKILL.md`
  (a test checks they match).
- Contributing, releases and security: `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`,
  `.github/workflows/release.yml` (runs on `v*` tags only).
