"""Internet Service Database (ISDB) lookup routes.

FortiManager itself does not expose the ISDB endpoints, so every call
here proxies through ``/sys/proxy/json`` to a user-selected managed
FortiGate. The caller picks the device on each request — we do not
persist a default because the same FMG may proxy lookups to different
FGTs for operator-specific reasons (PoP, VDOM, feature licensing).

Endpoints:

- ``GET /api/tools/isdb/devices`` — list of FortiGates available to
  proxy through. Returned verbatim to the frontend picker.

- ``GET /api/tools/isdb/fqdn?device=<name>&vdom=root`` — the full
  FQDN-group map FortiGuard keeps in its ISDB. Cached in-process for
  30 minutes per ``(fmg-host, device, vdom)`` tuple because the data
  only rolls over on a FortiGuard signature push.

- ``POST /api/tools/isdb/lookup`` — IP (or FQDN) enrichment fan-out.
  Parallel-fires reverse-DNS, geoip, internet-service-match, and
  internet-service-reputation against the selected FortiGate, then
  merges the match+reputation records by service id so the frontend
  renders a single glanceable card. Cached for 5 minutes.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dependencies import get_current_fmg
from app.services import fos_proxy
from app.services.fmg_client import FMGClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools/isdb", tags=["tools", "isdb"])


# FQDN catalog cache — 30 minute TTL. FortiGuard pushes the ISDB
# signature package roughly daily and the FQDN map is stable between
# pushes; 30 minutes keeps the UI feeling live without hammering FMG
# on every tab refresh. Key: (fmg_host, device, vdom).
_FQDN_TTL_SECONDS = 30 * 60
_fqdn_cache: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}


@router.get("/devices")
async def get_devices(
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    """Return every FortiGate the active FMG instance manages."""
    try:
        devices = await fos_proxy.list_managed_devices(fmg)
    except Exception as exc:
        logger.exception("isdb: failed to list managed devices")
        raise HTTPException(502, f"Failed to list managed devices: {exc}")
    return {"count": len(devices), "devices": devices}


@router.get("/fqdn")
async def get_fqdn_catalog(
    device: str = Query(..., min_length=1),
    vdom: str = Query("root"),
    refresh: bool = Query(False),
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    """Return the FortiGuard ISDB FQDN-group catalog via proxy.

    Response shape::

        {
          "device": "<fgt>",
          "vdom": "root",
          "cached": true | false,
          "group_count": 122,
          "fqdn_count": 874,
          "groups": [
            {"name": "FQDN-Google-Gmail", "fqdns": ["mail.google.com", ...]},
            ...
          ]
        }

    The upstream FOS shape is ``{group_name: [fqdn, ...]}``. We flatten
    it to a sorted array of ``{name, fqdns}`` so the frontend can
    render it as a table without having to massage object keys.
    """
    key = (fmg._host, device, vdom)
    now = time.monotonic()
    if not refresh:
        hit = _fqdn_cache.get(key)
        if hit and now - hit[0] < _FQDN_TTL_SECONDS:
            return {**hit[1], "cached": True}

    resource = f"/api/v2/monitor/firewall/internet-service-fqdn?vdom={vdom}"
    try:
        body = await fos_proxy.proxy_call(fmg, device, resource)
    except fos_proxy.FosProxyError as exc:
        logger.warning("isdb: fqdn proxy call failed: %s", exc)
        raise HTTPException(502, str(exc))
    except Exception as exc:
        logger.exception("isdb: fqdn proxy call errored")
        raise HTTPException(502, f"FQDN lookup failed: {exc}")

    raw = body.get("results")
    if not isinstance(raw, dict):
        raise HTTPException(
            502,
            f"Unexpected FOS response shape for internet-service-fqdn: "
            f"results={type(raw).__name__}",
        )

    # Flatten the map to an array. Sort group names for stable output;
    # the frontend layer does its own ordering on top of this.
    groups: list[dict[str, Any]] = []
    total_fqdns = 0
    for name in sorted(raw.keys()):
        fqdns = raw[name]
        if not isinstance(fqdns, list):
            continue
        fqdns_sorted = sorted(str(f) for f in fqdns)
        groups.append({"name": name, "fqdns": fqdns_sorted})
        total_fqdns += len(fqdns_sorted)

    payload = {
        "device": device,
        "vdom": vdom,
        "group_count": len(groups),
        "fqdn_count": total_fqdns,
        "groups": groups,
        "cached": False,
        "fetched_at": int(time.time()),
    }
    _fqdn_cache[key] = (now, payload)
    return payload


# --------------------------------------------------------------------
# IP lookup — consolidated fan-out
# --------------------------------------------------------------------

# Short TTL cache — IP-level data (geoip, reputation) drifts slowly
# but operators do triage in bursts, so 5 minutes is long enough to
# survive a typical session without looking stale. Key:
# (fmg_host, device, vdom, ip, is_ipv6).
_LOOKUP_TTL_SECONDS = 5 * 60
_lookup_cache: dict[tuple[str, str, str, str, bool], tuple[float, dict[str, Any]]] = {}


class IsdbLookupRequest(BaseModel):
    device: str = Field(..., min_length=1)
    target: str = Field(..., min_length=1)
    vdom: str = "root"


async def _resolve_target(target: str) -> tuple[str, bool, str | None]:
    """Coerce a user-typed target into (ip, is_ipv6, resolved_from).

    If ``target`` already parses as an IP address, it's returned as-is.
    Otherwise we treat it as a hostname and attempt DNS resolution via
    ``socket.getaddrinfo`` (offloaded to a thread because it's blocking
    in stdlib). Resolution failure raises ``ValueError`` with a short
    message the router can surface as an HTTP 400.
    """
    target = target.strip()
    # Trim leading/trailing whitespace and any protocol prefix a user
    # may have pasted from the address bar (https://…/).
    if "://" in target:
        target = target.split("://", 1)[1]
    if "/" in target:
        target = target.split("/", 1)[0]
    if target.startswith("[") and target.endswith("]"):
        target = target[1:-1]

    try:
        parsed = ipaddress.ip_address(target)
        return str(parsed), isinstance(parsed, ipaddress.IPv6Address), None
    except ValueError:
        pass

    # Not an IP — try DNS. We prefer A/AAAA sorted with A first so the
    # majority case (IPv4) lands in the expected path.
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, target, None)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve '{target}': {exc}") from exc
    if not infos:
        raise ValueError(f"Could not resolve '{target}': no records")
    # Pick the first IPv4 if any, else the first IPv6.
    ipv4 = next((info for info in infos if info[0] == socket.AF_INET), None)
    chosen = ipv4 or infos[0]
    addr = chosen[4][0]
    try:
        parsed = ipaddress.ip_address(addr)
    except ValueError as exc:
        raise ValueError(f"Resolved '{target}' to an unparseable address {addr!r}") from exc
    return str(parsed), isinstance(parsed, ipaddress.IPv6Address), target


async def _fetch_section(
    fmg: FMGClient,
    device: str,
    resource: str,
    *,
    action: str = "get",
    payload: Any = None,
) -> dict[str, Any]:
    """Run one FOS proxy call and unwrap to its ``results`` payload.

    Sections are intentionally reported as ``{ok, data?, error?}`` so
    one failing call (typical for reverse-DNS on private IPs) doesn't
    collapse the whole lookup. Callers pass this coroutine into
    ``asyncio.gather(return_exceptions=True)`` and map per-section.
    """
    try:
        body = await fos_proxy.proxy_call(
            fmg, device, resource, action=action, payload=payload
        )
    except fos_proxy.FosProxyError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        logger.exception("isdb lookup section %s failed", resource)
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return {"ok": True, "data": body.get("results")}


def _merge_match_and_reputation(
    match_data: Any, reputation_data: Any
) -> list[dict[str, Any]]:
    """Produce one ServiceMatch record per unique service id.

    ``internet-service-match`` lists services that include the IP,
    carrying ``owner`` and a (usually empty) inline ``reputation``
    block. ``internet-service-reputation`` lists the same services
    with concrete risk/popularity/domain/country/region/city ids and
    optional ``blocklist`` entries. We index both by ``id`` and emit a
    merged record with everything the frontend needs to render a row.
    """
    by_id: dict[int, dict[str, Any]] = {}

    if isinstance(match_data, list):
        for entry in match_data:
            if not isinstance(entry, dict):
                continue
            sid = entry.get("id")
            if not isinstance(sid, int):
                continue
            rec = by_id.setdefault(sid, {"id": sid})
            if entry.get("name"):
                rec["name"] = entry["name"]
            if entry.get("num_matched_services") is not None:
                rec["num_matched_services"] = entry["num_matched_services"]
            owner = entry.get("owner")
            if isinstance(owner, dict):
                rec["owner"] = {"id": owner.get("id"), "name": owner.get("name")}
            inline_rep = entry.get("reputation")
            if isinstance(inline_rep, dict):
                # Inline reputation wins only when the standalone call
                # doesn't also fill the field — we process the match
                # block first so standalone reputation can override.
                rec.setdefault("reputation", inline_rep.get("reputation"))
                rec.setdefault("popularity", inline_rep.get("popularity"))
                rec.setdefault("botnet_id", inline_rep.get("botnet_id"))
                rec.setdefault("domain_id", inline_rep.get("domain_id"))
                rec.setdefault("country_id", inline_rep.get("country_id"))
                rec.setdefault("region_id", inline_rep.get("region_id"))
                rec.setdefault("city_id", inline_rep.get("city_id"))
                if isinstance(inline_rep.get("blocklist"), list):
                    rec.setdefault("blocklist", inline_rep["blocklist"])

    if isinstance(reputation_data, list):
        for entry in reputation_data:
            if not isinstance(entry, dict):
                continue
            sid = entry.get("id")
            if not isinstance(sid, int):
                continue
            rec = by_id.setdefault(sid, {"id": sid})
            if entry.get("name"):
                rec["name"] = entry["name"]
            for field in (
                "reputation",
                "popularity",
                "botnet_id",
                "domain_id",
                "country_id",
                "region_id",
                "city_id",
            ):
                if entry.get(field) is not None:
                    rec[field] = entry[field]
            if isinstance(entry.get("blocklist"), list):
                rec["blocklist"] = entry["blocklist"]

    # Sort by reputation descending (higher = more trusted), then by
    # name so the row order is stable between calls.
    merged = list(by_id.values())
    merged.sort(
        key=lambda r: (-(r.get("reputation") or 0), r.get("name") or "")
    )
    return merged


@router.post("/lookup")
async def isdb_lookup(
    body: IsdbLookupRequest,
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    """Enrich an IP (or FQDN) with ISDB, reputation, geoip, and reverse DNS.

    Runs the four backing FOS calls in parallel and merges match +
    reputation into a single ``matches`` array. Individual failures
    are surfaced per-section (``reverse_dns.error``, ``geoip.error``,
    etc.) rather than aborting the whole lookup, so a private IP with
    no reverse DNS still returns geoip + match data.
    """
    try:
        ip, is_ipv6, resolved_from = await _resolve_target(body.target)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    cache_key = (fmg._host, body.device, body.vdom, ip, is_ipv6)
    now = time.monotonic()
    hit = _lookup_cache.get(cache_key)
    if hit and now - hit[0] < _LOOKUP_TTL_SECONDS:
        return {**hit[1], "cached": True}

    vdom = body.vdom or "root"

    # Build the four resource URLs. The ``is_ipv6`` + mask/prefix flags
    # must be present on the match endpoint or FOS defaults to v4 and
    # rejects v6 addresses as malformed.
    rev_resource = f"/api/v2/monitor/network/reverse-ip-lookup?ip={ip}&vdom={vdom}"
    geo_resource = f"/api/v2/monitor/geoip/geoip-query/select?vdom={vdom}"
    if is_ipv6:
        match_resource = (
            f"/api/v2/monitor/firewall/internet-service-match"
            f"?ip={ip}&is_ipv6=true&ipv6_prefix=128&vdom={vdom}"
        )
        rep_resource = (
            f"/api/v2/monitor/firewall/internet-service-reputation"
            f"?ip={ip}&is_ipv6=true&vdom={vdom}"
        )
    else:
        match_resource = (
            f"/api/v2/monitor/firewall/internet-service-match"
            f"?ip={ip}&is_ipv6=false&ipv4_mask=255.255.255.255&vdom={vdom}"
        )
        rep_resource = (
            f"/api/v2/monitor/firewall/internet-service-reputation"
            f"?ip={ip}&is_ipv6=false&vdom={vdom}"
        )

    rev_task = _fetch_section(fmg, body.device, rev_resource)
    geo_task = _fetch_section(
        fmg,
        body.device,
        geo_resource,
        action="post",
        payload={"ip_addresses": [ip]},
    )
    match_task = _fetch_section(fmg, body.device, match_resource)
    rep_task = _fetch_section(fmg, body.device, rep_resource)

    rev_res, geo_res, match_res, rep_res = await asyncio.gather(
        rev_task, geo_task, match_task, rep_task
    )

    # Reverse DNS: extract the single ``domain`` string for convenience.
    reverse_dns: dict[str, Any] = {"ok": rev_res.get("ok", False)}
    if rev_res.get("ok"):
        data = rev_res.get("data")
        if isinstance(data, dict):
            reverse_dns["resolved"] = bool(data.get("resolved"))
            reverse_dns["domain"] = data.get("domain") or None
    else:
        reverse_dns["error"] = rev_res.get("error")

    # GeoIP: responses are keyed on the IP, pull the single entry out.
    geoip: dict[str, Any] = {"ok": geo_res.get("ok", False)}
    if geo_res.get("ok"):
        data = geo_res.get("data")
        if isinstance(data, dict) and ip in data:
            geoip["location"] = data[ip].get("location")
            geoip["fallback"] = data[ip].get("fallback")
    else:
        geoip["error"] = geo_res.get("error")

    # ISDB services — merge match + reputation into one array, flag
    # which upstream call failed when relevant.
    matches_section: dict[str, Any] = {
        "ok": (match_res.get("ok") or rep_res.get("ok")) or False
    }
    if not match_res.get("ok") and not rep_res.get("ok"):
        matches_section["error"] = match_res.get("error") or rep_res.get("error")
        matches_section["services"] = []
    else:
        merged = _merge_match_and_reputation(
            match_res.get("data"), rep_res.get("data")
        )
        matches_section["services"] = merged
        if not match_res.get("ok"):
            matches_section["match_error"] = match_res.get("error")
        if not rep_res.get("ok"):
            matches_section["reputation_error"] = rep_res.get("error")

    payload = {
        "device": body.device,
        "vdom": vdom,
        "input": body.target.strip(),
        "ip": ip,
        "is_ipv6": is_ipv6,
        "resolved_from_fqdn": resolved_from,
        "reverse_dns": reverse_dns,
        "geoip": geoip,
        "matches": matches_section,
        "cached": False,
        "fetched_at": int(time.time()),
    }
    _lookup_cache[cache_key] = (now, payload)
    return payload
