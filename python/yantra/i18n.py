"""Language settings shared by :class:`~yantra.Diagram` and :class:`~yantra.Page`.

Mirrors ``src/core/i18n.js``: ``meta.lang`` (BCP 47) picks the built-in interface strings
(English fallback), RTL languages or ``meta.dir="rtl"`` mirror the chrome, and
``meta.strings`` overrides labels by key. The Node validator checks the keys
(``i18n/unknown-string``); a test keeps these constants in step with the JS table.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping, Optional

from ._cli import YantraError

__all__ = ["LANGUAGES", "RTL_LANGUAGES", "is_rtl", "language_meta"]

#: Languages with built-in interface strings.
LANGUAGES = ("en", "es", "fr", "de", "pt", "hi", "ne", "zh", "ja", "ar")
#: Primary language subtags written right to left.
RTL_LANGUAGES = ("ar", "he", "fa", "ur", "yi", "ps", "sd", "ckb", "dv", "ug")

_TAG = re.compile(r"^[a-z]{2,3}(-[a-z0-9]{1,8})*$", re.IGNORECASE)


def is_rtl(lang: str, dir: Optional[str] = None) -> bool:
    """True when ``dir`` is "rtl", or no dir is given and ``lang`` is a right-to-left language."""
    if dir in ("ltr", "rtl"):
        return dir == "rtl"
    return lang.split("-")[0].lower() in RTL_LANGUAGES


def language_meta(lang: str, dir: Optional[str] = None,
                  strings: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """Validated ``meta`` fields for a language: ``lang``, optional ``dir`` and ``strings``."""
    if not isinstance(lang, str) or not _TAG.match(lang):
        raise YantraError(f"lang must be a BCP 47 tag such as 'en', 'pt-BR' or 'zh-Hans', not {lang!r}")
    if dir not in (None, "ltr", "rtl"):
        raise YantraError(f"dir must be 'ltr' or 'rtl', not {dir!r}")
    out: Dict[str, Any] = {"lang": lang}
    if dir:
        out["dir"] = dir
    if strings:
        bad = [k for k, v in strings.items() if not isinstance(k, str) or not isinstance(v, str)]
        if bad:
            raise YantraError(f"strings maps label keys to text (strings); bad entries: {bad}")
        out["strings"] = dict(strings)
    return out
