"""Tests for the Yantra Python SDK (stdlib only).

Run from the repository root:  python -m unittest discover -s python/tests -v
CLI-backed tests are skipped when Node.js is not available.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "python"))

from yantra import LANGUAGES, RTL_LANGUAGES, Diagram, builtin_language, Page, YantraError, blocks, field, is_rtl, method  # noqa: E402

SCHEMAS = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in (ROOT / "schemas").glob("*.json")}
HAS_NODE = shutil.which("node") is not None and (ROOT / "node_modules").exists()

TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def _resolve(ref: str, doc: str) -> tuple:
    file, _, pointer = ref.partition("#")
    doc = file or doc
    node: Any = SCHEMAS[doc]
    for part in filter(None, pointer.split("/")):
        node = node[part]
    return node, doc


def _type_ok(value: Any, t: str) -> bool:
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, TYPES[t])


def check(value: Any, schema: Dict[str, Any], doc: str, path: str = "$") -> List[str]:
    """A minimal JSON Schema subset: $ref, type, required, properties, additionalProperties, items, enum, const."""
    if "$ref" in schema:
        target, doc = _resolve(schema["$ref"], doc)
        return check(value, target, doc, path)
    errs: List[str] = []
    types = schema.get("type")
    if types:
        types = types if isinstance(types, list) else [types]
        if not any(_type_ok(value, t) for t in types):
            return [f"{path}: expected {types}, got {type(value).__name__}"]
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{path}: {value!r} not in {schema['enum']}")
    if "const" in schema and value != schema["const"]:
        errs.append(f"{path}: expected {schema['const']!r}")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errs.append(f"{path}: missing required '{key}'")
        for key, v in value.items():
            if key in props:
                errs += check(v, props[key], doc, f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errs.append(f"{path}: unexpected key '{key}'")
            elif isinstance(schema.get("additionalProperties"), dict):
                errs += check(v, schema["additionalProperties"], doc, f"{path}.{key}")
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for i, v in enumerate(value):
            errs += check(v, schema["items"], doc, f"{path}[{i}]")
    return errs


def full_diagram() -> Diagram:
    d = Diagram("Checkout", "How an order is paid and stored.")
    d.summary("Orders are validated, charged and stored.", points=["One API", "One database"],
              facts={"Owner": "Payments", "SLA": "99.9%"})
    d.watermark(False)
    d.role("client", "Client", "amber").role("service", "Service", "blue").role("data", "Data", "violet")
    d.add_mode("prod", "Production", badge="PROD", default=True)
    d.add_mode("local", "Local", badge="LOCAL", description="Docker Compose", hide_nodes=["queue"])
    web = d.add_node("web", "Web app", "client", subtitle="Customer checkout", icon="monitor")
    api = d.add_node("api", "Orders API", "service", subtitle="Validates and charges", tech="Go", rank=1, width=240,
                     description="Owns the order lifecycle.", metadata={"Team": "Payments"})
    db = d.add_node("db", "Orders DB", "data", subtitle="Source of truth", tech="PostgreSQL", icon="database")
    queue = d.add_node("queue", "Events", "data", subtitle="Order events", tech="Kafka")
    db.mode_override("local", tech="SQLite")
    web.connect(api, "POST /orders")
    api.connect(db, "INSERT order")
    d.add_edge(api, queue, "OrderCreated", type="event", style="dashed")
    d.group("backend", "Backend", [api], color="blue", description="Private network")
    d.group("storage", "Storage", ["db", "queue"], parent="backend", style="dashed")
    d.add_step("Overview", "Client, API, database.")
    d.add_step("Submit", "The browser posts the cart.", nodes=["web", "api"], edges=["web-api"],
               payload={"method": "POST", "endpoint": "/orders", "status": 201})
    d.add_step("Persist", "The API stores the order.", nodes=[api, db], edges=["api-db"])
    retry = d.scenario("retry", "Retry", "What happens when the DB is slow.")
    retry.step("Publish", "The event is published.", nodes=[api, queue], edges=["api-queue"])
    d.panel("risks", "Risks", [
        blocks.points([("DB outage", "Orders queue and retry.", "warn")], nodes=["db"]),
        blocks.callout("Payments are idempotent.", label="Note", tone="good"),
    ])
    d.inspector(tabs=["summary", "node", "risks"], labels={"node": "Component"}, on_node_click="risks")
    return d


def org_chart() -> Diagram:
    d = Diagram("Org", "Who reports to whom.").tree("TB", collapsed=["eng"])
    d.role("exec", "Executive", "violet").role("team", "Team", "blue")
    ceo = d.add_node("ceo", "Amara Okafor", "exec", subtitle="CEO")
    eng = ceo.child("eng", "Daniel Reyes", subtitle="CTO")
    eng.child("platform", "Platform", "team").child("sre", "Reliability")
    eng.child("apps", "Product engineering", "team")
    ceo.child("ops", "Priya Nair", subtitle="COO").child("support", "Support", "team", label="runs")
    d.add_step("Overview", "Two executives, four teams.")
    d.add_step("Engineering", nodes=["eng", "platform", "apps"], edges=["eng-platform", "eng-apps"])
    return d


def data_model() -> Diagram:
    """A small ERD plus class cards: entity fields, methods, stereotypes and end markers."""
    d = Diagram("Shop schema", "Customers and orders.", direction="LR")
    d.role("table", "Table", "blue").role("class", "Class", "violet")
    d.add_entity("customers", "customers", [
        field("id", "uuid", pk=True),
        field("email", "varchar(255)", unique=True),
        "full_name",
    ], type="table", icon="user")
    d.add_entity("orders", "orders", [
        field("id", "uuid", pk=True),
        field("customer_id", "uuid", fk=True, ref="customers.id"),
        field("shipped_at", "timestamptz", nullable=True, note="Empty until shipped"),
    ], type="table")
    d.add_edge("customers", "orders", "places", source_end="one", target_end="zero-or-many")
    d.add_class("base", "Entity", fields=[field("id", "UUID", visibility="#")],
                methods=[method("validate", type="void", visibility="#", abstract=True)], stereotype="abstract")
    d.add_class("order", "Order", methods=[method("total", type="Money", visibility="+"),
                                           method("zero", "currency", "Money", "+", static=True)])
    d.add_edge("base", "order", relation="inheritance")
    d.add_step("Overview")
    d.add_step("Orders", nodes=["customers", "orders"], edges=["customers-orders"])
    d.add_step("Classes", nodes=["base", "order"], edges=["base-order"])
    return d


def drill_diagram() -> Diagram:
    """An overview whose Payments card drills into a detail diagram, with links."""
    d = Diagram("Shop", "Overview with one detail level.")
    d.role("service", "Service", "teal")
    web = d.add_node("web", "Web shop", "service", url="https://example.com/web")
    pay = d.add_node("payments", "Payments", "service", subtitle="Charges cards")
    web.connect(pay, "Charge", url="mailto:payments@example.com")
    d.add_step("Overview", url="https://example.com/runbook")
    d.add_step("Charge", nodes=[web, pay], edges=["web-payments"])
    detail = Diagram("Payments service")
    api = detail.add_node("api", "Payments API")
    db = detail.add_node("ledger", "Ledger", tech="PostgreSQL")
    api.connect(db, "Record")
    detail.add_step("Inside")
    detail.add_step("Record", nodes=[api, db], edges=["api-ledger"])
    d.detail("payments", detail, from_node=pay)
    return d


def full_page(diagram: Any = None) -> Page:
    p = Page("Why a saga?", title="Saga", kicker="Decision", author="Platform", date="20/10/2026")
    p.answer("Because no single transaction spans the payment provider and our services.",
             text="Context.", points=["One", "Two", "Three"])
    p.diagram(diagram if diagram is not None else full_diagram(), step=2, caption="The checkout path")
    p.text("Some **prose**.", title="Background")
    p.points(["A", ("B", "why", "good")], title="Reasons", span="half")
    p.steps([("First", "do this"), "Then this"], title="Steps", span="half")
    p.metrics({"p99": "180 ms"}, title="Numbers")
    p.table(["Option", "Cost"], [["Saga", "Low"], ["2PC", "High"]], title="Costs")
    p.compare([{"name": "Saga", "recommended": True}, {"name": "2PC"}], title="Options")
    p.callout("Careful.", label="Note", tone="warn")
    p.chart([("Payment", 94, "warn"), ("Ledger", 22)], unit=" ms", title="Time")
    p.code("print('hi')", language="python", title="Snippet")
    p.sources([("Paper", "https://example.com", "original")], title="Sources")
    return p


def chart_page() -> Page:
    """A page using every chart kind, a gantt plan and both matrix forms."""
    page = Page("How did Q3 go?", kicker="Review").answer("Revenue grew 14%.")
    page.metrics([{"label": "Revenue", "value": "£1.8m", "trend": [1.2, 1.4, 1.8], "tone": "good"}])
    page.chart(kind="line", categories=["30/04/2026", "31/05/2026", "30/06/2026"],
               series={"Starter": [2.8, 3.1, None], "Team": [1.9, 1.8, 1.7]}, unit="%", title="Churn")
    page.chart(kind="column", categories=["Q2", "Q3"], series=[{"name": "Net", "values": [12, -38]}], stacked=False)
    page.chart({"Subscriptions": 1057, "Services": 480}, kind="donut", prefix="£", unit="k", span="half")
    page.chart([("Price", 22), ("Integrations", 15)], title="Why they left", span="half")
    page.gantt([{"id": "a", "title": "Build", "start": "02/11/2026", "days": 10, "group": "Build"},
                {"title": "Launch", "milestone": True, "after": "a"}], today="05/11/2026", title="Plan",
               workdays=True, holidays=["2026-11-11"])
    page.matrix([("Alerts", 2, 8), ("Chat", 8, 3)], x={"label": "Effort", "low": "Low", "high": "High"},
                y="Value", quadrants=["Quick wins", "Big bets", "Fill-ins", "Avoid"], title="Priorities")
    page.matrix([("Outage", 3, 3, "bad")], grid=3, x={"label": "Likelihood", "labels": ["Low", "Mid", "High"]},
                y="Impact", title="Risks")
    return page


class PayloadShapeTests(unittest.TestCase):
    def test_diagram_matches_schema(self) -> None:
        payload = full_diagram().to_dict()
        self.assertEqual(check(payload, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])

    def test_diagram_fields(self) -> None:
        p = full_diagram().to_dict()
        meta = p["meta"]
        self.assertEqual(meta["layout"], {"direction": "LR"})
        self.assertEqual(meta["summary"]["facts"]["Owner"], "Payments")
        self.assertIs(meta["watermark"], False)
        self.assertEqual(meta["inspector"], {"tabs": ["summary", "node", "risks"], "labels": {"node": "Component"},
                                             "onNodeClick": "risks"})
        self.assertEqual(meta["defaultMode"], "prod")
        self.assertEqual(p["modes"][1]["hideNodes"], ["queue"])
        api = next(n for n in p["nodes"] if n["id"] == "api")
        self.assertEqual((api["rank"], api["width"]), (1, 240))
        db = next(n for n in p["nodes"] if n["id"] == "db")
        self.assertEqual(db["data"]["modes"], {"local": {"tech": "SQLite"}})
        edge = next(e for e in p["edges"] if e["id"] == "api-queue")
        self.assertEqual((edge["type"], edge["style"], edge["label"]), ("event", "dashed", "OrderCreated"))
        self.assertEqual([s["id"] for s in p["scenarios"]], ["main", "retry"])
        self.assertEqual(p["scenarios"][0]["name"], "Walkthrough")
        self.assertEqual(p["scenarios"][0]["steps"][1]["payload"]["status"], 201)
        self.assertEqual(p["scenarios"][0]["steps"][2]["highlightNodes"], ["api", "db"])
        self.assertEqual(p["scenarios"][1]["steps"][0]["id"], "retry-step-1")
        self.assertEqual(p["panels"][0]["blocks"][0]["nodes"], ["db"])

    def test_groups_contract(self) -> None:
        groups = full_diagram().to_dict()["groups"]
        self.assertEqual(groups[0], {"id": "backend", "title": "Backend", "nodes": ["api"],
                                     "color": "blue", "description": "Private network"})
        self.assertEqual(groups[1], {"id": "storage", "title": "Storage", "nodes": ["db", "queue"],
                                     "parent": "backend", "style": "dashed"})

    def test_backward_compatible_api(self) -> None:
        d = Diagram("Legacy", direction="TB")
        d.role("svc", "Service", "blue")
        a = d.add_node("a", "A", "svc", subtitle="first")
        a.connect("b", "x")
        d.add_node("b", "B", "svc")
        d.add_step("Overview")
        d.add_step("Go", nodes=["a", "b"], edges=["a-b"])
        d.scenario_name = "Story"
        p = d.to_dict()
        self.assertEqual(p["meta"]["layout"]["direction"], "TB")
        self.assertEqual(p["scenarios"], [{"id": "main", "name": "Story", "steps": [
            {"id": "step-1", "title": "Overview"},
            {"id": "step-2", "title": "Go", "highlightNodes": ["a", "b"], "highlightEdges": ["a-b"]}]}])
        self.assertEqual(len(d.steps), 2)
        self.assertNotIn("groups", p)
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])

    def test_tree_layouts(self) -> None:
        p = org_chart().to_dict()
        self.assertEqual(p["meta"]["layout"], {"direction": "TB", "algorithm": "tree", "collapsed": ["eng"]})
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])
        types = {n["id"]: n["type"] for n in p["nodes"]}
        self.assertEqual((types["eng"], types["sre"], types["support"]), ("exec", "team", "team"))
        self.assertIn({"id": "platform-sre", "source": "platform", "target": "sre"}, p["edges"])
        self.assertEqual(next(e for e in p["edges"] if e["id"] == "ops-support")["label"], "runs")
        m = Diagram("Plan").mindmap()
        m.collapse("a", "a", "b")
        self.assertEqual(m.meta["layout"], {"direction": "LR", "algorithm": "mindmap", "collapsed": ["a", "b"]})
        with self.assertRaises(YantraError):
            Diagram("X").layout("TB", algorithm="radial")

    def test_compact_and_assistants(self) -> None:
        d = Diagram("Org").tree("TB", compact=True)
        ceo = d.add_node("ceo", "Amara Okafor", "exec")
        cos = ceo.assistant("cos", "Rhys Morgan", subtitle="Chief of Staff")
        p = d.to_dict()
        self.assertEqual(p["meta"]["layout"], {"direction": "TB", "algorithm": "tree", "compact": True})
        node = next(n for n in p["nodes"] if n["id"] == "cos")
        self.assertEqual((node["type"], node["data"]["assistant"]), ("exec", True))
        self.assertIn({"id": "ceo-cos", "source": "ceo", "target": "cos"}, p["edges"])
        self.assertEqual(cos.id, "cos")
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])
        self.assertEqual(Diagram("A").tree(compact="auto").meta["layout"]["compact"], "auto")
        self.assertNotIn("compact", Diagram("B").tree().meta["layout"])
        with self.assertRaises(YantraError):
            Diagram("C").tree(compact="yes")
        with self.assertRaises(YantraError):
            Diagram("D").tree(compact=1)

    def test_data_model_payload(self) -> None:
        p = data_model().to_dict()
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])
        customers, orders, base, order = p["nodes"]
        self.assertEqual(customers["data"]["fields"], [
            {"name": "id", "type": "uuid", "pk": True},
            {"name": "email", "type": "varchar(255)", "unique": True},
            {"name": "full_name"}])
        self.assertEqual(orders["data"]["fields"][1], {"name": "customer_id", "type": "uuid", "fk": True,
                                                       "ref": "customers.id"})
        self.assertEqual(orders["data"]["fields"][2]["nullable"], True)
        self.assertEqual(base["data"]["stereotype"], "abstract")
        self.assertEqual(base["data"]["methods"], [{"name": "validate", "visibility": "#", "type": "void",
                                                   "abstract": True}])
        self.assertEqual(order["data"]["fields"], [])
        self.assertEqual(order["data"]["methods"][1], {"name": "zero", "visibility": "+", "params": "currency",
                                                      "type": "Money", "static": True})
        er, uml = p["edges"]
        self.assertEqual((er["sourceEnd"], er["targetEnd"], er["label"]), ("one", "zero-or-many", "places"))
        self.assertEqual(uml, {"id": "base-order", "source": "base", "target": "order", "relation": "inheritance"})

    def test_data_model_bad_input(self) -> None:
        d = Diagram("X")
        with self.assertRaises(YantraError):
            d.add_edge("a", "b", relation="friendship")
        with self.assertRaises(YantraError):
            d.add_edge("a", "b", target_end="lots")
        with self.assertRaises(YantraError):
            field("x", visibility="!")
        with self.assertRaises(YantraError):
            d.add_entity("t", "T", [{"type": "int"}])
        with self.assertRaises(YantraError):
            method("")

    def test_bad_input_rejected(self) -> None:
        d = Diagram("X")
        with self.assertRaises(YantraError):
            d.layout("RL")
        with self.assertRaises(YantraError):
            d.add_node("a", "A", width=100)
        with self.assertRaises(YantraError):
            d.role("a", "A", "pink")
        with self.assertRaises(ValueError):
            blocks.table(["a", "b"], [["only one"]])
        with self.assertRaises(ValueError):
            blocks.callout("x", tone="loud")
        with self.assertRaises(YantraError):
            Page("Q?").to_dict()

    def test_page_matches_schema(self) -> None:
        payload = full_page().to_dict()
        self.assertEqual(check(payload, SCHEMAS["yantra-page.schema.json"], "yantra-page.schema.json"), [])
        self.assertEqual(payload["kind"], "page")
        self.assertEqual([b["type"] for b in payload["blocks"]], [
            "diagram", "text", "points", "steps", "metrics", "table", "compare", "callout", "chart", "code", "sources"])
        self.assertEqual(payload["blocks"][0]["diagram"]["meta"]["title"], "Checkout")
        self.assertEqual(payload["blocks"][2]["items"][1], {"title": "B", "text": "why", "tone": "good"})

    def test_chart_blocks_match_schema(self) -> None:
        payload = chart_page().to_dict()
        self.assertEqual(check(payload, SCHEMAS["yantra-page.schema.json"], "yantra-page.schema.json"), [])
        b = payload["blocks"]
        self.assertEqual([x["type"] for x in b], ["metrics", "chart", "chart", "chart", "chart", "gantt", "matrix", "matrix"])
        self.assertEqual(b[1]["series"][0], {"name": "Starter", "values": [2.8, 3.1, None]})
        self.assertEqual(b[3]["data"][0], {"label": "Subscriptions", "value": 1057})
        self.assertNotIn("kind", b[4])
        self.assertEqual(b[6]["items"][0], {"label": "Alerts", "x": 2, "y": 8})
        self.assertEqual(b[0]["items"][0]["trend"], [1.2, 1.4, 1.8])
        self.assertEqual((b[5]["workdays"], b[5]["holidays"]), (True, ["2026-11-11"]))
        self.assertNotIn("workdays", blocks.gantt([("A", "02/11/2026", 2)]))
        goal = blocks.chart({"Mon": 180, "Tue": 150}, kind="column", unit=" ms", target=160)
        self.assertEqual(goal["target"], 160)
        self.assertNotIn("target", blocks.chart({"a": 1}))
        self.assertEqual(check({"kind": "page", "meta": {"question": "Q?"}, "answer": {"headline": "x"}, "blocks": [goal]}, SCHEMAS["yantra-page.schema.json"], "yantra-page.schema.json"), [])
        with self.assertRaises(ValueError):
            blocks.chart({"a": 1}, target="high")
        with self.assertRaises(ValueError):
            blocks.chart({"a": 1}, kind="pie", target=2)

    def test_chart_blocks_reject_bad_data(self) -> None:
        with self.assertRaises(ValueError):
            blocks.chart([("a", 1)], kind="radar")
        with self.assertRaises(ValueError):
            blocks.chart(kind="line", categories=["a", "b"], series={"s": [1]})
        with self.assertRaises(ValueError):
            blocks.chart(kind="pie", categories=["a"], series={"s": [1]})
        with self.assertRaises(ValueError):
            blocks.chart({"a": -1}, kind="donut")
        with self.assertRaises(ValueError):
            blocks.chart()
        with self.assertRaises(ValueError):
            blocks.gantt([{"title": "No length", "start": "02/11/2026"}])
        with self.assertRaises(ValueError):
            blocks.gantt([("A", "02/11/2026", 2)], holidays=["2026-11-11"])
        with self.assertRaises(ValueError):
            blocks.matrix([("a", 1, 2)], grid=7)
        with self.assertRaises(ValueError):
            blocks.matrix([("a", 1, 2)], quadrants=["only", "two"])
        with self.assertRaises(ValueError):
            blocks.matrix([{"label": "a", "x": "high", "y": 2}])
    def test_drill_down_and_links(self) -> None:
        p = drill_diagram().to_dict()
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])
        self.assertEqual(p["nodes"][1]["data"]["drill"], "payments")
        self.assertEqual(p["diagrams"]["payments"]["meta"]["title"], "Payments service")
        self.assertEqual(p["nodes"][0]["data"]["url"], "https://example.com/web")
        self.assertEqual(p["edges"][0]["url"], "mailto:payments@example.com")
        self.assertEqual(p["scenarios"][0]["steps"][0]["url"], "https://example.com/runbook")
        d = Diagram("Refs")
        d.add_node("a", "A", drill="x")
        d.detail("x", "details/x.json").start_level("x")
        self.assertEqual(d.to_dict()["diagrams"]["x"], {"$ref": "details/x.json"})
        self.assertEqual(d.to_dict()["meta"]["startLevel"], "x")
        for bad in ("/abs/x.json", "C:/x.json", "https://x.example/a.json", "x.txt"):
            with self.assertRaises(YantraError, msg=bad):
                Diagram("R").detail("x", bad)
        with self.assertRaises(YantraError):
            d.detail("x", "other.json")
        for bad_url in ("javascript:alert(1)", "data:text/html,x", "/relative"):
            with self.assertRaises(YantraError, msg=bad_url):
                Diagram("U").add_node("a", "A", url=bad_url)
        with self.assertRaises(YantraError):
            d.add_edge("a", "a", "x", url="ftp://x")
        with self.assertRaises(YantraError):
            d.add_step("S", url="javascript:x")
        self.assertEqual(blocks.diagram(drill_diagram(), level="payments")["level"], "payments")

    def test_diagram_block_sources(self) -> None:
        self.assertEqual(blocks.diagram("diagrams/a.json")["src"], "diagrams/a.json")
        self.assertIn("diagram", blocks.diagram({"meta": {"title": "x"}, "nodes": [], "edges": []}))
        self.assertEqual(blocks.diagram(full_diagram(), step=1, mode="prod")["mode"], "prod")

    def test_views_and_mode_drill(self) -> None:
        d = Diagram("Schema").views("flow")
        a = d.add_node("a", "A")
        a.drill("x").drill("y", mode="local").drill(None, mode="prod")
        p = d.to_dict()
        self.assertEqual(p["meta"]["views"], ["flow"])
        self.assertEqual(p["nodes"][0]["data"]["drill"], "x")
        self.assertEqual(p["nodes"][0]["data"]["modes"], {"local": {"drill": "y"}, "prod": {"drill": None}})
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])
        for bad in ((), ("graph",), ("flow", "flow")):
            with self.assertRaises(YantraError, msg=repr(bad)):
                Diagram("V").views(*bad)
        with self.assertRaises(YantraError):
            a.drill(None)

    def test_resolve_levels_is_path_safe(self) -> None:
        from yantra import resolve_levels
        tmp = Path(tempfile.mkdtemp(prefix="yantra-levels-"))
        try:
            (tmp / "levels").mkdir()
            (tmp / "levels" / "x.json").write_text(json.dumps({"meta": {"title": "X"}, "diagrams": {"y": {"$ref": "y.json"}}}), encoding="utf-8")
            (tmp / "levels" / "y.json").write_text(json.dumps({"meta": {"title": "Y"}, "diagrams": {"z": {"$ref": "y.json"}}}), encoding="utf-8")
            (tmp / "levels" / "bad.json").write_text("{not json", encoding="utf-8")
            payload = {"meta": {"title": "Top"}, "diagrams": {
                "x": {"$ref": "levels/x.json"}, "up": {"$ref": "../outside.json"}, "abs": {"$ref": "/etc/x.json"},
                "url": {"$ref": "https://example.com/x.json"}, "txt": {"$ref": "levels/x.txt"},
                "gone": {"$ref": "levels/nope.json"}, "bad": {"$ref": "levels/bad.json"}}}
            out = resolve_levels(payload, tmp)
            self.assertEqual(out["diagrams"]["x"]["meta"]["title"], "X")
            self.assertEqual(out["diagrams"]["x"]["diagrams"]["y"]["meta"]["title"], "Y", "refs are relative to their own file")
            self.assertEqual(out["diagrams"]["x"]["diagrams"]["y"]["diagrams"]["z"]["$error"], "cycle")
            for key in ("up", "abs", "url", "txt"):
                self.assertEqual(out["diagrams"][key]["$error"], "unsafe", key)
            self.assertEqual(out["diagrams"]["gone"]["$error"], "missing")
            self.assertEqual(out["diagrams"]["bad"]["$error"], "missing")
            self.assertEqual(payload["diagrams"]["x"], {"$ref": "levels/x.json"}, "input untouched")
            # The root is enforced even when it is not the base folder
            (tmp / "other").mkdir()
            self.assertEqual(resolve_levels(payload, tmp, tmp / "other")["diagrams"]["x"]["$error"], "unsafe")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


@unittest.skipUnless(HAS_NODE, "Node.js and node_modules are needed for the Yantra CLI")
class BlockParityTests(unittest.TestCase):
    def test_block_types_match_the_js_renderer(self) -> None:
        import re
        src = (ROOT / "src" / "core" / "page.js").read_text(encoding="utf-8")
        js = re.search(r"BLOCK_TYPES = \[([^\]]*)\]", src).group(1)
        self.assertEqual(sorted(re.findall(r"'([a-z]+)'", js)), sorted(blocks.BLOCK_TYPES))

    def test_older_blocks_match_schema(self) -> None:
        page = Page("What changed?", title="Release notes")
        page.answer("Three fixes shipped.")
        page.timeline([("01/10/2026", "Beta"), {"date": "20/10/2026", "title": "GA", "tone": "good"}], title="Dates")
        page.faq([("Is it free?", "Yes.")]).checklist([("Docs", True), "Release"])
        page.quote("Ship small.", by="Team lead").image("https://example.com/a.png", alt="Chart")
        page.kv({"Version": "2.1.0", "Licence": "MIT"})
        payload = page.to_dict()
        self.assertEqual(check(payload, SCHEMAS["yantra-page.schema.json"], "yantra-page.schema.json"), [])
        b = payload["blocks"]
        self.assertEqual([x["type"] for x in b], ["timeline", "faq", "checklist", "quote", "image", "kv"])
        self.assertEqual(b[2]["items"][0], {"text": "Docs", "done": True})
        self.assertEqual(b[5]["items"][1], {"k": "Licence", "v": "MIT"})


class CliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="yantra-py-")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def assertClean(self, report: Dict[str, Any]) -> None:
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["errors"], [])

    def test_diagram_validates(self) -> None:
        self.assertClean(full_diagram().validate())

    def test_tree_validates_clean(self) -> None:
        report = org_chart().validate()
        self.assertClean(report)
        self.assertEqual(report["warnings"], [])

    def test_folds_pass_through(self) -> None:
        d = org_chart()
        d.nodes["ceo"].assistant("ea", "Sam Lee", subtitle="Executive assistant")
        self.assertEqual(d.validate()["warnings"], [])
        chips = lambda text: len(re.findall(r">\+\d+</text>", text))  # +N fold badges
        folded = Path(d.export_svg(os.path.join(self.tmp, "a.svg"))).read_text(encoding="utf-8")
        self.assertEqual(chips(folded), 1, "eng opens folded")
        open_all = Path(d.export_svg(os.path.join(self.tmp, "b.svg"), expand_all=True)).read_text(encoding="utf-8")
        self.assertEqual(chips(open_all), 0)
        two = Path(d.export_svg(os.path.join(self.tmp, "c.svg"), collapsed=["eng", "ops"], theme="dark")).read_text(encoding="utf-8")
        self.assertEqual(chips(two), 2)
        html = Path(d.build_html(os.path.join(self.tmp, "d.html"), collapsed=["ops"])).read_text(encoding="utf-8")
        self.assertIn('"collapsed":["ops"]', html.replace(" ", ""))
        with self.assertRaises(YantraError):
            d.build_html(os.path.join(self.tmp, "e.html"), collapsed=["nobody"])

    def test_diagram_build(self) -> None:
        out = full_diagram().build_html(os.path.join(self.tmp, "d.html"))
        html = Path(out).read_text(encoding="utf-8")
        self.assertIn("Orders API", html)

    def test_data_model_validates_and_builds(self) -> None:
        d = data_model()
        report = d.validate()
        self.assertClean(report)
        self.assertEqual(report["warnings"], [])
        html = Path(d.build_html(os.path.join(self.tmp, "schema.html"))).read_text(encoding="utf-8")
        self.assertIn("customer_id", html)
        bad = data_model()
        bad.nodes["orders"].data["fields"][1]["ref"] = "nowhere.id"
        codes = [e["code"] for e in bad.validate()["errors"]]
        self.assertIn("ref/field-unknown-ref", codes)

    def test_invalid_diagram_reports_errors(self) -> None:
        d = Diagram("Broken")
        d.add_node("a", "A")
        d.add_edge("a", "missing")
        report = d.validate()
        self.assertFalse(report["valid"])
        self.assertTrue(report["errors"])
        with self.assertRaises(YantraError):
            d.build_html(os.path.join(self.tmp, "broken.html"))

    def test_page_validates_and_builds(self) -> None:
        page = full_page()
        self.assertClean(page.validate())
        out = page.build_html(os.path.join(self.tmp, "page.html"))
        html = Path(out).read_text(encoding="utf-8")
        self.assertIn("Because no single transaction spans the payment provider", html)

    def test_page_with_src_diagram(self) -> None:
        page = full_page(diagram="cloud-architecture.json")
        page.base_dir = str(ROOT / "examples")
        self.assertClean(page.validate())

    def test_page_src_diagram_with_ref_levels(self) -> None:
        os.makedirs(os.path.join(self.tmp, "diagrams", "levels"))
        detail = Diagram("Ledger detail")
        a, b = detail.add_node("a", "Writer"), detail.add_node("b", "Ledger")
        a.connect(b, "Insert")
        detail.add_step("Overview")
        detail.save_json(os.path.join(self.tmp, "diagrams", "levels", "ledger.json"))
        top = Diagram("Overview")
        n, m = top.add_node("n", "Payments"), top.add_node("m", "Orders")
        m.connect(n, "Charge")
        top.add_step("Overview")
        top.detail("ledger", "levels/ledger.json", from_node=n)
        top.save_json(os.path.join(self.tmp, "diagrams", "overview.json"))
        page = Page("Where do charges go?", title="Charges", base_dir=self.tmp)
        page.answer("Into the ledger.")
        page.diagram("diagrams/overview.json", level="ledger", title="Ledger")
        report = page.validate()
        self.assertClean(report)
        self.assertEqual(report["warnings"], [])
        html = Path(page.build_html(os.path.join(self.tmp, "page.html"))).read_text(encoding="utf-8")
        self.assertIn("Writer", html, "the $ref level is drawn")
        # A level that leaves base_dir is not loaded: the validator reports it
        top.diagrams["ledger"] = {"$ref": "../../outside.json"}
        top.save_json(os.path.join(self.tmp, "diagrams", "overview.json"))
        codes = [e["code"] for e in page.validate()["errors"]]
        self.assertIn("drill/ref-unsafe", codes)

    def test_chart_page_validates_cleanly_and_builds(self) -> None:
        page = chart_page()
        report = page.validate()
        self.assertClean(report)
        self.assertEqual(report["warnings"], [])
        html = Path(page.build_html(os.path.join(self.tmp, "charts.html"))).read_text(encoding="utf-8")
        for marker in ("p-chart--line", "p-chart--donut", "p-chart--gantt", "p-chart--matrix", "p-spark"):
            self.assertIn(marker, html)
    def test_drill_down_validates_and_builds(self) -> None:
        d = drill_diagram()
        report = d.validate()
        self.assertClean(report)
        self.assertEqual(report["warnings"], [])
        html = Path(d.build_html(os.path.join(self.tmp, "drill.html"))).read_text(encoding="utf-8")
        self.assertIn("Payments service", html)
        page = Page("Where do charges go?", title="Charges")
        page.answer("Into the ledger, through the Payments API.")
        page.diagram(d, level="payments")
        self.assertClean(page.validate())

    def test_detail_file_reference(self) -> None:
        detail = Diagram("Ledger detail")
        a = detail.add_node("a", "Writer")
        b = detail.add_node("b", "Ledger")
        a.connect(b, "Insert")
        detail.add_step("Overview")
        detail.save_json(os.path.join(self.tmp, "ledger.json"))
        d = Diagram("Overview")
        n = d.add_node("n", "Payments")
        m = d.add_node("m", "Orders")
        m.connect(n, "Charge")
        d.add_step("Overview")
        d.detail("ledger", "ledger.json", from_node=n)
        self.assertClean(d.validate(base_dir=self.tmp))
        self.assertEqual(sorted(os.listdir(self.tmp)), ["ledger.json"], "the temporary payload file is removed")
        codes = [e["code"] for e in d.validate()["errors"]]
        self.assertIn("drill/ref-missing", codes)

    def test_examples_run(self) -> None:
        for script, outputs in (("example.py", ["sales_pipeline.html"]),
                                ("example_page.py", ["cache_answer.json", "cache_answer.html"])):
            res = subprocess.run([sys.executable, "-B", str(ROOT / "python" / script), self.tmp],
                                 capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertNotIn("error:", res.stdout)
            for name in outputs:
                self.assertTrue(Path(self.tmp, name).exists(), name)


class LanguageTests(unittest.TestCase):
    """meta.lang / meta.dir / meta.strings parity with src/core/i18n.js."""

    def test_diagram_language(self) -> None:
        d = Diagram("रेफरल").language("ne", strings={"story.next": "अर्को"})
        d.add_node("a", "स्वास्थ्य चौकी").connect(d.add_node("b", "अस्पताल"), "रेफर")
        d.add_step("सबै")
        p = d.to_dict()
        self.assertEqual(p["meta"]["lang"], "ne")
        self.assertEqual(p["meta"]["strings"], {"story.next": "अर्को"})
        self.assertNotIn("dir", p["meta"])
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])
        d.language("ar")
        self.assertEqual(d.meta["lang"], "ar")
        self.assertNotIn("strings", d.meta, "language() replaces earlier settings")

    def test_page_language(self) -> None:
        pg = Page("لماذا؟", lang="ar").answer("لأن.")
        self.assertEqual(pg.to_dict()["meta"]["lang"], "ar")
        pg.language("en", dir="rtl")
        self.assertEqual(pg.meta["dir"], "rtl")
        self.assertEqual(check(pg.to_dict(), SCHEMAS["yantra-page.schema.json"], "yantra-page.schema.json"), [])

    def test_rtl_and_bad_input(self) -> None:
        for lang in ("ar", "he", "fa", "ur", "ar-EG"):
            self.assertTrue(is_rtl(lang), lang)
        self.assertFalse(is_rtl("ne"))
        self.assertTrue(is_rtl("en", "rtl"))
        self.assertFalse(is_rtl("ar", "ltr"))
        with self.assertRaises(YantraError):
            Diagram("X").language("not a tag")
        with self.assertRaises(YantraError):
            Diagram("X").language("en", dir="up")
        with self.assertRaises(YantraError):
            Page("Q").language("en", strings={"story.next": 3})  # type: ignore[dict-item]

    @unittest.skipUnless(HAS_NODE, "Node.js and node_modules are required")
    def test_constants_match_js_table(self) -> None:
        script = ("import('./src/core/i18n.js').then(m => console.log(JSON.stringify("
                  "{langs: m.LANGUAGES, rtl: m.RTL_LANGS})))")
        res = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(res.returncode, 0, res.stderr)
        js = json.loads(res.stdout)
        self.assertEqual(list(LANGUAGES), js["langs"])
        self.assertEqual(list(RTL_LANGUAGES), js["rtl"])

    @unittest.skipUnless(HAS_NODE, "Node.js and node_modules are required")
    def test_builtin_language_matches_js(self) -> None:
        tags = ["en", "pt-BR", "zh", "zh-CN", "zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hans-TW",
                "ko-KR", "he", "fa-IR", "ur", "bn-BD", "id", "it-CH", "sw", "not a tag", "ZH-tw"]
        script = ("import('./src/core/i18n.js').then(m => console.log(JSON.stringify("
                  + json.dumps(tags) + ".map(t => m.shippedLang(t)))))")
        res = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual([builtin_language(t) for t in tags], json.loads(res.stdout))
        self.assertEqual(builtin_language("zh-TW"), "zh-Hant")

    @unittest.skipUnless(HAS_NODE, "Node.js and node_modules are required")
    def test_validate_messages_in_a_language(self) -> None:
        d = Diagram("Pedido").language("es")
        d.add_node("a", "Tienda").connect(d.add_node("b", "Pedidos"), "")
        d.add_step("Todo")
        english = d.validate()
        spanish = d.validate(lang="auto")
        codes = [w["code"] for w in english["warnings"]]
        self.assertEqual(codes, [w["code"] for w in spanish["warnings"]])
        translated = [w for w in spanish["warnings"] if "messageEn" in w]
        self.assertTrue(translated, spanish)
        self.assertNotEqual(translated[0]["message"], translated[0]["messageEn"])

    @unittest.skipUnless(HAS_NODE, "Node.js and node_modules are required")
    def test_language_validates_and_builds(self) -> None:
        d = Diagram("طلب").language("ar")
        d.add_node("a", "المتجر").connect(d.add_node("b", "خدمة الطلبات"), "طلب جديد")
        d.add_step("نظرة عامة")
        d.add_step("الطلب", nodes=["a", "b"], edges=["a-b"])
        report = d.validate()
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["warnings"], [])
        tmp = tempfile.mkdtemp(prefix="yantra-py-")
        try:
            out = d.build_html(str(Path(tmp, "ar.html")))
            self.assertIn('<html lang="ar" dir="rtl"', Path(out).read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        unknown = Diagram("X").language("sw")
        unknown.add_node("a", "A")
        codes = [w["code"] for w in unknown.validate()["warnings"]]
        self.assertIn("i18n/unknown-lang", codes)


if __name__ == "__main__":
    unittest.main()
