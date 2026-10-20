# Importing draw.io and PlantUML

Besides Mermaid ([`mermaid.md`](mermaid.md)), Yantra imports **draw.io / diagrams.net** files
and **PlantUML** sequence, component / deployment / use-case, activity, state and class
diagrams, mind maps and work breakdowns. Each
import produces a normal payload (roles, groups, a walkthrough) that you then review, label
and extend. The parsers are small and dependency-free (`src/core/drawio.js`,
`src/core/plantuml.js`, shared assembly in `src/core/importkit.js`); they run in Node and in
the browser. They are best effort, so read the warnings they print.

```bash
yantra import architecture.drawio              # -> architecture.json, then lint report
yantra import export.xml                       # uncompressed draw.io XML export
yantra import diagram.drawio.svg               # draw.io SVG with the embedded diagram
yantra import model.drawio --page 2            # pick a page by number ...
yantra import model.drawio --page "Payments"   # ... or by name
yantra import model.drawio --all               # every page -> model-1.json, model-2.json, ...
yantra import login.puml                       # PlantUML (.puml, .plantuml, .pu, .iuml, .wsd)
yantra import notes.md                         # first ```plantuml / ```puml (or ```mermaid) block
yantra import diagram.txt --from plantuml      # force the format: mermaid | drawio | plantuml
```

**Format detection.** `--from` wins; otherwise the extension (`.drawio`, `.dio`,
`.drawio.xml`, `.drawio.svg` → draw.io; `.puml` & co. → PlantUML; `.mmd` → Mermaid), then
the content (`<mxfile>` / `<mxGraphModel>` → draw.io, `@startuml` or a ```plantuml fence →
PlantUML), else Mermaid.

The command prints import warnings, writes the JSON, validates it and exits 1 only if
validation reports errors.

- **MCP**: `yantra_import` with `{ text | filePath, format?, page?, all?, title?, outputPath? }`
  returns `{ format, payload | outputPath, warnings, validation }` (with `all`:
  `{ format, results: [...] }`). `filePath` must be inside `YANTRA_INPUT_ROOT` and end with a
  known extension (`.mmd .md .drawio .dio .xml .svg .puml .plantuml .pu .iuml .wsd .txt`);
  `outputPath` must be a `.json` inside `YANTRA_OUTPUT_ROOT`. `yantra_import_mermaid` is kept
  for compatibility.
- **JavaScript**: `importText(text, { format?, filename?, title?, page?, all? })` from
  `src/core/import.js`, or `fromDrawio(text, { title, page })` / `fromPlantUml(text, { title })`.
- **Python**: `yantra.import_diagram("model.drawio", format=None, page=None, title=None)`
  returns the payload as a dict (runs the CLI, so Node.js >= 18 is needed).

Samples: `examples/drawio/*.drawio` (plain, compressed, and an ER schema) and
`examples/plantuml/*.puml`. Every sample imports and validates with no warnings.

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
| `childLayout=stackLayout` lists, `shape=table` (UML classes, ER tables) | one card; edges to rows land on the card. Rows that read as members become `data.fields` / `data.methods`: `+ name: Type`, `- run(x: int): void` (type `class`), `PK id uuid`, `email text` (type `table`; `PK` / `FK` / `UK` cells set the keys). Other rows stay text in the subtitle (type `card`, "Entity"). |
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
| page name | `meta.title` unless it is a default `Page-n` |

**Coordinates are ignored**; the only thing taken from the drawing is the direction: `LR`
when edges mostly run sideways, else `TB`. Ids come from labels (`Orders DB` → `orders-db`).
Colours, fonts, waypoints and images are not imported; roles colour nodes by type.

## PlantUML

The importer reads the first `@startuml ... @enduml` block (`--all` for every one) and picks
the kind from the content: class keywords (`class`, `abstract`, `enum`, `interface X {`) →
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
| `[-> A`, `A ->]` (found / lost), `<->`, `destroy`, `create`, `newpage`, `skinparam`, `!include` | skipped or drawn one way, one warning per kind |

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
`state X <<choice>>` a `choice`, other states `shape: "state"`; `state "Long name" as X`,
`state X : text` (subtitle), composite `state X { ... }` (groups), `--` / `||` regions, and
self-transitions (self-loops). `A -> B`, `A -down-> B`, `A -[#red]-> B` and `B <-- A` all
become `A --> B`; colours, `skinparam`, `hide` and `scale` are dropped with a warning.

### Class diagrams

Rewritten to Mermaid `classDiagram` and converted by the Mermaid class importer: class cards
with `data.fields` and `data.methods` (visibility, types, parameters), `interface`,
`abstract` and `enum` as stereotypes (`<<interface>>` etc.), `package X { }` as groups,
relations `<|--` (inheritance), `<|..` (realization), `*--` (composition), `o--`
(aggregation), `-->` (association), `..>` (dependency). Direction hints (`-up-|>`) and
`{static}` / `{abstract}` modifiers are dropped; notes are ignored with a warning.
Multiplicities (`"1" *-- "many"`) go into the label or the walkthrough text.

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
| `fork` / `fork again` / `end fork` (also `split`) | parallel branches from the same node, joined after |
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

- draw.io: no images, colours per node, waypoints or rotated labels; a page with many
  shapes imports but may exceed the 14-node / 20-edge budget (split it, see
  `docs/authoring.md`). Layers are flattened. Non-mxGraph files (Visio, PNG with embedded
  XML) are not read; export them as `.drawio` or uncompressed XML first.
- PlantUML: object, ER (`entity`), Gantt, JSON / YAML and other `@start...` kinds are
  rejected with an error. The preprocessor (`!include`, `!define`, macros) is not run.
  Old-style activity syntax (`(*) --> "Action"`) is not supported.
- Identifiers containing `-` must be quoted or aliased in PlantUML (as in PlantUML itself).
- Imports are a starting point: tighten labels, add `description`s and a better
  walkthrough before sharing.
