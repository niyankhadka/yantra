# Answer pages

An answer page explains one question on one printable page: **the answer first**, then the
evidence. Use it when someone asks *why*, *how*, *which* or *what*, or wants a summary,
comparison, decision record or explainer they can share. Use a diagram (see
`authoring.md`) when the main thing to show is how parts connect; embed one in a page when
both matter.

Schema: `schemas/yantra-page.schema.json`. Examples: `examples/answer-checkout-saga.json`
(architecture decision), `examples/answer-incident-review.json` (incident review: timeline,
checklist, facts, FAQ) and `examples/answer-how-to-choose-database.json` (decision with an
interactive diagram).

Pages suit any purpose: explainers, decisions, comparisons, how-tos, incident reports,
study notes, product specs and process docs. Set `meta.kicker` to say which.

```bash
node bin/yantra.js new answer.json --page    # starter
node bin/yantra.js validate answer.json
node bin/yantra.js build answer.json          # -> answer.html (offline, prints to A4)
node bin/yantra.js screenshot answer.json     # -> answer-light.png, then look at it
node bin/yantra.js export answer.json -f md   # Markdown copy for chat, tickets or docs
```

## Shape

```json
{
  "kind": "page",
  "meta": { "question": "…?", "title": "Short title", "kicker": "Explainer", "author": "…", "date": "20/10/2026" },
  "answer": { "headline": "The conclusion in 1-2 sentences.", "text": "Short context.", "points": ["…", "…", "…"] },
  "blocks": [ { "type": "points", "title": "…", "items": [ … ] } ]
}
```

## Writing the answer

1. **Headline** (required, under 220 characters): the conclusion itself, not a teaser.
   "Use a saga, because…" beats "There are several considerations…".
2. **Text**: one short paragraph of context. **Points**: 3-5 supporting facts.
3. Then 3-8 blocks, ordered by what the reader needs next. A page should be readable in
   two minutes; the validator warns above 12 blocks.

## Choosing blocks

| The content is… | Block | Fields |
|---|---|---|
| A few parallel ideas, reasons, risks | `points` | `items: [{ title, text?, tone? }]` |
| A sequence or procedure | `steps` | `items: [{ title, text? }]` |
| Numbers that matter | `metrics` | `items: [{ label, value, note?, tone? }]` |
| A ranking or breakdown | `chart` | `data: [{ label, value, tone? }]`, `unit?` (horizontal bars) |
| Options to choose between | `compare` | `options: [{ name, summary?, pros?, cons?, verdict?, recommended? }]` |
| Structured facts across items | `table` | `columns: [...]`, `rows: [[...]]` (one cell per column) |
| How parts connect | `diagram` | `src: "file.json"` or `diagram: {…}`, `step?`, `mode?`, `caption?` |
| A warning, tip or key caveat | `callout` | `body`, `label?`, `tone: info \| good \| warn \| bad` |
| Prose that does not fit above | `text` | `body` |
| A command, config or snippet | `code` | `code`, `language?` |
| Where the facts come from | `sources` | `items: [{ title, url?, note? }]` |
| Events in order (history, incident, roadmap) | `timeline` | `items: [{ date, title, text?, tone? }]`; dates shown as written (`14/10/2026`, `14/10 14:02`) |
| Questions readers will ask | `faq` | `items: [{ q, a }]`: collapsible on screen, all open when printed |
| Actions, requirements, a to-do or readiness list | `checklist` | `items: [{ text, done?, note? }]` (static ticks) |
| A line worth remembering | `quote` | `text`, `by?`, `source?` |
| A screenshot, photo or chart image | `image` | `src` (`https:` URL or `data:image/…` URI), `alt` (required), `caption?`, `width?` |
| Short facts about one thing (owner, status, version) | `kv` | `items: [{ k, v }]` |

- `span: "half"` places two consecutive blocks side by side on wide screens (pair a
  `steps` with a `callout`, or two `points`).
- `tone` colours: `info` blue, `good` green, `warn` amber, `bad` rose, `neutral` slate.
- Text fields accept light markdown: paragraphs, `- ` and `1. ` lists, `**bold**`,
  `*italic*`, `` `code` ``, `[link](https://…)`. HTML is escaped.
- An embedded diagram is validated like any diagram (geometry included) and drawn as a
  static figure in both themes; `step` highlights that walkthrough step.
- `interactive: true` on a diagram embeds the full viewer (step-through, inspector) in a
  sandboxed frame, `height` pixels tall (default 560); the static figure is still what
  prints (and shows without JavaScript). All embeds on a page share one copy of the viewer
  (about 270 kB), filled in at load; each embed then adds only its diagram. Still use at most
  two per page: every live viewer costs memory and attention.
- Contents: a row of links to every titled block appears when `meta.toc` is `true`, or by
  itself from 6 titled blocks (`meta.toc: false` hides it). Anchors are the slug of the
  block title (`#follow-up-actions`), with `-2`, `-3` for repeats, so links stay stable.
- `meta.updated` adds "Updated …" to the byline next to `meta.date`.

## Rules

- Answer the question that was asked. If you are unsure of a fact, say so in a `callout`
  rather than presenting it as certain, and cite `sources` when you have them.
- Prefer a `compare` with a `recommended` option over a vague "it depends".
- Numbers need units and context (`note`).
- `meta.watermark: false` removes the "Made with Yantra" badge; a string replaces its text.

## Validation codes

| Code | Fix |
|---|---|
| `page/missing-answer` | Add `answer.headline`. |
| `page/unknown-block` | Use one of the block types above. |
| `page/block-invalid` | Supply the fields listed in the message. |
| `page/diagram-unresolved` | `src` must be a relative `.json` path inside the page's own folder (no `..`, no absolute paths); fix the path or inline the diagram. |
| `page/image-src` | Use an `https:` URL or a `data:image/…` URI. |
| `page/image-alt` | Describe the image in `alt`. |
| `page/heavy-embed` (warning) | More than 2 `interactive` diagrams; make the rest static. |
| `page/bad-height`, `page/bad-toc` (warnings) | `height` is a number ≥ 240; `meta.toc` is `true` or `false`. |
| `page/headline-too-long`, `page/too-many-blocks` | Cut. |
| diagram codes (`geometry/*`, `ref/*`, …) | Fix the embedded diagram; see `authoring.md`. |
