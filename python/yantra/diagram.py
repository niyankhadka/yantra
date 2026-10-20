"""Diagram builder: nodes, edges, roles, groups, modes, scenarios, summary and inspector panels.

Produces payloads matching ``schemas/yantra-payload.schema.json``. Layout is automatic, so
nodes need no coordinates.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Union

from ._cli import YantraError, build_payload, validate_payload

__all__ = ["Diagram", "Node", "Edge", "Step", "Scenario", "Group", "COLORS", "DEFAULT_SCENARIO"]

COLORS = ("blue", "teal", "green", "amber", "rose", "violet", "orange", "slate")
DEFAULT_SCENARIO = "main"
NodeRef = Union["Node", str]


def _id(ref: Any) -> str:
    return ref.id if hasattr(ref, "id") else str(ref)


def _ids(refs: Optional[Iterable[Any]]) -> List[str]:
    return [_id(r) for r in refs] if refs else []


class Node:
    """A card. ``data`` holds title, subtitle, tech, icon, badge, description, metadata, modes..."""

    def __init__(self, diagram: "Diagram", node_id: str, title: str, type: str = "node",
                 rank: Optional[int] = None, width: Optional[float] = None, **data: Any):
        self.id = node_id
        self.type = type
        self.rank = rank
        self.width = width
        self.data: Dict[str, Any] = {"title": title, **{k: v for k, v in data.items() if v not in (None, "", {})}}
        self._diagram = diagram

    def connect(self, target: NodeRef, label: str = "", **edge: Any) -> "Node":
        """Add an edge from this node to `target`; returns the target node for chaining."""
        target_id = _id(target)
        self._diagram.add_edge(self.id, target_id, label=label, **edge)
        return target if isinstance(target, Node) else self

    def mode_override(self, mode_id: str, **data: Any) -> "Node":
        """Override data fields (title, subtitle, tech, ...) while mode `mode_id` is shown."""
        self.data.setdefault("modes", {}).setdefault(mode_id, {}).update(data)
        return self

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"id": self.id, "type": self.type}
        if self.rank is not None:
            d["rank"] = self.rank
        if self.width is not None:
            d["width"] = self.width
        d["data"] = self.data
        return d


class Edge:
    """A connection. ``type``: sync | async | event | stream | data; ``style``: solid | dashed | dotted."""

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
                 payload: Optional[Dict[str, Any]] = None):
        self.id = step_id
        self.title = title
        self.description = description
        self.nodes = _ids(nodes)
        self.edges = _ids(edges)
        self.payload = payload

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
             step_id: Optional[str] = None) -> Step:
        """Append a step. `nodes`/`edges` accept ids or Node/Edge objects; `payload` shows in the inspector."""
        prefix = "step" if self.id == DEFAULT_SCENARIO else f"{self.id}-step"
        s = Step(step_id or f"{prefix}-{len(self.steps) + 1}", title, description,
                 _ids(nodes), _ids(edges), payload)
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
                 color: Optional[str] = None, description: Optional[str] = None, style: Optional[str] = None):
        self.id = group_id
        self.title = title
        self.nodes = _ids(nodes)
        self.parent = parent
        self.color = color
        self.description = description
        self.style = style

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"id": self.id, "title": self.title, "nodes": self.nodes}
        for key in ("parent", "color", "description", "style"):
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

    # --- meta ---------------------------------------------------------------
    def layout(self, direction: str = "LR", mode: Optional[str] = None) -> "Diagram":
        """Main flow direction: "LR" (left-to-right) or "TB" (top-to-bottom). `mode="manual"` uses node x/y."""
        if direction not in ("LR", "TB"):
            raise YantraError(f"layout direction must be 'LR' or 'TB', not {direction!r}")
        if mode not in (None, "auto", "manual"):
            raise YantraError(f"layout mode must be 'auto' or 'manual', not {mode!r}")
        self.meta["layout"] = {"direction": direction, **({"mode": mode} if mode else {})}
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
                 width: Optional[float] = None, **data: Any) -> Node:
        """Add a card. Common data fields: subtitle, tech, icon, badge, description, metadata.
        `rank` forces the column (LR) or row (TB); `width` is 160-320 (default 220)."""
        if node_id in self.nodes:
            raise YantraError(f"Duplicate node id: {node_id}")
        if width is not None and not 160 <= width <= 320:
            raise YantraError(f"node width must be 160-320, not {width}")
        if rank is not None and (not isinstance(rank, int) or rank < 0):
            raise YantraError(f"node rank must be a non-negative integer, not {rank!r}")
        node = Node(self, node_id, title, type, rank=rank, width=width, **data)
        self.nodes[node_id] = node
        return node

    def add_edge(self, source: NodeRef, target: NodeRef, label: str = "", edge_id: Optional[str] = None,
                 type: Optional[str] = None, style: Optional[str] = None, **extra: Any) -> Edge:
        """Connect two nodes. `type`: sync | async | event | stream | data; `style`: solid | dashed | dotted."""
        source, target = _id(source), _id(target)
        if style not in (None, "solid", "dashed", "dotted"):
            raise YantraError(f"edge style must be solid, dashed or dotted, not {style!r}")
        edge_id = edge_id or f"{source}-{target}"
        base, n = edge_id, 2
        while edge_id in self.edges:
            edge_id = f"{base}-{n}"
            n += 1
        edge = Edge(edge_id, source, target, label, type=type, style=style, **extra)
        self.edges[edge_id] = edge
        return edge

    def group(self, group_id: str, title: str, nodes: Iterable[NodeRef], parent: Optional[str] = None,
              color: Optional[str] = None, description: Optional[str] = None,
              style: Optional[str] = None) -> Group:
        """Draw a titled boundary around `nodes`; `parent` nests it inside another group."""
        if group_id in self.groups:
            raise YantraError(f"Duplicate group id: {group_id}")
        if color is not None and color not in COLORS:
            raise YantraError(f"group colour must be one of {COLORS}, not {color!r}")
        g = Group(group_id, title, nodes, parent, color, description, style)
        self.groups[group_id] = g
        return g

    def panel(self, panel_id: str, title: str, blocks: Iterable[Dict[str, Any]]) -> "Diagram":
        """Add a custom inspector tab built from `yantra.blocks` (blocks may carry ``nodes=[...]``)."""
        items = list(blocks)
        if not items:
            raise YantraError("a panel needs at least one block")
        self.panels.append({"id": panel_id, "title": title, "blocks": items})
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
                 edges: Optional[List[str]] = None, payload: Optional[Dict[str, Any]] = None) -> Step:
        """Add a step to the default walkthrough. With no nodes/edges it is an overview step."""
        return self._default().step(title, description, nodes, edges, payload)

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
        return out

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False) + "\n"

    def save_json(self, path: str) -> str:
        Path(path).write_text(self.to_json(), encoding="utf-8")
        return path

    def validate(self) -> Dict[str, Any]:
        """Run the Yantra validator; returns {"valid", "errors", "warnings"}."""
        return validate_payload(self.to_dict(), "diagram.json")

    def build_html(self, output_html: str, force: bool = False) -> str:
        """Validate and write a single-file offline HTML diagram."""
        return build_payload(self.to_dict(), output_html, force, "diagram.json")
