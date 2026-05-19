"""FortiGate routing-table collection through FortiManager proxy.

The standalone ``fortimanager-get-routes`` script used the same FMG
``/sys/proxy/json`` tunnel to query ``/api/v2/monitor/router/ipv4`` on one
managed FortiGate at a time, then exported the routes to Excel. This module
adapts that read-only workflow for the web app: collect route tables from one
or more selected devices, normalize common fields for filtering, and keep the
raw FOS row attached for detail views.
"""

from __future__ import annotations

import asyncio
import ipaddress
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from app.services import fos_proxy
from app.services.fmg_client import FMGClient

ROUTE_CACHE_TTL_SECONDS = 60
MAX_ROUTE_DEVICES = 25

_route_cache: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True)
class NormalizedDestination:
    raw: str
    display: str
    network: str | None
    prefix_length: int | None
    ip_version: int | None
    is_default: bool


async def fetch_device_routes(
    fmg: FMGClient,
    device: str,
    *,
    vdom: str = "root",
    refresh: bool = False,
) -> dict[str, Any]:
    """Fetch and normalize the IPv4 routing table for one FortiGate."""
    key = (fmg._host, device, vdom)
    now = time.monotonic()
    if not refresh:
        cached = _route_cache.get(key)
        if cached and now - cached[0] < ROUTE_CACHE_TTL_SECONDS:
            return {**cached[1], "cached": True}

    query = urlencode({"vdom": vdom})
    resource = f"/api/v2/monitor/router/ipv4?{query}"
    body = await fos_proxy.proxy_call(fmg, device, resource, timeout=60)
    raw_routes = body.get("results")
    if raw_routes is None:
        raw_routes = []
    if not isinstance(raw_routes, list):
        raise fos_proxy.FosProxyError(
            f"Unexpected FOS route response for device={device!r}: "
            f"results={type(raw_routes).__name__}"
        )

    routes = [
        normalize_route(device, vdom, index, route)
        for index, route in enumerate(raw_routes, 1)
        if isinstance(route, dict)
    ]
    payload = {
        "device": device,
        "vdom": vdom,
        "count": len(routes),
        "routes": routes,
        "cached": False,
        "fetched_at": int(time.time()),
        "version": body.get("version"),
        "serial": body.get("serial"),
    }
    _route_cache[key] = (now, payload)
    return payload


async def fetch_routes_for_devices(
    fmg: FMGClient,
    devices: list[str],
    *,
    vdom: str = "root",
    refresh: bool = False,
) -> dict[str, Any]:
    """Fetch route tables for selected devices with bounded concurrency."""
    selected = [device.strip() for device in devices if device.strip()]
    selected = list(dict.fromkeys(selected))[:MAX_ROUTE_DEVICES]
    sem = asyncio.Semaphore(5)

    async def one(device: str) -> dict[str, Any]:
        async with sem:
            try:
                return await fetch_device_routes(
                    fmg,
                    device,
                    vdom=vdom,
                    refresh=refresh,
                )
            except Exception as exc:
                return {
                    "device": device,
                    "vdom": vdom,
                    "count": 0,
                    "routes": [],
                    "cached": False,
                    "fetched_at": int(time.time()),
                    "error": str(exc),
                }

    device_results = await asyncio.gather(*(one(device) for device in selected))
    routes: list[dict[str, Any]] = []
    for result in device_results:
        routes.extend(result.get("routes", []))

    return {
        "adom": fmg._adom,
        "vdom": vdom,
        "device_count": len(selected),
        "route_count": len(routes),
        "devices": device_results,
        "routes": routes,
        "summary": summarize_routes(routes, device_results),
    }


def normalize_route(
    device: str,
    vdom: str,
    index: int,
    route: dict[str, Any],
) -> dict[str, Any]:
    dest = parse_destination(
        _first_string(
            route,
            "ip_mask",
            "destination",
            "dst",
            "dstaddr",
            "network",
            "prefix",
        )
    )
    gateway = _first_string(route, "gateway", "gw", "nexthop", "next-hop")
    iface = _first_string(route, "interface", "dev", "device")
    protocol = _first_string(route, "protocol", "proto")
    route_type = _first_string(route, "type")
    vrf = route.get("vrf", "")
    distance = _coerce_number(route.get("distance"))
    metric = _coerce_number(route.get("metric"))
    age = _coerce_number(route.get("age"))

    return {
        "id": f"{device}:{vdom}:{index}:{dest.display}:{gateway}:{iface}",
        "device": device,
        "vdom": vdom,
        "index": index,
        "destination": dest.display,
        "destination_raw": dest.raw,
        "network": dest.network,
        "prefix_length": dest.prefix_length,
        "ip_version": dest.ip_version,
        "is_default": dest.is_default,
        "gateway": gateway,
        "distance": distance,
        "metric": metric,
        "interface": iface,
        "type": route_type,
        "protocol": protocol,
        "age": age,
        "vrf": "" if vrf is None else str(vrf),
        "selected": route.get("selected"),
        "flags": route.get("flags"),
        "raw": route,
    }


def parse_destination(value: str) -> NormalizedDestination:
    raw = value.strip()
    if not raw:
        return NormalizedDestination("", "", None, None, None, False)

    candidates = [raw]
    parts = raw.split()
    if len(parts) >= 2:
        candidates.insert(0, f"{parts[0]}/{parts[1]}")

    for candidate in candidates:
        try:
            network = ipaddress.ip_network(candidate, strict=False)
        except ValueError:
            continue
        return NormalizedDestination(
            raw=raw,
            display=str(network),
            network=str(network.network_address),
            prefix_length=network.prefixlen,
            ip_version=network.version,
            is_default=network.prefixlen == 0,
        )

    return NormalizedDestination(raw, raw, None, None, None, raw in {"0.0.0.0/0", "::/0"})


def summarize_routes(
    routes: list[dict[str, Any]],
    devices: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "routes": len(routes),
        "devices": len(devices),
        "devices_with_errors": sum(1 for device in devices if device.get("error")),
        "default_routes": sum(1 for route in routes if route.get("is_default")),
        "interfaces": _count_by(routes, "interface"),
        "protocols": _count_by(routes, "protocol"),
        "types": _count_by(routes, "type"),
        "vrfs": _count_by(routes, "vrf"),
        "devices_by_route_count": _count_by(routes, "device"),
    }


def _count_by(routes: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for route in routes:
        value = route.get(field)
        key = str(value) if value not in (None, "") else "unset"
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0].lower())))


def _first_string(route: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = route.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _coerce_number(value: Any) -> int | float | str:
    if isinstance(value, int | float):
        return value
    if value in (None, ""):
        return ""
    text = str(value)
    try:
        return int(text)
    except ValueError:
        try:
            return float(text)
        except ValueError:
            return text
