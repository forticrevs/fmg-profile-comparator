"""Eager firewall object resolver with 5-minute TTL cache.

The policy viewer needs to resolve address / addrgrp / service / service
group names into their concrete definitions for hover tooltips. Fetching
on-demand per hover is unworkable, so we eagerly pull the full object
catalog for an ADOM on first use and cache it for 5 minutes.

Cache key = (adom, session_host) so different FMG instances don't stomp
each other. The resolver returns slim dicts — just the fields the UI
needs — to keep the JSON payload bounded.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from app.services.fmg_client import FMGClient

_TTL_SECONDS = 300  # 5 min
_lock = asyncio.Lock()
_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


ADDRESS_FIELDS = [
    "name",
    "type",
    "subnet",
    "start-ip",
    "end-ip",
    "fqdn",
    "wildcard",
    "country",
    "macaddr",
    "sub-type",
    "sdn",
    "filter",
    "route-tag",
    "interface",
    "associated-interface",
    "comment",
]

ADDRGRP_FIELDS = ["name", "member", "comment"]

SERVICE_FIELDS = [
    "name",
    "protocol",
    "tcp-portrange",
    "udp-portrange",
    "sctp-portrange",
    "icmptype",
    "icmpcode",
    "comment",
]

SERVICE_GROUP_FIELDS = ["name", "member", "comment"]


async def _fetch_list(
    fmg: FMGClient, url: str, fields: list[str]
) -> list[dict[str, Any]]:
    try:
        data = await fmg._call("get", [{"url": url, "fields": fields}], verbose=True)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _index_by_name(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if isinstance(name, str) and name:
            out[name] = item
    return out


async def _build_object_map(fmg: FMGClient, adom: str) -> dict[str, Any]:
    """Fetch address, addrgrp, service, service group lists in parallel."""
    base = f"/pm/config/adom/{adom}/obj/firewall"
    addresses, addrgrps, services, svc_groups = await asyncio.gather(
        _fetch_list(fmg, f"{base}/address", ADDRESS_FIELDS),
        _fetch_list(fmg, f"{base}/addrgrp", ADDRGRP_FIELDS),
        _fetch_list(fmg, f"{base}/service/custom", SERVICE_FIELDS),
        _fetch_list(fmg, f"{base}/service/group", SERVICE_GROUP_FIELDS),
    )
    return {
        "addresses": _index_by_name(addresses),
        "addrgrps": _index_by_name(addrgrps),
        "services": _index_by_name(services),
        "service_groups": _index_by_name(svc_groups),
        "counts": {
            "addresses": len(addresses),
            "addrgrps": len(addrgrps),
            "services": len(services),
            "service_groups": len(svc_groups),
        },
    }


async def get_object_map(
    fmg: FMGClient, adom: str, *, force_refresh: bool = False
) -> dict[str, Any]:
    """Return the cached object map for (adom, fmg_host), refreshing if stale."""
    host = getattr(fmg, "_host", "") or ""
    key = (adom, host)
    now = time.monotonic()

    async with _lock:
        cached = _cache.get(key)
        if not force_refresh and cached and (now - cached[0]) < _TTL_SECONDS:
            return cached[1]

        obj_map = await _build_object_map(fmg, adom)
        _cache[key] = (now, obj_map)
        return obj_map


def invalidate(adom: str | None = None) -> None:
    """Clear cache entries — all, or just for a given ADOM."""
    if adom is None:
        _cache.clear()
        return
    for key in list(_cache.keys()):
        if key[0] == adom:
            _cache.pop(key, None)
