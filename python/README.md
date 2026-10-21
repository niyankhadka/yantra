# Yantra Python SDK

Build Yantra step-by-step diagrams and one-page answers from Python. The SDK writes the JSON
payload (see `schemas/`); the Yantra CLI validates it and compiles a single offline HTML file.
No third-party Python dependencies; Python >= 3.9.

> **Node.js 20.19 or later is required** to validate, build HTML or import. Building payloads
> (`to_dict()`, `save_json()`) works without it.

```bash
pip install niyankhadka-yantra     # import name "yantra"
pip install -e python/             # from a checkout of the repository
```

The CLI is found, in order, via:

1. `YANTRA_CLI`: a path to `bin/yantra.js` (run with `node`) or to a `yantra` executable.
2. `bin/yantra.js` in the checkout the package is installed from (editable installs).
3. `yantra` on PATH (`npm i -g @niyankhadka/yantra`, or `npm link` in a checkout).
4. `npx --yes --package @niyankhadka/yantra yantra`, which downloads the CLI from npm on first use
   (set `YANTRA_NO_NPX=1` to turn this off).

If none works, `YantraError` explains what to install.

## Diagram

```python
from yantra import Diagram, blocks

d = Diagram("Checkout", "How an order is paid and stored.")
d.role("service", "Service", "blue").role("data", "Data", "violet")
api = d.add_node("api", "Orders API", "service", subtitle="Validates and charges", rank=0)
db = d.add_node("db", "Orders DB", "data", tech="PostgreSQL")
api.connect(db, "INSERT order")
d.add_edge(api, "queue", "OrderCreated", type="event", style="dashed")   # edge type/style
d.summary("Orders are validated, charged and stored.", points=["..."], facts={"SLA": "99.9%"})
d.add_mode("local", "Local", badge="LOCAL", hide_nodes=["queue"])
db.mode_override("local", tech="SQLite")
d.group("backend", "Backend", [api, db], color="blue")
d.add_step("Overview")                                    # default scenario "main"
d.scenario("retry", "Retry").step("Publish", nodes=[api], payload={"status": 202})
d.panel("risks", "Risks", [blocks.points([("DB outage", "Orders retry.", "warn")], nodes=["db"])])
d.inspector(tabs=["summary", "risks"], on_node_click="risks")
d.layout("TB"); d.watermark(False)

d.validate()                  # {"valid", "errors", "warnings"}
d.build_html("checkout.html")
```

### Detail diagrams and links

```python
pay = d.add_node("payments", "Payments", "service", url="https://example.com/runbook")
detail = Diagram("Payments service")            # a full diagram: nodes, edges, steps
...
d.detail("payments", detail, from_node=pay)     # pay.drill("payments") opens it
d.detail("search", "search.json")               # or a file: {"$ref": "search.json"}
d.validate(base_dir="diagrams/")                # folder that file references are relative to
d.add_edge(api, db, "INSERT", url="https://example.com/schema")
d.add_step("Persist", url="https://example.com/adr-12")
```

Links accept `http(s)://` and `mailto:` only. `Page.diagram(d, level="payments")` shows a
detail level on a page. `pay.drill("payments-local", mode="local")` opens another level in
one mode. A page diagram given as a file (`p.diagram("diagrams/overview.json")`) has its
`$ref` levels loaded too, relative to that file and only inside the page's `base_dir`
(`yantra.resolve_levels(payload, folder, root)` does the same for any payload).
`d.views("flow")` hides the Flow / Sequence toggle (`views("sequence")`: sequence only).

State machines: `shape` is one of `SHAPES` (`"state"` cards; `"initial"`, `"final"` and
`"choice"` pseudo-states), `arrow` one of `ARROWS` (`"forward"`, `"both"`, `"none"`), and an
edge from a node to itself is a self-loop.

```python
start = d.add_node("start", "Start", "pseudo", shape="initial")
open_ = d.add_node("open", "Open", "state", shape="state")
start.connect(open_)                                      # no label needed out of a start
d.add_edge(open_, open_, "add note")                      # self-loop
d.add_edge(open_, "waiting", "ask / reply", arrow="both") # one two-way edge
```

## Data models and class diagrams

```python
from yantra import Diagram, field, method

d = Diagram("Shop schema", direction="LR")
d.add_entity("customers", "customers", [field("id", "uuid", pk=True), field("email", "text", unique=True)])
d.add_entity("orders", "orders", [field("id", "uuid", pk=True),
                                  field("customer_id", "uuid", fk=True, ref="customers.id")])
d.add_edge("customers", "orders", "places", source_end="one", target_end="zero-or-many")

d.add_class("method", "PaymentMethod", methods=[method("authorize", "amount: Money", "Auth", "+")],
            stereotype="interface")
d.add_class("card", "CardPayment", fields=[field("token", "String", visibility="-")])
d.add_edge("method", "card", relation="realization")   # triangle on the source (the interface)
```

`field(name, type, pk=, fk=, unique=, nullable=, ref=, visibility=, static=, note=)` and
`method(name, params, type, visibility, static=, abstract=)` build rows; `RELATIONS` and
`END_KINDS` list the accepted `relation` and `source_end` / `target_end` values.

## Charts in diagrams

```python
from yantra import Diagram, blocks, mini_chart

d = Diagram("Shop health")
d.add_node("api", "Orders API", "service",
           chart=mini_chart([180, 172, 165, 150, 142], "line", "p95 latency", unit=" ms", target=160))
d.add_node("db", "Orders DB", "service", chart=mini_chart(value=99.95, label="Uptime", unit="%"))
d.add_chart_card("latency", "p95 latency by service",
                 blocks.chart(kind="column", unit=" ms", categories=["Orders", "Payments"],
                              series={"Last week": [150, 210], "This week": [142, 260]}))
```

`mini_chart` kinds: line, area, column, bar, donut, ring, bullet (`MINI_KINDS`). A chart card
takes any page chart block (`yantra.blocks.chart`); `width` is 240-480.

## Trees and mind maps

```python
org = Diagram("Org chart").tree("TB")                    # or .mindmap(), or .layout(algorithm=...)
ceo = org.add_node("ceo", "Amara Okafor", "exec", subtitle="CEO")
cto = ceo.child("cto", "Daniel Reyes", subtitle="CTO")    # node + ceo -> cto edge, type inherited
cto.child("platform", "Platform", "team").child("sre", "Reliability")
ceo.assistant("cos", "Rhys Morgan", subtitle="Chief of Staff")  # beside the CEO, not below
org.collapse("cto")                                       # opens folded; readers unfold with +N
org.build_html("org.html", expand_all=True)               # or collapsed=["cto", "cfo"] for this file
org.export_svg("org.svg", collapsed=["cto"])
```

## Deep hierarchies

```python
city = d.group("city", "Harbourside City", style="solid")              # boxes may hold only boxes
north = d.group("north", "North district", parent=city)                  # parent: id or Group
traffic = d.group("traffic", "Traffic management", ["utc"], parent=north)
d.group("junction", "Junction 14 cabinet", ["signals"], parent=traffic)  # up to 6 levels deep
d.collapse("junction")
d.add_step("A queue builds", nodes=["signals", "utc"], focus_group="junction")  # zooms there, unfolds it
d.build_html("city.html", depth=2)                                      # fold to depth: 2 levels of boxes open
d.export_svg("city.svg", depth=0)                                       # or collapsed= / expand_all=
```

`Scenario.step(..., focus_group=...)` does the same for named scenarios. `depth`, `collapsed`
and `expand_all` are alternatives: pass one.

`.tree("TB", compact=True)` lists leaf teams in one column under their leader (`False`: never;
the default `"auto"` does it only when the chart gets too wide).

Edges define the hierarchy; hierarchy edges need no label (`label=` is shown on the connector,
e.g. "Yes" / "No" in a decision tree).

## Import

```python
from yantra import import_diagram

payload = import_diagram("architecture.drawio", page=2)    # also .mmd, .md, .puml; format= to force
```

Returns the payload dict produced by `yantra import` (see `docs/import.md`).

## Set up a project for coding agents

```python
import yantra

report = yantra.init_project("path/to/project", agents=["claude", "cursor"])  # dry_run=True previews
```

Runs `yantra init` (skill, MCP server entry and rules for Claude Code, Cursor, Codex or
Antigravity; see `docs/agents.md`) and returns its report: `files` lists each path with its
`action` (`created`, `merged`, `unchanged`, `skipped`, ...).

## Answer page

```python
from yantra import Page

p = Page("Why a saga?", title="Saga", kicker="Decision", author="Platform", date="20/10/2026")
p.answer("Because no single transaction spans the payment provider and our services.",
         points=["...", "...", "..."])
p.diagram(d, step=2, caption="The checkout path")   # Diagram, payload dict or .json path
p.steps([("Authorise", "..."), ("Commit", "...")], span="half").callout("...", tone="warn", span="half")
p.metrics({"p99": "180 ms"}).chart({"Payment": 94, "Ledger": 22}, unit=" ms")
p.build_html("saga.html")
```

Blocks: `text`, `points`, `steps`, `metrics`, `table`, `compare`, `callout`, `diagram`,
`chart`, `code`, `sources`, `gantt`, `matrix` (all take `title=` and `span=`). The same
constructors live in `yantra.blocks` for diagram panels.

```python
p.chart(kind="line", categories=["Jul", "Aug", "Sep"], series={"Starter": [3.4, 3.6, 4.1]}, unit="%")
p.chart({"Subscriptions": 1057, "Services": 480}, kind="donut", prefix="£", unit="k")
p.gantt([{"id": "api", "title": "API", "start": "05/10/2026", "days": 25},
         {"title": "Launch", "milestone": True, "after": "api"}], today="20/10/2026",
        workdays=True, holidays=["2026-12-25"])   # days count working days
p.matrix([("Alerts", 2, 8), ("Chat", 8, 3)], x="Effort", y="Value",
         quadrants=["Quick wins", "Big bets", "Fill-ins", "Avoid"])
```

Languages: `d.language("ne")`, `Page(..., lang="ar")` or `p.language("ar", strings={"page.answer": "..."})`
set `meta.lang` / `meta.dir` / `meta.strings` (labels, number formats, right to left; see
`docs/authoring.md`). `yantra.LANGUAGES` lists the built-in tables, `yantra.builtin_language("zh-TW")` the
one a tag uses (`"zh-Hant"`), `yantra.is_rtl(lang)` the direction, and `d.validate(lang="auto")` returns
the common validation messages in the diagram language (codes unchanged, English in `messageEn`).

Examples: `python python/example.py [out-dir]`, `python python/example_page.py [out-dir]`
(default: the OS temp dir). Tests: `python -m unittest discover -s python/tests -v`.
