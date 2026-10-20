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
