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
- `meta.layout.algorithm`: `layered` (default) for flows; `tree` or `mindmap` for
  hierarchies (see [Trees, org charts and mind maps](#trees-org-charts-and-mind-maps)).

## Budgets

| Thing | Budget | Why |
|---|---|---|
| Nodes | ≤ 14 (aim for 6–10); trees and mind maps ≤ 40 as they open, ≤ 120 in all | Beyond that, split into an overview plus detail diagrams (see Drill-down), or fold branches |
| Edges | ≤ 20 | Merge parallel flows that say the same thing |
| Roles | 3–5 | Colour means something only when it repeats |
| Node title | ≤ 42 columns (characters; CJK count 2) | Detail goes in `subtitle` (card) or `description` (inspector) |
| Edge label | ≤ 28 columns, ideally 1–3 words | Labels name what flows: `JWT`, `Order event`, `SQL write` |
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

## Trees, org charts and mind maps

When the answer is a hierarchy, pick a hierarchical layout. Edges still point from parent to
child; the engine takes the hierarchy from them.

| `meta.layout.algorithm` | Use for | Drawing |
|---|---|---|
| `"tree"` + `direction: "TB"` | org charts, decision trees, work breakdowns | rows per level, parents centred over their children, comb connectors |
| `"tree"` + `direction: "LR"` | taxonomies, file trees, deep breakdowns | columns per level, same connectors sideways |
| `"mindmap"` | study or project plans, brainstorms, topic overviews | the root in the centre, branches balanced left and right, curved connectors, one colour per branch |

```json
"meta": { "title": "Org chart", "layout": { "algorithm": "tree", "direction": "TB" } },
"nodes": [
  { "id": "ceo", "type": "exec", "data": { "title": "Amara Okafor", "subtitle": "Chief Executive Officer" } },
  { "id": "cto", "type": "exec", "data": { "title": "Daniel Reyes", "subtitle": "Chief Technology Officer" } }
],
"edges": [ { "id": "ceo-cto", "source": "ceo", "target": "cto" } ]
```

- **One parent per node.** A node with two incoming edges keeps the first listed one as its
  parent; the other is drawn as a routed cross-link and lint warns `layout/tree-cross-link`.
  In a decision tree, repeat an outcome card (`sev2-a`, `sev2-b`) instead of merging branches.
- **Labels are optional on hierarchy edges** (the hierarchy is the meaning). Label them when
  the branch needs a name: `Yes` / `No` in a decision tree, a condition, a percentage.
- **People cards**: `title` is the name, `subtitle` the role, `badge` a short team or level
  tag; `width: 180-200` keeps wide org charts compact.
- **Wide org charts: compact stacks.** In a `TB` tree, a parent whose children are all
  leaves (no reports of their own, no edge label) can list them in one column below itself,
  indented on a side bus, instead of a row. `meta.layout.compact`: `"auto"` (default) does
  this only when the spread tree is much wider than tall (over 1600 px and 2.4 times its
  height), `true` always, `false` never. Parents with a mix of leaf and non-leaf children keep
  their row. A 30-40 person org chart then fits a near-square canvas. `LR` trees and mind maps
  are never stacked (`layout/compact-ignored` when `compact: true` is set there).
- **Assistants and staff**: `data.assistant: true` on a leaf card (an executive assistant, a
  chief of staff) places it beside its manager, in the manager's row, on a short side
  connector instead of a level below. The first assistant goes right (TB) or below (LR), the
  next on the other side, more stack in those columns. A root, a card with reports or a mind
  map ignores the flag (`layout/assistant-ignored`).
- **Dragging** a card moves its visible subtree with it; comb, stack and assistant connectors
  are rebuilt from where the cards now sit (mind-map curves stay curves). A child dragged out
  of tree order (above its parent, say) is routed like any other edge.
- **Mind maps** have one root (the first node nothing points at). Branch colours replace role
  colours on the canvas, so the roles legend is hidden; keep `roles` for the inspector.
- Order children the way they should read: siblings keep the order of their edges.
- State shapes work here too: a self-loop sits right of its card (TB tree) or below it (LR
  tree, mind map) with room kept for it; dots and diamonds carry no fold button while open,
  and a `+N` badge beside them while folded (click it to unfold). Cards with
  `data.drill` keep their drill mark, and each detail level opens with its own `collapsed`.
- Groups are not drawn in these layouts (`layout/groups-ignored`); the hierarchy is the
  boundary. This is deliberate: a tidy tree packs subtrees by their outline, so a box around
  one subtree would often enclose cards of its neighbours. To show or hide a team, fold its
  top card (`meta.layout.collapsed: ["cto"]`); folding a group id in a tree warns
  `layout/collapse-ignored`.

See `examples/org-chart.json`, `examples/study-plan-mindmap.json` and
`examples/incident-triage-decision-tree.json`.

## Big diagrams: folding

Readers can fold parts of a diagram into one card and unfold them again (`+N` / `−` buttons,
key `X` on a selected card; the state is kept in the link as `#collapsed=id,id`):

- in `tree` and `mindmap` layouts, any card with children folds its **subtree**;
- in the `layered` layout, every **group** folds into a summary card that takes over the
  group's edges (parallel edges merge, internal ones disappear).

`meta.layout.collapsed: ["id", ...]` lists what is folded when the viewer opens (`build`,
`export` and `screenshot` take `--collapsed id,id` or `--expand-all` to override it for one
output; MCP tools take `collapsed` / `expandAll`). Use it for
large trees (lint counts the cards that show at first against the budget of 40) and for detail
groups in an architecture overview. A step that highlights a folded card unfolds it, so a
walkthrough can open a branch at the right moment. Validation checks the drawing both as it
opens and fully unfolded (findings for the second carry `[expanded]`).

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

`meta.views` lists the views a reader may switch between. `["flow"]` hides the toggle (a
diagram whose steps highlight relationships rather than messages); `["sequence"]` shows only the
sequence view. Without it both are offered, except that a diagram made **only of table or class
cards** (an ERD or a class diagram: every node has `fields` or `methods`) has no sequence view and
no toggle; list `["flow", "sequence"]` to offer it anyway.

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
  built HTML always contains every level, so it still works offline. The dev server
  (`npm run dev`) inlines them too when a gallery example is imported (relative to the
  example, inside the project only), and the Python SDK loads them for a page's diagram `src`
  (relative to that file, inside `base_dir`).
- `data.modes.<mode id>.drill` opens another level while that mode is shown (`null`: no detail
  in that mode). Lint checks these targets like `data.drill`, and the Markdown export lists
  them as `Mode: detail: Title` after the card.
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
- When several transitions meet a dot or diamond, the best-aligned one keeps its side and
  each other one enters from the free side that gives it the shortest route, so lines reach
  the dot directly instead of going round it.
- **Self-loops** (`source` equal to `target`) draw as a small loop on a free side of the card
  (above or below it in `LR`, to its right in `TB`), with the label on the loop. Layout makes
  room for it; steps may highlight it like any edge. Ports of other edges on that side stay
  clear of the loop's legs. A loop on a dot or diamond takes a side no other edge uses, starts
  on the outline and reaches well past the shape, with its label beyond the loop.
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

### Fork, join and concurrent regions

- `shape: "fork"` draws a **fork or join bar**: a thick bar across the flow (vertical in `LR`,
  horizontal in `TB`). Edges attach along its length on the two long sides, lined up with the
  cards they join, and end on the bar's face. The bar grows with its edges (and stretches to
  span its neighbours when there is room); `width` sets a length. Use the same shape for a
  join. Transitions into or out of a bar need no label; a bar should split into or merge two
  or more transitions (`story/fork-needs-branches`).
- **Concurrent regions**: make the composite state a group, and each region a child group with
  `"kind": "region"` and `"parent"` set to it. Regions stack across the flow (rows in `LR`,
  columns in `TB`); the parent draws its box and title, each region only its title, with a
  dashed line between neighbouring regions. Put every node of the composite state inside one
  of its regions, and use two or more regions.
- In `tree` and `mindmap` layouts a bar is drawn like the other pseudo-states (folded, it
  shows a `+N` badge); hierarchy edges there are tree connectors and ignore `sourceField` /
  `targetField`, which apply to cross-links and self-loops only.

```json
{ "id": "split", "type": "pseudo", "shape": "fork", "data": { "title": "Fork" } },
"groups": [
  { "id": "processing", "title": "Processing", "nodes": [] },
  { "id": "payment", "title": "Payment", "kind": "region", "parent": "processing", "nodes": ["authorise", "capture"] },
  { "id": "stock", "title": "Stock", "kind": "region", "parent": "processing", "nodes": ["reserve", "pack"] }
]
```

See `examples/parallel-checkout-states.json`.

## Data models and class diagrams

A card becomes an **entity card** when its `data` has `fields` and/or `methods`: the rows
appear under the title and the card grows to fit them (and widens, up to 320px, for long
types). Use it for database schemas (ERDs) and UML class diagrams.

```json
{ "id": "orders", "type": "table", "data": { "title": "orders", "fields": [
  { "name": "id", "type": "uuid", "pk": true },
  { "name": "customer_id", "type": "uuid", "fk": true, "ref": "customers.id" },
  { "name": "shipped_at", "type": "timestamptz", "nullable": true }
] } }
```

- **Fields**: `name` (required), `type`, flags `pk` / `fk` / `unique` (shown as PK / FK / UK in
  a key column, PK names in bold), `nullable` (type ends in `?`), `ref` (`"node"` or
  `"node.field"`, validated), `note` (inspector and Markdown only).
- **Class cards**: `fields` are attributes and `methods` are operations
  (`{ name, params?, type?, visibility?, static?, abstract? }`, drawn as `name(params)` with the
  return type on the right). `visibility` is `+ - # ~`; static members are underlined,
  abstract ones italic. `data.stereotype: "interface"` shows `«interface»` in place of the kicker.
- **Keep cards small**: a card shows 12 rows (fields + methods); the rest become `+ N more`
  and lint warns `content/too-many-fields`. Show the keys and the columns the story needs;
  list the rest in `description`.
- **Layout**: `LR` suits ERDs (tall cards side by side), `TB` suits class hierarchies.

### Relationship notation

Edges take a marker at each end, independent of `style`:

| Field | Values |
|---|---|
| `sourceEnd`, `targetEnd` | ER cardinality: `one` (two bars, exactly one), `zero-or-one`, `many`, `one-or-many`, `zero-or-many`; UML heads: `triangle`, `diamond`, `open-diamond`, `open-arrow`, `arrow`; `none` |
| `relation` | `inheritance`, `realization` (dashed), `composition`, `aggregation`, `association`, `dependency` (dashed) |

```json
{ "id": "places", "source": "customers", "target": "orders", "label": "places", "sourceEnd": "one", "targetEnd": "zero-or-many" },
{ "id": "is-a", "source": "entity", "target": "order", "relation": "inheritance" }
```

- `relation` puts triangles and diamonds on the **source** (the parent, interface or whole) and
  open arrows on the **target**. Point edges parent → child and whole → part, so the layout
  draws parents first; `sourceEnd` / `targetEnd` override either end.
- An edge with any notation drops the default arrowhead (and ignores `arrow`); an end without
  a marker is plain. Use `arrow` for plain flows and state transitions, notation for data models.
- Inheritance, realization, composition and aggregation need no label (the symbol says it);
  ER relationships still want a verb (`places`, `contains`). Markers fit in the straight stub at
  each port, and labels are kept clear of them.
- **Field rows**: `sourceField` / `targetField` name a field of the source / target card; the
  edge then attaches at that row, on the left or right side facing the other card (both on the
  right when the cards stand one above the other). Point foreign keys at the key they reference
  (`"sourceField": "id", "targetField": "customer_id"`); several edges from one key share its
  port. An unknown name is an error (`ref/edge-unknown-field`). Without them, edges attach to
  card sides.
- **End labels**: `sourceLabel` / `targetLabel` put short text beside each end, past its marker:
  multiplicities (`"1"`, `"0..*"`, `"1..*"`) or role names (`"owner"`), up to 16 characters. The
  Markdown export adds them to the Relationship column (`1 → 0..*`).
- **Self-relationships** (`employees.manager_id` → `employees.id`) are self-loops: with field
  names they join the two rows on the less busy left or right side, with their markers and the
  label beside the loop.

```json
{ "id": "places", "source": "customers", "target": "orders", "label": "places", "sourceEnd": "one", "targetEnd": "zero-or-many", "sourceField": "id", "targetField": "customer_id" },
{ "id": "lines", "source": "order", "target": "line", "relation": "composition", "label": "lines", "sourceLabel": "1", "targetLabel": "1..*" }
```

See `examples/ecommerce-schema.json` and `examples/payment-classes.json`.

## Languages and right to left

```json
"meta": { "title": "…", "lang": "ne" }
```

- `meta.lang` is the BCP 47 tag of the content (`es`, `pt-BR`, `ne`, `zh`, `ja`, `ar` …).
  It sets `<html lang>` (built HTML) and `xml:lang` (SVG), the number format of metrics,
  charts, counters and zoom (`Intl.NumberFormat`), and the language of every fixed label:
  toolbar, tooltips, walkthrough, inspector, help dialog, toasts, export menu, the badge,
  and the SVG and Markdown exports. Built-in tables: `en es fr de pt it hi bn ne zh zh-Hant
  ja ko id ar he fa ur`. A region tag uses its language (`pt-BR` → `pt`); Chinese uses
  Traditional (`zh-Hant`) for `zh-Hant*`, `zh-TW`, `zh-HK` and `zh-MO` (unless `Hans` is
  given) and Simplified otherwise. Any other language keeps English labels
  and the validator warns `i18n/unknown-lang`; the content still gets its `lang`.
- Write the payload text (titles, labels, steps) in that language yourself; Yantra only
  translates its own interface. Keyboard keys, Yantra and GitHub are never translated.
- `meta.strings` overrides labels by key, e.g. `{ "story.next": "Continue" }`; placeholders
  are written `{n}`, `{total}`, `{title}`, `{role}`, `{name}`. The keys are `STRING_KEYS` in
  `src/core/i18n.js` (listed below). `meta.inspector.labels` still renames the built-in tabs.
- **Plurals.** Counted words (`chart.day1` / `chart.days`, `chart.point1` / `chart.points`)
  are chosen with `Intl.PluralRules`: the CLDR category `one` uses the first key, anything
  else the second. A table or `meta.strings` may add `zero`, `two`, `few` or `many` forms
  as `<key>.<category>`, e.g. `"chart.days.two": "יומיים"`; Arabic and Hebrew ship them.
- **File size.** A built HTML file carries the English table plus only the tables its
  payload uses (its `meta.lang` and those of detail diagrams; an answer page: those of its
  interactive diagrams). The tables live in `src/core/locales/<lang>.js`; the dev viewer and
  gallery load them all.
- **Right to left.** `ar`, `he`, `fa`, `ur` (and `yi ps sd ckb dv ug`), or `meta.dir: "rtl"`,
  set `dir="rtl"`: the toolbar, walkthrough, step chips, inspector (docks left), legend and
  badge (bottom-left) mirror, arrow keys follow the reading direction, and the text inside
  cards, group titles, the SVG title, legend and badge are right-aligned.
  `meta.dir: "ltr"` forces left to right.
- **The diagram keeps its layout direction.** `LR` stays left to right in an RTL document:
  arrows, ranks, edge routes and sequence-view columns are the same as in any language, so
  one payload translated into Arabic has the same geometry, the validator checks the same
  scene, and technical flows read the way their source code and protocols are written. If a
  process should run right to left for its readers, reverse the order of the nodes yourself
  (e.g. with `rank`); a mirrored layout is not generated automatically.
- Text is measured per script: Han, kana and Hangul count as full width, Devanagari and
  Arabic letters have their own widths and combining marks count as zero, so cards are
  sized without clipping. Chinese and Japanese wrap between characters without spaces
  (no line starts with `、。」` or ends with `「`).
- **Budgets measure width.** `content/title-too-long` (42), `content/label-too-long` (28)
  and `page/headline-too-long` (220) count display columns, as terminals do: a full-width
  Han, kana or Hangul character counts 2, a combining mark (Devanagari vowel signs, Arabic
  harakat) 0, anything else 1. A 20-character Chinese title (40 columns) passes, a
  25-character one does not; for text without wide characters the count equals its length.
  The codes are unchanged; the message says "columns wide" when the two differ.
- **Validation messages in a language.** Codes and English messages are the interface for
  tooling. For people, `yantra validate file.json --lang ja` (or `--lang auto` for the
  payload's `meta.lang`; MCP `yantra_validate` takes `lang`; Python `validate(lang=...)`)
  translates the `content/`, `story/`, `ref/` and `i18n/` messages into any built-in
  language and keeps the English text in `messageEn`. Other messages (geometry, schema,
  pages) stay in English: they are rarer and name JSON fields and layout terms that read
  best as written in the schema.

| Code | Fix |
|---|---|
| `i18n/unknown-lang` (warning) | No built-in labels for that language: English labels are used. Translate them with `meta.strings`, or use a built-in language. |
| `i18n/bad-lang` (warning) | Use a BCP 47 tag such as `en`, `pt-BR`, `zh-Hans`. |
| `i18n/bad-dir` (warning) | `meta.dir` is `ltr` or `rtl`. |
| `i18n/unknown-string`, `i18n/bad-strings` (warnings) | Use a key from the list below, with a string value. |

Examples: `examples/health-referral-nepali.json`, `examples/order-fulfilment-arabic.json`.

<details><summary>String keys</summary>

<!-- string-keys:start -->
| Key | English |
|---|---|
| `app.untitled` | Untitled diagram |
| `app.examples` | Example diagram |
| `app.mode` | Mode |
| `app.view` | View |
| `view.flow` | Flow |
| `view.flowTip` | Flow: the system as a graph |
| `view.sequence` | Sequence |
| `view.sequenceTip` | Sequence: messages in time order |
| `view.flowToast` | Flow view |
| `view.sequenceToast` | Sequence view |
| `zoom.in` | Zoom in |
| `zoom.out` | Zoom out |
| `zoom.fit` | Fit to screen |
| `inspector.title` | Inspector |
| `inspector.toggle` | Toggle inspector |
| `inspector.sections` | Inspector sections |
| `inspector.close` | Close inspector |
| `theme.title` | Light / dark |
| `theme.toggle` | Toggle theme |
| `export.title` | Export |
| `export.png` | PNG image |
| `export.svg` | SVG vector |
| `export.html` | Standalone HTML |
| `export.md` | Markdown spec |
| `export.json` | Copy JSON with positions |
| `export.reset` | Reset layout |
| `export.diagram` | Diagram |
| `export.mdAll` | Markdown, all levels |
| `help.title` | Keyboard shortcuts |
| `help.close` | Close keyboard shortcuts |
| `help.next` | Next step |
| `help.prev` | Previous step |
| `help.play` | Play / pause |
| `help.ends` | First / last step |
| `help.follow` | Camera follows steps |
| `help.view` | Flow / sequence view |
| `help.scenario` | Switch scenario |
| `help.mode` | Next mode |
| `help.inspector` | Inspector |
| `help.legend` | Roles legend |
| `help.story` | Collapse walkthrough |
| `help.fit` | Fit to screen |
| `help.zoom` | Zoom |
| `help.theme` | Light / dark |
| `help.fullscreen` | Fullscreen |
| `help.clear` | Clear selection, then back up a level |
| `help.hint` | Drag cards to rearrange; edges re-route live. Scroll or pinch to zoom. |
| `help.drill` | Open the card's detail diagram |
| `help.fold` | Fold / unfold selected branch |
| `common.close` | Close |
| `canvas.label` | Diagram canvas |
| `legend.title` | Roles |
| `legend.label` | Roles legend |
| `legend.filter` | Filter by role |
| `legend.all` | All roles |
| `legend.showing` | Showing: {role} |
| `legend.labelShowing` | Roles legend, showing {role} |
| `story.label` | Walkthrough |
| `story.steps` | Steps |
| `story.scenario` | Scenario |
| `story.scenarioN` | Scenario {n} |
| `story.follow` | Camera follows each step |
| `story.followOff` | Camera stays where you put it |
| `story.present` | Present full screen |
| `story.collapse` | Collapse |
| `story.collapseLabel` | Collapse walkthrough |
| `story.expand` | Expand |
| `story.more` | Show more |
| `story.less` | Show less |
| `story.restart` | Back to the first step |
| `story.play` | Play |
| `story.pause` | Pause |
| `story.replay` | Replay |
| `story.autoplay` | Autoplay |
| `story.speed` | Autoplay speed |
| `story.back` | Back |
| `story.next` | Next |
| `story.prevStep` | Previous step |
| `story.nextStep` | Next step |
| `story.step` | Step {n} |
| `story.stepOf` | Step {n} of {total}: {title} |
| `story.empty` | No steps in this scenario |
| `tab.summary` | Summary |
| `tab.step` | Step |
| `tab.node` | Details |
| `summary.components` | Components |
| `summary.connections` | Connections |
| `summary.steps` | Steps |
| `summary.modes` | Modes |
| `summary.points` | Key points |
| `summary.facts` | Facts |
| `summary.roles` | Roles |
| `summary.scenarios` | Scenarios |
| `step.none` | This diagram has no walkthrough steps. |
| `step.payload` | Payload |
| `step.copy` | Copy |
| `node.none` | Select a card to see its details and connections. |
| `node.tech` | Technology |
| `node.runtime` | Runtime |
| `node.ports` | Ports |
| `node.status` | Status |
| `node.source` | Source |
| `node.connections` | Connections |
| `node.noConnections` | No connections. |
| `panel.for` | For {name} |
| `panel.showAll` | Show all cards |
| `panel.hint` | Select a card to see the items for that component. |
| `panel.empty` | Nothing recorded for this component. |
| `toast.payloadCopied` | Payload copied |
| `toast.jsonCopied` | JSON copied with current positions |
| `toast.layoutReset` | Layout reset |
| `toast.buildHint` | Run 'yantra build diagram.json' to produce a standalone file |
| `toast.pngFailed` | PNG export failed; exported SVG instead |
| `toast.noFullscreen` | Full screen is not available here |
| `watermark.text` | Made with Yantra |
| `watermark.title` | Yantra on GitHub |
| `watermark.label` | {text} – Yantra on GitHub (opens in a new tab) |
| `page.answer` | Answer |
| `page.question` | Question |
| `page.contents` | Contents |
| `page.updated` | Updated {date} |
| `page.theme` | Toggle light or dark theme |
| `page.recommended` | Recommended |
| `page.done` | Done: |
| `page.todo` | To do: |
| `page.diagram` | Diagram |
| `page.interactive` | {title} (interactive) |
| `page.diagramMissing` | Diagram missing. |
| `page.imageOmitted` | Image omitted: only https: and data:image/ sources are allowed. |
| `page.diagramNote` | Diagram: {title} |
| `page.seeHtml` | see the HTML page |
| `page.image` | Image: {alt} |
| `md.component` | Component |
| `md.role` | Role |
| `md.description` | Description |
| `md.groups` | Groups |
| `md.group` | Group |
| `md.inside` | Inside |
| `md.members` | Members |
| `md.groupSuffix` | {name} (group) |
| `md.from` | From |
| `md.to` | To |
| `md.label` | Label |
| `md.hides` | hides: {list} |
| `md.version` | Version {v} |
| `md.fields` | Fields |
| `md.methods` | Methods |
| `md.field` | Field |
| `md.method` | Method |
| `md.type` | Type |
| `md.returns` | Returns |
| `md.key` | Key |
| `md.visibility` | Visibility |
| `md.notes` | Notes |
| `md.nullable` | nullable |
| `md.static` | static |
| `md.abstract` | abstract |
| `md.direction` | Direction |
| `md.relationship` | Relationship |
| `md.both` | both ways |
| `md.undirected` | undirected |
| `md.selfLoop` | self-loop |
| `md.link` | link |
| `md.more` | More: {url} |
| `md.detail` | detail: {title} |
| `drill.crumbs` | Diagram levels |
| `drill.back` | Back to {title} |
| `drill.open` | Open detail: {title} |
| `drill.cardHint` | opens a detail diagram |
| `drill.opened` | Opened {title} |
| `drill.details` | Detail diagrams |
| `drill.link` | Open link |
| `drill.newTab` | (opens in a new tab) |
| `drill.edgeLink` | Open link for {label} |
| `drill.overview` | Overview |
| `drill.hasDetail` | Has a detail diagram |
| `card.more` | + {n} more |
| `vis.public` | public |
| `vis.private` | private |
| `vis.protected` | protected |
| `vis.package` | package |
| `end.one` | exactly one |
| `end.zero-or-one` | zero or one |
| `end.many` | many |
| `end.one-or-many` | one or more |
| `end.zero-or-many` | zero or more |
| `end.any` | any |
| `end.between` | {a} to {b} |
| `chart.total` | Total |
| `chart.today` | Today |
| `chart.day` | Day {n} |
| `chart.day1` | {n} day |
| `chart.days` | {n} days |
| `chart.trend` | trend |
| `chart.value` | Value |
| `chart.share` | Share |
| `chart.task` | Task |
| `chart.group` | Group |
| `chart.start` | Start |
| `chart.end` | End |
| `chart.after` | After |
| `chart.milestone` | Milestone |
| `chart.item` | Item |
| `chart.noData` | No data to chart. |
| `chart.series` | Series {n} |
| `chart.more` | +{n} more |
| `chart.topLeft` | Top left |
| `chart.topRight` | Top right |
| `chart.bottomLeft` | Bottom left |
| `chart.bottomRight` | Bottom right |
| `chart.kind.bar` | Bar chart |
| `chart.kind.column` | Column chart |
| `chart.kind.line` | Line chart |
| `chart.kind.area` | Area chart |
| `chart.kind.pie` | Pie chart |
| `chart.kind.donut` | Donut chart |
| `chart.kind.gantt` | Gantt chart |
| `chart.kind.matrix` | Matrix |
| `chart.kind.heat` | Heat map |
| `chart.kind.trend` | Trend |
| `chart.point1` | {n} point |
| `chart.points` | {n} points |
| `chart.seriesCount` | {n} series |
| `chart.summary` | {kind}, {points}; values in the table that follows. |
| `fold.expand` | Expand {title} ({n} hidden) |
| `fold.collapse` | Collapse {title} |
| `fold.folded` | Folded |
| `fold.expanded` | Expanded |
<!-- string-keys:end -->

</details>

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
| `schema/node-shape-invalid`, `schema/edge-arrow-invalid` | Use a listed `shape` (`card`, `state`, `initial`, `final`, `choice`, `fork`) or `arrow` (`forward`, `both`, `none`). |
| `story/fork-needs-branches` (warning) | A fork splits into two or more transitions and a join merges two or more: add the missing branch, or drop the bar. |
| `schema/group-kind-invalid` | `kind` on a group is `"region"` or absent. |
| `group/region-needs-parent` | A region divides a composite state: set its `parent` to that group. |
| `group/single-region`, `group/region-mixed` (warnings) | Give the composite state two or more regions and put all of its nodes inside them. |
| `story/initial-has-incoming`, `story/final-has-outgoing` (warnings) | Nothing enters an initial state or leaves a final one: retarget the edge at a real state. |
| `story/choice-needs-branches` (warning) | Give the choice two or more outgoing, labelled branches, or make it a state. |
| `story/edge-endpoint-dimmed` (warning) | Add the edge's source and target to that step's `highlightNodes`. |
| `story/no-steps` (warning) | Add a scenario with an overview step and 2+ focused steps. |
| `sequence/no-messages` (warning) | `meta.view` is `sequence` but no step lists `highlightEdges`: add them, or drop `meta.view`. |
| `schema/unknown-view` | `meta.view` must be `flow` or `sequence`; `meta.views` a non-empty list of them. |
| `sequence/not-offered` (warning) | `meta.view` names a view the payload does not offer (`meta.views`, or `sequence` on a diagram of only table / class cards): change one of them. |
| `schema/unknown-layout-algorithm`, `schema/layout-collapsed-invalid` | `meta.layout.algorithm` is `layered`, `tree` or `mindmap`; `collapsed` is an array of ids. |
| `ref/collapsed-unknown` | List only node or group ids in `meta.layout.collapsed`. |
| `layout/collapse-ignored` (warning) | Tree layouts fold cards that have children (not groups); the layered layout folds groups only. |
| `schema/layout-compact-invalid` | `meta.layout.compact` is `true`, `false` or `"auto"`. |
| `layout/compact-ignored` (warning) | Compact stacks apply to `tree` layouts with `direction: "TB"` only. |
| `layout/assistant-ignored` (warning) | `data.assistant: true` needs a tree layout and a leaf card with a manager. |
| `layout/tree-cross-link` (warning) | A node has a second parent: repeat the shared card or drop the edge. |
| `layout/groups-ignored` (warning) | Remove `groups` from a tree or mind map, or use the layered layout. |
| `layout/mindmap-roots` (warning) | Connect every branch to one central root. |
| `geometry/sequence-label-*` | Should not occur (gaps widen to fit); report it, and shorten the label meanwhile. |
| `schema/members-invalid` | `data.fields` / `data.methods` must be arrays of objects with a `name`; `stereotype` a string. |
| `ref/field-unknown-ref` | A field's `ref` must name a node (`"orders"`) or one of its fields (`"orders.id"`). |
| `schema/unknown-relation`, `schema/unknown-end` | Use a listed `relation` or `sourceEnd` / `targetEnd` value. |
| `ref/edge-unknown-field` | `sourceField` / `targetField` must name a field (`data.fields[].name`) of that end's card. |
| `schema/end-label-invalid`, `content/end-label-too-long` (warning) | `sourceLabel` / `targetLabel` are short strings (a multiplicity or role name, under 16 chars). |
| `geometry/end-label-overlap` (warning) | An end label touches a card or another label: widen the gap, or shorten the label. |
| `content/too-many-fields` (warning) | Over 12 rows on one card: keep the keys and the columns the story needs. |
| `content/duplicate-field` (warning) | Remove or rename the repeated field. |
| `drill/unknown-target` | `data.drill` must name a key of `diagrams` (ids are case-sensitive). |
| `drill/cycle` | Levels drill into each other (A > B > A), or `$ref` files load each other: remove one `data.drill` or ref so levels form a tree. |
| `drill/too-deep` | More than 3 levels below the overview: merge a level, or link the deepest one as a separate diagram (`url`). |
| `drill/ref-missing` | The `$ref` file is missing, unreadable or not valid JSON (or nothing loaded it: validate with the CLI or MCP). |
| `drill/ref-unsafe` | Use a relative `.json` path inside the input folder: no absolute paths, URLs or `..` that leaves it. |
| `drill/invalid-diagram`, `drill/diagrams-invalid`, `drill/duplicate-id` | `diagrams` is an object of diagram payloads (or `$ref`s) with ids unique across all levels. |
| `drill/unknown-start-level` | `meta.startLevel` must be a key of `diagrams`. |
| `drill/unused-diagram` (warning) | No card drills into this level (in any mode): add `data.drill` or remove it. |
| `drill/unknown-mode` (warning) | `data.modes.<id>.drill` names a mode the diagram does not have. |
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
