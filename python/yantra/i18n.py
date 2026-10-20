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

__all__ = ["LANGUAGES", "RTL_LANGUAGES", "builtin_language", "is_rtl", "language_meta"]

#: Languages with built-in interface strings.
LANGUAGES = ("en", "es", "fr", "de", "pt", "it", "hi", "bn", "ne", "zh", "zh-Hant", "ja", "ko", "id",
             "ar", "he", "fa", "ur")
#: Primary language subtags written right to left.
RTL_LANGUAGES = ("ar", "he", "fa", "ur", "yi", "ps", "sd", "ckb", "dv", "ug")

_TAG = re.compile(r"^[a-z]{2,3}(-[a-z0-9]{1,8})*$", re.IGNORECASE)
_HANT_REGIONS = ("tw", "hk", "mo")


def builtin_language(lang: str) -> Optional[str]:
    """The built-in table a tag uses, or None (English labels): "pt-BR" -> "pt";
    Chinese is "zh-Hant" for the Hant script and for TW, HK and MO unless Hans is given."""
    if not isinstance(lang, str) or not _TAG.match(lang):
        return None
    parts = lang.lower().split("-")
    if parts[0] == "zh":
        sub = parts[1:]
        hant = "hant" in sub or ("hans" not in sub and any(s in _HANT_REGIONS for s in sub))
        return "zh-Hant" if hant else "zh"
    return parts[0] if parts[0] in LANGUAGES else None


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
