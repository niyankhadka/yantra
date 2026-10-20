"""Bridge to the Yantra Node CLI (`bin/yantra.js`).

Discovery order:

1. ``YANTRA_CLI`` environment variable: a path to ``yantra.js`` (run with node) or to an executable.
2. ``bin/yantra.js`` in the Yantra repository this package lives in, run with ``node``.
3. ``yantra`` on ``PATH`` (e.g. after ``npm link``).

Commands run without a shell, so paths with spaces and Windows paths are safe.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

__all__ = ["YantraError", "cli_command", "run_cli", "validate_payload", "build_payload"]


class YantraError(RuntimeError):
    """Raised when the CLI is missing or a command fails."""


def _node_script(script: Path) -> Optional[List[str]]:
    node = shutil.which("node")
    return [node, str(script)] if node and script.exists() else None


def cli_command() -> List[str]:
    """Return the argv prefix that runs the Yantra CLI."""
    override = os.environ.get("YANTRA_CLI")
    if override:
        p = Path(override)
        if p.suffix == ".js":
            cmd = _node_script(p)
            if cmd:
                return cmd
        elif p.exists():
            return [str(p)]
    local = _node_script(Path(__file__).resolve().parents[2] / "bin" / "yantra.js")
    if local:
        return local
    found = shutil.which("yantra")
    if found:
        return [found]
    raise YantraError("Yantra CLI not found: install Node.js >= 18 and run `npm link` in the Yantra repo, "
                      "or set YANTRA_CLI to the path of bin/yantra.js.")


def run_cli(args: List[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run ``yantra <args>`` and return the completed process."""
    res = subprocess.run(cli_command() + args, capture_output=True, text=True, encoding="utf-8")
    if check and res.returncode != 0:
        raise YantraError(f"yantra {args[0]} failed:\n{res.stderr or res.stdout}")
    return res


def _write(payload: Dict[str, Any], folder: str, name: str) -> str:
    path = os.path.join(folder, name)
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def validate_payload(payload: Dict[str, Any], name: str = "payload.json") -> Dict[str, Any]:
    """Validate a diagram or page payload; returns ``{"valid", "errors", "warnings"}``."""
    with tempfile.TemporaryDirectory() as tmp:
        res = run_cli(["validate", _write(payload, tmp, name), "--json"], check=False)
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError as exc:
        raise YantraError(f"yantra validate gave no report:\n{res.stderr or res.stdout}") from exc


def build_payload(payload: Dict[str, Any], output_html: str, force: bool = False,
                  name: str = "payload.json") -> str:
    """Validate and write a single-file offline HTML; returns the output path."""
    out = os.path.abspath(output_html)
    with tempfile.TemporaryDirectory() as tmp:
        args = ["build", _write(payload, tmp, name), "-o", out]
        if force:
            args.append("--force")
        run_cli(args)
    return output_html
