---
name: yantra
description: Create interactive, step-by-step diagrams (architecture, request flows, pipelines, business or clinical processes) and one-page answers (explainers, comparisons, decision records) as single offline HTML files with automatic layout, routed edges, summary cards and a validator. Use when the user wants to visualise how a system or process works, explain a flow step by step, turn a description, codebase or Mermaid sketch into a shareable diagram, or asks a question whose answer should be a page to read, print or share.
---

# Yantra

Every output is a single offline HTML file. Pick one:

| The user wants… | Make | Guide |
|---|---|---|
| to see how parts connect or how a flow runs | **diagram** | `docs/authoring.md`, `schemas/yantra-payload.schema.json` |
| who calls whom, in order (protocol, API call, handshake) | **diagram** with `meta.view: "sequence"` | `docs/authoring.md` (Sequence view) |
| an answer, explanation, comparison or decision on one page | **answer page** (`"kind": "page"`) | `docs/pages.md`, `schemas/yantra-page.schema.json` |
| their Mermaid flowchart / sequence diagram as Yantra | `node bin/yantra.js import sketch.mmd` then review | `docs/mermaid.md` |

For "explain how X works", make the diagram first, then the page around it
(`{ "type": "diagram", "src": "flow.json" }`). References: `examples/*.json`
(`answer-*.json` are pages; `oauth-login.json` is a sequence; `aws-serverless.json` has groups).

## Diagram

1. **Plan the story**: the question it answers and 3-6 walkthrough steps. More than ~12
   nodes → an overview diagram plus detail diagrams.
2. **Write the payload** (`meta`, `roles`, `nodes`, `edges`, `scenarios`) in one pass.
   - Do **not** write `x`/`y`. Point edges along the main flow; layout and routing are automatic.
   - Group node `type`s into 3-5 `roles` with one colour each; specific label in `data.badge`.
   - Cards show `title`, `subtitle`, `tech`; details go in `description`, `metadata`, `sourceFile`.
   - Edge labels: 1-3 words naming what flows.
   - Boundaries that matter to the explanation (VPC, trust zone, team, phase) → `groups`:
     2-5 of them, each node in its innermost group only.
   - Steps: an overview first, then focused steps listing the nodes **and** edges involved.
     In the sequence view each step's `highlightEdges` become its arrows, in order.
   - Inspector tabs come from content, so include only what was asked for: `meta.summary`
     → **Summary**; step `payload`s → **Step**; node `description`/`metadata`/`tech` →
     **Details**; anything else (risks, costs, glossary) → a `panels` entry built from page
     blocks. Set `meta.inspector.onNodeClick` (a panel id, or `"stay"`) only when needed.
   - For code-backed diagrams, read the code first and cite it in `data.sourceFile`.

## Answer page

1. Write `answer.headline` first: the conclusion in 1-2 sentences. Then `answer.text` and
   3-5 `answer.points`.
2. Add 3-8 blocks chosen by content: `points`, `steps`, `metrics`, `chart`, `compare`,
   `table`, `timeline`, `faq`, `checklist`, `quote`, `image`, `kv`, `callout`, `text`,
   `code`, `sources`, `diagram`, `gantt`, `matrix`. See the table in `docs/pages.md`.
   Numbers: `chart` with `kind` bar (default), column, line, area (trends; dates allowed),
   pie or donut (parts of a whole, ≤ 8 slices); several series via `categories` + `series`
   (≤ 6, `stacked: true` to stack); `trend: [..]` on a metric adds a sparkline. Plans:
   `gantt` (tasks with `start`/`days`/`after`, `milestone`, `group`, `today`). Priorities
   and risks: `matrix` (2x2 with `quadrants`, or `grid: 5` heat map).
3. Diagrams are static figures; `interactive: true` embeds the live viewer - at most 2 per page.
4. Do not state uncertain facts as certain: flag them in a `callout`, cite `sources`.

## Then, for every output

1. **Validate**: `node bin/yantra.js validate file.json`. Fix errors in this order:
   `schema/*` → `ref/*` → `page/*` → `layout/*` → `geometry/*`, then warnings. At most two
   repair rounds; if geometry still fails, remove nodes or split the diagram.
2. **Build**: `node bin/yantra.js build file.json -o file.html`
3. **Look**: `node bin/yantra.js screenshot file.json` (diagrams: `--step 2`, sequence:
   `--view sequence`; pages: `--height 3200` if long; also `--theme dark`) and view the PNG.
   Do not say it looks right without viewing it.
4. **Report** the HTML path and, in chat, the answer headline or the walkthrough steps,
   plus any warnings you chose to keep. `export -f md` gives a Markdown copy to paste.

With the MCP server connected the same actions are tools: `yantra_get_schema` (pass
`kind: "page"` for pages), `yantra_get_example`, `yantra_import_mermaid`, `yantra_validate`,
`yantra_build`, `yantra_export`, `yantra_screenshot`.

## Other outputs

- Static SVG: `node bin/yantra.js export diagram.json -f svg [--theme dark] [--view sequence]`
- Markdown: `node bin/yantra.js export file.json -f md`
- `meta.watermark: false` hides the "Made with Yantra" badge; a string replaces its text.
- Exact hand layout (rare): `meta.layout.mode: "manual"` plus `x`/`y` on the 10px grid.
