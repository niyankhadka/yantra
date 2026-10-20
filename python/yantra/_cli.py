"""Bridge to the Yantra Node CLI (`bin/yantra.js`).

Producing HTML (and validating) needs Node.js >= 18; the SDK itself is pure Python.

Discovery order:

1. ``YANTRA_CLI`` environment variable: a path to ``yantra.js`` (run with node) or to an executable.
2. ``bin/yantra.js`` in the Yantra repository this package lives in, run with ``node``
   (an editable install from a checkout).
3. ``yantra`` on ``PATH`` (``npm i -g yantra-diagrams``, or ``npm link`` in a checkout).
4. ``npx --yes --package yantra-diagrams yantra`` when ``npx`` is available
   (downloads the CLI from npm on first use; set ``YANTRA_NO_NPX=1`` to disable).

Commands run without a shell, so paths with spaces and Windows paths are safe.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

__all__ = ["YantraError", "cli_command", "run_cli", "validate_payload", "build_payload", "export_payload", "import_diagram",
           "NPM_PACKAGE"]

NPM_PACKAGE = "yantra-diagrams"
NODE_HINT = ("Yantra needs Node.js >= 18 to validate and build HTML (https://nodejs.org). Then either "
             "`npm i -g yantra-diagrams`, run from a Yantra checkout, or set YANTRA_CLI to the path of bin/yantra.js.")


class YantraError(RuntimeError):
    """Raised when the CLI is missing or a command fails."""


def _node_script(script: Path) -> Optional[List[str]]:
    node = shutil.which("node")
    return [node, str(script)] if node and script.exists() else None


def cli_command() -> List[str]:
    """Return the argv prefix that runs the Yantra CLI (see the module docstring for the order)."""
    override = os.environ.get("YANTRA_CLI")
    if override:
        p = Path(override)
        if p.suffix == ".js":
            cmd = _node_script(p)
            if cmd:
                return cmd
            raise YantraError(f"YANTRA_CLI points to {p}, but it does not exist or `node` is not on PATH. " + NODE_HINT)
        found = shutil.which(override)
        if p.exists() or found:
            return [str(p) if p.exists() else found]
        raise YantraError(f"YANTRA_CLI points to {override}, which was not found. " + NODE_HINT)
    local = _node_script(Path(__file__).resolve().parents[2] / "bin" / "yantra.js")
    if local:
        return local
    found = shutil.which("yantra")
    if found:
        return [found]
    npx = shutil.which("npx")
    if npx and shutil.which("node") and not os.environ.get("YANTRA_NO_NPX"):
        return [npx, "--yes", "--package", NPM_PACKAGE, "yantra"]
    raise YantraError("Yantra CLI not found. " + NODE_HINT)


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


class _PayloadFile:
    """The payload as a temporary .json file: in a temp folder, or inside `base_dir` (hidden
    name, removed afterwards) so relative file references such as ``{"$ref": "x.json"}`` resolve."""

    def __init__(self, payload: Dict[str, Any], name: str, base_dir: Optional[str]):
        self.payload, self.name, self.base_dir = payload, name, base_dir

    def __enter__(self) -> str:
        if self.base_dir is None:
            self.tmp = tempfile.TemporaryDirectory()
            return _write(self.payload, self.tmp.name, self.name)
        fd, self.path = tempfile.mkstemp(prefix=".yantra-", suffix=".json", dir=self.base_dir)
        os.close(fd)
        Path(self.path).write_text(json.dumps(self.payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return self.path

    def __exit__(self, *exc: Any) -> None:
        if self.base_dir is None:
            self.tmp.cleanup()
        else:
            os.remove(self.path)


def validate_payload(payload: Dict[str, Any], name: str = "payload.json", base_dir: Optional[str] = None,
                     lang: Optional[str] = None) -> Dict[str, Any]:
    """Validate a diagram or page payload; returns ``{"valid", "errors", "warnings"}``.
    `base_dir`: folder that relative file references in the payload resolve against.
    `lang`: messages in a built-in language ("auto": the payload's meta.lang); codes stay
    the same, translated findings keep the English text in ``messageEn``."""
    with _PayloadFile(payload, name, base_dir) as file:
        res = run_cli(["validate", file, "--json"] + (["--lang", lang] if lang else []), check=False)
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError as exc:
        raise YantraError(f"yantra validate gave no report:\n{res.stderr or res.stdout}") from exc


def _fold_args(collapsed: Optional[Iterable[Any]], expand_all: bool, depth: Optional[int] = None) -> List[str]:
    """``--collapsed a,b`` / ``--expand-all`` / ``--depth n``: what is folded when the diagram opens."""
    if sum([bool(expand_all), collapsed is not None, depth is not None]) > 1:
        raise YantraError("use one of collapsed, expand_all and depth")
    if depth is not None:
        if isinstance(depth, bool) or not isinstance(depth, int) or depth < 0:
            raise YantraError(f"depth must be a whole number of levels to keep open, not {depth!r}")
        return ["--depth", str(depth)]
    if expand_all:
        return ["--expand-all"]
    if collapsed is None:
        return []
    ids = [str(i) for i in ([collapsed] if isinstance(collapsed, str) else collapsed)]
    if any("," in i for i in ids):
        raise YantraError("collapsed ids cannot contain commas")
    return ["--collapsed", ",".join(ids)]


def build_payload(payload: Dict[str, Any], output_html: str, force: bool = False,
                  name: str = "payload.json", base_dir: Optional[str] = None,
                  collapsed: Optional[Iterable[Any]] = None, expand_all: bool = False,
                  depth: Optional[int] = None) -> str:
    """Validate and write a single-file offline HTML; returns the output path.
    `collapsed` (ids), `expand_all` or `depth` (fold to depth n) replace meta.layout.collapsed
    for this build (diagrams only)."""
    out = os.path.abspath(output_html)
    with _PayloadFile(payload, name, base_dir) as file:
        args = ["build", file, "-o", out] + _fold_args(collapsed, expand_all, depth)
        if force:
            args.append("--force")
        run_cli(args)
    return output_html


def export_payload(payload: Dict[str, Any], output: str, format: str = "svg", theme: str = "light",
                   step: Optional[int] = None, view: Optional[str] = None, level: Optional[str] = None,
                   collapsed: Optional[Iterable[Any]] = None, expand_all: bool = False,
                   name: str = "payload.json", base_dir: Optional[str] = None, depth: Optional[int] = None) -> str:
    """Write a static SVG (diagrams) or Markdown export (``yantra export``); returns the output path."""
    if format not in ("svg", "md"):
        raise YantraError(f"export format must be 'svg' or 'md', not {format!r}")
    out = os.path.abspath(output)
    with _PayloadFile(payload, name, base_dir) as file:
        args = ["export", file, "-f", format, "-o", out, "--theme", theme] + _fold_args(collapsed, expand_all, depth)
        if step is not None:
            args += ["--step", str(step)]
        if view:
            args += ["--view", view]
        if level:
            args += ["--level", level]
        run_cli(args)
    return output


def import_diagram(source: str, format: Optional[str] = None, page: Optional[Any] = None,
                   title: Optional[str] = None) -> Dict[str, Any]:
    """Convert a Mermaid, draw.io, PlantUML or Visio file into a payload dict (``yantra import``).

    ``format`` is ``"mermaid"``, ``"drawio"``, ``"plantuml"`` or ``"visio"`` (default: detected
    from the file name or content); ``page`` picks a draw.io or Visio page by 1-based number or
    name. Gantt, pie, timeline and quadrant charts come back as answer pages (``"kind": "page"``).
    Import warnings and the validation report are printed by the CLI to stderr.
    """
    src = os.path.abspath(source)
    if not os.path.isfile(src):
        raise YantraError(f"File not found: {src}")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "imported.json")
        args = ["import", src, "-o", out]
        if format:
            args += ["--from", format]
        if page is not None:
            args += ["--page", str(page)]
        if title:
            args += ["--title", title]
        res = run_cli(args, check=False)
        if not os.path.exists(out):
            raise YantraError(f"yantra import failed:\n{res.stderr or res.stdout}")
        return json.loads(Path(out).read_text(encoding="utf-8"))
