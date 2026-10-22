<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/niyankhadka/yantra/main/src/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/src/assets/logo-light.svg" alt="Yantra logo" width="96" height="96">
  </picture>
</p>

<h1 align="center">Yantra</h1>

<p align="center">
  <strong>Interactive, step-by-step diagrams and one-page answers, shipped as one offline HTML file.</strong>
</p>

<p align="center">
  <a href="https://github.com/niyankhadka/yantra/actions/workflows/ci.yml"><img src="https://github.com/niyankhadka/yantra/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/@niyankhadka/yantra"><img src="https://img.shields.io/npm/v/@niyankhadka/yantra.svg" alt="npm version"></a>
  <a href="https://pypi.org/project/niyankhadka-yantra/"><img src="https://img.shields.io/pypi/v/niyankhadka-yantra.svg" alt="PyPI version"></a>
  <a href="https://github.com/niyankhadka/yantra/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue.svg" alt="Licence: MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20.19-339933.svg" alt="Node.js 20.19 or later">
  <a href="https://yantra.nbk.com.np/"><img src="https://img.shields.io/badge/website-yantra.nbk.com.np-2f5bd3.svg" alt="Website: yantra.nbk.com.np"></a>
</p>

<p align="center">
  <a href="https://yantra.nbk.com.np/"><strong>Website</strong></a> ·
  <a href="https://yantra.nbk.com.np/docs/"><strong>Docs</strong></a> ·
  <a href="https://yantra.nbk.com.np/playground/"><strong>Playground</strong></a> ·
  <a href="https://github.com/niyankhadka/yantra/tree/main/examples"><strong>Examples</strong></a> ·
  <a href="https://github.com/niyankhadka/yantra/blob/main/CHANGELOG.md"><strong>Changelog</strong></a>
</p>

Yantra is an open-source diagram tool that turns a short JSON description into an
interactive architecture diagram, sequence diagram, flowchart, state machine, ER diagram,
org chart or mind map, or into a one-page answer with charts. It lays the diagram out, routes
the edges, checks the result with a validator and writes **one HTML file that works
offline**, with a walkthrough readers can step through. Use it from the command line, from
coding agents through MCP, from any AI chat through the browser playground, or from Python.

<p align="center">
  <img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/walkthrough.png" alt="A cloud architecture diagram at step 3 of its walkthrough: two cards are highlighted, the rest are dimmed, and the storyboard below describes the step" width="900">
</p>

## Why Yantra

- **No boxes to place.** Layout, edge routing and label placement are automatic; there are
  no coordinates in the JSON.
- **A story, not just a picture.** Steps highlight the cards and edges involved, with a
  description for each, so a reader can follow a request, a process or a decision.
- **Checked before anyone sees it.** The validator reports broken references, overlaps,
  edges through cards and label collisions, each with a stable code an agent can fix.
- **One file to share.** The output makes no network requests: email it, attach it to a
  ticket or open it from a USB stick. SVG, PNG and Markdown exports are there too.

## At a glance

One JSON format covers these kinds of diagram. Each picture links to its example.

<table>
  <tr>
    <td width="33%" align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/cloud-architecture.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-cloud-architecture.png" alt="Architecture diagram: an order and payment pipeline with mini charts on the cards"></a><br><b>Architecture and flow</b></td>
    <td width="33%" align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/oauth-login.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-oauth-login.png" alt="Sequence diagram: OAuth 2.0 sign-in with PKCE, messages numbered by step"></a><br><b>Sequence</b></td>
    <td width="33%" align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/ticket-lifecycle.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-ticket-lifecycle.png" alt="State machine: the states of a support ticket and the events between them"></a><br><b>State machine</b></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/ecommerce-schema.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-ecommerce-schema.png" alt="ER diagram: e-commerce tables with typed fields and crow's foot ends"></a><br><b>ER and class diagrams</b></td>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/org-chart.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-org-chart.png" alt="Org chart: leadership and teams in a tree layout"></a><br><b>Trees and org charts</b></td>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/study-plan-mindmap.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-study-plan-mindmap.png" alt="Mind map: a revision plan with four themes branching left and right"></a><br><b>Mind maps</b></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/smart-city-operations.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-nested-groups.png" alt="Nested groups: city districts, transport and energy boxes nested several levels deep around sensors and controllers"></a><br><b>Nested groups</b></td>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/answer-quarterly-review.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-answer-page.png" alt="Answer page: a quarterly review question with the answer headline and three supporting points"></a><br><b>Answer pages</b></td>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/live-operations-dashboard.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/chart-cards-dark.png" alt="Live operations dashboard in the dark theme: service cards with mini charts and alert rules"></a><br><b>Chart cards, dark theme</b></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/book-checkout-explained.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-book.png" alt="Book in book mode: the cover with its summary and four chapters, one screen at a time with page controls"></a><br><b>Books, read like an e-reader</b></td>
    <td align="center"><a href="https://github.com/niyankhadka/yantra/blob/main/examples/answer-quarterly-review.json"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-present.png" alt="An answer page in present mode: one chart per slide with slide controls"></a><br><b>Pages as slides</b></td>
    <td align="center"><a href="https://yantra.nbk.com.np/playground/"><img src="https://raw.githubusercontent.com/niyankhadka/yantra/main/docs/images/kind-playground.png" alt="The playground: the JSON editor, a live preview and the examples and templates picker"></a><br><b>Playground: templates and preview</b></td>
  </tr>
</table>

Also: drill-down from an overview into detail diagrams, charts on answer pages, and modes
(for example production against local). Open any of them in the
[playground](https://yantra.nbk.com.np/playground/) from **Examples and templates**.

## Quick start

Yantra needs **Node.js 20.19 or later** (22.12 or later on Node 22).

```bash
npm i -g @niyankhadka/yantra      # the `yantra` command, with a prebuilt viewer
yantra new diagram.json           # a starter diagram (--page for an answer page)
yantra validate diagram.json      # schema, references, story and rendered geometry
yantra build diagram.json         # -> diagram.html, works offline
```

| Without installing | Python | Set up your coding agent |
|---|---|---|
| `npx @niyankhadka/yantra build diagram.json` | `pip install niyankhadka-yantra` | `npx @niyankhadka/yantra init` |

A first diagram, step by step:
[Install and your first diagram](https://yantra.nbk.com.np/docs/guides/first-diagram/).

## A diagram in 20 lines

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

Save it as `checkout.json`, then run `yantra validate checkout.json` and
`yantra build checkout.json`. The rules, budgets and every validation code are in
[Authoring diagrams](https://yantra.nbk.com.np/docs/authoring/); answer pages are covered in
[Answer pages](https://yantra.nbk.com.np/docs/pages/).

## Use with your tools

**Coding agents** (Claude Code, Cursor, Codex, Antigravity). One command adds the Yantra
skill and MCP server to your project, so the agent can read your code and draw it:

```bash
npx @niyankhadka/yantra init          # the agents whose folders exist here, else Claude Code
npx @niyankhadka/yantra init --all    # Claude Code, Cursor, Codex and Antigravity
```

`init` writes only inside the project, never overwrites a file it did not write, merges MCP
configs and is safe to run again (`--dry-run` shows what it would do). Guide:
[Diagrams from your codebase](https://yantra.nbk.com.np/docs/guides/coding-agents/).

**AI chats** (Claude.ai, ChatGPT, Gemini and others). Nothing to install: open the
[playground](https://yantra.nbk.com.np/playground/), press **Copy prompt for your chat** and
paste it into the chat. Paste the JSON it answers with back into the playground to validate
it, see it and download it. The button follows the editor: with a diagram loaded it copies
the diagram too, and with validation findings it asks the chat to fix them. Everything runs
in your browser. Guide: [Use with Claude.ai, ChatGPT and any chat](https://yantra.nbk.com.np/docs/guides/chat/).

**Existing diagrams.** `yantra import` reads Mermaid, PlantUML, draw.io / diagrams.net and
Visio `.vsdx` files and validates the result. Guide:
[Import Mermaid, PlantUML, draw.io and Visio](https://yantra.nbk.com.np/docs/guides/import/).

**Python.** Build payloads in Python and let the CLI validate and build them. Guide:
[Python SDK](https://yantra.nbk.com.np/docs/guides/python/).

## Features

- **Layouts:** layered layout with orthogonal edge routing; trees, org charts, decision
  trees and mind maps; groups nested up to six levels; an optional manual layout.
- **Diagram kinds:** flow and architecture, sequence (lifeline) view of the same payload,
  state machines with fork / join and regions, ER and UML class diagrams, chart cards.
- **Walkthroughs:** scenarios with steps, autoplay, camera follow and a present mode, opened
  full, as a slim bar or switched off; folding for big diagrams; drill-down into detail
  diagrams up to eight levels.
- **Answer pages:** the conclusion first, then blocks such as points, metrics, charts,
  compare, table, timeline, FAQ, checklist, gantt, matrix and embedded diagrams, side by side
  in halves or thirds and grouped in sections.
- **Books and reading modes:** several answer pages in one file, read as one long page, one
  screen at a time like an e-reader, or as slides.
- **Charts:** bar, column, line, area, pie and donut charts, sparklines, gantt plans and 2x2
  or risk heat-map matrices, drawn as inline SVG with no chart library.
- **Sharing:** one offline HTML file; SVG, PNG and Markdown exports; view state in the URL
  hash; light and dark themes; print styles; your own logo.
- **Languages and accessibility:** 18 interface languages, right-to-left layout for Arabic,
  Hebrew, Persian and Urdu, full keyboard control and contrast tests on the theme.
- **For agents:** a validator with stable codes, a CLI, an MCP server (stdio and Streamable
  HTTP), an agent skill and a Python SDK.

<details>
<summary><b>CLI reference</b></summary>

| Command | What it does |
|---|---|
| `yantra validate <file.json> [--json] [--lang xx]` | Check schema, references, story and rendered geometry. Exits with code 1 on errors. |
| `yantra build <file.json> [-o out.html] [--force]` | Validate, then write a single offline HTML file. |
| `yantra export <file.json> -f svg\|md [-o file]` | Static SVG (diagrams) or Markdown (diagrams and pages). |
| `yantra screenshot <file.json\|page.html> [-o out.png]` | PNG through the local Chrome or Edge (`YANTRA_BROWSER` overrides). |
| `yantra new <file.json> [--page\|--book\|--kind k]` | Write a starter diagram, answer page or book (`--kind`: flow, sequence, state, er, class, tree, mindmap, page, book). |
| `yantra import <file> [-o out.json]` | Convert Mermaid, PlantUML, draw.io or Visio, then validate. |
| `yantra examples [name] [-o file]` | List the built-in examples, or copy one. |
| `yantra init [--claude] [--cursor] [--codex] [--antigravity] [--all]` | Set up a project for coding agents: skill, MCP server, rules. Also `[--dir path] [--force] [--dry-run] [--json] [--windows\|--posix]`. |
| `yantra schema [diagram\|page\|book]` | Print the JSON Schema for diagrams, answer pages or books. |
| `yantra docs [authoring\|pages\|books\|mermaid\|import\|agents]` | Print a guide. |
| `yantra mcp [--http]` | Start the MCP server on stdio, or over Streamable HTTP with `--http [--port 8787] [--host 127.0.0.1]`. |
| `yantra dev` | Start the live viewer at http://localhost:3000 (from a clone after `npm install`, or with `vite` installed next to the package). |

| Option | Commands | Meaning |
|---|---|---|
| `--json` | validate | Machine-readable output. |
| `--lang xx` | validate | Messages in a built-in language (`es`, `ja`, `ar`...); `auto` uses `meta.lang`. Codes stay the same. |
| `--force` | build | Build even when validation reports errors. |
| `--theme light\|dark` | export, screenshot | Theme to draw. |
| `--mode id` | export | One of the diagram's modes. |
| `--view flow\|sequence` | export, screenshot | Flow graph or sequence diagram. |
| `--step n` | export, screenshot | Highlight walkthrough step `n` (1-based). |
| `--level id` | export, screenshot | A detail diagram (drill-down level) instead of the overview. |
| `--all-levels` | export (`-f md`) | Append every detail diagram after the overview. |
| `--collapsed a,b` | build, export, screenshot | Open with these subtrees or groups folded, instead of `meta.layout.collapsed`. |
| `--expand-all` | build, export, screenshot | Open with nothing folded. |
| `--depth n` | build, export, screenshot | Fold to depth `n`: `n` levels of boxes or tree levels stay open. |
| `--focus group` | screenshot | Zoom the camera to a group, unfolding it and the boxes around it. |
| `--width`, `--height` | screenshot | Viewport size; `--width 390` shows a page at phone width. |
| `--from mermaid\|drawio\|plantuml\|visio` | import | Force the source format. |
| `--page n\|name` | import | draw.io or Visio page to import (default: the first). |
| `--title "..."` | import | Title of the imported diagram. |
| `--all` | import | Import every page or diagram block. |

From a clone without `npm link`, use `node bin/yantra.js` in place of `yantra`.

</details>

<details>
<summary><b>MCP server</b></summary>

`yantra mcp` (or `node mcp/server.js`) speaks MCP over stdio; `yantra init` registers it for
your agents. Tools: `yantra_get_schema`, `yantra_list_examples`, `yantra_get_example`,
`yantra_validate`, `yantra_build`, `yantra_export`, `yantra_import`, `yantra_import_mermaid`
and `yantra_screenshot`. File access is sandboxed to `YANTRA_INPUT_ROOT` and
`YANTRA_OUTPUT_ROOT` (both default to the server's working directory).

`yantra mcp --http` serves the same tools over Streamable HTTP for clients that connect by
URL, such as Claude.ai and ChatGPT connectors. You host it; see
[Remote MCP server](https://yantra.nbk.com.np/docs/remote-mcp/). Manual setup for every agent
and Claude Desktop: [Coding agents](https://yantra.nbk.com.np/docs/agents/).

</details>

<details>
<summary><b>Viewer keyboard shortcuts</b></summary>

Press `?` in a diagram to see the keys that work there.

| Key | Action | Key | Action |
|---|---|---|---|
| `→` / `Space`, `←` | Next / previous step | `Home` / `End` | First / last step |
| `P` | Play / pause | `C` | Camera follows steps |
| `S` | Collapse the walkthrough | `1`-`9` | Switch scenario |
| `W` | Walkthrough on / off | | |
| `V` | Flow / sequence view | `M` | Next mode |
| `I` | Inspector | `L` | Roles legend |
| `T` | Light / dark | `F` | Full screen |
| `X` | Fold / unfold the selected branch | `1`-`6`, `0` | Fold to depth, open everything (`Shift` with several scenarios) |
| `D` | Open the card's detail diagram | `G` | Zoom to the selected card's group |
| `+` / `-`, `R` | Zoom, fit to screen | `Esc` | Clear selection, then back up a level |

The view state is mirrored in the URL hash, for example
`#level=payments&step=3&mode=dev&view=sequence&theme=dark` (`story=off` hides the walkthrough), so a link reopens the same view.

</details>

## Examples

[`examples/`](https://github.com/niyankhadka/yantra/tree/main/examples) holds 25 diagrams,
13 answer pages and 7 chart pages, plus import samples for Mermaid, PlantUML, draw.io and
Visio. Every example validates with no warnings. `yantra examples` lists them and
`yantra examples oauth-login -o oauth.json` copies one. Companies and data in the examples
are fictional.

## Documentation

| Guides | Reference |
|---|---|
| [Install and your first diagram](https://yantra.nbk.com.np/docs/guides/first-diagram/) | [Authoring diagrams](https://yantra.nbk.com.np/docs/authoring/) |
| [Diagrams from your codebase](https://yantra.nbk.com.np/docs/guides/coding-agents/) | [Answer pages](https://yantra.nbk.com.np/docs/pages/) |
| [One-page answers and charts](https://yantra.nbk.com.np/docs/guides/answer-pages/) | [Import: Mermaid](https://yantra.nbk.com.np/docs/mermaid/), [draw.io, PlantUML, Visio](https://yantra.nbk.com.np/docs/import/) |
| [Use with Claude.ai, ChatGPT, any chat](https://yantra.nbk.com.np/docs/guides/chat/) | [Coding agents](https://yantra.nbk.com.np/docs/agents/), [AI chats](https://yantra.nbk.com.np/docs/chat/) |
| [Embedding and sharing](https://yantra.nbk.com.np/docs/guides/sharing/) | [Remote MCP server](https://yantra.nbk.com.np/docs/remote-mcp/) |
| [Releases and self-hosting](https://yantra.nbk.com.np/docs/guides/self-hosting/) | [Architecture](https://yantra.nbk.com.np/docs/architecture/) |

The reference pages are the files in [`docs/`](https://github.com/niyankhadka/yantra/tree/main/docs),
so they match the release you are reading.

## Development

```bash
git clone https://github.com/niyankhadka/yantra.git
cd yantra
npm install
npm run dev          # viewer with every example at http://localhost:3000
npm test             # Node test suite
npm run dev:site     # website and playground at http://localhost:3001/
```

Python SDK tests: `pip install -e python/`, then
`python -m unittest discover -s python/tests`. Setup, layout of the repository and the
rules the tests enforce are in the
[contributing guide](https://github.com/niyankhadka/yantra/blob/main/CONTRIBUTING.md).

## Contributing and support

- [Contributing guide](https://github.com/niyankhadka/yantra/blob/main/CONTRIBUTING.md): setup, tests and pull requests.
- [Support](https://github.com/niyankhadka/yantra/blob/main/SUPPORT.md): where to ask questions and report bugs.
- [Security policy](https://github.com/niyankhadka/yantra/blob/main/SECURITY.md): report vulnerabilities privately.
- [Code of conduct](https://github.com/niyankhadka/yantra/blob/main/CODE_OF_CONDUCT.md).

If Yantra is useful to you, you can [buy me a coffee](https://buymeacoffee.com/niyankhadka),
star the repository, or keep the "Made with Yantra" badge in your diagrams
(`meta.watermark: false` hides it).

## Licence

[MIT](https://github.com/niyankhadka/yantra/blob/main/LICENSE) © niyankhadka. The licence
covers the code; the Yantra name and logo are covered by the
[trademark policy](https://github.com/niyankhadka/yantra/blob/main/TRADEMARKS.md).
