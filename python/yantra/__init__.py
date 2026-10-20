"""
Yantra Python SDK: build diagram and answer-page payloads in Python and compile them with the Yantra CLI.

Layout is automatic, so nodes need no coordinates. Requires Node.js >= 18; the CLI is found via
``YANTRA_CLI``, next to this package in the Yantra repository (``bin/yantra.js``), or on PATH (``yantra``).

    from yantra import Diagram, Page, blocks
"""

from __future__ import annotations

from . import blocks
from ._cli import YantraError, cli_command
from .diagram import ALGORITHMS, ARROWS, COLORS, END_KINDS, RELATIONS, SHAPES, Diagram, Edge, Group, Node, Scenario, Step, field, method
from .page import Page

__version__ = "2.0.0"

__all__ = [
    "Diagram", "Node", "Edge", "Step", "Scenario", "Group", "Page", "blocks",
    "YantraError", "COLORS", "SHAPES", "ARROWS", "RELATIONS", "END_KINDS", "ALGORITHMS", "field", "method",
    "cli_command", "__version__",
]
