"""Reference data API routes."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.models.schemas import (
    MetadataVariableRow,
    MetadataVariableSummary,
    MetadataVariablesResponse,
    ReferenceListResponse,
)
from app.dependencies import get_current_fmg
from app.services.fmg_client import FMGClient
from app.services.id_resolver import resolver

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reference", tags=["reference"])

_METADATA_VARIABLE_CACHE_TTL_SECONDS = 300
_metadata_variable_cache: dict[
    tuple[str, str, str],
    tuple[float, MetadataVariablesResponse],
] = {}


def _metadata_cache_key(fmg_client: FMGClient) -> tuple[str, str, str]:
    return (
        str(getattr(fmg_client, "_host", "")),
        str(getattr(fmg_client, "_adom", "")),
        str(getattr(fmg_client, "_user", "")),
    )


def _scope_list(scope: Any) -> list[dict[str, Any]]:
    if isinstance(scope, dict):
        return [scope]
    if isinstance(scope, list):
        return [item for item in scope if isinstance(item, dict)]
    return []


def _metadata_value_to_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, sort_keys=True)
    except TypeError:
        return str(value)


def build_metadata_variable_matrix(
    variables: list[dict[str, Any]],
) -> MetadataVariablesResponse:
    """Pivot FMG metadata variables into device-centric rows."""
    variable_names: set[str] = set()
    variable_devices: dict[str, set[str]] = {}
    variable_values: dict[str, set[str]] = {}
    devices: dict[str, dict[str, dict[str, str]]] = {}

    for variable in variables:
        if not isinstance(variable, dict):
            continue

        variable_name = str(variable.get("name") or "").strip()
        if not variable_name:
            continue

        variable_names.add(variable_name)
        variable_devices.setdefault(variable_name, set())
        variable_values.setdefault(variable_name, set())

        mappings = variable.get("dynamic_mapping") or []
        if not isinstance(mappings, list):
            continue

        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue

            value = _metadata_value_to_string(mapping.get("value"))
            scopes = _scope_list(mapping.get("_scope"))

            for scope in scopes:
                device_name = str(scope.get("name") or "").strip()
                if not device_name:
                    continue

                vdom = str(scope.get("vdom") or "global")
                device = devices.setdefault(
                    device_name,
                    {"values": {}, "vdoms": {}},
                )
                device["values"][variable_name] = value
                device["vdoms"][variable_name] = vdom
                variable_devices[variable_name].add(device_name)
                if value:
                    variable_values[variable_name].add(value)

    sorted_variables = sorted(variable_names, key=str.casefold)
    rows: list[MetadataVariableRow] = []
    for device_name in sorted(devices.keys(), key=str.casefold):
        values = devices[device_name]["values"]
        vdoms = devices[device_name]["vdoms"]
        rows.append(
            MetadataVariableRow(
                device=device_name,
                values=values,
                vdoms=vdoms,
                set_count=sum(1 for value in values.values() if value != ""),
            )
        )

    summaries = [
        MetadataVariableSummary(
            name=name,
            mapped_device_count=len(variable_devices.get(name, set())),
            unique_value_count=len(variable_values.get(name, set())),
        )
        for name in sorted_variables
    ]

    return MetadataVariablesResponse(
        reference_type="metadata-variables",
        count=len(variables),
        variable_count=len(sorted_variables),
        device_count=len(rows),
        variables=sorted_variables,
        variable_summaries=summaries,
        rows=rows,
    )


@router.get("/application-signatures")
async def get_application_signatures(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ReferenceListResponse:
    try:
        items = await fmg_client.list_application_signatures()
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")

    return ReferenceListResponse(
        reference_type="application-signatures",
        count=len(items),
        items=items,
    )


@router.get("/application-signatures/{signature_id}/encyclopedia")
async def get_application_signature_encyclopedia(
    signature_id: int,
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    """Return the FortiGuard encyclopedia record for an app signature.

    Backs the hover-tooltip on the Application Signatures reference
    page. Uses the undocumented FMG GUI CGI API (``productapi``) —
    there is no JSON-RPC equivalent. Per-client cached for 24 h.
    """
    try:
        return await fmg_client.fetch_encyclopedia("app", signature_id)
    except Exception as exc:
        raise HTTPException(502, f"FMG encyclopedia lookup failed: {exc}")


@router.get("/ips-signatures")
async def get_ips_signatures(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ReferenceListResponse:
    try:
        items = await fmg_client.list_ips_signatures()
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")

    return ReferenceListResponse(
        reference_type="ips-signatures",
        count=len(items),
        items=items,
    )


@router.get("/ips-signatures/{signature_id}/encyclopedia")
async def get_ips_signature_encyclopedia(
    signature_id: int,
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    """Return the FortiGuard encyclopedia record for an IPS signature.

    Backs the hover-tooltip on the IPS Signatures reference page. Uses
    the undocumented FMG GUI CGI API (``productapi``) — the JSON-RPC
    ``_rule/list`` endpoint only returns catalog data, not the rich
    encyclopedia fields (Summary, Symptoms, Analysis, DefaultAction,
    CVE, DetectionAvailability, etc.). Per-client cached for 24 h.
    """
    try:
        return await fmg_client.fetch_encyclopedia("ips", signature_id)
    except Exception as exc:
        raise HTTPException(502, f"FMG encyclopedia lookup failed: {exc}")


@router.get("/dlp-sensors")
async def get_dlp_sensors(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ReferenceListResponse:
    try:
        items = await fmg_client.list_dlp_sensors()
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")

    return ReferenceListResponse(
        reference_type="dlp-sensors",
        count=len(items),
        items=items,
    )


@router.get("/dlp-dictionaries")
async def get_dlp_dictionaries(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ReferenceListResponse:
    try:
        items = await fmg_client.list_dlp_dictionaries()
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")

    return ReferenceListResponse(
        reference_type="dlp-dictionaries",
        count=len(items),
        items=items,
    )


@router.get("/dlp-data-types")
async def get_dlp_data_types(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ReferenceListResponse:
    try:
        items = await fmg_client.list_dlp_data_types()
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")

    return ReferenceListResponse(
        reference_type="dlp-data-types",
        count=len(items),
        items=items,
    )


@router.get("/local-web-categories")
async def get_local_web_categories(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ReferenceListResponse:
    """Return the ADOM's custom web categories (``ftgd-local-cat``).

    These are operator-defined category buckets a webfilter profile can
    tag URLs into (via the corresponding Web Rating Overrides page).
    The reference view is browse-only — there's no create/edit surface.
    """
    try:
        items = await fmg_client.list_local_web_categories()
    except Exception as exc:
        logger.exception("local-web-categories fetch failed")
        raise HTTPException(502, f"FMG error: {exc}")

    return ReferenceListResponse(
        reference_type="local-web-categories",
        count=len(items),
        items=items,
    )


@router.get("/web-rating-overrides")
async def get_web_rating_overrides(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ReferenceListResponse:
    """Return the ADOM's FortiGuard web rating overrides.

    Each entry binds a URL to one (or occasionally several) webfilter
    category IDs. Category IDs alone are unreadable, so we load the
    shared ``IDResolver`` (lazy, per-process) and add a parallel
    ``rating_display`` field with the resolved names. The original
    ``rating`` array is preserved for consumers that want the raw IDs.
    """
    try:
        items = await fmg_client.list_web_rating_overrides()
    except Exception as exc:
        logger.exception("web-rating-overrides fetch failed")
        raise HTTPException(502, f"FMG error: {exc}")

    # Lazy-load ID resolver so we can render category names. Best-effort:
    # if the load fails (transient FMG issue, etc.) we still return the
    # raw records so the operator isn't stuck with an empty page.
    if not resolver._loaded:
        try:
            await resolver.load(fmg_client)
        except Exception as exc:
            logger.warning("resolver load failed for rating enrichment: %s", exc)

    for item in items:
        if not isinstance(item, dict):
            continue
        raw_rating = item.get("rating")
        if not isinstance(raw_rating, list):
            continue
        display: list[str] = []
        for cat_id in raw_rating:
            name = resolver.resolve_webfilter_category(str(cat_id))
            display.append(name if name else str(cat_id))
        item["rating_display"] = display

    return ReferenceListResponse(
        reference_type="web-rating-overrides",
        count=len(items),
        items=items,
    )


@router.get("/metadata-variables")
async def get_metadata_variables(
    refresh: bool = Query(False),
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> MetadataVariablesResponse:
    """Return ADOM metadata variables pivoted by device.

    FMG's native payload is variable-centric. This endpoint preserves
    the old tool's operator-facing view by returning one row per device
    and one column per metadata variable. Results are cached briefly per
    active FMG host, ADOM, and username because the catalog can be large.
    """
    cache_key = _metadata_cache_key(fmg_client)
    now = time.monotonic()
    cached = _metadata_variable_cache.get(cache_key)
    if not refresh and cached and now - cached[0] < _METADATA_VARIABLE_CACHE_TTL_SECONDS:
        return cached[1]

    try:
        items = await fmg_client.list_metadata_variables()
    except Exception as exc:
        logger.exception("metadata-variables fetch failed")
        raise HTTPException(502, f"FMG error: {exc}")

    response = build_metadata_variable_matrix(items)
    _metadata_variable_cache[cache_key] = (now, response)
    return response
