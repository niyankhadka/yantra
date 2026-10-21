"""
Yantra Python SDK: build diagram and answer-page payloads in Python and compile them with the Yantra CLI.

Layout is automatic, so nodes need no coordinates. Validating and building HTML need Node.js >= 20.19;
the CLI is found via ``YANTRA_CLI``, next to this package in the Yantra repository (``bin/yantra.js``),
on PATH (``yantra``), or through ``npx`` (package ``@niyankhadka/yantra``).

    from yantra import Diagram, Page, blocks
"""

from __future__ import annotations

from . import blocks
from ._cli import YantraError, cli_command, import_diagram, init_project
from .diagram import ALGORITHMS, ARROWS, COLORS, END_KINDS, GROUP_KINDS, MINI_KINDS, RELATIONS, SHAPES, Diagram, Edge, Group, Node, Scenario, Step, field, method, mini_chart
from .i18n import LANGUAGES, RTL_LANGUAGES, builtin_language, is_rtl
from .page import Page, resolve_levels

__version__ = "1.1.0"

__all__ = [
    "Diagram", "Node", "Edge", "Step", "Scenario", "Group", "Page", "blocks",
    "YantraError", "COLORS", "SHAPES", "ARROWS", "RELATIONS", "END_KINDS", "GROUP_KINDS", "ALGORITHMS", "MINI_KINDS", "field", "method", "mini_chart",
    "LANGUAGES", "RTL_LANGUAGES", "builtin_language", "is_rtl", "cli_command", "import_diagram", "init_project", "resolve_levels", "__version__",
]
