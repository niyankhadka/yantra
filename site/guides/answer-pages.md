---
description: Answer one question on one printable page: the headline first, then points, metrics, charts, comparisons and diagrams, in one offline HTML file.
---

# One-page answers and charts

Not every question is a diagram. "Should we build or buy?", "What happened during the
outage?" and "How are sales doing?" need an answer first and evidence after it. An
**answer page** (`"kind": "page"`) is exactly that: one page, readable in two minutes,
printable to A4, built into the same kind of offline HTML file as a diagram.

## 1. Start a page

```bash
yantra new answer.json --page
```

Or write it yourself. A page has a question, a headline answer and a few blocks:

```json
{
  "kind": "page",
  "meta": { "question": "Should we move background jobs from Redis to Postgres?", "title": "Job queue", "kicker": "Decision", "date": "20/10/2026" },
  "answer": {
    "headline": "Yes: move the jobs to Postgres, because it removes a service we run only for queues and keeps jobs in the same transaction as the data they change.",
    "points": ["One less service to run and monitor", "Jobs commit or roll back with the order", "Our volume is far below what Postgres queues handle"]
  },
  "blocks": [
    {
      "type": "compare",
      "title": "Options",
      "options": [
        { "name": "Postgres queue", "summary": "Jobs in a table, picked with SKIP LOCKED.", "pros": ["Transactional", "No extra service"], "cons": ["Polling load"], "recommended": true },
        { "name": "Keep Redis", "summary": "The current setup.", "pros": ["Already works"], "cons": ["Separate failure mode", "Jobs can outlive a rolled-back order"] }
      ]
    },
    {
      "type": "chart",
      "title": "Jobs per minute at peak",
      "kind": "column",
      "unit": "/min",
      "data": [{ "label": "Mon", "value": 410 }, { "label": "Tue", "value": 380 }, { "label": "Wed", "value": 455 }]
    },
    {
      "type": "checklist",
      "title": "Migration steps",
      "items": [{ "text": "Create the jobs table and worker" }, { "text": "Run both queues for a week" }, { "text": "Remove Redis" }]
    }
  ]
}
```

Then the same three commands as for a diagram:

```bash
yantra validate answer.json
yantra build answer.json          # -> answer.html (offline, prints to A4)
yantra export answer.json -f md   # a Markdown copy for a ticket, wiki or chat
```

## 2. Write the answer first

1. **Headline**: the conclusion itself, in one or two sentences (under 220 characters).
   "Use a saga, because..." beats "There are several considerations...".
2. **Points**: three to five supporting facts.
3. **Blocks**: three to eight, in the order the reader needs them. The validator warns
   above 12.

If a fact is uncertain, say so in a `callout` with `"tone": "warn"` instead of stating it
as certain, and list where facts come from in a `sources` block.

## 3. Choose blocks by content

| The content is... | Block |
|---|---|
| Parallel ideas, reasons, risks | `points` |
| A sequence or procedure | `steps` |
| Numbers that matter | `metrics` (a `trend` array adds a sparkline) |
| A ranking, a trend, parts of a whole | `chart` |
| Options to choose between | `compare` (mark one `recommended`) |
| A plan or schedule | `gantt` |
| Priorities or risks | `matrix` (2x2, or a 3x3 to 5x5 heat map) |
| Facts across items | `table` |
| Events in order | `timeline` |
| How parts connect | `diagram` |
| Questions readers will ask | `faq` |
| A to-do or readiness list | `checklist` |
| A warning or key caveat | `callout` |

`"span": "half"` puts two consecutive blocks side by side on wide screens. Every block's
fields are in [Answer pages](../../docs/pages.md).

## 4. Charts

Charts are inline SVG with no chart library: they follow the theme, print in colour, carry
a hidden data table for screen readers and redraw narrower on phones.

| `kind` | Use for |
|---|---|
| `bar` (default) | Rankings and long labels |
| `column` | A few categories, values that can be negative |
| `line` | Trends, several series compared |
| `area` | Totals over time (`stacked: true` shows how parts add up) |
| `pie`, `donut` | Parts of one whole, two to eight slices |

Several series use `categories` plus `series`; `target` draws a dashed reference line;
`prefix` and `unit` format the values (`£`, `%`, ` ms`). Clicking a legend item hides that
series. A page of `metrics` and charts makes a simple dashboard: see the
[sales dashboard](../../examples/chart-sales-dashboard.json) or the
[quarterly review](../../examples/answer-quarterly-review.json) in the playground.

## 5. Put a diagram on the page

A `diagram` block embeds a diagram, either inline or from a file next to the page:

```json
{ "type": "diagram", "src": "checkout.json", "step": 2, "caption": "The payment path" }
```

It is validated like any diagram and drawn as a static figure. Add `"interactive": true` to
embed the full viewer (walkthrough and inspector) in the page; keep it to at most two live
viewers per page. A good pattern for "explain how X works" is a diagram first, then a page
around it.

## 6. Plans and priorities

A `gantt` block takes tasks with dates (or days after other tasks), milestones, groups,
progress and a today line; `workdays: true` skips weekends and listed holidays. A `matrix`
places items on a 2x2 (impact against effort) or colours a risk heat map. The
[launch plan](../../examples/answer-launch-plan.json) shows both.

## 7. Layout, reading modes and books

- `span: "half"` puts two blocks side by side and `span: "third"` puts three; a `section`
  block groups blocks under a heading, with a short `intro`.
- Readers switch between **Scroll**, **Book** (one screen at a time, like an e-reader) and
  **Present** (one row of blocks per slide) in the page header. `meta.reading` sets how the
  page opens.
- When one page is not enough, put several in a **book**: `{ "kind": "book" }` with the pages
  as `chapters`, a cover summary and a contents menu, still in one offline file. Start one
  with `yantra new guide.json --book`, or open the
  [example book](../../examples/book-checkout-explained.json).

## Next

- Every block, chart option and validation code: [Answer pages](../../docs/pages.md).
- Chapters, reading modes and their keys: [Books](../../docs/books.md).
- Turn a Mermaid `gantt`, `pie` or `timeline` into a page: [Import](import.md).
- Ask a chat to write pages for you: [Use with AI chats](chat.md).
