"""Packaging, CLI discovery and import tests for the Yantra Python SDK (stdlib only).

Run from the repository root:  python -m unittest discover -s python/tests -v
CLI-backed tests are skipped when Node.js is not available.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "python"))

import yantra  # noqa: E402
from yantra import YantraError, cli_command, import_diagram  # noqa: E402
from yantra import _cli  # noqa: E402

HAS_NODE = shutil.which("node") is not None and (ROOT / "node_modules").exists()
PYPROJECT = (ROOT / "python" / "pyproject.toml").read_text(encoding="utf-8")


def _field(name: str) -> str:
    m = re.search(rf'^{name}\s*=\s*"([^"]*)"', PYPROJECT, re.M)
    return m.group(1) if m else ""


class MetadataTests(unittest.TestCase):
    def test_versions_match(self) -> None:
        npm = __import__("json").loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(_field("version"), yantra.__version__)
        self.assertEqual(npm["version"], yantra.__version__)

    def test_pyproject_metadata(self) -> None:
        self.assertEqual(_field("name"), "yantra-diagrams")
        self.assertEqual(_field("readme"), "README.md")
        self.assertTrue((ROOT / "python" / "README.md").exists())
        self.assertTrue((ROOT / "python" / "LICENSE").exists())
        for key in ("keywords", "classifiers", "[project.urls]", "Homepage", "Issues"):
            self.assertIn(key, PYPROJECT)
        self.assertIn("Node.js >= 18", _field("description"))

    def test_pyproject_parses(self) -> None:
        try:
            import tomllib  # Python 3.11+
        except ImportError:
            self.skipTest("tomllib needs Python 3.11+")
        data = tomllib.loads(PYPROJECT)
        self.assertEqual(data["project"]["requires-python"], ">=3.9")
        self.assertEqual(data["tool"]["setuptools"]["packages"], ["yantra"])


class DiscoveryTests(unittest.TestCase):
    def test_env_js_path_runs_with_node(self) -> None:
        if not shutil.which("node"):
            self.skipTest("node not installed")
        script = str(ROOT / "bin" / "yantra.js")
        with mock.patch.dict(os.environ, {"YANTRA_CLI": script}):
            cmd = cli_command()
        self.assertEqual(cmd[-1], script)
        self.assertTrue(Path(cmd[0]).name.lower().startswith("node"))

    def test_env_missing_path_is_a_clear_error(self) -> None:
        with mock.patch.dict(os.environ, {"YANTRA_CLI": str(ROOT / "nope" / "yantra.js")}):
            with self.assertRaises(YantraError) as ctx:
                cli_command()
        self.assertIn("Node.js >= 18", str(ctx.exception))

    def test_npx_fallback_and_opt_out(self) -> None:
        def which(name: str):
            return {"npx": "/usr/bin/npx", "node": "/usr/bin/node"}.get(name)

        env = {k: v for k, v in os.environ.items() if k not in ("YANTRA_CLI", "YANTRA_NO_NPX")}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(_cli, "_node_script", return_value=None), \
                mock.patch.object(_cli.shutil, "which", side_effect=which):
            self.assertEqual(cli_command(), ["/usr/bin/npx", "--yes", "--package", "@niyankhadka/yantra", "yantra"])
            os.environ["YANTRA_NO_NPX"] = "1"
            with self.assertRaises(YantraError) as ctx:
                cli_command()
        self.assertIn("npm i -g @niyankhadka/yantra", str(ctx.exception))


@unittest.skipUnless(HAS_NODE, "Node.js and node_modules are needed for the CLI")
class ImportTests(unittest.TestCase):
    def test_import_drawio_and_plantuml(self) -> None:
        d = import_diagram(str(ROOT / "examples" / "drawio" / "support-triage.drawio"))
        self.assertEqual(d["meta"]["title"], "Support triage")
        p = import_diagram(str(ROOT / "examples" / "plantuml" / "payment-sequence.puml"), title="Pay")
        self.assertEqual(p["meta"]["title"], "Pay")
        self.assertEqual(p["meta"]["view"], "sequence")

    def test_import_missing_file(self) -> None:
        with self.assertRaises(YantraError):
            import_diagram(str(ROOT / "examples" / "nope.drawio"))


if __name__ == "__main__":
    unittest.main()
