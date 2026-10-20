# Importing Mermaid

Yantra can turn a Mermaid **flowchart** (`graph` / `flowchart`), **sequence diagram**
(`sequenceDiagram`) or **state diagram** (`stateDiagram` / `stateDiagram-v2`) into a diagram
payload with roles, groups and a walkthrough. The
parser is small and dependency-free (`src/core/mermaid.js`); it is not a full Mermaid
implementation, so check the warnings it prints.

```bash
yantra import flow.mmd                      # -> flow.json, then lint report
yantra import notes.md -o diagram.json      # first ```mermaid block in a Markdown file
yantra import notes.md --all                # every block -> notes-1.json, notes-2.json, ...
yantra import flow.mmd --title "Checkout"   # override the title
```

The command prints import warnings, writes the JSON, runs the validator and exits 1 only
if validation reports errors. From MCP, call `yantra_import_mermaid` with
`{ mermaid, title?, outputPath? }`; it returns `{ payload | outputPath, warnings, validation }`.
From JavaScript: `fromMermaid(text, { title }) -> { payload, warnings }`.

Samples: `examples/mermaid/*.mmd`.

## Flowcharts

| Mermaid | Yantra |
|---|---|
| `graph TD` / `TB` / `BT` | `meta.layout.direction: "TB"` (BT warns: not reversed) |
| `graph LR` / `RL` | `"LR"` (RL warns: not reversed) |
| `A[text]`, `A(text)`, `A[[text]]`, `A{{text}}` | node, type `node` (role "Step") |
| `A([text])`, `A((text))`, `A(((text)))` | type `terminal` ("Start / end") |
| `A[(text)]` | type `store`, icon `database` |
| `A{text}` | type `decision` |
| `A>text]` | type `event` |
| `A[/text/]`, `A[\text\]`, `A[/text\]`, `A[\text/]` | type `io` ("Input / output") |
| `A["quoted"]`, `<br>`, `**md**`, `fa:fa-x`, `#quot;` | cleaned; first line becomes the title, later lines the subtitle |
| `A --> B`, `A --o B`, `A --x B` | edge, arrow at the target (circle/cross heads warn: drawn as arrows) |
| `A --- B`, `A -.- B`, `A === B`, `A -- text --- B` | edge with `arrow: "none"` (undirected) |
| `A <--> B`, `A o--o B`, `A x--x B` | edge with `arrow: "both"` |
| `A --> A` | self-loop, drawn as a loop on the card |
| `A -.-> B`, `A -. text .-> B` | edge with `style: "dashed"` |
| `A ==> B`, `A == text ==> B` | edge with `style: "solid"` |
| `A -->\|text\| B`, `A -- text --> B` | edge `label` |
| `A --> B --> C` | one edge per link |
| `A & B --> C & D` | every source to every target |
| `subgraph id [Title]`, `subgraph Title`, `subgraph "Title"` ... `end` | `groups[]` (`{ id, title, nodes, parent? }`), nested via `parent` |
| edge to a subgraph id | attached to the subgraph's first node (warning) |
| `classDef name fill:#hex`, `class A,B name`, `A:::name` | node `type: name`; role colour from the fill (nearest hue), else an unused hue |
| `%% comment`, `%%{init}%%`, `---` front matter | dropped; front-matter `title:` becomes `meta.title` |
| `style`, `linkStyle`, `click`, `direction`, `~~~` | ignored with one warning per kind |

**Ids.** Mermaid ids are kept when they are plain (`[A-Za-z0-9_-]`); other characters become
`-` and collisions get `-2`, `-3`. Edge ids are `source-target` (`-2` for repeats).

**Roles.** One role per type with a label (`Step`, `Decision`, `Data store`, `Start / end`,
`Input / output`, `Event`, or the class name humanised). Class roles take colours first;
shape roles keep their usual hue (blue, amber, violet, teal, green, orange) unless taken.

**Walkthrough.** An overview step, then one step per node in topological order (declaration
order breaks ties and cycles). With more than seven nodes, nodes are bucketed by rank so the
walkthrough stays at eight steps or fewer. Each step lights its nodes, their incoming edges
and the sources of those edges; decisions list their branches.

**Text budgets.** Titles over 42 characters are shortened (full text in `description`), edge
labels over 28 characters are shortened. Unlabelled edges are reported once; label them in
Mermaid (`-->|what flows|`) to keep the validator quiet.

## Sequence diagrams

| Mermaid | Yantra |
|---|---|
| `participant A as Label` | node, type `service` ("Participant"); `store` with a database icon when the name says db/database/store/cache/queue |
| `actor U as User` | node, type `actor`, icon `user` |
| participants first used in a message | created on first use |
| `A->>B: text` (`->`, `-->`, `-->>`, `-x`, `--x`, `-)`, `--)`) | one edge per ordered pair, labelled with the first message; `--` arrows are dashed |
| every message | a step: title = message text, lights both participants and the edge |
| `A->>A: text` (self) | a step lighting `A`; no edge is drawn |
| `Note over/left of/right of X: text` | appended to the previous step's description (before any message: the overview) |
| `alt/else`, `opt`, `loop`, `par/and`, `critical/option`, `break` ... `end` | noted in each enclosed step, e.g. `Inside loop "every second".` |
| `box Title` ... `end` | `groups[]` |
| `title X`, `autonumber`, `activate`, `deactivate`, `rect` | title used; the rest ignored |

The scenario starts with an overview step and keeps every message as its own step.

## State diagrams

| Mermaid | Yantra |
|---|---|
| `stateDiagram`, `stateDiagram-v2` | `meta.layout.direction: "TB"`; `direction LR` at the top level gives `"LR"` |
| `A`, `state A`, `state "Long name" as A` | node, type `state` ("State"), `shape: "state"` |
| `A : text` | subtitle (descriptions over 60 characters go to `description`) |
| `[*] --> A` | an initial pseudo-state (`shape: "initial"`, id `start`), type `terminal` |
| `A --> [*]` | a final pseudo-state (`shape: "final"`, id `end`), one per scope |
| `A --> B : event`, `A --> A : event` | transition with `label`; a self-loop is kept |
| `state X <<choice>>` | `shape: "choice"`, type `choice` ("Choice") |
| `state X <<fork>>` / `<<join>>` | a plain state (warning) |
| `state C { ... }` | group `C` (nested composites get `parent`); its own `[*]` become `C-start` / `C-end` |
| transition to / from a composite | attached to its entry state (target of its `[*]`) / exit state (source into its `[*]`), with a warning |
| `note left of / right of X : text`, `note ... end note` | ignored, with one warning counting the notes |
| `--` (concurrent regions), `classDef`, `class`, `:::`, `style`, `scale`, `hide`, `direction` inside a composite | ignored with one warning per kind |

The walkthrough is built as for flowcharts (overview, then states in topological order);
self-loops are mentioned on their state's step. Transitions out of a start or into an end
need no label; the validator does not ask for one.

## Limitations

- Only flowcharts, sequence diagrams and state diagrams; other types (`classDiagram`, `erDiagram`, ...) are rejected with an error.
- Circle and cross heads (`--o`, `--x`, `o--o`) are drawn as plain arrows.
- State diagrams: notes, concurrent regions (`--`) and fork/join bars are not drawn; composite states are groups, so a transition to the composite itself lands on its entry state.
- Mermaid styling (`style`, `linkStyle`, colours other than `classDef` fill) and interactions (`click`) are dropped.
- Per-subgraph `direction` is ignored (layout is automatic).
- Node ids with hyphens before `-`, `.`, `o` or `x` (e.g. `a--ob`) can be ambiguous; add spaces around links.
- Groups are emitted in the payload; how they are drawn depends on the viewer version.
- Larger graphs import but may exceed the 14-node / 20-edge budget; split them as described in `docs/authoring.md`.
