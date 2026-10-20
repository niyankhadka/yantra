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
    "gantt", "matrix", "CHART_KINDS",
]

Block = Dict[str, Any]
BLOCK_TYPES = ("text", "points", "steps", "metrics", "table", "compare", "callout", "diagram", "chart", "code", "sources",
               "gantt", "matrix")
CHART_KINDS = ("bar", "column", "line", "area", "pie", "donut")
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
    """Numbers that matter: items ``{label, value, note?, tone?, trend?}``, ``(label, value, note)`` or a
    ``{label: value}`` mapping. ``trend`` (a list of numbers) draws a sparkline under the value."""
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


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def chart(data: Union[Iterable[Item], Mapping[str, float], None] = None, unit: Optional[str] = None,
          title: Optional[str] = None, span: Optional[str] = None,
          nodes: Optional[Iterable[Any]] = None, *, kind: Optional[str] = None,
          categories: Optional[Sequence[Any]] = None,
          series: Optional[Union[Mapping[str, Sequence[Any]], Iterable[Mapping[str, Any]]]] = None,
          stacked: Optional[bool] = None, prefix: Optional[str] = None,
          caption: Optional[str] = None) -> Block:
    """A chart. ``data`` (``[{label, value, tone?}]``, ``(label, value, tone)`` or ``{label: value}``)
    for one series; or ``categories`` plus ``series`` (``{name: values}`` or ``[{name, values, tone?}]``,
    ``None`` for a gap) for several. ``kind``: bar (default, horizontal), column, line, area, pie, donut."""
    if kind is not None and kind not in CHART_KINDS:
        raise ValueError(f"chart kind must be one of {CHART_KINDS}, not {kind!r}")
    fields: Dict[str, Any] = {}
    if series is not None:
        if data is not None:
            raise ValueError("give a chart either data or categories + series, not both")
        if kind in ("pie", "donut"):
            raise ValueError(f"{kind} charts take data, not series")
        if categories is None:
            raise ValueError("chart series need categories (one per value)")
        cats = list(categories)
        rows = ([{"name": str(k), "values": list(v)} for k, v in series.items()] if isinstance(series, Mapping)
                else [dict(s) for s in series])
        for s in rows:
            if "name" not in s or not isinstance(s.get("values"), (list, tuple)):
                raise ValueError(f"chart series needs name and values: {s!r}")
            s["values"] = list(s["values"])
            if len(s["values"]) != len(cats):
                raise ValueError(f"series {s['name']!r} has {len(s['values'])} values for {len(cats)} categories")
            if not all(v is None or _is_num(v) for v in s["values"]):
                raise ValueError(f"series {s['name']!r} values must be numbers or None")
        fields.update(categories=cats, series=rows)
    else:
        if data is None:
            raise ValueError("chart needs data, or categories + series")
        if isinstance(data, Mapping):
            rows = [{"label": str(k), "value": v} for k, v in data.items()]
        else:
            rows = _items(data, ("label", "value", "tone"))
        for r in rows:
            if not _is_num(r.get("value")):
                raise ValueError(f"chart value must be a number: {r!r}")
        if kind in ("pie", "donut") and any(r["value"] < 0 for r in rows):
            raise ValueError(f"{kind} chart values must be 0 or more")
        fields["data"] = rows
    return _block("chart", title, span, nodes, kind=kind, stacked=stacked, prefix=prefix, unit=unit,
                  caption=caption, **fields)


def gantt(items: Iterable[Item], start: Optional[str] = None, today: Optional[Union[str, int]] = None,
          title: Optional[str] = None, span: Optional[str] = None, nodes: Optional[Iterable[Any]] = None,
          caption: Optional[str] = None) -> Block:
    """A project plan: items ``{title, id?, group?, start?, end? | days?, after?, milestone?, progress?, tone?}``
    or ``(title, start, days)``. Dates are ``YYYY-MM-DD`` or ``DD/MM/YYYY``; numbers count days from ``start``."""
    rows = _items(items, ("title", "start", "days"))
    for r in rows:
        if not r.get("title"):
            raise ValueError(f"gantt task needs a title: {r!r}")
        if not r.get("milestone") and "days" not in r and "end" not in r:
            raise ValueError(f"gantt task {r['title']!r} needs days or end (or milestone=True)")
        if isinstance(r.get("after"), tuple):
            r["after"] = list(r["after"])
    return _block("gantt", title, span, nodes, start=start, today=today, caption=caption, items=rows)


def matrix(items: Iterable[Item], x: Optional[Union[str, Mapping[str, Any]]] = None,
           y: Optional[Union[str, Mapping[str, Any]]] = None, quadrants: Optional[Sequence[Any]] = None,
           grid: Optional[int] = None, title: Optional[str] = None, span: Optional[str] = None,
           nodes: Optional[Iterable[Any]] = None, heat: Optional[bool] = None,
           caption: Optional[str] = None) -> Block:
    """A 2x2 (``grid`` 2: items placed by ``x``/``y`` score, default 0-10; ``quadrants`` = 4 titles from the
    top left) or a 3x3-5x5 heat map (``x``/``y`` are cell numbers). Items ``{label, x, y, tone?}`` or ``(label, x, y)``."""
    if grid is not None and grid not in (2, 3, 4, 5):
        raise ValueError("matrix grid must be 2, 3, 4 or 5")
    rows = _items(items, ("label", "x", "y", "tone"))
    for r in rows:
        if "label" not in r or not _is_num(r.get("x")) or not _is_num(r.get("y")):
            raise ValueError(f"matrix item needs label, x and y (numbers): {r!r}")
    if quadrants is not None and ((grid or 2) != 2 or len(quadrants) != 4):
        raise ValueError("quadrants needs exactly 4 titles and grid 2")
    return _block("matrix", title, span, nodes, grid=grid, x=dict(x) if isinstance(x, Mapping) else x,
                  y=dict(y) if isinstance(y, Mapping) else y,
                  quadrants=list(quadrants) if quadrants is not None else None, heat=heat, caption=caption,
                  items=rows)


def code(source: str, language: Optional[str] = None, title: Optional[str] = None, span: Optional[str] = None,
         nodes: Optional[Iterable[Any]] = None) -> Block:
    """A command, config or snippet."""
    return _block("code", title, span, nodes, language=language, code=source)


def sources(items: Iterable[Item], title: Optional[str] = None, span: Optional[str] = None,
            nodes: Optional[Iterable[Any]] = None) -> Block:
    """Where the facts come from: ``{title, url?, note?}`` (or ``(title, url, note)``)."""
    return _block("sources", title, span, nodes, items=_items(items, ("title", "url", "note")))
