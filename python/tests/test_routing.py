"""Fork / join bars, concurrent regions, field-row edges and end labels in the Python SDK.

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

from yantra import GROUP_KINDS, Diagram, YantraError, field  # noqa: E402
from test_sdk import SCHEMAS, check  # noqa: E402

HAS_NODE = shutil.which("node") is not None and (ROOT / "node_modules").exists()


def parallel() -> Diagram:
    d = Diagram("Parallel", "Two things at once.")
    d.role("pseudo", "Start / end", "slate").role("state", "State", "blue")
    d.add_node("start", "Start", "pseudo", shape="initial")
    d.add_node("cart", "Cart", "state", shape="state")
    d.add_node("split", "Fork", "pseudo", shape="fork")
    for sid in ("pay", "ship", "pack", "bill"):
        d.add_node(sid, sid.title(), "state", shape="state")
    d.add_node("merge", "Join", "pseudo", shape="fork")
    d.add_node("end", "End", "pseudo", shape="final")
    d.add_edge("start", "cart")
    d.add_edge("cart", "split", "checkout")
    d.add_edge("split", "pay")
    d.add_edge("split", "pack")
    d.add_edge("pay", "bill", "approved")
    d.add_edge("pack", "ship", "picked")
    d.add_edge("bill", "merge")
    d.add_edge("ship", "merge")
    d.add_edge("merge", "end")
    d.group("work", "Processing", [])
    d.group("money", "Payment", ["pay", "bill"], parent="work", kind="region")
    d.group("goods", "Stock", ["pack", "ship"], parent="work", kind="region")
    d.add_step("Overview", "Both regions run at once.")
    return d


def schema() -> Diagram:
    d = Diagram("Schema", "Users and their posts.")
    d.add_entity("users", "users", [field("id", "uuid", pk=True), field("manager_id", "uuid", fk=True)], type="table")
    d.add_entity("posts", "posts", [field("id", "uuid", pk=True), field("author_id", "uuid", fk=True)], type="table")
    d.add_edge("users", "posts", "writes", source_end="one", target_end="zero-or-many",
               source_field="id", target_field="author_id", source_label="1", target_label="0..*")
    d.add_edge("users", "users", "manages", source_end="zero-or-one", target_end="zero-or-many",
               source_field="id", target_field="manager_id")
    d.add_step("Overview", "Who writes what.")
    return d


class RoutingPayloadTests(unittest.TestCase):
    def test_regions_and_fork_in_payload(self) -> None:
        p = parallel().to_dict()
        shapes = {n["id"]: n.get("shape") for n in p["nodes"]}
        self.assertEqual(shapes["split"], "fork")
        groups = {g["id"]: g for g in p["groups"]}
        self.assertEqual(groups["money"]["kind"], "region")
        self.assertEqual(groups["money"]["parent"], "work")
        self.assertNotIn("kind", groups["work"])

    def test_field_edges_and_end_labels_in_payload(self) -> None:
        e = {x["id"]: x for x in schema().to_dict()["edges"]}["users-posts"]
        self.assertEqual((e["sourceField"], e["targetField"]), ("id", "author_id"))
        self.assertEqual((e["sourceLabel"], e["targetLabel"]), ("1", "0..*"))

    def test_matches_schema(self) -> None:
        for d in (parallel(), schema()):
            self.assertEqual(check(d.to_dict(), SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])

    def test_constants_match_schema(self) -> None:
        groups = SCHEMAS["yantra-payload.schema.json"]["properties"]["groups"]["items"]["properties"]
        self.assertEqual(tuple(groups["kind"]["enum"]), GROUP_KINDS)

    def test_bad_values_rejected(self) -> None:
        d = Diagram("X")
        d.add_node("a", "A")
        with self.assertRaises(YantraError):
            d.group("r", "R", ["a"], kind="region")  # no parent
        with self.assertRaises(YantraError):
            d.group("g", "G", ["a"], kind="lane")
        with self.assertRaises(YantraError):
            d.add_edge("a", "a", "x", target_label="far too long for an end label")
        with self.assertRaises(YantraError):
            d.add_node("bar", "Bar", shape="fork", width=600)
        d.add_node("ok", "Bar", shape="fork", width=200)


@unittest.skipUnless(HAS_NODE, "Node.js and node_modules are needed for the Yantra CLI")
class RoutingCliTests(unittest.TestCase):
    def test_validate_clean(self) -> None:
        for d in (parallel(), schema()):
            report = d.validate()
            self.assertTrue(report["valid"], report)
            self.assertEqual(report["warnings"], [])


if __name__ == "__main__":
    unittest.main()
