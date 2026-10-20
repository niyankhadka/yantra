"""Charts in diagrams from the Python SDK: mini charts on cards and chart cards.

Run from the repository root:  python -m unittest discover -s python/tests -v
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(HERE))

from yantra import MINI_KINDS, Diagram, YantraError, blocks, mini_chart  # noqa: E402
from test_sdk import SCHEMAS, check  # noqa: E402

HAS_NODE = shutil.which("node") is not None and (ROOT / "node_modules").exists()
HOURS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]


def dashboard() -> Diagram:
    d = Diagram("Shop health", "Services report metrics; a chart card shows latency.")
    d.role("service", "Service", "blue").role("chart", "Dashboard", "teal")
    d.add_node("api", "Orders API", "service", subtitle="Takes orders",
               chart=mini_chart([180, 172, 165, 158, 150, 142], "line", "p95 latency", labels=HOURS, unit=" ms", target=160))
    d.add_node("db", "Orders DB", "service", chart=mini_chart(value=99.95, label="Uptime", unit="%", target=99.9))
    d.add_node("pay", "Payments", "service",
               chart=mini_chart(kind="bullet", label="Authorisation rate", value=96.6, target=97, max=100, unit="%"))
    d.add_chart_card("latency", "p95 latency by service",
                     blocks.chart(kind="column", unit=" ms", categories=["Orders API", "Payments"],
                                  series={"Last week": [150, 210], "This week": [142, 260]}), width=400)
    d.add_chart_card("mix", "Errors by cause", blocks.chart({"Declines": 1840, "Timeouts": 1210, "Other": 310}, kind="donut"))
    d.add_edge("api", "db", "SQL")
    d.add_edge("api", "pay", "Charge")
    d.add_edge("api", "latency", "Metrics")
    d.add_edge("pay", "mix", "Errors")
    d.add_step("Overview")
    d.add_step("Latency", "The chart card shows both weeks.", nodes=["api", "latency"], edges=["api-latency"])
    return d


class MiniChartTests(unittest.TestCase):
    def test_mini_chart_dicts(self) -> None:
        self.assertEqual(mini_chart([1, None, 3], label="Load"), {"label": "Load", "values": [1, None, 3]})
        self.assertEqual(mini_chart(value=72), {"value": 72})
        bar = mini_chart(kind="bar", data=[("Basket", 100), ("Paid", 41, "good")])
        self.assertEqual(bar["data"][1], {"label": "Paid", "value": 41, "tone": "good"})
        self.assertEqual(mini_chart(kind="donut", data={"Web": 58, "iOS": 42})["data"][0], {"label": "Web", "value": 58})
        self.assertIn("ring", MINI_KINDS)

    def test_mini_chart_rejects_bad_input(self) -> None:
        for bad in (lambda: mini_chart([1, "x"]), lambda: mini_chart(kind="pie", data={"a": 1}),
                    lambda: mini_chart(kind="bullet"), lambda: mini_chart(kind="bar", values=[1]),
                    lambda: mini_chart([1, 2], labels=["a"]), lambda: mini_chart(value="high")):
            with self.assertRaises(YantraError):
                bad()

    def test_payload_shape(self) -> None:
        nodes = {n["id"]: n for n in dashboard().to_dict()["nodes"]}
        self.assertEqual(nodes["api"]["data"]["chart"]["kind"], "line")
        self.assertNotIn("shape", nodes["api"])
        self.assertEqual(nodes["latency"]["shape"], "chart")
        self.assertEqual(nodes["latency"]["width"], 400)
        self.assertNotIn("type", nodes["latency"]["data"]["chart"], "the block type is dropped")
        self.assertEqual(nodes["latency"]["data"]["chart"]["series"][1]["name"], "This week")

    def test_chart_card_rules(self) -> None:
        d = Diagram("X")
        with self.assertRaises(YantraError):
            d.add_node("a", "A", shape="chart")
        with self.assertRaises(YantraError):
            d.add_chart_card("b", "B", blocks.chart({"a": 1}), width=600)
        with self.assertRaises(YantraError):
            d.add_node("c", "C", chart=blocks.chart({"a": 1}))
        with self.assertRaises(YantraError):
            d.add_node("e", "E", chart={"kind": "pie", "values": [1]})

    def test_matches_schema(self) -> None:
        self.assertEqual(check(dashboard().to_dict(), SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])


@unittest.skipUnless(HAS_NODE, "Node.js and node_modules are needed for the Yantra CLI")
class ChartCliTests(unittest.TestCase):
    def test_validates_clean(self) -> None:
        report = dashboard().validate()
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["warnings"], [])

    def test_svg_export_draws_the_charts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "d.svg"
            dashboard().export_svg(str(out))
            svg = out.read_text(encoding="utf-8")
        self.assertIn("p95 latency", svg)
        self.assertIn("Errors by cause", svg)
        self.assertNotIn("class=\"m-", svg, "styles are inlined in the export")


if __name__ == "__main__":
    unittest.main()
