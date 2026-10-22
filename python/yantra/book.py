"""Books: several answer pages (chapters) read in order, built into one offline HTML file.

Produces payloads matching ``schemas/yantra-book.schema.json``. A chapter is a :class:`Page`,
a page dict, or a path to a page's ``.json`` file (written as ``{"$ref": path}``)::

    from yantra import Book, Page

    intro = Page("What is a saga?").answer("A sequence of local steps, each undoable.")
    book = Book("Checkout, end to end", description="How our checkout works.")
    book.summary("Payments are approved in seconds and settled overnight.")
    book.chapter(intro).chapter("chapters/incident.json")
    book.build_html("checkout.html")
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from ._cli import YantraError, build_payload, validate_payload
from .i18n import language_meta
from .page import READING_MODES, Page, _inside

__all__ = ["Book"]

Chapter = Union[Page, Dict[str, Any], str, os.PathLike]


class Book:
    """A book of answer pages. ``base_dir`` is where chapter paths (and their diagram
    ``src`` files) are read from; it defaults to the current directory."""

    def __init__(self, title: str, description: Optional[str] = None, author: Optional[str] = None,
                 date: Optional[str] = None, kicker: Optional[str] = None, footer: Optional[str] = None,
                 base_dir: Optional[str] = None, lang: Optional[str] = None):
        self.meta: Dict[str, Any] = {k: v for k, v in {
            "title": title, "description": description, "author": author, "date": date,
            "kicker": kicker, "footer": footer,
        }.items() if v is not None}
        if lang:
            self.meta.update(language_meta(lang))
        self.base_dir = base_dir
        self._summary: Optional[str] = None
        self.chapters: List[Chapter] = []

    def summary(self, text: str) -> "Book":
        """The whole book in two or three sentences, shown on the cover."""
        self._summary = text
        return self

    def chapter(self, page: Chapter) -> "Book":
        """Append a chapter: a :class:`Page`, a page dict, or a path to a page ``.json`` file."""
        if not isinstance(page, (Page, dict, str, os.PathLike)):
            raise YantraError(f"a chapter is a Page, a page dict or a path, not {type(page).__name__}")
        if isinstance(page, dict) and page.get("kind") not in (None, "page"):
            raise YantraError(f"a chapter is an answer page, not kind {page.get('kind')!r}")
        self.chapters.append(page)
        return self

    def reading(self, mode: str) -> "Book":
        """How the book opens: "book" (default: one screen at a time), "scroll" or "present"."""
        if mode not in READING_MODES:
            raise YantraError(f"reading must be one of {READING_MODES}, not {mode!r}")
        self.meta["reading"] = mode
        return self

    def language(self, lang: str, dir: Optional[str] = None, strings: Optional[Dict[str, str]] = None) -> "Book":
        """Language of the book's interface; chapters without their own language inherit it."""
        for key in ("lang", "dir", "strings"):
            self.meta.pop(key, None)
        self.meta.update(language_meta(lang, dir, strings))
        return self

    def watermark(self, value: Union[bool, str]) -> "Book":
        """False hides the "Made with Yantra" badge; a string replaces its text."""
        self.meta["watermark"] = value
        return self

    # --- output -------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        """The payload as a JSON-ready dict (chapter paths stay ``{"$ref": path}``)."""
        if not self.chapters:
            raise YantraError("add at least one chapter with .chapter(page) before exporting the book")
        chapters: List[Dict[str, Any]] = []
        for ch in self.chapters:
            if isinstance(ch, Page):
                page = ch.to_dict()
                page.pop("kind", None)
                chapters.append(page)
            elif isinstance(ch, dict):
                chapters.append({k: v for k, v in ch.items() if k != "kind"})
            else:
                chapters.append({"$ref": Path(ch).as_posix()})
        out: Dict[str, Any] = {"kind": "book", "meta": self.meta}
        if self._summary:
            out["summary"] = self._summary
        out["chapters"] = chapters
        return out

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False) + "\n"

    def save_json(self, path: str) -> str:
        """Write the payload. Chapter paths are kept as given (relative to the book's file)."""
        Path(path).write_text(self.to_json(), encoding="utf-8")
        return path

    def _resolved(self) -> Dict[str, Any]:
        """Payload with chapter files and their diagram ``src`` files inlined.

        The CLI validates and builds a temp copy, so files are read here: chapter paths
        relative to ``base_dir`` (and inside it), diagram ``src`` paths relative to each
        chapter's own file. Missing or outside files stay as ``$ref`` so validation reports them.
        """
        payload = self.to_dict()
        base = Path(self.base_dir or os.getcwd())
        resolved = []
        for ch in payload["chapters"]:
            if isinstance(ch.get("$ref"), str):
                path = base / ch["$ref"]
                if path.is_file() and path.suffix.lower() == ".json" and _inside(base, path):
                    page = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(page.get("blocks"), list):
                        page["blocks"] = Page._resolve_blocks(page["blocks"], path.parent)
                    page.pop("kind", None)
                    ch = page
            elif isinstance(ch.get("blocks"), list):
                ch = dict(ch)
                ch["blocks"] = Page._resolve_blocks(ch["blocks"], base)
            resolved.append(ch)
        payload["chapters"] = resolved
        return payload

    def validate(self, lang: Optional[str] = None) -> Dict[str, Any]:
        """Run the Yantra validator on every chapter; returns {"valid", "errors", "warnings"}.
        `lang` translates the common messages ("auto": the book's language); codes do not change."""
        return validate_payload(self._resolved(), "book.json", lang=lang)

    def build_html(self, output_html: str, force: bool = False) -> str:
        """Validate and write a single-file offline HTML book (scroll, book and present modes)."""
        return build_payload(self._resolved(), output_html, force, "book.json")
