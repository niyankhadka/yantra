---
description: Install the Yantra CLI, write a three-card diagram with a walkthrough, validate it and build one offline HTML file, in about five minutes.
---

# Install and your first diagram

In five minutes you will install the `yantra` command, write a small diagram with a
walkthrough, check it and build it into one HTML file that works offline.

Prefer not to install anything yet? Open the
[playground](https://yantra.nbk.com.np/playground/), pick **Load an example** and edit the JSON
there: it validates and previews in your browser.

## 1. Check Node.js

Yantra needs **Node.js 20.19 or later** (22.12 or later if you are on Node 22).

```bash
node --version
```

If the version is older, install a current LTS release from nodejs.org or your package
manager first.

## 2. Install the CLI

```bash
npm i -g @niyankhadka/yantra
yantra --help
```

The package ships a prebuilt viewer, so there is nothing else to set up. To try it without a
global install, put `npx @niyankhadka/yantra` wherever this guide says `yantra`:

```bash
npx @niyankhadka/yantra new diagram.json
```

## 3. Write a diagram

Save this as `checkout.json`. It describes three cards, two connections and a walkthrough of
three steps. There are no coordinates: Yantra lays the cards out and routes the edges.

```json
{
  "meta": { "title": "Checkout", "description": "How an order is paid and stored." },
  "nodes": [
    { "id": "web", "type": "client", "data": { "title": "Web app", "subtitle": "Customer checkout" } },
    { "id": "api", "type": "service", "data": { "title": "Orders API", "tech": "Go" } },
    { "id": "db", "type": "data", "data": { "title": "Orders DB", "tech": "PostgreSQL", "icon": "database" } }
  ],
  "edges": [
    { "id": "web-api", "source": "web", "target": "api", "label": "POST /orders" },
    { "id": "api-db", "source": "api", "target": "db", "label": "INSERT order" }
  ],
  "steps": [
    { "title": "Overview" },
    { "title": "Submit", "highlightNodes": ["web", "api"], "highlightEdges": ["web-api"] },
    { "title": "Persist", "highlightNodes": ["api", "db"], "highlightEdges": ["api-db"] }
  ]
}
```

Two rules matter from the start:

- The first step is an overview that highlights nothing.
- A highlighted edge needs **both** of its endpoints highlighted in the same step.

`yantra new checkout.json` writes a similar starter if you would rather begin from a file.

## 4. Validate

```bash
yantra validate checkout.json
```

The validator checks the schema, every reference (edges and steps must name real ids), the
story, and the rendered geometry: overlapping cards, edges that cross cards and colliding
labels. Each finding has a stable code such as `ref/edge-unknown-target`, and the command
exits with code 1 when there are errors, so it works in CI. Add `--json` for
machine-readable output or `--lang es` for messages in another language.

Try breaking it: change `"target": "api"` to `"target": "apii"` and validate again to see
the error and its code. Put it back afterwards.

## 5. Build one HTML file

```bash
yantra build checkout.json
```

This writes `checkout.html`: the viewer, its styles and your diagram in one file that makes
no network requests. Open it in a browser and:

- press <kbd>→</kbd> and <kbd>←</kbd> (or <kbd>Space</kbd>) to step through the walkthrough;
- click a card to open the inspector;
- press <kbd>V</kbd> for the sequence view of the same payload, <kbd>T</kbd> for the dark
  theme and <kbd>?</kbd> for every shortcut.

The URL hash follows what you do (for example `#step=2&theme=dark`), so a copied link
reopens the same view.

## 6. Look at it without a browser window

```bash
yantra screenshot checkout.json --step 2
```

This renders a PNG through your local Chrome or Edge (`YANTRA_BROWSER` points it at another
browser). It is the quickest way to review a diagram, and coding agents use it to check
their own work.

## Where to go next

- Copy a richer starting point: `yantra examples` lists the built-in examples and
  `yantra examples oauth-login -o oauth.json` copies one. You can also open them in the
  [playground](https://yantra.nbk.com.np/playground/#example=cloud-architecture).
- Learn the rules, budgets and every diagram kind in
  [Authoring diagrams](../../docs/authoring.md): groups, trees, state machines, ERDs,
  drill-down and charts.
- Let a coding agent draw your codebase: [Diagrams from your codebase](coding-agents.md).
- Answer a question on one page instead: [One-page answers and charts](answer-pages.md).
