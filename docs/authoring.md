# Authoring Yantra diagrams

This is the contract for anyone (person or agent) writing a Yantra payload. The schema is
`schemas/yantra-payload.schema.json`; this page explains how to use it well.

## Workflow

1. **Decide the story first.** What question does the diagram answer? Who reads it? List the
   3–6 steps of the walkthrough before listing boxes.
2. **Write the payload** in one pass: `meta`, `roles`, `nodes`, `edges`, `scenarios`.
   Start from `yantra new diagram.json` or a file in `examples/`.
3. **Validate**: `yantra validate diagram.json`. Fix every error, then the warnings
   (repair order below). Repeat at most twice; if it still fails, simplify the diagram.
4. **Build**: `yantra build diagram.json` writes `diagram.html` (single offline file).
5. **Look at it**: `yantra screenshot diagram.json --step 2` and open the PNG. Never claim a
   diagram looks right without viewing it.

## Do not place nodes

Layout and edge routing are automatic. Leave out `x`/`y`. The engine ranks nodes by the
direction of the edges, so **edge direction is your layout tool**:

- Point edges along the main flow (request → service → store). The main path becomes a
  straight row (`LR`) or column (`TB`).
- Return / feedback edges (refund, retry, sync back) are detected and drawn in a corridor
  outside the drawing. Keep them; do not invert them to "help" the layout.
- `meta.layout.direction`: `LR` (default) for pipelines and request flows, `TB` for
  hierarchies and long sequential processes.
- `node.rank` forces a column when two nodes must line up; use sparingly.
- `meta.layout.mode: "manual"` + `x`/`y` (multiples of 10) only when an exact
  hand layout is required. You then own overlaps.

## Budgets

| Thing | Budget | Why |
|---|---|---|
| Nodes | ≤ 14 (aim for 6–10) | Beyond that, split into an overview plus detail diagrams (see Drill-down) |
| Edges | ≤ 20 | Merge parallel flows that say the same thing |
| Roles | 3–5 | Colour means something only when it repeats |
| Node title | ≤ 42 chars | Detail goes in `subtitle` (card) or `description` (inspector) |
| Edge label | ≤ 28 chars, ideally 1–3 words | Labels name what flows: `JWT`, `Order event`, `SQL write` |
| Steps per scenario | 3–8 | The first step is usually an overview |

## Content rules

- `data.title`: the thing's name. `data.subtitle`: its job, in a few words.
  `data.tech`: the technology, one line. Anything longer goes in `description`.
- Put facts (SLA, team size, owner) in `data.metadata`; they show in the inspector, not on
  the card. Cards stay quiet.
- Use `roles` to group `type`s into 3–5 meaningful categories with one colour each, e.g.
  `edge`, `service`, `data`, `external`. Give the specific label in `data.badge`.
- `edge.type: "async" | "event" | "stream"` (or `style: "dashed"`) for asynchronous flows.
- A step that highlights nothing is an overview. A focused step lists the nodes **and** the
  edges involved; every highlighted edge must have both endpoints highlighted.
- `step.payload` is optional and is shown in the inspector: `method`, `endpoint`, `status`,
  `latency`, `protocol` become chips, everything else is pretty-printed JSON.
- Add `modes` only when they change something (`hideNodes`, `hideEdges`, or per-mode
  `data.modes.<id>` overrides).

## Inspector tabs: include only what was asked for

The side panel builds its tabs from the payload, so add content for a tab only when the
user wants that kind of information:

| Tab | Appears when | Add it when the user asks for… |
|---|---|---|
| **Summary** | `meta.summary` exists | a summary, overview, key points, TL;DR |
| **Step** | any step has a `payload` | request/response detail, data per step, step-by-step specifics |
| **Details** | any node has `description`, `tech`, `metadata`, `ports`, `sourceFile`… | component details, specs, owners, code references |
| *your panel* | listed in `panels` | anything else: risks, costs, glossary, FAQ, decisions, metrics |

```json
"panels": [
  { "id": "risks", "title": "Risks", "blocks": [
    { "type": "points", "items": [{ "title": "Provider outage", "text": "Payments queue and retry.", "tone": "warn" }] }
  ] }
]
```

- Panels use the same blocks as answer pages (`points`, `steps`, `metrics`, `table`,
  `compare`, `callout`, `chart`, `code`, `sources`, `text`; see `docs/pages.md`). Keep the
  title to one or two words: it is the tab label.
- `meta.inspector.tabs: ["summary", "risks"]` picks and orders tabs explicitly;
  `meta.inspector.labels: { "node": "Component" }` renames built-in tabs.
- No tabs at all hides the inspector button. Many tabs scroll sideways.

### What a card click opens

Clicking a card always highlights it and its connections. What the inspector does is a
fixed rule per diagram, set with `meta.inspector.onNodeClick`; leave it out unless the
diagram's purpose calls for something else:

| Value | Click opens | Use when |
|---|---|---|
| `"node"` (default) | the card's **Details** tab | almost always |
| `"stay"` | nothing new; the open tab stays | the panel is the point (e.g. a walkthrough read alongside) and Details would distract |
| a panel id, e.g. `"risks"` | that panel, filtered to the card | the diagram is *about* that panel per component (a risk map, a cost map, an ownership map) |

For a panel opened by click, give its blocks `nodes: ["card-id", …]`: such blocks show
only while one of those cards is selected (with a "Show all cards" link), and blocks
without `nodes` always show. If the target tab does not exist, the click only highlights.

## Groups

`groups` draws a labelled box around related nodes. Use it when the boundary itself is part
of the explanation:

- **trust boundaries**: public internet vs. your network, PCI scope, tenant isolation;
- **cloud structure**: account > region > VPC / subnet, cluster > namespace;
- **ownership**: teams or departments, and **swimlanes** for who does each step of a process;
- **subsystems**: "Billing", "Search", "Data platform" inside a larger architecture.

Keep to **2-5 groups**, nest at most 3 deep, and leave nodes that sit outside every boundary
(users, third parties) ungrouped. A box with one node rarely helps; put the node's context in
its subtitle instead.

```json
"groups": [
  { "id": "aws", "title": "AWS account (eu-west-2)", "nodes": ["cdn"], "color": "orange", "style": "solid" },
  { "id": "vpc", "title": "Private VPC", "parent": "aws", "nodes": ["worker", "db"], "color": "green",
    "description": "Private subnets in two AZs; no internet gateway." }
]
```

- List each node in its **innermost** group only; the parent's members include the child's.
- Group ids must not reuse node ids. `color` is a role hue name; `style` is `dashed` (default) or `solid`.
- Layout keeps members together, pads each box (20px sides, 36px top for the title) and keeps
  boxes clear of outsiders. Edges cross borders where they enter or leave a group, but never
  run through a title. In manual layout the box simply wraps its members' cards.
- During a step, a group whose members are all dimmed is dimmed too.

See `examples/aws-serverless.json`.

## Sequence view

The same payload can be drawn as a sequence diagram. Use it when **time order** matters more
than topology: request/response flows, protocols and handshakes (OAuth, TLS, payments),
"who calls whom" during one user action. The steps drive it, so no extra data is needed:

- Every id in a step's `highlightEdges` becomes one arrow, source -> target, in step order.
  An edge used in two steps appears twice. Labels come from the edge (fallback: the step title);
  `style: "dashed"` or an async/event `type` draws a dashed arrow; an edge from a node to itself
  draws a self-loop.
- Participants are the nodes that send or receive a message, left to right in order of first
  appearance (a step without messages contributes its `highlightNodes`, so an opening
  "the user clicks" step puts the user on the left). `meta.sequence.allParticipants: true`
  adds every node. Group members are kept adjacent and their group becomes a box around their
  columns.
- Each step is a numbered row; a step without `highlightEdges` becomes a note across its
  highlighted nodes. Column gaps widen automatically until every label fits between its lifelines.

`"meta": { "view": "sequence" }` opens in the sequence view. Whenever the active scenario has a
step with `highlightEdges`, the viewer shows a Flow / Sequence toggle (key `V`, deep link
`#view=sequence`). CLI: `yantra export file.json -f svg --view sequence [--step n]` and
`yantra screenshot file.json --view sequence --step n`. Write `highlightEdges` for every step
that sends something, and keep the flow view readable too: both views come from one payload.
See `examples/oauth-login.json`.

## Drill-down: an overview plus detail diagrams

A big system does not fit in 14 cards, and should not. Draw the **overview** with one card per
subsystem, then give a subsystem its own **detail diagram**: the card gets a drill mark, and
opening it (click the mark, double-click the card, key `D`, or the inspector button) shows the
detail with a breadcrumb (`Overview › Payments`). The breadcrumb, `Esc` (once nothing is
selected) and the browser's Back button return; the URL carries the level (`#level=payments`).
Each level is a full diagram: its own steps, inspector tabs, modes and sequence view.

```json
{
  "meta": { "title": "Shop platform" },
  "nodes": [
    { "id": "payments", "type": "service", "data": { "title": "Payments", "drill": "payments" } }
  ],
  "diagrams": {
    "payments": { "meta": { "title": "Payments service" }, "nodes": [ ... ], "edges": [ ... ], "scenarios": [ ... ] },
    "search": { "$ref": "./search.json" }
  }
}
```

- `data.drill` names a key of the top-level `diagrams` map. A detail diagram may drill further
  (at most **3 levels** below the overview, no cycles); every id lives in one namespace, so a
  detail diagram's own `diagrams` map is merged in.
- `{ "$ref": "./search.json" }` keeps a level in its own file. The CLI and MCP server load it
  relative to the file that contains it; it must be a relative `.json` path that stays inside
  the input folder (the input file's folder for the CLI, `YANTRA_INPUT_ROOT` for MCP). The
  built HTML always contains every level, so it still works offline. The browser dev server
  and the gallery cannot load files: inline those levels.
- `meta.startLevel: "payments"` opens the viewer on a detail diagram.
- Exports follow the level on screen (SVG, PNG, Markdown); **Export → Markdown, all levels**
  (CLI `export -f md --all-levels`) appends every level under its breadcrumb. CLI and MCP take
  `--level <id>` / `level` for `export` and `screenshot`.
- Answer pages: a diagram block with `level: "payments"` shows that level; with
  `interactive: true` the viewer opens there and can go back up. One drillable embed is still
  one viewer for the two-per-page budget.

See `examples/platform-overview.json`.

## Links

`data.url` on a node, `url` on an edge or a step adds an **Open link** to the inspector (node
Details, the edge in its card's connections, the Step tab), opened in a new tab with
`rel="noopener noreferrer"`. Only `http:`, `https:` and `mailto:` links are allowed; Markdown
exports keep them as links. Use links for runbooks, dashboards, specs and source, not for
content that belongs on the card.

## State machines and lifecycles

Use a state diagram when the question is **what states a thing can be in and which event
moves it** (an order, a ticket, a document, a connection). Nodes are states, edges are
transitions labelled with their event:

- `shape: "state"` draws a rounder card for a state. `shape: "initial"` (filled dot),
  `"final"` (ringed dot) and `"choice"` (diamond) are small, textless pseudo-states; their
  `data.title` still names them in tooltips, the inspector and exports. Give them their own
  role (e.g. `pseudo`, slate) so the legend explains the dots.
- A transition out of an initial state or into a final state needs no label; every other
  transition should name its event.
- **Self-loops** (`source` equal to `target`) draw as a small loop on a free side of the card
  (above or below it in `LR`, to its right in `TB`), with the label on the loop. Layout makes
  room for it; steps may highlight it like any edge.
- **Back-edges** (reopen, retry, decline) are fine: point them the way the event goes and
  layout routes them back. Two edges between the same pair of states get a wider gap so
  both labels fit side by side.
- `edge.arrow`: `"forward"` (default), `"both"` for one two-way edge (`ask / reply`), or
  `"none"` for an undirected link. Layout still ranks by `source` → `target`.

```json
{ "id": "start", "type": "pseudo", "shape": "initial", "data": { "title": "Start" } },
{ "id": "open", "type": "state", "shape": "state", "data": { "title": "Open" } },
{ "id": "open-note", "source": "open", "target": "open", "label": "add note" },
{ "id": "open-waiting", "source": "open", "target": "waiting", "label": "ask / reply", "arrow": "both" }
```

See `examples/ticket-lifecycle.json`; Mermaid `stateDiagram` imports to the same shapes.

## Limits

- Card titles, subtitles and edge labels over 200 characters are cut with an ellipsis;
  lint warns `content/text-too-long`.
- Graphs over 60 nodes or 120 edges switch to a faster windowed router
  (`budget/large-graph-fast-routing`); it may leave the odd label overlap the careful router
  avoids. Split big diagrams instead where you can.

## Validation codes and how to fix them

Fix in this order; each fix can clear later errors.

| Code | Fix |
|---|---|
| `schema/*` | Add the missing field (`meta.title`, `data.title`, step `title`). |
| `ref/duplicate-*`, `ref/*-unknown-*` | Make ids unique; fix the referenced id (copy-paste ids, don't retype). |
| `ref/default-mode-unknown` | Point `meta.defaultMode` at an existing mode id. |
| `layout/manual-missing-xy`, `layout/off-grid` | Manual layout only: give every node x/y on the 10px grid, or remove `layout.mode`. |
| `geometry/node-overlap` | Manual layout: move nodes apart. Auto layout never overlaps. |
| `geometry/route-failed`, `geometry/edge-through-node` | Usually manual layout or extreme density: spread nodes, drop redundant edges, or split. |
| `geometry/label-overlaps-node`, `geometry/label-overlaps-label` | Shorten labels; remove labels that repeat the target's name. |
| `geometry/edges-stacked` (warning) | Two edges share a track; merge them or remove one. |
| `group/unknown-node`, `group/unknown-parent`, `group/duplicate-id` | Fix the id (group ids must differ from node ids and from each other). |
| `group/node-in-two-groups` | List the node only in its innermost group. |
| `group/cycle`, `group/too-deep` | Fix `parent` so groups form a tree at most 3 levels deep. |
| `group/empty`, `group/missing-title` (warnings) | Add members and a title, or remove the group. |
| `geometry/group-overlap`, `geometry/node-in-foreign-group` | Manual layout: move nodes so boxes separate, or add the node to the group. Auto layout avoids both. |
| `geometry/label-overlaps-group-title` (warning) | Shorten the label or the group title. |
| `ref/inspector-unknown-click-target`, `ref/panel-unknown-node` | Point `onNodeClick` at `node`, `stay` or a panel id; list only real card ids in `nodes`. |
| `panel/*`, `ref/inspector-unknown-tab` | Give each panel a unique `id`, a `title` and blocks; list only existing tab ids. |
| `page/block-invalid` (inside a panel) | Supply the block fields listed in the message. |
| `schema/node-shape-invalid`, `schema/edge-arrow-invalid` | Use a listed `shape` (`card`, `state`, `initial`, `final`, `choice`) or `arrow` (`forward`, `both`, `none`). |
| `story/initial-has-incoming`, `story/final-has-outgoing` (warnings) | Nothing enters an initial state or leaves a final one: retarget the edge at a real state. |
| `story/choice-needs-branches` (warning) | Give the choice two or more outgoing, labelled branches, or make it a state. |
| `story/edge-endpoint-dimmed` (warning) | Add the edge's source and target to that step's `highlightNodes`. |
| `story/no-steps` (warning) | Add a scenario with an overview step and 2+ focused steps. |
| `sequence/no-messages` (warning) | `meta.view` is `sequence` but no step lists `highlightEdges`: add them, or drop `meta.view`. |
| `schema/unknown-view` | `meta.view` must be `flow` or `sequence`. |
| `geometry/sequence-label-*` | Should not occur (gaps widen to fit); report it, and shorten the label meanwhile. |
| `drill/unknown-target` | `data.drill` must name a key of `diagrams` (ids are case-sensitive). |
| `drill/cycle` | Levels drill into each other (A > B > A), or `$ref` files load each other: remove one `data.drill` or ref so levels form a tree. |
| `drill/too-deep` | More than 3 levels below the overview: merge a level, or link the deepest one as a separate diagram (`url`). |
| `drill/ref-missing` | The `$ref` file is missing, unreadable or not valid JSON (or nothing loaded it: validate with the CLI or MCP). |
| `drill/ref-unsafe` | Use a relative `.json` path inside the input folder: no absolute paths, URLs or `..` that leaves it. |
| `drill/invalid-diagram`, `drill/diagrams-invalid`, `drill/duplicate-id` | `diagrams` is an object of diagram payloads (or `$ref`s) with ids unique across all levels. |
| `drill/unknown-start-level` | `meta.startLevel` must be a key of `diagrams`. |
| `drill/unused-diagram` (warning) | No card drills into this level: add `data.drill` or remove it. |
| `diagrams.<id>: …` | A finding inside a detail diagram; fix it there like any other code. |
| `link/unsafe-url` | `url` must start with `http://`, `https://` or `mailto:`. |
| `budget/*` (warning) | Split the diagram or merge nodes. |
| `content/*` (warning) | Shorten titles/labels; add missing edge labels. |

## Minimal example

```json
{
  "meta": { "title": "Checkout", "description": "How an order is paid and stored." },
  "roles": {
    "client": { "label": "Client", "color": "amber" },
    "service": { "label": "Service", "color": "blue" },
    "data": { "label": "Data", "color": "violet" }
  },
  "nodes": [
    { "id": "web", "type": "client", "data": { "title": "Web app", "subtitle": "Customer checkout", "icon": "monitor" } },
    { "id": "api", "type": "service", "data": { "title": "Orders API", "subtitle": "Validates and charges", "tech": "Go" } },
    { "id": "db", "type": "data", "data": { "title": "Orders DB", "subtitle": "Source of truth", "tech": "PostgreSQL", "icon": "database" } }
  ],
  "edges": [
    { "id": "web-api", "source": "web", "target": "api", "label": "POST /orders" },
    { "id": "api-db", "source": "api", "target": "db", "label": "INSERT order" }
  ],
  "scenarios": [
    {
      "id": "main",
      "name": "Place an order",
      "steps": [
        { "id": "s1", "title": "Overview", "description": "Three parts: client, API, database." },
        { "id": "s2", "title": "Submit", "description": "The browser posts the cart.", "highlightNodes": ["web", "api"], "highlightEdges": ["web-api"] },
        { "id": "s3", "title": "Persist", "description": "The API stores the order.", "highlightNodes": ["api", "db"], "highlightEdges": ["api-db"] }
      ]
    }
  ]
}
```
