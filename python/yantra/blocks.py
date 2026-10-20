"""Typed block constructors shared by answer pages (`Page`) and diagram panels (`Diagram.panel`).

Every function returns a plain ``dict`` matching ``schemas/yantra-page.schema.json``
(``blocks.items``). All accept ``title=`` and ``span=`` ("full" | "half"); ``nodes=[...]``
scopes a block in a diagram panel to those cards (ignored on pages).

Items are forgiving: a string becomes ``{"title": s}``, a ``(title, text)`` tuple becomes
``{"title", "text"}`` and dicts pass through unchanged.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Union

__all__ = [
    "Block", "BLOCK_TYPES", "TONES",
    "text", "points", "steps", "metrics", "table", "compare", "callout", "diagram", "chart", "code", "sources",
]

Block = Dict[str, Any]
BLOCK_TYPES = ("text", "points", "steps", "metrics", "table", "compare", "callout", "diagram", "chart", "code", "sources")
TONES = ("info", "good", "warn", "bad", "neutral")
Item = Union[str, Sequence[Any], Mapping[str, Any]]


def _clean(d: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


def _block(type: str, title: Optional[str], span: Optional[str], nodes: Optional[Iterable[Any]],
           **fields: Any) -> Block:
    if span not in (None, "full", "half"):
        raise ValueError(f"span must be 'full' or 'half', not {span!r}")
    out: Block = {"type": type}
    if title:
        out["title"] = title
    if span:
        out["span"] = span
    out.update(_clean(fields))
    if nodes:
        out["nodes"] = [getattr(n, "id", n) for n in nodes]
    return out


def _tone(tone: Optional[str]) -> Optional[str]:
    if tone is not None and tone not in TONES:
        raise ValueError(f"tone must be one of {TONES}, not {tone!r}")
    return tone


def _items(items: Iterable[Item], keys: Sequence[str]) -> List[Dict[str, Any]]:
    """Normalise items: str -> {keys[0]: s}; tuple -> zip(keys, tuple); dict -> as is."""
    out: List[Dict[str, Any]] = []
    for it in items:
        if isinstance(it, str):
            out.append({keys[0]: it})
        elif isinstance(it, Mapping):
            out.append(dict(it))
        else:
            vals = list(it)
            if len(vals) > len(keys):
                raise ValueError(f"item {it!r} has more than {len(keys)} fields ({', '.join(keys)})")
            out.append(_clean(dict(zip(keys, vals))))
    return out


def text(body: str, title: Optional[str] = None, span: Optional[str] = None,
         nodes: Optional[Iterable[Any]] = None) -> Block:
    """Prose (light markdown)."""
    return _block("text", title, span, nodes, body=body)


def points(items: Iterable[Item], title: Optional[str] = None, span: Optional[str] = None,
           nodes: Optional[Iterable[Any]] = None) -> Block:
    """Parallel ideas, reasons or risks: items ``{title, text?, tone?}`` (or ``(title, text, tone)``)."""
    return _block("points", title, span, nodes, items=_items(items, ("title", "text", "tone")))


def steps(items: Iterable[Item], title: Optional[str] = None, span: Optional[str] = None,
          nodes: Optional[Iterable[Any]] = None) -> Block:
    """A sequence or procedure: items ``{title, text?}``."""
    return _block("steps", title, span, nodes, items=_items(items, ("title", "text")))


def metrics(items: Union[Iterable[Item], Mapping[str, Any]], title: Optional[str] = None,
            span: Optional[str] = None, nodes: Optional[Iterable[Any]] = None) -> Block:
    """Numbers that matter: items ``{label, value, note?, tone?}``, ``(label, value, note)`` or a ``{label: value}`` mapping."""
    if isinstance(items, Mapping):
        rows = [{"label": str(k), "value": str(v)} for k, v in items.items()]
    else:
        rows = _items(items, ("label", "value", "note", "tone"))
        for r in rows:
            if "value" in r and not isinstance(r["value"], str):
                r["value"] = str(r["value"])
    return _block("metrics", title, span, nodes, items=rows)


def table(columns: Sequence[str], rows: Iterable[Sequence[Any]], title: Optional[str] = None,
          span: Optional[str] = None, nodes: Optional[Iterable[Any]] = None) -> Block:
    """Structured facts: one cell per column in every row."""
    cols = [str(c) for c in columns]
    body = [list(r) for r in rows]
    for r in body:
        if len(r) != len(cols):
            raise ValueError(f"table row {r!r} has {len(r)} cells, expected {len(cols)}")
    return _block("table", title, span, nodes, columns=cols, rows=body)


def compare(options: Iterable[Mapping[str, Any]], title: Optional[str] = None, span: Optional[str] = None,
            nodes: Optional[Iterable[Any]] = None) -> Block:
    """Options to choose between: ``{name, summary?, pros?, cons?, verdict?, recommended?}``."""
    opts = [dict(o) for o in options]
    for o in opts:
        if "name" not in o:
            raise ValueError(f"compare option needs a name: {o!r}")
    return _block("compare", title, span, nodes, options=opts)


def callout(body: str, label: Optional[str] = None, tone: str = "info", title: Optional[str] = None,
            span: Optional[str] = None, nodes: Optional[Iterable[Any]] = None) -> Block:
    """A warning, tip or key caveat."""
    return _block("callout", title, span, nodes, label=label, tone=_tone(tone), body=body)


def diagram(source: Any, step: Optional[int] = None, mode: Optional[str] = None, caption: Optional[str] = None,
            title: Optional[str] = None, span: Optional[str] = None,
            nodes: Optional[Iterable[Any]] = None) -> Block:
    """Embed a diagram: a ``Diagram`` instance, a payload dict, or a path to a diagram .json
    (relative to the page file)."""
    if hasattr(source, "to_dict"):
        ref: Dict[str, Any] = {"diagram": source.to_dict()}
    elif isinstance(source, Mapping):
        ref = {"diagram": dict(source)}
    elif isinstance(source, (str, Path)):
        ref = {"src": Path(source).as_posix()}
    else:
        raise TypeError("diagram source must be a Diagram, a payload dict or a path")
    if step is not None and step < 1:
        raise ValueError("diagram step is 1-based")
    return _block("diagram", title, span, nodes, **ref, step=step, mode=mode, caption=caption)


def chart(data: Union[Iterable[Item], Mapping[str, float]], unit: Optional[str] = None,
          title: Optional[str] = None, span: Optional[str] = None,
          nodes: Optional[Iterable[Any]] = None) -> Block:
    """Horizontal bars: ``[{label, value, tone?}]``, ``(label, value, tone)`` or ``{label: value}``."""
    if isinstance(data, Mapping):
        rows = [{"label": str(k), "value": v} for k, v in data.items()]
    else:
        rows = _items(data, ("label", "value", "tone"))
    for r in rows:
        if not isinstance(r.get("value"), (int, float)) or isinstance(r.get("value"), bool):
            raise ValueError(f"chart value must be a number: {r!r}")
    return _block("chart", title, span, nodes, unit=unit, data=rows)


def code(source: str, language: Optional[str] = None, title: Optional[str] = None, span: Optional[str] = None,
         nodes: Optional[Iterable[Any]] = None) -> Block:
    """A command, config or snippet."""
    return _block("code", title, span, nodes, language=language, code=source)


def sources(items: Iterable[Item], title: Optional[str] = None, span: Optional[str] = None,
            nodes: Optional[Iterable[Any]] = None) -> Block:
    """Where the facts come from: ``{title, url?, note?}`` (or ``(title, url, note)``)."""
    return _block("sources", title, span, nodes, items=_items(items, ("title", "url", "note")))
