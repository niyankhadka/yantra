# Importing draw.io, PlantUML and Visio

Besides Mermaid ([`mermaid.md`](mermaid.md)), Yantra imports **draw.io / diagrams.net** files
(also PNG exports with the diagram embedded), **Visio** `.vsdx` files and **PlantUML**
sequence, component / deployment / use-case, activity (new and old syntax), state, class,
object and entity-relationship diagrams, mind maps, work breakdowns and Gantt charts. Each
import produces a normal payload (roles, groups, a walkthrough) that you then review, label
and extend. The parsers are small and dependency-free (`src/core/drawio.js`,
`src/core/visio.js`, `src/core/plantuml.js`, chart pages in `src/core/importcharts.js`, shared
assembly in `src/core/importkit.js`); they run in Node and in the browser. They are best effort, so read the warnings they print.

```bash
yantra import architecture.drawio              # -> architecture.json, then lint report
yantra import export.xml                       # uncompressed draw.io XML export
yantra import diagram.drawio.svg               # draw.io SVG with the embedded diagram
yantra import diagram.drawio.png               # draw.io PNG export with the diagram embedded
yantra import process.vsdx                     # Visio (2013+): shapes and glued connectors
yantra import model.drawio --page 2            # pick a page by number ...
yantra import model.drawio --page "Payments"   # ... or by name
yantra import model.drawio --all               # every page -> model-1.json, model-2.json, ...
yantra import login.puml                       # PlantUML (.puml, .plantuml, .pu, .iuml, .wsd)
yantra import notes.md                         # first ```plantuml / ```puml (or ```mermaid) block
yantra import diagram.txt --from plantuml      # force the format: mermaid | drawio | plantuml | visio
```

**Format detection.** A zip archive is Visio and a PNG is draw.io, whatever the name; then
`--from` wins; otherwise the extension (`.vsdx` → Visio; `.drawio`, `.dio`, `.drawio.xml`,
`.drawio.svg`, `.drawio.png` → draw.io; `.puml` & co. → PlantUML; `.mmd` → Mermaid), then
the content (`<mxfile>` / `<mxGraphModel>` → draw.io, `@startuml` / `@startgantt` or a
```plantuml fence → PlantUML), else Mermaid. Chart-like sources (Mermaid gantt / pie /
timeline / quadrantChart, PlantUML `@startgantt`) become answer pages (`"kind": "page"`).

The command prints import warnings, writes the JSON, validates it and exits 1 only if
validation reports errors.

- **MCP**: `yantra_import` with `{ text | filePath, format?, page?, all?, title?, outputPath? }`
  returns `{ format, payload | outputPath, warnings, validation }` (with `all`:
  `{ format, results: [...] }`). `filePath` must be inside `YANTRA_INPUT_ROOT` and end with a
  known extension (`.mmd .md .drawio .dio .xml .svg .png .vsdx .puml .plantuml .pu .iuml .wsd .txt`);
  PlantUML `!include` is resolved inside `YANTRA_INPUT_ROOT` only;
  `outputPath` must be a `.json` inside `YANTRA_OUTPUT_ROOT`. `yantra_import_mermaid` is kept
  for compatibility.
- **JavaScript**: `importText(textOrBytes, { format?, filename?, title?, page?, all?, include?, path? })`
  from `src/core/import.js` (bytes: a `.vsdx`, a PNG, or UTF-8 text; `include(target, fromPath)`
  resolves PlantUML includes, see `lib/includes.js` for the Node one), or
  `fromDrawio(text, { title, page })` / `fromPlantUml(text, { title, include?, path? })` /
  `fromVisio(bytes, { title, page })`.
- **Python**: `yantra.import_diagram("model.drawio", format=None, page=None, title=None)` (also `.vsdx`, `.drawio.png`)
  returns the payload as a dict (runs the CLI, so Node.js >= 18 is needed).

Samples: `examples/drawio/` (plain, compressed, an ER schema, `payment-services.drawio` with
fill colours and cloud icons, `support-triage.drawio.png`), `examples/visio/order-approval.vsdx`
and `examples/plantuml/` (including `shop-entities.puml`, `order-objects.puml`,
`launch-plan.puml` (Gantt), `legacy-approval.puml` (old activity syntax) and
`shared-services.puml`, which includes `shared/styles.iuml`). Every sample imports and
validates with no warnings.

## draw.io / diagrams.net

| draw.io | Yantra |
|---|---|
| `<mxfile>` with several `<diagram>` pages | first page, with a warning listing the others; `--page n\|name` or `--all` |
| compressed page (base64 + raw deflate + URI encoding) | inflated in pure JavaScript (no zlib needed) |
| bare `<mxGraphModel>` (XML export), `.drawio.svg` (`content` attribute) | read the same way |
| vertex | node; title = first label line, subtitle = the rest |
| `html=1` labels (`<b>`, `<br>`, `<div>`, entities) | plain text; `<br>` / blocks become line breaks |
| `<UserObject label tooltip>` / `<object>` | node; the tooltip becomes `data.description` |
| `shape=cylinder*`, `datastore`, database / storage / S3 / DynamoDB / RDS icons | type `store`, icon `database` |
| `rhombus`, `*.decision` | type `decision` |
| `ellipse`, `doubleEllipse`, `*.terminator`, `*.start_*` | type `terminal` |
| `shape=umlActor`, actor / person / user icons | type `actor`, icon `user` |
| `parallelogram`, `*.manualInput`, `*.data`, `document`, `card` | type `io` |
| any other shape | type `node` ("Step") |
| `swimlane`, `container=1`, `group`, `pool` with a label, or any shape with children | `groups[]`, nested via `parent`; colour from `fillColor` / `swimlaneFillColor` |
| unlabelled container (`group` style) | transparent: its children join the enclosing group |
| `childLayout=stackLayout` lists, `shape=table` (UML classes, ER tables) | one card; an edge drawn to a field row keeps that row (`sourceField` / `targetField`), other edges land on the card. Rows that read as members become `data.fields` / `data.methods`: `+ name: Type`, `- run(x: int): void` (type `class`), `PK id uuid`, `email text` (type `table`; `PK` / `FK` / `UK` cells set the keys). Other rows stay text in the subtitle (type `card`, "Entity"). |
| edge | edge with the cell value as label |
| edge label cells (`edgeLabel` vertices parented to the edge) | appended to the edge label |
| `dashed=1` | `style: "dashed"` |
| `startArrow` and `endArrow` both set | `arrow: "both"`; `endArrow=none` without a start head: `arrow: "none"`; a start head only: drawn reversed |
| `ERone`, `ERmandOne`, `ERmany`, `ERzeroToOne`, `ERoneToMany`, `ERzeroToMany` | `sourceEnd` / `targetEnd` (`one`, `many`, `zero-or-one`, `one-or-many`, `zero-or-many`) |
| `endArrow=block;endFill=0` (dashed: realization) | `relation: "inheritance"` / `"realization"`, swapped so the triangle sits on the parent (the Yantra source) |
| `diamond` / `diamondThin` heads (`Fill=0`: aggregation) | `relation: "composition"` / `"aggregation"` with the whole as the source |
| dashed `endArrow=open` | `relation: "dependency"` |
| edge to a container | attached to the container's first node (warning) |
| free-standing `text` cells, unlabelled unconnected shapes | dropped (one warning each kind) |
| edges with a missing end | dropped (warning) |
| self-loops | kept (drawn as a loop on the card) |
| `fillColor` (else `strokeColor`) | the role colour, by nearest hue (blue, teal, green, amber for yellow, rose for red, violet for purple, orange, slate for grey); white, black and `none` are no colour. A type drawn in one colour gets it; a type drawn in several keeps the commonest and splits the rest into roles such as `node-rose` "Step (red)" |
| image shapes (`shape=image`, `image=...`, AWS / Azure / GCP / Kubernetes / Cisco icon sets, `resIcon`, `prIcon`) | `data.icon` when the shape, resource or file name maps to a built-in icon (`lambda` → `zap`, `dynamodb` / `sql` → `database` and type `store`, `ec2` → `server`, `sqs` → `layers`, `ses` / `email` → `mail`, `user` → `user` ...); an unlabelled image takes its name as the title. Other images (data URIs, logos) keep their label and are reported in one warning |
| a thin filled black bar (or a `line` shape with `strokeWidth` ≥ 3), unlabelled | a fork / join bar (`shape: "fork"`): "Fork" when more edges leave it than enter |
| PNG export (`zTXt` / `tEXt` / `iTXt` chunk with the `mxfile` keyword) | read like the `.drawio` file inside |
| page name | `meta.title` unless it is a default `Page-n` |

**Coordinates are ignored**; the only thing taken from the drawing is the direction: `LR`
when edges mostly run sideways, else `TB`. Ids come from labels (`Orders DB` → `orders-db`).
**Waypoints are ignored by design**: layout and routing are automatic, so hand-placed bends
would fight the router. Fonts and per-node styles other than colour are not imported.

## Visio (.vsdx)

A `.vsdx` file is a zip of XML parts; Yantra reads it with its own small unzip and inflater
(no dependencies). The older binary `.vsd` format is not supported: save as `.vsdx`, or
export to draw.io and import the `.drawio` file.

| Visio | Yantra |
|---|---|
| pages (`visio/pages/pages.xml`, background pages skipped) | first page, with a warning listing the others; `--page n\|name` or `--all` |
| a shape with text | node; type from its master name: Decision → `decision`, Start/End / Terminator → `terminal`, Database / Data store → `store`, Document / Data → `io`, Actor / Person → `actor`, else `node` |
| a connector glued at both ends (`<Connect>` `BeginX` / `EndX`) | edge with the connector text as label; `BeginArrow` / `EndArrow` give the direction (`arrow: "both"` / `"none"`), `LinePattern` > 1 is dashed |
| a group whose parts carry text | `groups[]` titled by the group text (an untitled group is transparent); a group whose parts have no text is one shape |
| `FillForegnd` (else `LineColor`) on a shape or group, `#rrggbb` or a legacy index 0-7 | role colour as for draw.io fills: a type drawn in several colours splits into `<type>-<hue>` roles ("Step (red)"); white, black, `FillPattern` / `LinePattern` 0 and colours inherited from masters or themes are not read |
| shapes without text or connections, unglued connectors | dropped (one warning each kind) |
| page name | `meta.title` unless it is a default `Page-n` |

Positions only hint the direction (`LR` when connectors mostly run sideways). Themes, layers,
comments and data graphics are not read; colours only as in the table above.

## PlantUML

The importer reads the first `@startuml ... @enduml` block (`--all` for every one) and picks
the kind from the content: `(*)` → old-style activity; `entity X {` blocks or crow's-foot
links (`||--o{`) → entity-relationship; `object` / `map` → object; class keywords (`class`, `abstract`, `enum`, `interface X {`) →
class; `[*]` or `state` → state; activity syntax (`start`, `:action;`, `if (...) then`, swimlanes)
→ activity; component / use-case syntax (`[A]`, `(Use case)`, `component`, `package {`,
`left to right direction`) without sequence-only keywords → component; anything else →
sequence, as in PlantUML itself. Comments (`'`, `/' ... '/`) are dropped; `title` becomes
`meta.title`; creole (`**bold**`, `//italic//`), `\n`, `<b>`-style tags and `<<stereotypes>>`
are cleaned.

### Sequence diagrams (`meta.view: "sequence"`)

| PlantUML | Yantra |
|---|---|
| `participant`, `boundary`, `control`, `entity` | node, type `service` ("Participant"); `store` when the name says db/cache/queue |
| `actor` | type `actor`, icon `user` |
| `database`, `collections`, `queue` | type `store`, icon `database` |
| `participant "Long name" as A`, `participant A as "Long name"` | id `A`, title "Long name" |
| `A -> B : text` (`->`, `->>`, `-\\`, `->x`, `->o`, `-[#red]>`) | one edge per ordered pair, labelled with the first message; each message is a step |
| `A --> B` (dashed) | `style: "dashed"`, described as a reply |
| `B <- A`, `B <-- A` | drawn A → B |
| `A ->> B ++ : x`, `activate`, `deactivate`, `autonumber` | activation markers ignored |
| `return text` | a reply from the last callee to its caller |
| `alt/else`, `opt`, `loop`, `par`, `break`, `critical`, `group` ... `end` | noted in each enclosed step |
| `note ... : text`, multi-line `note ... end note`, `ref over` | appended to the previous step (before any message: the overview) |
| `== Section ==` | noted on the next step |
| `box "Title"` ... `end box` | `groups[]` |
| `A <-> B`, `A <--> B` | `arrow: "both"` (dashed for `<-->`); the step reads `A ↔ B` |
| `[-> A`, `A ->]` (found / lost), `destroy`, `create`, `newpage`, `skinparam` | skipped, one warning per kind |

### Component, deployment and use-case diagrams

| PlantUML | Yantra |
|---|---|
| `[Name]`, `component`, `node`, `rectangle`, `cloud`, `artifact`, `file`, `card`, ... | type `component` |
| `(Use case)`, `usecase` | type `usecase` ("Use case") |
| `actor`, `:Name:`, `person` | type `actor` |
| `database`, `storage`, `collections` | type `store` |
| `queue` | type `event` |
| `interface`, `() Name`, `circle` | type `interface` |
| `X as Alias`, `"Name" as Alias`, `Alias as "Name"` | id from the alias, title from the name |
| `A --> B : label`, `A ..> B` (dashed), `A -- B`, `A <|-- B`, `A *-- B`, `A -left-> B` | edge (direction hints ignored, `<--` reversed) |
| `package`, `node`, `rectangle`, `frame`, `folder`, `cloud`, `database` ... `{ ... }` | `groups[]`, nested via `parent` (more than 3 levels are merged) |
| edge to a group | attached to its first element (warning) |
| `left to right direction` | `meta.layout.direction: "LR"` (default `TB`) |
| `together {`, notes, `skinparam`, `hide` / `show` | ignored, one warning per kind |

### State diagrams

Rewritten to Mermaid `stateDiagram-v2` and converted by the Mermaid state importer
(see [`mermaid.md`](mermaid.md)): `[*]` start and end become `initial` / `final` shapes,
`state X <<choice>>` a `choice`, `<<fork>>` / `<<join>>` a fork / join bar (`shape: "fork"`),
other states `shape: "state"`; `state "Long name" as X`, `state X : text` (subtitle),
composite `state X { ... }` (groups), `--` / `||` concurrent regions (child groups with
`"kind": "region"`), and self-transitions (self-loops). `A -> B`, `A -down-> B`, `A -[#red]-> B` and `B <-- A` all
become `A --> B`; colours, `skinparam`, `hide` and `scale` are dropped with a warning.

### Class diagrams

Rewritten to Mermaid `classDiagram` and converted by the Mermaid class importer: class cards
with `data.fields` and `data.methods` (visibility, types, parameters), `interface`,
`abstract` and `enum` as stereotypes (`<<interface>>` etc.), `package X { }` as groups,
relations `<|--` (inheritance), `<|..` (realization), `*--` (composition), `o--`
(aggregation), `-->` (association), `..>` (dependency). Direction hints (`-up-|>`) and
`{static}` / `{abstract}` modifiers are dropped; notes are ignored with a warning.
Multiplicities (`"1" *-- "many"`) become end labels (`sourceLabel` / `targetLabel`); lollipops
(`A ()-- B`) are realizations of the interface `A`; self-relationships are loops.

### Object diagrams

| PlantUML | Yantra |
|---|---|
| `object Name`, `object "alice : User" as alice { ... }` | a table card (type `object`, "Object"); title from the name |
| `name = "Alice"`, `age : 30` (in the block or `alice : age = 30`) | `fields: [{ name, type }]` with the value in the type column |
| `map Prices { tea => 3.50 }` | a card of type `map` ("Map"), one row per entry |
| `owner *-> alice` inside a map | a row plus an edge labelled `owner` to `alice` |
| `A --> B : label`, `A -- B`, `A <--> B`, `A ..> B` | edges (arrow forward / none / both, dashed) |
| `A *-- B`, `A o-- B`, `A <\|-- B` (either way round) | `relation: "composition"` / `"aggregation"` / `"inheritance"` from the whole / parent |
| `package` / `rectangle` ... `{ }` | `groups[]` |

### Entity-relationship diagrams

Rewritten to a Mermaid `erDiagram` and converted by the Mermaid ER importer.

| PlantUML | Yantra |
|---|---|
| `entity "Customer" as c { ... }`, `entity Order { ... }` | entity card (type `entity`), title from the name |
| `*id : int <<generated>>` above a `--` (or `==`, `..`, `__`) separator | `{ name, type, pk: true, note: "generated" }`: attributes above the separator form the primary key |
| `<<PK>>`, `<<FK>>`, `<<UK>>` / `<<unique>>` | `pk`, `fk`, `unique`; other stereotypes become the `note`; an attribute without a type has none |
| `c \|\|--o{ Order : places`, `A }\|..\|\| B` | `sourceEnd` / `targetEnd` crow's feet (`o\|` and `\|o` read the same on either side); dotted lines are dashed |
| `<entity>_id` foreign keys | key-row attachment (`sourceField` / `targetField`), as for Mermaid ER |
| links without a symbol at both ends, `-[hidden]-` | skipped (one warning) |
| `hide circle`, `skinparam`, notes | ignored, one warning per kind |

### Gantt charts (`@startgantt`)

A Gantt chart becomes an answer page with a `gantt` block (see [`pages.md`](pages.md)); the
headline gives the span of the plan and the last task.

| PlantUML | Yantra |
|---|---|
| `Project starts 2026-10-05` | tasks with no start and no dependency start on that day (else day 0) |
| `[Task] lasts 5 days` / `requires 2 weeks` | `days: 5` / `14` |
| `[B] starts at [A]'s end`, `[A] -> [B]`, `then [B] ...` | `after: "a"` |
| `[T] starts 2026-10-12`, `[T] ends 2026-10-16` | `start` / `end` (the last day) |
| `[M] happens at [T]'s end` / `happens 2026-11-01` | `milestone: true` |
| `[T] is 60% completed` | `progress: 60` |
| `-- Section --` | `group` of the tasks below |
| `[A] as [B]`, `... and ...` clauses | aliases; several statements on one line |
| `today is 2026-10-20` | `today` |
| `saturday are closed` and `sunday are closed` | `workdays: true`: durations and dependencies count working days |
| `2026-12-25 is closed`, `2026-12-24 to 2026-12-26 is closed` | `holidays` (with closed weekends; otherwise a warning and they stay working days) |
| other closed weekdays (`friday are closed`), `... is open`, colours, resources (`on {Alice}`), lags (`3 days after`), scales | ignored, one warning per kind |

### Activity diagrams (old syntax)

| PlantUML | Yantra |
|---|---|
| `(*) --> "First step"` | a "Start" terminal; `--> (*)` the shared "End" |
| `"Long text" as A1`, then `A1` | node titled "Long text" |
| `A --> B`, `-->[label] B` (from the last step), `-down->`, `-[#red]->` | edges; direction hints and colours are dropped |
| `if "cond" then` ... `else` ... `endif` | a `decision`; branch labels come from `-->[yes]`; the branches meet at the next arrow |
| `===B1===` | a node "Synchronise" (or the bar's name) |
| `partition Name { }` | `groups[]` |

### Preprocessor

A safe subset runs before parsing (`src/core/plantuml.js`, `preprocessPlantUml`):

| PlantUML | Yantra |
|---|---|
| `!include file.iuml`, `!include_once`, `!include_many`, `!includesub file!PART` | the file's `@startuml` body (or its `!startsub PART` block) is inserted. Paths are relative to the including file and must stay inside the input root (the folder of the imported file for the CLI, `YANTRA_INPUT_ROOT` for MCP); only `.puml .plantuml .pu .iuml .wsd .txt .inc` files up to 1 MB; cycles are skipped; nesting stops at 8 levels. Text imports with no file (MCP `text`, the browser) skip includes with a warning |
| `!includeurl`, `!include https://...`, `!include <C4/...>` | never fetched (one warning) |
| `!define NAME value`, `!undef NAME` | whole-word substitution |
| `!$var = "value"`, `!$var ?= value`, `!global` / `!local` | `$var` substitution |
| `!define F(x) ...`, `!procedure` / `!function` ... `!end...`, `!if` / `!ifdef`, `!theme`, `!pragma` | not run (one warning per kind); bodies of procedures are dropped, both branches of an `!if` are kept |

### Mind maps and work breakdowns

`@startmindmap` and `@startwbs` outlines (`*`, `**`, ...; `+` / `-` sides; `_` boxless
items; `:multi-line;` items keep their first line) are converted through the Mermaid mind-map
importer: a mind map uses `meta.layout.algorithm: "mindmap"`, a WBS `"tree"` (top to bottom).
Colours and styles are dropped.

### Activity diagrams (new syntax)

| PlantUML | Yantra |
|---|---|
| `start` | type `terminal` "Start" |
| `stop`, `end` | one shared `terminal` "End" |
| `kill`, `detach` | end of the branch, no node |
| `:action;` (also multi-line, and `|`, `<`, `>`, `/`, `]`, `}` endings) | type `node` ("Step") |
| `if (cond) then (yes)` / `elseif` / `else (no)` / `endif` | `decision` node, branch edges labelled (default `yes` / `no`), branches merge after `endif` |
| `switch (x)` / `case (a)` / `endswitch` | `decision` with one labelled edge per case |
| `while (cond) is (yes)` ... `endwhile (no)` | `decision` with a `repeat` back edge |
| `repeat` ... `repeat while (cond) is (yes) not (no)` | `decision` with a back edge to the first action |
| `fork` / `fork again` / `end fork` | a "Fork" bar the branches leave from and a "Join" bar they meet at (`shape: "fork"`) |
| `split` / `split again` / `end split` | parallel branches from the same node, merged after |
| `-> label;` | label of the next transition |
| `|Lane|`, `partition Name {` ... `}`, `group` ... `end group` | `groups[]` (partitions nest in the current lane) |
| notes, `backward`, connectors / `goto` | ignored, one warning per kind |

Activity arrows are rarely labelled, so unlabelled transitions are named `then` (sequential),
`otherwise` (from a decision) or `done` (into End), with one import warning; replace them
with `-> label;` in PlantUML or in the JSON for a better walkthrough.

## Walkthrough

Flow imports get the same walkthrough as Mermaid flowcharts: an overview, then one step per
node in topological order (bucketed by rank above seven nodes), each lighting the node, its
incoming edges and their sources; decisions list their branches. Sequence imports get an
overview plus one step per message.

## Limitations

- draw.io: waypoints (by design), fonts and rotated labels are not imported; images become
  icons only when their name matches a built-in one. A page with many shapes imports but may
  exceed the 14-node / 20-edge budget (split it, see `docs/authoring.md`). Layers are flattened.
- Visio: `.vsdx` only (not `.vsd`, `.vsdm` macros are ignored); ZIP64 archives are not read;
  connectors must be glued to shapes at both ends.
- PlantUML: JSON / YAML / salt / timing / network and other `@start...` kinds are rejected with
  an error. Preprocessor conditions, functions and macros with arguments are not evaluated.
- Identifiers containing `-` must be quoted or aliased in PlantUML (as in PlantUML itself).
- Imports are a starting point: tighten labels, add `description`s and a better
  walkthrough before sharing.
