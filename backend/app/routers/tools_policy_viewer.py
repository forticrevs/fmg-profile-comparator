"""Policy viewer endpoints — package list, policy list, schema, object map.

Authenticated: requires the same Bearer token + active FMG instance as
the profile comparison flows. The object map is eagerly fetched and
cached for 5 minutes per (adom, fmg-host) pair so hover tooltips don't
trigger per-cell round trips. The firewall-policy schema (obtained via
FMG's ``syntax`` option) is cached for 10 minutes per ``(fmg-host,
adom)`` pair — it's a fixed ~208-field blob per FMG version and paying
~250 ms every package selection adds up.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_fmg
from app.services.fmg_client import FMGClient
from app.services import policy_fetcher, object_resolver

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools/policy-viewer", tags=["tools", "policy-viewer"])


# Schema cache — keyed on (host, adom). Policy schema is stable for the
# duration of an FMG version so a 10-minute TTL is plenty.
_SCHEMA_TTL_SECONDS = 600
_schema_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


@router.get("/packages")
async def get_packages(fmg: FMGClient = Depends(get_current_fmg)) -> dict[str, Any]:
    adom = fmg._adom
    try:
        packages = await policy_fetcher.list_packages(fmg, adom)
    except Exception as exc:
        logger.exception("policy-viewer: failed to list packages")
        raise HTTPException(502, f"Failed to list packages: {exc}")
    return {"adom": adom, "packages": packages}


@router.get("/schema")
async def get_schema(
    refresh: bool = False,
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    """Return the full firewall-policy schema (types, defaults, enums,
    help text, datasrc refs) via the FMG ``syntax`` option. Cached
    in-process for ``_SCHEMA_TTL_SECONDS`` per ``(host, adom)``."""
    adom = fmg._adom
    key = (fmg._host, adom)
    now = time.monotonic()
    if not refresh:
        hit = _schema_cache.get(key)
        if hit and now - hit[0] < _SCHEMA_TTL_SECONDS:
            return {"adom": adom, "cached": True, "schema": hit[1]}
    try:
        schema = await policy_fetcher.fetch_policy_schema(fmg, adom)
    except Exception as exc:
        logger.exception("policy-viewer: failed to fetch policy schema")
        raise HTTPException(502, f"Failed to fetch schema: {exc}")
    _schema_cache[key] = (now, schema)
    return {"adom": adom, "cached": False, "schema": schema}


@router.get("/packages/{package:path}/hitcount")
async def get_hitcount(
    package: str,
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    """Return on-demand per-policyid hit counters for a package.

    Runs the three-step FMG hitcount refresh flow synchronously (trigger
    → poll → collect). Typically completes in 2-4 s against a moderately
    sized package; returns an empty ``hitcounts`` map if the FMG version
    predates the feature (6.4.7 / 7.0.3) or the task times out. The
    frontend merges the result into the policy table by ``policyid``.
    """
    adom = fmg._adom
    try:
        hc = await policy_fetcher.fetch_hitcounts(fmg, adom, package)
    except TimeoutError as exc:
        logger.warning("policy-viewer: hitcount timed out: %s", exc)
        return {
            "adom": adom,
            "package": package,
            "hitcounts": {},
            "error": "timeout",
        }
    except Exception as exc:
        logger.exception("policy-viewer: failed to fetch hitcounts")
        raise HTTPException(502, f"Failed to fetch hitcounts: {exc}")
    return {
        "adom": adom,
        "package": package,
        "count": len(hc),
        # FastAPI serialises int-keyed dicts as JSON with string keys,
        # which is what we want — the frontend re-parses as needed.
        "hitcounts": hc,
    }


@router.get("/packages/{package:path}/policies")
async def get_policies(
    package: str,
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    adom = fmg._adom
    try:
        # No `fields` filter — the viewer's expand-row view needs every
        # field the schema advertises, so we let FMG return the full
        # ~127-field policy object.
        policies = await policy_fetcher.fetch_policies(fmg, adom, package)
    except Exception as exc:
        logger.exception("policy-viewer: failed to fetch policies")
        raise HTTPException(502, f"Failed to fetch policies: {exc}")

    # Union of every field key that actually shows up on at least one
    # policy — the frontend uses this to lay out its expand-row detail
    # panel without blindly trusting a hardcoded list.
    seen: set[str] = set()
    for p in policies:
        if isinstance(p, dict):
            seen.update(p.keys())

    return {
        "adom": adom,
        "package": package,
        "count": len(policies),
        "policies": policies,
        "fields": sorted(seen),
    }


@router.get("/objects")
async def get_objects(
    refresh: bool = False,
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    adom = fmg._adom
    try:
        obj_map = await object_resolver.get_object_map(
            fmg, adom, force_refresh=refresh
        )
    except Exception as exc:
        logger.exception("policy-viewer: failed to build object map")
        raise HTTPException(502, f"Failed to build object map: {exc}")
    return {"adom": adom, **obj_map}
