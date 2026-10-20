# Yantra rules

1. Diagrams follow `schemas/yantra-payload.schema.json` and `docs/authoring.md`; answer pages (`"kind": "page"`) follow `schemas/yantra-page.schema.json` and `docs/pages.md`, headline first.
2. Never write node coordinates unless `meta.layout.mode` is `"manual"`; layout and routing are automatic.
3. Every diagram tells a story: a scenario with an overview step plus focused steps whose highlighted edges have both endpoints highlighted. Use `meta.view: "sequence"` for protocols and call orders, and 2-5 `groups` only for boundaries that matter.
4. Start from Mermaid with `node bin/yantra.js import <file.mmd>` and review the warnings.
5. At most 2 `interactive: true` diagrams per page.
6. Run `node bin/yantra.js validate <file>` and fix all errors before `node bin/yantra.js build <file>`.
7. View a screenshot (`node bin/yantra.js screenshot <file>`, also `--theme dark`) before saying it looks right.
8. Core changes go in `src/core/` (shared by browser, CLI and MCP); run `npm test` after any change and keep both skill copies identical.
