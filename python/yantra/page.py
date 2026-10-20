"""Answer page builder: one question answered on one printable page, the answer first.

Produces payloads matching ``schemas/yantra-page.schema.json``. Block helpers mirror
:mod:`yantra.blocks` and return the page, so calls chain.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Union

from . import blocks as B
from ._cli import YantraError, build_payload, validate_payload
from .i18n import language_meta

__all__ = ["Page", "resolve_levels"]

_UNSAFE_REF = re.compile(r"^([a-zA-Z][\w+.-]*:|[\\/])")


def _inside(root: Path, file: Path) -> bool:
    """True when `file` is inside `root`, by its path and once symlinks are resolved."""
    try:
        Path(os.path.abspath(file)).relative_to(os.path.abspath(root))
        file.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def resolve_levels(payload: Any, base_dir: Union[str, Path], root: Union[str, Path, None] = None) -> Any:
    """Inline drill-down file references, as the Node builder does (``resolveLevels`` in
    lib/build.js): every ``{"$ref": "./x.json"}`` in a ``diagrams`` map, at any depth and in
    loaded files too, becomes that file's payload. A ref is relative to the file that contains
    it and must be a relative .json path that stays inside `root` (default `base_dir`; symlinks
    resolved). One that cannot be loaded stays with ``"$error"`` ("unsafe", "missing" or
    "cycle"), which the validator reports. The input is not modified."""
    base = Path(base_dir)
    top = Path(root) if root is not None else base

    def visit(owner: Any, folder: Path, chain: List[Path]) -> Any:
        if not isinstance(owner, dict) or not isinstance(owner.get("diagrams"), dict):
            return owner
        table: Dict[str, Any] = {}
        for key, sub in owner["diagrams"].items():
            if not (isinstance(sub, dict) and isinstance(sub.get("$ref"), str)):
                table[key] = visit(sub, folder, chain)
                continue
            ref = sub["$ref"]
            file = folder / ref
            if _UNSAFE_REF.match(ref) or not ref.lower().endswith(".json") or not _inside(top, file):
                table[key] = {"$ref": ref, "$error": "unsafe"}
                continue
            if not file.is_file():
                table[key] = {"$ref": ref, "$error": "missing"}
                continue
            real = file.resolve()
            if real in chain:
                table[key] = {"$ref": ref, "$error": "cycle"}
                continue
            try:
                loaded = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                table[key] = {"$ref": ref, "$error": "missing"}
                continue
            table[key] = visit(loaded, file.parent, chain + [real])
        return {**owner, "diagrams": table}

    return visit(payload, base, [])


class Page:
    """Build a Yantra answer page (``"kind": "page"``).

    `base_dir` is the folder that relative diagram ``src`` paths are resolved against when
    validating or building (default: the current directory).
    """

    def __init__(self, question: str, title: Optional[str] = None, kicker: Optional[str] = None,
                 author: Optional[str] = None, date: Optional[str] = None, description: Optional[str] = None,
                 footer: Optional[str] = None, base_dir: Optional[str] = None, lang: Optional[str] = None):
        self.meta: Dict[str, Any] = {k: v for k, v in {
            "question": question, "title": title, "kicker": kicker, "description": description,
            "author": author, "date": date, "footer": footer,
        }.items() if v is not None}
        if lang is not None:
            self.language(lang)
        self._answer: Optional[Dict[str, Any]] = None
        self.blocks: List[Dict[str, Any]] = []
        self.base_dir = base_dir

    def answer(self, headline: str, text: Optional[str] = None, points: Optional[List[str]] = None) -> "Page":
        """The conclusion (1-2 sentences, under 220 characters), optional context and 3-5 points."""
        a: Dict[str, Any] = {"headline": headline}
        if text:
            a["text"] = text
        if points:
            a["points"] = list(points)
        self._answer = a
        return self

    def language(self, lang: str, dir: Optional[str] = None,
                 strings: Optional[Mapping[str, str]] = None) -> "Page":
        """Page language (BCP 47): <html lang dir>, fixed labels and number formats. Diagram blocks
        without their own language inherit it. RTL languages lay the page out right to left."""
        for key in ("lang", "dir", "strings"):
            self.meta.pop(key, None)
        self.meta.update(language_meta(lang, dir, strings))
        return self

    def watermark(self, value: Union[bool, str]) -> "Page":
        """False hides the "Made with Yantra" badge; a string replaces its text."""
        self.meta["watermark"] = value
        return self

    def add(self, block: Dict[str, Any]) -> "Page":
        """Append a block made with :mod:`yantra.blocks` (or a raw dict)."""
        if block.get("type") not in B.BLOCK_TYPES:
            raise YantraError(f"unknown block type {block.get('type')!r}")
        self.blocks.append(block)
        return self

    # --- typed blocks -------------------------------------------------------
    def text(self, body: str, title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.text(body, title, span))

    def points(self, items: Iterable[Any], title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.points(items, title, span))

    def steps(self, items: Iterable[Any], title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.steps(items, title, span))

    def metrics(self, items: Union[Iterable[Any], Mapping[str, Any]], title: Optional[str] = None,
                span: Optional[str] = None) -> "Page":
        return self.add(B.metrics(items, title, span))

    def table(self, columns: Sequence[str], rows: Iterable[Sequence[Any]], title: Optional[str] = None,
              span: Optional[str] = None) -> "Page":
        return self.add(B.table(columns, rows, title, span))

    def compare(self, options: Iterable[Mapping[str, Any]], title: Optional[str] = None,
                span: Optional[str] = None) -> "Page":
        return self.add(B.compare(options, title, span))

    def callout(self, body: str, label: Optional[str] = None, tone: str = "info", title: Optional[str] = None,
                span: Optional[str] = None) -> "Page":
        return self.add(B.callout(body, label, tone, title, span))

    def diagram(self, source: Any, step: Optional[int] = None, mode: Optional[str] = None,
                caption: Optional[str] = None, title: Optional[str] = None, span: Optional[str] = None,
                level: Optional[str] = None) -> "Page":
        """Embed a ``Diagram``, a payload dict or a diagram .json path (relative to the page file);
        `level` shows one of its detail diagrams (drill-down)."""
        return self.add(B.diagram(source, step, mode, caption, title, span, level=level))

    def chart(self, data: Union[Iterable[Any], Mapping[str, float], None] = None, unit: Optional[str] = None,
              title: Optional[str] = None, span: Optional[str] = None, **kw: Any) -> "Page":
        """Bars by default; ``kind=`` column, line, area, pie or donut; ``categories=`` + ``series=`` for
        several series (``stacked=True`` to stack). See :func:`yantra.blocks.chart`."""
        return self.add(B.chart(data, unit, title, span, **kw))

    def gantt(self, items: Iterable[Any], start: Optional[str] = None, today: Optional[Union[str, int]] = None,
              title: Optional[str] = None, span: Optional[str] = None, caption: Optional[str] = None,
              workdays: Optional[bool] = None, holidays: Optional[Iterable[str]] = None) -> "Page":
        """A project plan; see :func:`yantra.blocks.gantt` (``workdays=True`` skips weekends and ``holidays``)."""
        return self.add(B.gantt(items, start, today, title, span, caption=caption, workdays=workdays, holidays=holidays))

    def matrix(self, items: Iterable[Any], x: Any = None, y: Any = None, quadrants: Optional[Sequence[Any]] = None,
               grid: Optional[int] = None, title: Optional[str] = None, span: Optional[str] = None,
               heat: Optional[bool] = None, caption: Optional[str] = None) -> "Page":
        """A 2x2 or a heat map; see :func:`yantra.blocks.matrix`."""
        return self.add(B.matrix(items, x, y, quadrants, grid, title, span, heat=heat, caption=caption))

    def code(self, source: str, language: Optional[str] = None, title: Optional[str] = None,
             span: Optional[str] = None) -> "Page":
        return self.add(B.code(source, language, title, span))

    def sources(self, items: Iterable[Any], title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.sources(items, title, span))

    def timeline(self, items: Iterable[Any], title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.timeline(items, title, span))

    def faq(self, items: Iterable[Any], title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.faq(items, title, span))

    def checklist(self, items: Iterable[Any], title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.checklist(items, title, span))

    def quote(self, text: str, by: Optional[str] = None, source: Optional[str] = None,
              title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.quote(text, by, source, title, span))

    def image(self, src: str, alt: str = "", caption: Optional[str] = None, width: Optional[int] = None,
              title: Optional[str] = None, span: Optional[str] = None) -> "Page":
        return self.add(B.image(src, alt, caption, width, title, span))

    def kv(self, items: Union[Iterable[Any], Mapping[str, Any]], title: Optional[str] = None,
           span: Optional[str] = None) -> "Page":
        return self.add(B.kv(items, title, span))

    # --- output -------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        """The payload as a JSON-ready dict."""
        if self._answer is None:
            raise YantraError("call .answer(headline) before exporting the page")
        out: Dict[str, Any] = {"kind": "page", "meta": self.meta, "answer": self._answer}
        if self.blocks:
            out["blocks"] = self.blocks
        return out

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False) + "\n"

    def save_json(self, path: str) -> str:
        """Write the payload. Diagram ``src`` paths are kept as given (relative to this file)."""
        Path(path).write_text(self.to_json(), encoding="utf-8")
        return path

    def _resolved(self) -> Dict[str, Any]:
        """Payload with diagram ``src`` files inlined as ``diagram``.

        The CLI validates and builds a temp copy, and only loads ``src`` paths inside the
        page's own folder, so referenced diagrams are read here (relative to ``base_dir``)
        and embedded. Missing files are left as ``src`` so validation reports them.
        Drill-down ``{"$ref": "x.json"}`` levels inside those diagrams (and inside inline
        diagram dicts) are loaded too, relative to the file that contains them and only
        inside ``base_dir`` (see :func:`resolve_levels`).
        """
        payload = self.to_dict()
        base = Path(self.base_dir or os.getcwd())
        resolved = []
        for b in payload.get("blocks", []):
            if b.get("type") == "diagram" and b.get("src") and not b.get("diagram"):
                path = Path(b["src"]) if Path(b["src"]).is_absolute() else base / b["src"]
                if path.is_file():
                    b = {k: v for k, v in b.items() if k != "src"}
                    diagram = json.loads(path.read_text(encoding="utf-8"))
                    # Levels stay inside base_dir; a src outside it (an absolute path) is its own root
                    root = base if _inside(base, path) else path.parent
                    b["diagram"] = resolve_levels(diagram, path.parent, root)
            elif b.get("type") == "diagram" and isinstance(b.get("diagram"), dict):
                b = dict(b)
                b["diagram"] = resolve_levels(b["diagram"], base, base)
            resolved.append(b)
        if resolved:
            payload["blocks"] = resolved
        return payload

    def validate(self, lang: Optional[str] = None) -> Dict[str, Any]:
        """Run the Yantra validator (embedded diagrams included); returns {"valid", "errors", "warnings"}.
        `lang` translates the common messages ("auto": the page's language); codes do not change."""
        return validate_payload(self._resolved(), "page.json", lang=lang)

    def build_html(self, output_html: str, force: bool = False) -> str:
        """Validate and write a single-file offline HTML page (prints to A4)."""
        return build_payload(self._resolved(), output_html, force, "page.json")
