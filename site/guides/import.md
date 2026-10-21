---
description: Turn Mermaid, PlantUML, draw.io / diagrams.net and Visio files into Yantra diagrams or answer pages with yantra import, then review the warnings and add a walkthrough.
---

# Import from Mermaid, PlantUML, draw.io and Visio

Already have a diagram? `yantra import` converts it into a Yantra payload, validates it and
prints what it could not carry over. You then review it, tighten the labels and tell the
story with walkthrough steps.

## 1. Import a file

```bash
yantra import flow.mmd                    # Mermaid -> flow.json
yantra import login.puml                  # PlantUML
yantra import architecture.drawio         # draw.io / diagrams.net
yantra import diagram.drawio.png          # a draw.io PNG export with the diagram embedded
yantra import process.vsdx                # Visio 2013 or later
```

Each command writes the JSON next to the source (`-o other.json` picks the name), runs the
validator and exits with code 1 only if validation reports errors.

| Source | Becomes a diagram | Becomes an answer page |
|---|---|---|
| Mermaid (`.mmd`, or a fenced `mermaid` block in `.md`) | flowchart, sequence, state, ER, class, mind map, journey | gantt, pie, timeline, quadrant chart |
| PlantUML (`.puml`, or a fenced `plantuml` block in `.md`) | sequence, component, deployment, use case, activity, state, class, object, ER, mind map, WBS | Gantt |
| draw.io / diagrams.net (`.drawio`, `.xml`, `.drawio.svg`, `.drawio.png`) | shapes, colours, icons, containers and swimlanes as groups, edge labels, ER and UML ends | |
| Visio (`.vsdx`) | shapes, glued connectors, groups | |

## 2. Pick a page or a block

```bash
yantra import model.drawio --page 2          # one page of a multi-page file, by number
yantra import model.drawio --page "Payments" # ... or by name
yantra import model.drawio --all             # every page -> model-1.json, model-2.json, ...
yantra import notes.md                       # the first diagram block in a Markdown file
yantra import notes.md --all                 # every block
yantra import diagram.txt --from plantuml    # force the format
yantra import flow.mmd --title "Checkout"    # set the title
```

The format comes from the content or the extension: a zip is Visio, a PNG is draw.io,
`@startuml` is PlantUML, `<mxfile>` is draw.io, otherwise Mermaid. `--from` overrides it.

## 3. Review what came across

Importers are deliberately small and dependency-free, so they are best effort. Read the
warnings: they name each shape, arrow or option that was skipped or approximated. Then open
the result:

```bash
yantra build flow.json && yantra screenshot flow.json
```

Layout is Yantra's own, not the original's: positions from draw.io or Visio are not kept,
so a diagram that was hand-arranged may come out in a different order (usually tidier). If a
particular arrangement matters, set `meta.layout.direction` to `"LR"` or `"TB"`, or arrange
the cards in the viewer and use **Export > Copy JSON with positions** to save a manual
layout.

## 4. Add the story

An import generates a basic walkthrough. Make it tell the story you need:

- Give each step a title and a sentence of text.
- Highlight only the cards and edges involved in that step, and for every highlighted edge
  both of its endpoints.
- Use `type` roles (`client`, `service`, `data`...) with three to five colours.
- For a Mermaid or PlantUML sequence diagram, the result already uses
  `meta.view: "sequence"` with one message per step.

## 5. From an agent or code

- **MCP**: the `yantra_import` tool takes `text` or a `filePath` inside the server's input
  folder and returns the payload, the warnings and the validation report.
- **Python**: `yantra.import_diagram("model.drawio", page=2)` returns the payload as a dict.
- **JavaScript**: `importText()` from `src/core/import.js` runs in Node and in the browser.

Samples for every format are in [examples/](../../examples/): Mermaid, PlantUML (including a
Gantt chart and an `!include`), draw.io (plain, compressed, an ER schema, a PNG export) and
a Visio file. Every sample imports and validates with no warnings.

## Reference

- Mermaid, construct by construct: [Import: Mermaid](../../docs/mermaid.md).
- draw.io, PlantUML and Visio mappings and limitations:
  [Import: draw.io, PlantUML, Visio](../../docs/import.md).
