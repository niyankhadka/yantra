"""Deep hierarchies in the Python SDK: nested groups, fold to depth, focus_group steps.

Run from the repository root:  python -m unittest discover -s python/tests -v
CLI-backed tests are skipped when Node.js is not available.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(HERE))

from yantra import Diagram, YantraError  # noqa: E402
from test_sdk import HAS_NODE, SCHEMAS, check  # noqa: E402


def campus() -> Diagram:
    """University > faculty > school > department > programme > modules: six levels in one frame."""
    d = Diagram("Northbridge University", "Where a module's marks go.")
    d.role("module", "Module", "teal")
    d.role("office", "Office", "blue")
    uni = d.group("uni", "Northbridge University", color="slate", style="solid")
    fac = d.group("fac", "Faculty of Science", parent=uni, color="blue")
    sch = d.group("sch", "School of Computing", parent=fac, color="blue")
    dep = d.group("dep", "Department of Data Science", parent="sch", color="violet")
    prog = d.group("prog", "MSc Data Science", parent=dep, color="violet")
    d.add_node("ml", "Machine Learning", "module")
    d.add_node("stats", "Applied Statistics", "module")
    d.group("mods", "Year 1 modules", ["ml", "stats"], parent=prog, color="teal")
    d.add_node("board", "Exam board", "office")
    d.group("reg", "Registry", ["board"], parent=uni, color="amber")
    d.add_node("records", "Student records", "office")
    d.add_edge("ml", "board", "Marks")
    d.add_edge("stats", "board", "Marks")
    d.add_edge("board", "records", "Confirmed results")
    d.add_step("The university in one frame")
    d.add_step("Modules report marks", nodes=["ml", "stats", "board"], edges=["ml-board", "stats-board"], focus_group=prog)
    d.add_step("Results are recorded", nodes=["board", "records"], edges=["board-records"], focus_group="reg")
    d.collapse("reg")
    assert sch.parent == "fac"
    return d


class NestingShapeTests(unittest.TestCase):
    def test_nested_groups_and_focus_steps(self) -> None:
        p = campus().to_dict()
        parents = {g["id"]: g.get("parent") for g in p["groups"]}
        self.assertEqual(parents, {"uni": None, "fac": "uni", "sch": "fac", "dep": "sch", "prog": "dep", "mods": "prog", "reg": "uni"})
        self.assertEqual(next(g for g in p["groups"] if g["id"] == "fac")["nodes"], [], "a group may hold only child groups")
        steps = p["scenarios"][0]["steps"]
        self.assertNotIn("focusGroup", steps[0])
        self.assertEqual([s.get("focusGroup") for s in steps[1:]], ["prog", "reg"])
        self.assertEqual(check(p, SCHEMAS["yantra-payload.schema.json"], "yantra-payload.schema.json"), [])

    def test_depth_arguments_are_checked(self) -> None:
        from yantra._cli import _fold_args
        self.assertEqual(_fold_args(None, False, 2), ["--depth", "2"])
        self.assertEqual(_fold_args(None, False, 0), ["--depth", "0"])
        for bad in (-1, 1.5, True, "2"):
            with self.assertRaises(YantraError):
                _fold_args(None, False, bad)
        with self.assertRaises(YantraError):
            _fold_args(["a"], False, 2)
        with self.assertRaises(YantraError):
            _fold_args(None, True, 2)


@unittest.skipUnless(HAS_NODE, "Node.js and npm dependencies are needed for CLI tests")
class NestingCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="yantra-nest-")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_six_levels_validate_clean(self) -> None:
        report = campus().validate()
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["warnings"], [])

    def test_fold_to_depth(self) -> None:
        d = campus()
        chips = lambda text: len(re.findall(r">\+\d+</text>", text))  # +N fold badges
        top = Path(d.export_svg(os.path.join(self.tmp, "a.svg"), depth=1)).read_text(encoding="utf-8")
        self.assertEqual(chips(top), 2, "faculty and registry fold into summary cards")
        whole = Path(d.export_svg(os.path.join(self.tmp, "b.svg"), depth=0)).read_text(encoding="utf-8")
        self.assertEqual(chips(whole), 1, "only the university card is left")
        deep = Path(d.export_svg(os.path.join(self.tmp, "c.svg"), depth=6)).read_text(encoding="utf-8")
        self.assertEqual(chips(deep), 0)
        html = Path(d.build_html(os.path.join(self.tmp, "d.html"), depth=2)).read_text(encoding="utf-8")
        self.assertIn('"collapsed":["sch","dep","prog","mods"]', html.replace(" ", ""))


if __name__ == "__main__":
    unittest.main()
