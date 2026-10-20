"""State-machine support in the Python SDK: node shapes, edge arrows and self-loops.

Run from the repository root:  python -m unittest discover -s python/tests -v
"""

from __future__ import annotations

import shutil
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(HERE))

from yantra import ARROWS, SHAPES, Diagram, YantraError  # noqa: E402
from test_sdk import SCHEMAS, check  # noqa: E402

HAS_NODE = shutil.which("node") is not None and (ROOT / "node_modules").exists()


def lifecycle() -> Diagram:
    d = Diagram("Ticket", "A small ticket lifecycle.")
    d.role("pseudo", "Start / end", "slate").role("state", "State", "blue").role("decision", "Decision", "amber")
    start = d.add_node("start", "Start", "pseudo", shape="initial")
    new = d.add_node("new", "New", "state", shape="state", subtitle="Not yet looked at")
    check_ = d.add_node("valid", "Valid?", "decision", shape="choice")
    open_ = d.add_node("open", "Open", "state", shape="state")
    waiting = d.add_node("waiting", "Waiting", "state", shape="state")
    end = d.add_node("end", "Closed", "pseudo", shape="final")
    start.connect(new)
    new.connect(check_, "triage")
    check_.connect(open_, "valid")
    check_.connect(end, "spam")
    d.add_edge(open_, open_, "add note")
    d.add_edge(open_, waiting, "ask / reply", arrow="both")
    d.add_edge(open_, end, "resolve")
    d.add_step("Overview")
    d.add_step("Work", "Notes loop on Open.", nodes=[open_, waiting], edges=["open-open", "open-waiting"])
    return d


class StateShapeTests(unittest.TestCase):
    def test_shapes_and_arrows_in_payload(self) -> None:
        payload = lifecycle().to_dict()
        nodes = {n["id"]: n for n in payload["nodes"]}
        self.assertEqual(nodes["start"]["shape"], "initial")
        self.assertEqual(nodes["valid"]["shape"], "choice")
        self.assertNotIn("shape", Diagram("x").add_node("a", "A").to_dict())
        edges = {e["id"]: e for e in payload["edges"]}
        self.assertEqual(edges["open-waiting"]["arrow"], "both")
        self.assertEqual(edges["open-open"]["source"], edges["open-open"]["target"])
        self.assertNotIn("arrow", edges["new-valid"])

    def test_matches_schema(self) -> None:
        self.assertEqual(check(lifecycle().to_dict(), SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])

    def test_constants_match_schema(self) -> None:
        schema = SCHEMAS["yantra-payload.schema.json"]["properties"]
        self.assertEqual(tuple(schema["nodes"]["items"]["properties"]["shape"]["enum"]), SHAPES)
        self.assertEqual(tuple(schema["edges"]["items"]["properties"]["arrow"]["enum"]), ARROWS)

    def test_bad_shape_or_arrow_rejected(self) -> None:
        d = Diagram("X")
        with self.assertRaises(YantraError):
            d.add_node("a", "A", shape="blob")
        d.add_node("b", "B")
        with self.assertRaises(YantraError):
            d.add_edge("b", "b", "x", arrow="backward")


@unittest.skipUnless(HAS_NODE, "Node.js and node_modules are needed for the Yantra CLI")
class StateCliTests(unittest.TestCase):
    def test_lifecycle_validates_clean(self) -> None:
        report = lifecycle().validate()
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["warnings"], [])


if __name__ == "__main__":
    unittest.main()
