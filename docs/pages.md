# Answer pages

An answer page explains one question on one printable page: **the answer first**, then the
evidence. Use it when someone asks *why*, *how*, *which* or *what*, or wants a summary,
comparison, decision record or explainer they can share. Use a diagram (see
`authoring.md`) when the main thing to show is how parts connect; embed one in a page when
both matter.

Schema: `schemas/yantra-page.schema.json`. Examples: `examples/answer-checkout-saga.json`
(architecture decision), `examples/answer-incident-review.json` (incident review: timeline,
checklist, facts, FAQ), `examples/answer-how-to-choose-database.json` (decision with an
interactive diagram), `examples/answer-quarterly-review.json` (charts and sparklines) and
`examples/answer-launch-plan.json` (gantt plan, 2x2 matrix, risk heat map).

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
| Numbers that matter | `metrics` | `items: [{ label, value, note?, tone?, trend? }]` (`trend: [numbers]` adds a sparkline) |
| A ranking or breakdown | `chart` | `data: [{ label, value, tone? }]`, `unit?`, `prefix?` (horizontal bars; see [Charts](#charts)) |
| Change over time, a comparison across groups, parts of a whole | `chart` | `kind: column \| line \| area \| pie \| donut`, `categories` + `series` for several series |
| A project plan or schedule | `gantt` | `items: [{ title, start?, end? \| days?, after?, group?, milestone?, progress? }]`, `today?`, `workdays?`, `holidays?` |
| Priorities (impact / effort) or a risk heat map | `matrix` | `items: [{ label, x, y }]`, `x`, `y`, `quadrants?` or `grid: 3-5` |
| Options to choose between | `compare` | `options: [{ name, summary?, pros?, cons?, verdict?, recommended? }]` |
| Structured facts across items | `table` | `columns: [...]`, `rows: [[...]]` (one cell per column) |
| How parts connect | `diagram` | `src: "file.json"` or `diagram: {…}`, `step?`, `mode?`, `level?`, `caption?` |
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
- A diagram with detail diagrams (drill-down, see `authoring.md`) embeds as one viewer with
  every level; `level: "payments"` shows that level as the figure and opens the viewer there.
  A `src` diagram's `$ref` levels are loaded relative to its own file, inside the page's folder.
- Contents: a row of links to every titled block appears when `meta.toc` is `true`, or by
  itself from 6 titled blocks (`meta.toc: false` hides it). Anchors are the slug of the
  block title (`#follow-up-actions`), with `-2`, `-3` for repeats, so links stay stable.
- `meta.updated` adds "Updated …" to the byline next to `meta.date`.

## Charts

Charts are drawn as inline SVG that scales with the page, follows the light and dark theme,
prints in colour and carries a visually hidden data table for screen readers.

```json
{ "type": "chart", "kind": "line", "title": "Monthly churn", "unit": "%",
  "categories": ["30/04/2026", "31/05/2026", "30/06/2026"],
  "series": [ { "name": "Starter", "values": [2.8, 3.1, 3.2], "tone": "bad" },
              { "name": "Team", "values": [1.9, 1.8, null] } ] }
```

| `kind` | Use for | Data |
|---|---|---|
| `bar` (default) | Rankings, long labels | `data`, or `categories` + `series` (grouped; `stacked: true`) |
| `column` | Few categories, values that can be negative | as `bar` |
| `line` | Trends; several series compared | `categories` + `series` (or `data`); `null` leaves a gap |
| `area` | Totals over time; `stacked: true` shows how parts add up | as `line` |
| `pie`, `donut` | Parts of one whole (2-8 slices); a donut shows the total in its centre | `data` only, values ≥ 0 |

- Values are numbers; `prefix` goes before them (`£`), `unit` after (`%`, ` ms`, `k`).
- Series take colours in a colour-blind-safe order (blue, orange, teal, violet, rose,
  amber…); line series also get distinct marker shapes. `tone` on a series or data item
  overrides its colour. More than 6 series, 24 bars, 60 line points or 8 slices is a warning.
- Categories that are all dates (`YYYY-MM-DD` or `DD/MM/YYYY`, increasing) are spaced by time
  on line and area charts, and shown as written.
- A plain `data` bar chart with no negative values keeps the original HTML bar list.
- `span: "half"` draws a narrower chart; `caption` adds a note under any chart, gantt or matrix.
  In inspector panels charts are drawn at the panel's width, so they fit without scrolling.
  On pages, column, bar, line and area charts, gantt plans and matrices also carry narrower
  drawings (320, 420 and 560 px, inert `<template>`s); the page script swaps in the widest one
  that fits the block on load and on resize, so phones do not scroll sideways. Without
  JavaScript, and in print, the static drawing stays.
- Clicking a legend item (or Enter / Space on it) hides that series, or takes a slice out of
  a pie or donut and redraws the others with their new shares and total. Without JavaScript
  (and in print) the chart is shown as written.

**Gantt.** Each item is a task with a `title`; dates are `YYYY-MM-DD` or `DD/MM/YYYY`, and
numbers are days from the block's `start` date (or day 0 when the plan has no dates). Give
`start` plus `days` or `end` (the last day, inclusive). Without `start`, a task begins when
everything in its `after` (an `id`, a title, or a list) has ended, else when the task above
it ends. `milestone: true` draws a diamond; `group` adds a heading row with a span bracket;
`progress` (0-100) fills part of the bar; `today` draws a dashed line. Arrows show `after`.

```json
{ "type": "gantt", "title": "Plan", "today": "20/10/2026", "items": [
  { "id": "api", "title": "API", "group": "Build", "start": "05/10/2026", "days": 25, "progress": 60 },
  { "id": "pay", "title": "Payments", "group": "Build", "after": "api", "days": 14 },
  { "title": "Launch", "milestone": true, "after": "pay", "tone": "good" } ] }
```

`workdays: true` counts **working days**: `days`, numeric `start`s and a numeric `today` skip
Saturdays, Sundays and every date in `holidays` (`["2026-12-25", "28/12/2026"]`), a task that
follows another (by `after` or by position) starts on the next working day, and weekends and
holidays are shaded. Explicit dates and `end` are kept as written; a milestone marks the moment
its `after` tasks end. It needs dates (a `start` date); tooltips count working days. See
`examples/answer-launch-plan.json`.

**Matrix.** `grid: 2` (default) is a 2x2: items are placed by `x` and `y` scores on
`axis.min`..`axis.max` (default 0-10), `quadrants` names the four corners (top left, top
right, bottom left, bottom right; `{ title, tone }` tints one). `grid: 3`-`5` is a heat map:
`x` and `y` are cell numbers (1 = left / bottom), cells are coloured low to high (`heat:
false` turns that off) and `x.labels` / `y.labels` name the columns and rows. An axis is a
label string or `{ label, low?, high?, labels?, min?, max? }`.

## Rules

- Answer the question that was asked. If you are unsure of a fact, say so in a `callout`
  rather than presenting it as certain, and cite `sources` when you have them.
- Prefer a `compare` with a `recommended` option over a vague "it depends".
- Numbers need units and context (`note`).
- `meta.watermark: false` removes the "Made with Yantra" badge; a string replaces its text.
- `meta.lang` (BCP 47) sets `<html lang dir>`, the fixed labels (Answer, Contents, Updated …,
  Recommended, the badge) and number formats in `metrics` and `chart` values (numbers given as
  numbers, not strings). Arabic, Hebrew, Persian and Urdu, or `meta.dir: "rtl"`, lay the page
  out right to left; diagram figures keep their own layout direction. Diagram blocks without
  their own `meta.lang` inherit the page's. `meta.strings` overrides labels by key. See
  `authoring.md` (Languages and right to left) and `examples/answer-order-fulfilment-arabic.json`.

## Validation codes

| Code | Fix |
|---|---|
| `page/missing-answer` | Add `answer.headline`. |
| `page/unknown-block` | Use one of the block types above. |
| `page/block-invalid` | Supply the fields listed in the message. |
| `page/diagram-unresolved` | `src` must be a relative `.json` path inside the page's own folder (no `..`, no absolute paths); fix the path or inline the diagram. |
| `page/unknown-level` | `level` must be a key of the diagram's `diagrams` map. |
| `page/image-src` | Use an `https:` URL or a `data:image/…` URI. |
| `page/image-alt` | Describe the image in `alt`. |
| `page/chart-kind` | `kind` is one of bar, column, line, area, pie, donut; pie and donut take `data`, not `series`. |
| `page/chart-mismatch` | Give one value per category in every series; `quadrants` has 4 entries; `x.labels` / `y.labels` one per row or column. |
| `page/chart-negative` | Pie and donut values must be 0 or more (and not all 0); use a column chart for negatives. |
| `page/chart-too-many-series`, `page/chart-too-many-points` (warnings) | Cut to the limits above: merge small items into "Other", or use a table. |
| `page/chart-out-of-range` (warning) | A matrix item lies outside its axis range (it is drawn at the edge), or a gantt `progress` is outside 0-100. |
| `page/gantt-date` | Use `YYYY-MM-DD` or `DD/MM/YYYY` (or a number of days), and give every task `days` or `end`. `holidays` are dates and need `workdays: true`; `workdays` needs a dated plan (warnings). |
| `page/gantt-dependency` | `after` must name a task's `id` or title, ids must be unique, and dependencies cannot loop. |
| `page/gantt-order` | A task ends before it starts (error), or starts before a task in its `after` ends (warning). |
| `page/heavy-embed` (warning) | More than 2 `interactive` diagrams; make the rest static. |
| `page/bad-height`, `page/bad-toc` (warnings) | `height` is a number ≥ 240; `meta.toc` is `true` or `false`. |
| `page/headline-too-long`, `page/too-many-blocks` | Cut. |
| `i18n/*` (warnings) | See `authoring.md`: `meta.lang` is a BCP 47 tag, `meta.dir` is `ltr`/`rtl`, `meta.strings` keys exist. |
| diagram codes (`geometry/*`, `ref/*`, …) | Fix the embedded diagram; see `authoring.md`. |
