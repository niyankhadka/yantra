---
description: Build Yantra diagrams and answer pages from Python with the niyankhadka-yantra SDK, then validate, build HTML, export SVG and import Mermaid or draw.io through the CLI.
---

# Python SDK

The Python SDK writes Yantra payloads from Python code: useful when a diagram or report
comes from data, a notebook or a script. It has no third-party dependencies and needs
Python 3.9 or later.

## 1. Install

```bash
pip install niyankhadka-yantra
```

The import name is `yantra`. Building payloads (`to_dict()`, `save_json()`) works with
Python alone. Validating, building HTML and importing call the Yantra CLI, so they also need
**Node.js 20.19 or later**. The SDK finds the CLI in this order:

1. `YANTRA_CLI`: a path to `bin/yantra.js` or to a `yantra` executable;
2. the repository checkout the package was installed from (`pip install -e python/`);
3. `yantra` on your `PATH` (`npm i -g @niyankhadka/yantra`);
4. `npx --yes --package @niyankhadka/yantra yantra`, which downloads the CLI on first use
   (set `YANTRA_NO_NPX=1` to turn that off).

If none works, `YantraError` explains what to install.

## 2. A diagram

```python
from yantra import Diagram

d = Diagram("Checkout", "How an order is paid and stored.")
web = d.add_node("web", "Web app", "client", subtitle="Customer checkout")
api = d.add_node("api", "Orders API", "service", tech="Go")
db = d.add_node("db", "Orders DB", "data", tech="PostgreSQL")
web.connect(api, "POST /orders")
api.connect(db, "INSERT order")

d.add_step("Overview")
d.add_step("Submit", nodes=[web, api], edges=["web-api"])
d.add_step("Persist", nodes=[api, db], edges=["api-db"])

print(d.validate())             # {'valid': True, 'errors': [], 'warnings': []}
d.build_html("checkout.html")
```

The first step highlights nothing (an overview); the others highlight cards with `nodes=`
and connections with `edges=` (ids default to `source-target`, so `web.connect(api)` is
`"web-api"`). `d.save_json("checkout.json")` writes the payload for the CLI,
the playground or version control.

## 3. Other kinds

The same `Diagram` class covers every kind:

```python
# Org chart: a tree layout, children added under their parent
org = Diagram("Org chart").tree("TB")
ceo = org.add_node("ceo", "Chief executive", "exec")
cto = ceo.child("cto", "Chief technology officer")
cto.child("platform", "Platform", "team")

# Data model: tables with typed fields and crow's foot ends
from yantra import field
s = Diagram("Shop schema", direction="LR")
s.add_entity("customers", "customers", [field("id", "uuid", pk=True), field("email", "text", unique=True)])
s.add_entity("orders", "orders", [field("id", "uuid", pk=True), field("customer_id", "uuid", fk=True, ref="customers.id")])
s.add_edge("customers", "orders", "places", source_end="one", target_end="zero-or-many")
s.add_step("Overview")
```

State machines (`shape="state"`, `"initial"`, `"final"`, `"choice"`), class diagrams
(`add_class`), mind maps (`.mindmap()`), groups nested up to six levels, drill-down detail
diagrams, modes and chart cards are all in the
[SDK README](../../python/README.md).

## 4. An answer page

```python
from yantra import Page

p = Page("Why a saga?", title="Saga", kicker="Decision")
p.answer("Because no single transaction spans the payment provider and our services.",
         points=["Separate systems", "Compensations are explicit", "Retries are safe"])
p.diagram(d, step=2, caption="The checkout path")    # a Diagram, a dict or a .json path
p.metrics({"p99": "180 ms", "Error rate": "0.2%"})
p.chart({"Payment": 94, "Ledger": 22}, unit=" ms")
p.build_html("saga.html")
```

Blocks include `text`, `points`, `steps`, `metrics`, `table`, `compare`, `callout`,
`diagram`, `chart`, `code`, `sources`, `gantt` and `matrix`; each takes `title=` and
`span=`. Charts take `kind=` (`bar`, `column`, `line`, `area`, `pie`, `donut`),
`categories=` and `series=` for several series.

## 5. Import and set up projects

```python
from yantra import import_diagram
import yantra

payload = import_diagram("architecture.drawio", page=2)   # also .mmd, .md, .puml, .vsdx
report = yantra.init_project("path/to/project", agents=["claude", "cursor"])
```

`import_diagram` returns the payload `yantra import` would write;
`init_project` runs `yantra init` and returns its report.

## 6. In a notebook or a pipeline

- Generate one diagram per service from a service catalogue, or a weekly report page from a
  query, and write the HTML as a build artefact.
- `d.validate()` returns the same codes as the CLI, so a test can fail when a generated
  diagram breaks (for example a step that names a node that no longer exists).
- `d.export_svg("checkout.svg")` writes a static SVG for documents that cannot hold HTML.

Full API: [python/README.md](../../python/README.md).
