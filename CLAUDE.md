# Yantra - Claude Code guide

See `AGENTS.md` for the layout of the repo. The diagram-authoring workflow is the `yantra`
skill in `.claude/skills/yantra/`; the MCP server is registered in `.mcp.json`.

## Commands
- Dev viewer: `npm run dev` (http://localhost:3000; `#example=<name>&step=<n>&view=sequence&theme=dark`)
- Tests: `npm test` (Python SDK: `pip install -e python/` then `python -m unittest discover -s python/tests`)
- Validate: `node bin/yantra.js validate <file.json>`
- Build single-file HTML: `node bin/yantra.js build <file.json> [-o out.html]`
- Screenshot for review: `node bin/yantra.js screenshot <file.json> [--step n] [--theme dark] [--view sequence]`
- Import Mermaid / draw.io / PlantUML: `node bin/yantra.js import <file.mmd|file.md|file.drawio|file.puml> [-o out.json] [--from ...] [--page n]` (`docs/import.md`)
- MCP server: `node mcp/server.js` (Streamable HTTP: `--http [--port 8787]`, `docs/remote-mcp.md`)
- Website (landing, docs, playground at /playground/): `npm run dev:site` / `npm run build:site` (-> dist-pages/; sources in `site/`); chat packs: `npm run pack:skill`, `npm run pack:gpt`

## Rules
- Answer pages (`"kind": "page"`) follow `schemas/yantra-page.schema.json` and `docs/pages.md`:
  the answer headline comes first; at most 2 `interactive: true` diagrams per page.
- Payloads follow `schemas/yantra-payload.schema.json` and `docs/authoring.md`. Do not write
  node coordinates; layout is automatic unless `meta.layout.mode` is `"manual"`.
- Step `highlightNodes` / `highlightEdges` must reference real ids; highlighted edges need
  both endpoints highlighted. Protocols and call orders: `meta.view: "sequence"`.
- Validate before building, and view a screenshot before calling a diagram finished.
- Geometry logic lives only in `src/core/`; the browser, CLI and MCP all call it.
- Brand logos live in `src/assets/logo-light.svg` (light theme) and `logo-dark.svg` (dark theme).
- Keep `.claude/skills/yantra/SKILL.md` and `.agents/skills/yantra/SKILL.md` identical.
