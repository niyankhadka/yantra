"""Diagram builder: nodes, edges, roles, groups, modes, scenarios, summary, inspector panels,
drill-down detail diagrams and links.

Produces payloads matching ``schemas/yantra-payload.schema.json``. Layout is automatic, so
nodes need no coordinates.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Union

from ._cli import YantraError, build_payload, export_payload, validate_payload
from .i18n import language_meta

__all__ = ["Diagram", "Node", "Edge", "Step", "Scenario", "Group", "COLORS", "SHAPES", "ARROWS", "DEFAULT_SCENARIO",
           "RELATIONS", "END_KINDS", "VISIBILITY", "ALGORITHMS", "GROUP_KINDS", "field", "method"]

COLORS = ("blue", "teal", "green", "amber", "rose", "violet", "orange", "slate")
#: Node shapes: cards ("card", "state"), state-machine pseudo-states ("initial", "final", "choice")
#: and the fork / join bar ("fork").
SHAPES = ("card", "state", "initial", "final", "choice", "fork")
#: Group kinds: "region" is a concurrent region of its parent group (a composite state).
GROUP_KINDS = ("region",)
#: End labels (``source_label`` / ``target_label``) are multiplicities or short role names.
END_LABEL_CHARS = 16
#: Edge arrow heads: at the target (default), at both ends, or none (an undirected link).
ARROWS = ("forward", "both", "none")
ALGORITHMS = ("layered", "tree", "mindmap")
COMPACT = (True, False, "auto")
#: UML relationship kinds (edge ``relation``). Triangles and diamonds sit on the source.
RELATIONS = ("inheritance", "realization", "composition", "aggregation", "association", "dependency")
#: Markers for ``source_end`` / ``target_end``: UML heads and ER cardinality (crow's foot).
END_KINDS = ("none", "arrow", "open-arrow", "triangle", "diamond", "open-diamond",
             "one", "zero-or-one", "many", "one-or-many", "zero-or-many")
VISIBILITY = ("+", "-", "#", "~")
DEFAULT_SCENARIO = "main"
NodeRef = Union["Node", str]


def _id(ref: Any) -> str:
    return ref.id if hasattr(ref, "id") else str(ref)


def _ids(refs: Optional[Iterable[Any]]) -> List[str]:
    return [_id(r) for r in refs] if refs else []


_SAFE_URL = re.compile(r"^(https?://|mailto:)[^\s\"'<>]+$", re.IGNORECASE)


def _url(url: Optional[str]) -> Optional[str]:
    """Links open only http(s) and mailto targets (the validator reports link/unsafe-url)."""
    if url is None:
        return None
    if not isinstance(url, str) or not _SAFE_URL.match(url.strip()):
        raise YantraError(f"url must be an http(s) or mailto: link, not {url!r}")
    return url.strip()


def _member(name: str, visibility: Optional[str], **flags: Any) -> Dict[str, Any]:
    if not name:
        raise YantraError("a field or method needs a name")
    if visibility is not None and visibility not in VISIBILITY:
        raise YantraError(f"visibility must be one of {VISIBILITY}, not {visibility!r}")
    m: Dict[str, Any] = {"name": name}
    if visibility is not None:
        m["visibility"] = visibility
    m.update({k: v for k, v in flags.items() if v not in (None, False, "")})
    return m


def field(name: str, type: Optional[str] = None, pk: bool = False, fk: bool = False, unique: bool = False,
          nullable: bool = False, ref: Optional[str] = None, visibility: Optional[str] = None,
          static: bool = False, note: Optional[str] = None) -> Dict[str, Any]:
    """A table column or class attribute. `ref` names what a foreign key points at ("node" or "node.field")."""
    return _member(name, visibility, type=type, pk=pk, fk=fk, unique=unique, nullable=nullable, ref=ref,
                   static=static, note=note)


def method(name: str, params: Optional[str] = None, type: Optional[str] = None, visibility: Optional[str] = None,
           static: bool = False, abstract: bool = False, note: Optional[str] = None) -> Dict[str, Any]:
    """A class operation, shown as ``name(params)`` with the return `type` on the right."""
    return _member(name, visibility, params=params, type=type, static=static, abstract=abstract, note=note)


def _members(items: Optional[Iterable[Any]]) -> List[Dict[str, Any]]:
    """Accept dicts from :func:`field` / :func:`method` or bare names."""
    out = []
    for m in items or []:
        if isinstance(m, str):
            m = {"name": m}
        if not isinstance(m, dict) or not m.get("name"):
            raise YantraError(f"fields and methods need a name, got {m!r}")
        out.append(dict(m))
    return out


class Node:
    """A card. ``data`` holds title, subtitle, tech, icon, badge, description, metadata, modes..."""

    def __init__(self, diagram: "Diagram", node_id: str, title: str, type: str = "node",
                 rank: Optional[int] = None, width: Optional[float] = None,
                 shape: Optional[str] = None, **data: Any):
        self.id = node_id
        self.type = type
        self.rank = rank
        self.width = width
        self.shape = shape
        self.data: Dict[str, Any] = {"title": title, **{k: v for k, v in data.items() if v not in (None, "", {})}}
        self._diagram = diagram

    def connect(self, target: NodeRef, label: str = "", **edge: Any) -> "Node":
        """Add an edge from this node to `target`; returns the target node for chaining."""
        target_id = _id(target)
        self._diagram.add_edge(self.id, target_id, label=label, **edge)
        return target if isinstance(target, Node) else self

    def child(self, child_id: str, title: str, type: Optional[str] = None, label: str = "",
              width: Optional[float] = None, **data: Any) -> "Node":
        """Add a card below this one in a tree or mind map (node plus parent -> child edge).
        `type` defaults to this node's type; returns the child for chaining."""
        node = self._diagram.add_node(child_id, title, type or self.type, width=width, **data)
        self._diagram.add_edge(self.id, child_id, label=label)
        return node

    def assistant(self, child_id: str, title: str, type: Optional[str] = None, label: str = "",
                  width: Optional[float] = None, **data: Any) -> "Node":
        """Add an assistant (staff) card: in a tree layout it sits beside this card on a short side
        connector instead of a level below (``data.assistant: true``). Returns the assistant."""
        return self.child(child_id, title, type, label=label, width=width, assistant=True, **data)

    def drill(self, diagram_id: str) -> "Node":
        """Open the detail diagram `diagram_id` (see :meth:`Diagram.detail`) from this card."""
        self.data["drill"] = _id(diagram_id)
        return self

    def mode_override(self, mode_id: str, **data: Any) -> "Node":
        """Override data fields (title, subtitle, tech, ...) while mode `mode_id` is shown."""
        self.data.setdefault("modes", {}).setdefault(mode_id, {}).update(data)
        return self

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"id": self.id, "type": self.type}
        if self.shape is not None:
            d["shape"] = self.shape
        if self.rank is not None:
            d["rank"] = self.rank
        if self.width is not None:
            d["width"] = self.width
        d["data"] = self.data
        return d


class Edge:
    """A connection. ``type``: sync | async | event | stream | data; ``style``: solid | dashed | dotted;
    ``arrow``: forward | both | none."""

    def __init__(self, edge_id: str, source: str, target: str, label: str = "", **extra: Any):
        self.id = edge_id
        self.source = source
        self.target = target
        self.label = label
        self.extra = {k: v for k, v in extra.items() if v is not None}

    def to_dict(self) -> Dict[str, Any]:
        d = {"id": self.id, "source": self.source, "target": self.target, **self.extra}
        if self.label:
            d["label"] = self.label
        return d


class Step:
    """A walkthrough step. No nodes/edges = an overview step."""

    def __init__(self, step_id: str, title: str, description: str = "",
                 nodes: Optional[List[str]] = None, edges: Optional[List[str]] = None,
                 payload: Optional[Dict[str, Any]] = None, url: Optional[str] = None):
        self.id = step_id
        self.title = title
        self.description = description
        self.nodes = _ids(nodes)
        self.edges = _ids(edges)
        self.payload = payload
        self.url = _url(url)

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"id": self.id, "title": self.title}
        if self.description:
            d["description"] = self.description
        if self.nodes:
            d["highlightNodes"] = self.nodes
        if self.edges:
            d["highlightEdges"] = self.edges
        if self.payload:
            d["payload"] = self.payload
        if self.url:
            d["url"] = self.url
        return d


class Scenario:
    """A named walkthrough; add steps with :meth:`step`."""

    def __init__(self, scenario_id: str, name: Optional[str], description: Optional[str] = None):
        self.id = scenario_id
        self.name = name
        self.description = description
        self.steps: List[Step] = []

    def step(self, title: str, description: str = "", nodes: Optional[Iterable[NodeRef]] = None,
             edges: Optional[Iterable[Any]] = None, payload: Optional[Dict[str, Any]] = None,
             step_id: Optional[str] = None, url: Optional[str] = None) -> Step:
        """Append a step. `nodes`/`edges` accept ids or Node/Edge objects; `payload` and `url`
        (an http(s) or mailto link) show in the inspector."""
        prefix = "step" if self.id == DEFAULT_SCENARIO else f"{self.id}-step"
        s = Step(step_id or f"{prefix}-{len(self.steps) + 1}", title, description,
                 _ids(nodes), _ids(edges), payload, url)
        self.steps.append(s)
        return s

    def to_dict(self, default_name: str = "Walkthrough") -> Dict[str, Any]:
        d: Dict[str, Any] = {"id": self.id, "name": self.name or default_name}
        if self.description:
            d["description"] = self.description
        d["steps"] = [s.to_dict() for s in self.steps]
        return d


class Group:
    """A titled boundary around nodes (e.g. a VPC, a team, a bounded context)."""

    def __init__(self, group_id: str, title: str, nodes: Iterable[NodeRef], parent: Optional[str] = None,
                 color: Optional[str] = None, description: Optional[str] = None, style: Optional[str] = None,
                 kind: Optional[str] = None):
        self.id = group_id
        self.title = title
        self.nodes = _ids(nodes)
        self.parent = parent
        self.color = color
        self.description = description
        self.style = style
        self.kind = kind

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"id": self.id, "title": self.title, "nodes": self.nodes}
        for key in ("parent", "color", "description", "style", "kind"):
            value = getattr(self, key)
            if value is not None:
                d[key] = value
        return d


class Diagram:
    """Build a Yantra diagram payload, validate it and compile it to a single offline HTML file."""

    def __init__(self, title: str, description: str = "", direction: str = "LR"):
        self.meta: Dict[str, Any] = {"title": title}
        if description:
            self.meta["description"] = description
        self.layout(direction)
        self.roles: Dict[str, Dict[str, str]] = {}
        self.modes: List[Dict[str, Any]] = []
        self.nodes: Dict[str, Node] = {}
        self.edges: Dict[str, Edge] = {}
        self.groups: Dict[str, Group] = {}
        self.panels: List[Dict[str, Any]] = []
        self.scenarios: Dict[str, Scenario] = {}
        self.scenario_name = "Walkthrough"
        self.diagrams: Dict[str, Any] = {}

    # --- meta ---------------------------------------------------------------
    def layout(self, direction: str = "LR", mode: Optional[str] = None, algorithm: Optional[str] = None,
               collapsed: Optional[Iterable[Any]] = None, compact: Optional[Union[bool, str]] = None) -> "Diagram":
        """Main flow direction: "LR" (left-to-right) or "TB" (top-to-bottom). `mode="manual"` uses node x/y.

        `algorithm`: "layered" (default; flows), "tree" (org charts, decision trees, breakdowns) or
        "mindmap" (central topic, balanced branches). `collapsed`: node ids (tree, mindmap) or group
        ids (layered) folded when the viewer opens. `compact` (TB trees): True lists leaf teams in a
        column under their parent, False never, "auto" (the default) only when the tree gets too wide."""
        if direction not in ("LR", "TB"):
            raise YantraError(f"layout direction must be 'LR' or 'TB', not {direction!r}")
        if mode not in (None, "auto", "manual"):
            raise YantraError(f"layout mode must be 'auto' or 'manual', not {mode!r}")
        if algorithm not in (None,) + ALGORITHMS:
            raise YantraError(f"layout algorithm must be one of {ALGORITHMS}, not {algorithm!r}")
        if compact is not None and compact is not True and compact is not False and compact != "auto":
            raise YantraError(f"layout compact must be True, False or 'auto', not {compact!r}")
        layout: Dict[str, Any] = {"direction": direction}
        if mode:
            layout["mode"] = mode
        if algorithm:
            layout["algorithm"] = algorithm
        if collapsed:
            layout["collapsed"] = _ids(collapsed)
        if compact is not None:
            layout["compact"] = compact
        self.meta["layout"] = layout
        return self

    def tree(self, direction: str = "TB", collapsed: Optional[Iterable[Any]] = None,
             compact: Optional[Union[bool, str]] = None) -> "Diagram":
        """Tidy tree layout: parents centred over children, comb connectors. Edges define the hierarchy.
        `compact` (TB): True / False / "auto" - list leaf teams in a column under their parent."""
        return self.layout(direction, algorithm="tree", collapsed=collapsed, compact=compact)

    def mindmap(self, collapsed: Optional[Iterable[Any]] = None) -> "Diagram":
        """Mind-map layout: the first root in the centre, branches left and right, one colour per branch."""
        return self.layout("LR", algorithm="mindmap", collapsed=collapsed)

    def collapse(self, *ids: Any) -> "Diagram":
        """Fold these subtrees (tree, mindmap) or groups (layered) when the viewer opens."""
        layout = self.meta.setdefault("layout", {"direction": "LR"})
        folded = layout.setdefault("collapsed", [])
        folded.extend(i for i in _ids(ids) if i not in folded)
        return self

    def summary(self, headline: str, points: Optional[List[str]] = None,
                facts: Optional[Mapping[str, Union[str, int, float]]] = None) -> "Diagram":
        """Summary card shown first in the inspector: a one-line takeaway, 3-5 points, key facts."""
        s: Dict[str, Any] = {"headline": headline}
        if points:
            s["points"] = list(points)
        if facts:
            s["facts"] = dict(facts)
        self.meta["summary"] = s
        return self

    def language(self, lang: str, dir: Optional[str] = None,
                 strings: Optional[Mapping[str, str]] = None) -> "Diagram":
        """Content language (BCP 47, e.g. "ne", "pt-BR", "ar"): interface labels, number formats and
        <html lang>. ar/he/fa/ur (or dir="rtl") mirror the chrome; the layout keeps its direction.
        strings overrides labels by key, e.g. {"story.next": "Continue"}."""
        for key in ("lang", "dir", "strings"):
            self.meta.pop(key, None)
        self.meta.update(language_meta(lang, dir, strings))
        return self

    def watermark(self, value: Union[bool, str]) -> "Diagram":
        """False hides the "Made with Yantra" badge; a string replaces its text."""
        self.meta["watermark"] = value
        return self

    def inspector(self, tabs: Optional[List[str]] = None, labels: Optional[Mapping[str, str]] = None,
                  on_node_click: Optional[str] = None) -> "Diagram":
        """Choose inspector tabs (summary, step, node or panel ids), rename built-in tabs and set
        what a card click opens ("node", "stay" or a panel id)."""
        ins: Dict[str, Any] = {}
        if tabs is not None:
            ins["tabs"] = list(tabs)
        if labels:
            bad = set(labels) - {"summary", "step", "node"}
            if bad:
                raise YantraError(f"inspector labels only rename summary, step, node (got {sorted(bad)})")
            ins["labels"] = dict(labels)
        if on_node_click:
            ins["onNodeClick"] = on_node_click
        self.meta["inspector"] = ins
        return self

    def role(self, type: str, label: str, color: str, icon: Optional[str] = None) -> "Diagram":
        """Declare a role (legend entry) for a node type. Colours: blue, teal, green, amber, rose, violet, orange, slate."""
        if color not in COLORS:
            raise YantraError(f"role colour must be one of {COLORS}, not {color!r}")
        self.roles[type] = {"label": label, "color": color, **({"icon": icon} if icon else {})}
        return self

    def add_mode(self, mode_id: str, name: str, badge: Optional[str] = None, description: Optional[str] = None,
                 hide_nodes: Optional[Iterable[NodeRef]] = None, hide_edges: Optional[Iterable[Any]] = None,
                 default: bool = False) -> "Diagram":
        """Add an alternative view (e.g. production vs local). `default=True` shows it first."""
        m: Dict[str, Any] = {"id": mode_id, "name": name}
        if badge:
            m["badge"] = badge
        if description:
            m["description"] = description
        if hide_nodes:
            m["hideNodes"] = _ids(hide_nodes)
        if hide_edges:
            m["hideEdges"] = _ids(hide_edges)
        self.modes.append(m)
        if default:
            self.meta["defaultMode"] = mode_id
        return self

    # --- graph --------------------------------------------------------------
    def add_node(self, node_id: str, title: str, type: str = "node", rank: Optional[int] = None,
                 width: Optional[float] = None, shape: Optional[str] = None, **data: Any) -> Node:
        """Add a card. Common data fields: subtitle, tech, icon, badge, description, metadata.
        `rank` forces the column (LR) or row (TB); `width` is 160-320 (default 220).
        `shape`: "card" (default), "state" (rounder card), or the textless pseudo-states
        "initial" (filled dot), "final" (ringed dot), "choice" (diamond) and "fork" (a fork / join
        bar across the flow; its `width` is the bar's length, 40-480)."""
        if node_id in self.nodes:
            raise YantraError(f"Duplicate node id: {node_id}")
        if shape is not None and shape not in SHAPES:
            raise YantraError(f"node shape must be one of {SHAPES}, not {shape!r}")
        if width is not None and shape == "fork" and not 40 <= width <= 480:
            raise YantraError(f"fork bar length (width) must be 40-480, not {width}")
        if width is not None and shape != "fork" and not 160 <= width <= 320:
            raise YantraError(f"node width must be 160-320, not {width}")
        if rank is not None and (not isinstance(rank, int) or rank < 0):
            raise YantraError(f"node rank must be a non-negative integer, not {rank!r}")
        if data.get("url") is not None:
            data["url"] = _url(data["url"])
        if data.get("drill") is not None:
            data["drill"] = _id(data["drill"])
        node = Node(self, node_id, title, type, rank=rank, width=width, shape=shape, **data)
        self.nodes[node_id] = node
        return node

    def add_entity(self, node_id: str, title: str, fields: Iterable[Any], type: str = "entity",
                   **data: Any) -> Node:
        """Add a table card (ER diagrams): `fields` from :func:`field`, drawn as rows (PK / FK / UK, type)."""
        return self.add_node(node_id, title, type, fields=_members(fields), **data)

    def add_class(self, node_id: str, title: str, fields: Optional[Iterable[Any]] = None,
                  methods: Optional[Iterable[Any]] = None, stereotype: Optional[str] = None,
                  type: str = "class", **data: Any) -> Node:
        """Add a class card: attributes (:func:`field`) and operations (:func:`method`) as two row
        sections; `stereotype` ("interface", "abstract", ...) shows as «stereotype»."""
        return self.add_node(node_id, title, type, fields=_members(fields), methods=_members(methods) or None,
                             stereotype=stereotype, **data)

    def add_edge(self, source: NodeRef, target: NodeRef, label: str = "", edge_id: Optional[str] = None,
                 type: Optional[str] = None, style: Optional[str] = None, arrow: Optional[str] = None,
                 relation: Optional[str] = None, source_end: Optional[str] = None, target_end: Optional[str] = None,
                 source_field: Optional[str] = None, target_field: Optional[str] = None,
                 source_label: Optional[str] = None, target_label: Optional[str] = None,
                 **extra: Any) -> Edge:
        """Connect two nodes. `type`: sync | async | event | stream | data; `style`: solid | dashed | dotted;
        `arrow`: forward (default) | both | none. `source == target` draws a self-loop.
        `url=` adds an http(s) or mailto link shown in the inspector.
        `relation`: a UML kind (see RELATIONS; triangles and diamonds sit on the source, so point edges
        parent -> child and whole -> part). `source_end` / `target_end`: ER cardinality or UML heads
        (see END_KINDS), e.g. source_end="one", target_end="zero-or-many". Notation replaces `arrow`.
        `source_field` / `target_field`: a field name on that end's card; the edge attaches at its row
        (e.g. source_field="id", target_field="customer_id"). `source_label` / `target_label`: short
        text beside each end, such as multiplicities ("1", "0..*") or a role name."""
        source, target = _id(source), _id(target)
        if style not in (None, "solid", "dashed", "dotted"):
            raise YantraError(f"edge style must be solid, dashed or dotted, not {style!r}")
        if arrow not in (None,) + ARROWS:
            raise YantraError(f"edge arrow must be one of {ARROWS}, not {arrow!r}")
        if extra.get("url") is not None:
            extra["url"] = _url(extra["url"])
        if relation is not None and relation not in RELATIONS:
            raise YantraError(f"edge relation must be one of {RELATIONS}, not {relation!r}")
        for end in (source_end, target_end):
            if end is not None and end not in END_KINDS:
                raise YantraError(f"edge end must be one of {END_KINDS}, not {end!r}")
        for name, text in (("source_label", source_label), ("target_label", target_label)):
            if text is not None and (not isinstance(text, str) or not text.strip() or len(text) > END_LABEL_CHARS):
                raise YantraError(f"edge {name} must be a short string (1-{END_LABEL_CHARS} chars), not {text!r}")
        for name, value in (("source_field", source_field), ("target_field", target_field)):
            if value is not None and (not isinstance(value, str) or not value):
                raise YantraError(f"edge {name} must be a field name, not {value!r}")
        extra.update({k: v for k, v in (("relation", relation), ("sourceEnd", source_end),
                                        ("targetEnd", target_end), ("sourceField", source_field),
                                        ("targetField", target_field), ("sourceLabel", source_label),
                                        ("targetLabel", target_label)) if v is not None})
        edge_id = edge_id or f"{source}-{target}"
        base, n = edge_id, 2
        while edge_id in self.edges:
            edge_id = f"{base}-{n}"
            n += 1
        edge = Edge(edge_id, source, target, label, type=type, style=style, arrow=arrow, **extra)
        self.edges[edge_id] = edge
        return edge

    def group(self, group_id: str, title: str, nodes: Iterable[NodeRef], parent: Optional[str] = None,
              color: Optional[str] = None, description: Optional[str] = None,
              style: Optional[str] = None, kind: Optional[str] = None) -> Group:
        """Draw a titled boundary around `nodes`; `parent` nests it inside another group.
        `kind="region"` makes it a concurrent region of its parent (a composite state): regions
        stack inside the parent, divided by dashed lines."""
        if group_id in self.groups:
            raise YantraError(f"Duplicate group id: {group_id}")
        if color is not None and color not in COLORS:
            raise YantraError(f"group colour must be one of {COLORS}, not {color!r}")
        if kind is not None and kind not in GROUP_KINDS:
            raise YantraError(f"group kind must be one of {GROUP_KINDS}, not {kind!r}")
        if kind == "region" and not parent:
            raise YantraError("a region needs a parent group (the composite state it divides)")
        g = Group(group_id, title, nodes, parent, color, description, style, kind)
        self.groups[group_id] = g
        return g

    def panel(self, panel_id: str, title: str, blocks: Iterable[Dict[str, Any]]) -> "Diagram":
        """Add a custom inspector tab built from `yantra.blocks` (blocks may carry ``nodes=[...]``)."""
        items = list(blocks)
        if not items:
            raise YantraError("a panel needs at least one block")
        self.panels.append({"id": panel_id, "title": title, "blocks": items})
        return self

    # --- drill-down -----------------------------------------------------------
    def detail(self, diagram_id: str, diagram: Union["Diagram", Mapping[str, Any], str, Path],
               from_node: Optional[NodeRef] = None) -> "Diagram":
        """Add a detail diagram that a card opens (drill-down): a ``Diagram``, a payload dict, or a
        relative path to a diagram .json file (stored as ``{"$ref": path}``, loaded by the CLI
        relative to the saved overview). `from_node` sets that card's ``drill``. Returns self."""
        if diagram_id in self.diagrams:
            raise YantraError(f"Duplicate detail diagram id: {diagram_id}")
        if isinstance(diagram, (str, Path)):
            ref = Path(diagram).as_posix()
            if Path(ref).is_absolute() or ref.startswith("/") or re.match(r"^[a-zA-Z][\w+.-]*:", ref) or not ref.lower().endswith(".json"):
                raise YantraError(f"detail diagram path must be a relative .json path, not {ref!r}")
            self.diagrams[diagram_id] = {"$ref": ref}
        elif isinstance(diagram, (Diagram, Mapping)):
            self.diagrams[diagram_id] = diagram
        else:
            raise TypeError("detail diagram must be a Diagram, a payload dict or a .json path")
        if from_node is not None:
            node = self.nodes.get(_id(from_node))
            if node is None:
                raise YantraError(f"Unknown node: {_id(from_node)}")
            node.drill(diagram_id)
        return self

    def start_level(self, diagram_id: str) -> "Diagram":
        """Open the viewer on a detail diagram instead of the overview."""
        self.meta["startLevel"] = diagram_id
        return self

    # --- story --------------------------------------------------------------
    def scenario(self, scenario_id: str, name: str, description: Optional[str] = None) -> Scenario:
        """Get or create a named walkthrough. ``add_step`` writes to the default scenario ("main")."""
        sc = self.scenarios.get(scenario_id)
        if sc is None:
            sc = self.scenarios[scenario_id] = Scenario(scenario_id, name, description)
        else:
            sc.name = name
            if description is not None:
                sc.description = description
        return sc

    def _default(self) -> Scenario:
        if DEFAULT_SCENARIO not in self.scenarios:
            self.scenarios[DEFAULT_SCENARIO] = Scenario(DEFAULT_SCENARIO, None)
        return self.scenarios[DEFAULT_SCENARIO]

    @property
    def steps(self) -> List[Step]:
        """Steps of the default scenario."""
        return self._default().steps

    def add_step(self, title: str, description: str = "", nodes: Optional[List[str]] = None,
                 edges: Optional[List[str]] = None, payload: Optional[Dict[str, Any]] = None,
                 url: Optional[str] = None) -> Step:
        """Add a step to the default walkthrough. With no nodes/edges it is an overview step."""
        return self._default().step(title, description, nodes, edges, payload, url=url)

    # --- output -------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        """The payload as a JSON-ready dict."""
        out: Dict[str, Any] = {"meta": self.meta}
        if self.roles:
            out["roles"] = self.roles
        if self.modes:
            out["modes"] = self.modes
        out["nodes"] = [n.to_dict() for n in self.nodes.values()]
        out["edges"] = [e.to_dict() for e in self.edges.values()]
        if self.groups:
            out["groups"] = [g.to_dict() for g in self.groups.values()]
        scenarios = [s.to_dict(self.scenario_name) for s in self.scenarios.values() if s.steps]
        if scenarios:
            out["scenarios"] = scenarios
        if self.panels:
            out["panels"] = self.panels
        if self.diagrams:
            out["diagrams"] = {k: v.to_dict() if isinstance(v, Diagram) else dict(v) for k, v in self.diagrams.items()}
        return out

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False) + "\n"

    def save_json(self, path: str) -> str:
        Path(path).write_text(self.to_json(), encoding="utf-8")
        return path

    def validate(self, base_dir: Optional[str] = None, lang: Optional[str] = None) -> Dict[str, Any]:
        """Run the Yantra validator; returns {"valid", "errors", "warnings"}. `base_dir` is the
        folder that detail-diagram paths (``detail(id, "x.json")``) are relative to. `lang`
        translates the common messages ("auto": the diagram's language); codes do not change."""
        return validate_payload(self.to_dict(), "diagram.json", base_dir, lang)

    def build_html(self, output_html: str, force: bool = False, base_dir: Optional[str] = None,
                   collapsed: Optional[Iterable[Any]] = None, expand_all: bool = False) -> str:
        """Validate and write a single-file offline HTML diagram (every detail level included).
        `collapsed` (ids) or `expand_all=True` set what is folded when it opens, for this file only."""
        return build_payload(self.to_dict(), output_html, force, "diagram.json", base_dir,
                             collapsed=collapsed, expand_all=expand_all)

    def export_svg(self, output_svg: str, theme: str = "light", step: Optional[int] = None,
                   view: Optional[str] = None, level: Optional[str] = None, collapsed: Optional[Iterable[Any]] = None,
                   expand_all: bool = False, base_dir: Optional[str] = None) -> str:
        """Write a static SVG of the diagram (or detail `level`); `step` is 1-based. `collapsed` /
        `expand_all` set what is folded, as in :meth:`build_html`."""
        return export_payload(self.to_dict(), output_svg, "svg", theme, step, view, level, collapsed, expand_all,
                              "diagram.json", base_dir)
