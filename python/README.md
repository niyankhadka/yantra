# Yantra Python SDK

Build Yantra step-by-step diagrams and one-page answers from Python. The SDK writes the JSON
payload (see `schemas/`); the Yantra CLI (Node.js >= 18) validates it and compiles a single
offline HTML file. No third-party Python dependencies; Python >= 3.9.

```bash
pip install -e python/          # package "yantra-diagrams", import "yantra"
```

The CLI is found via `YANTRA_CLI` (path to `bin/yantra.js`), then `bin/yantra.js` in this
repository (run with `node`), then `yantra` on PATH.

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
detail level on a page.

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
         {"title": "Launch", "milestone": True, "after": "api"}], today="20/10/2026")
p.matrix([("Alerts", 2, 8), ("Chat", 8, 3)], x="Effort", y="Value",
         quadrants=["Quick wins", "Big bets", "Fill-ins", "Avoid"])
```

Examples: `python python/example.py [out-dir]`, `python python/example_page.py [out-dir]`
(default: the OS temp dir). Tests: `python -m unittest discover -s python/tests -v`.
