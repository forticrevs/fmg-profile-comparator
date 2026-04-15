"""In-memory TTL cache for FMG syntax responses.

Schema/syntax data is effectively static for the lifetime of a FortiManager
firmware version, so we can cache aggressively. Keyed by
`(fmg_host, cache_key)` so multiple FMG instances don't collide, with a
coarse TTL that's long enough to survive a normal user session but short
enough that a firmware upgrade will refresh within a day.

Entry shape:
    {
        "fields": [{"name": str, "label": str, "help": str, "type": str}, ...],
        "subobjects": {
            # Subobjects are indexed under BOTH their dotted path
            # ("ftgd-wf.filters") AND their leaf name ("filters") so the
            # frontend can look up nested collections either way.
            "filters":        [{"name": ..., "label": ..., ...}, ...],
            "ftgd-wf.filters":[{"name": ..., "label": ..., ...}, ...],
            ...
        },
    }

Notes on "excluded": FMG's syntax marks many real, user-visible fields as
`excluded: true` — we still show them. That flag marks CLI-hidden attrs
internal to FMG's config engine, not "don't expose to users". Filtering
them out drops 50-80% of real fields on profile types like webfilter.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

_TTL_SECONDS = 24 * 3600  # 24h
_lock = asyncio.Lock()
_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


def _humanize(name: str) -> str:
    return name.replace("-", " ").replace("_", " ").strip().title()


def _extract_attrs(attr_map: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(attr_map, dict):
        return out
    for field_name, meta in attr_map.items():
        if not isinstance(meta, dict):
            continue
        help_text = str(meta.get("help", "")).strip()
        # Append enum options to the help text so the user can see the
        # allowed values at a glance. FMG exposes these as `opts help`.
        opts_help = meta.get("opts help")
        if isinstance(opts_help, dict) and opts_help:
            pairs = [f"{k}: {v}" for k, v in opts_help.items() if v]
            if pairs:
                help_text = (help_text + "\n" if help_text else "") + "\n".join(pairs)
        elif isinstance(meta.get("opts"), dict) and meta["opts"]:
            help_text = (help_text + "\n" if help_text else "") + "Values: " + ", ".join(
                str(k) for k in meta["opts"].keys()
            )
        out.append({
            "name": field_name,
            "label": _humanize(field_name),
            "help": help_text,
            "type": str(meta.get("type", "")),
        })
    out.sort(key=lambda f: f["name"])
    return out


def _walk_subobj(
    subobj: Any,
    prefix: str,
    accum: dict[str, list[dict[str, Any]]],
) -> None:
    """Recursively walk a `subobj` tree, registering each child under
    both its full dotted path and its leaf name."""
    if not isinstance(subobj, dict):
        return
    for sub_name, sub_def in subobj.items():
        if not isinstance(sub_def, dict):
            continue
        dotted = f"{prefix}.{sub_name}" if prefix else sub_name
        attrs = _extract_attrs(sub_def.get("attr"))
        # Index under the dotted path (canonical) and the leaf name
        # (convenience — only if not already taken by a different path).
        accum[dotted] = attrs
        accum.setdefault(sub_name, attrs)
        nested = sub_def.get("subobj")
        if nested:
            _walk_subobj(nested, dotted, accum)


def parse_syntax(raw: Any) -> dict[str, Any]:
    """Walk an FMG syntax response and pull out a flat field list plus
    (recursively flattened) subobject field lists.

    FMG's syntax payload wraps the actual schema one level deep under a
    single "table name" key (e.g. `"dlp filepattern"`). We unwrap that
    automatically so callers don't have to know the table name.
    """
    if not isinstance(raw, dict) or not raw:
        return {"fields": [], "subobjects": {}}

    # Unwrap the single table wrapper ({"dlp filepattern": {...}}).
    schema = raw
    if len(raw) == 1:
        only_value = next(iter(raw.values()))
        if isinstance(only_value, dict) and ("attr" in only_value or "subobj" in only_value):
            schema = only_value

    fields = _extract_attrs(schema.get("attr"))
    subobjects: dict[str, list[dict[str, Any]]] = {}
    _walk_subobj(schema.get("subobj"), "", subobjects)

    return {"fields": fields, "subobjects": subobjects}


async def get_or_fetch(
    host: str,
    cache_key: str,
    loader,
) -> dict[str, Any]:
    """Return cached parsed schema or populate via `loader` (async callable
    returning the raw FMG syntax response)."""
    key = (host or "_default", cache_key)
    now = time.monotonic()
    async with _lock:
        hit = _cache.get(key)
        if hit and (now - hit[0]) < _TTL_SECONDS:
            return hit[1]

    raw = await loader()
    parsed = parse_syntax(raw)

    async with _lock:
        _cache[(host or "_default", cache_key)] = (time.monotonic(), parsed)
    return parsed


def invalidate(host: str | None = None) -> None:
    """Drop cache entries (all entries if host is None)."""
    global _cache
    if host is None:
        _cache = {}
        return
    _cache = {k: v for k, v in _cache.items() if k[0] != host}
