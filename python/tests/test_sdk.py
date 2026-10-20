"""Tests for the Yantra Python SDK (stdlib only).

Run from the repository root:  python -m unittest discover -s python/tests -v
CLI-backed tests are skipped when Node.js is not available.
"""

from __future__ import annotations

import json
import os
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

from yantra import Diagram, Page, YantraError, blocks  # noqa: E402

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
                {"title": "Launch", "milestone": True, "after": "a"}], today="05/11/2026", title="Plan")
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


@unittest.skipUnless(HAS_NODE, "Node.js and node_modules are needed for the Yantra CLI")
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

    def test_diagram_build(self) -> None:
        out = full_diagram().build_html(os.path.join(self.tmp, "d.html"))
        html = Path(out).read_text(encoding="utf-8")
        self.assertIn("Orders API", html)

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


if __name__ == "__main__":
    unittest.main()
