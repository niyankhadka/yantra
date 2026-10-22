# Books

A book is several answer pages (chapters) read in order, built into **one offline HTML
file**. Use it when one page is not enough: an onboarding guide, a system explained part by
part, a handbook, a course module or a project report. Each chapter keeps the answer page
rules (see `pages.md`): its answer first, then the evidence.

Schema: `schemas/yantra-book.schema.json`. Example: `examples/book-checkout-explained.json`
(four chapters loaded from existing answer pages).

```bash
node bin/yantra.js new guide.json --book     # starter with two inline chapters
node bin/yantra.js validate guide.json        # every chapter is checked as an answer page
node bin/yantra.js build guide.json           # -> guide.html (offline)
node bin/yantra.js export guide.json -f md    # Markdown: cover, contents, then each chapter
```

## Shape

```json
{
  "kind": "book",
  "meta": { "title": "Checkout, end to end", "description": "What the reader will understand.", "author": "…", "date": "22/10/2026", "reading": "book" },
  "summary": "The whole book in two or three sentences.",
  "chapters": [
    { "meta": { "question": "…?", "title": "Short title" }, "answer": { "headline": "…" }, "blocks": [ … ] },
    { "$ref": "chapters/incident.json" }
  ]
}
```

- `meta.title` (required) is on the cover; `description`, `author` and `date` sit under it.
- `summary` (light markdown) is the book in two or three sentences: write it last, from the
  chapters' answers.
- `chapters` (1-12, in reading order): an answer page inline (with or without
  `"kind": "page"`), or `{ "$ref": "file.json" }`, a page in its own file, relative to the
  book and inside its folder. A chapter's diagram `src` paths are relative to the chapter's
  own file.
- A chapter without `meta.lang` takes the book's `lang`, `dir` and `strings`.
- The cover lists the chapters by `meta.title` (else the question), so give each chapter a
  short title.

## Reading modes

Every page and book has three reading modes, switched in the header:

| Mode | What the reader sees | Good for |
|---|---|---|
| `scroll` | one long page | reading at a desk, searching, printing |
| `book` | one screen at a time, like an e-reader: previous / next, a progress bar, text size | reading on a phone, reading in order |
| `present` | one row of blocks per slide, larger | a meeting or a walkthrough |

`meta.reading` sets how it opens (books default to `book`, pages to `scroll`). Pages break
**between** blocks, never inside one: blocks side by side (`half`, `third`) stay together, a
section's heading stays with its first row, and each chapter starts a new page. A block
taller than the screen scrolls on its own page.

- **Turning pages**: the arrow keys, Space / Shift+Space, Page Up / Page Down, Home / End,
  the buttons in the bottom bar, a swipe, or a tap near the left or right edge. `Esc` leaves
  present mode.
- **Contents** (books): the list button in the header opens the chapters and their titled
  blocks; a link opens the page it is on.
- **Remembered**: the mode, the place and the text size are kept in the reader's browser,
  per book. `#read=book` (or `scroll`, `present`) and `#at=12` (the 12th part) in the URL
  open a given mode and place.
- **Printing** always prints every chapter in order, each on a new sheet.

## Writing a good book

1. One question per chapter. If a chapter needs more than 12 blocks, it is two chapters.
2. Order chapters so each builds on the last: what it is, how it works, what goes wrong,
   what to do.
3. Keep interactive diagrams to the chapters that need them (at most 2 per chapter); static
   figures print and load faster.
4. More than 12 chapters is documentation: split it into books, or use a docs site.

## Validation codes

| Code | Fix |
|---|---|
| `schema/missing-title` | Give the book `meta.title`. |
| `book/no-chapters` | Add at least one chapter. |
| `book/too-many-chapters` (warning) | More than 12 chapters: split the book or merge chapters. |
| `book/chapter-unresolved` | A chapter `$ref` was not loaded: a relative `.json` path inside the book's folder (no `..`, no URLs), that exists and is not itself a book. In the browser playground, write chapters inline. |
| `book/chapter-invalid` | A chapter must be an answer page (`kind` `page` or none). |
| `book/bad-summary` | `summary` is a string. |
| `page/bad-reading` | `meta.reading` is `scroll`, `book` or `present`. |
| page codes (`page/*`, diagram codes) | Reported per chapter as `chapters[i] "Title": …`; see `pages.md`. |
