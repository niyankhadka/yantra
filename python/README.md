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
