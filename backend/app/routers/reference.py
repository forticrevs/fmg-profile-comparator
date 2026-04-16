"""Reference data API routes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import ReferenceListResponse
from app.dependencies import get_current_fmg
from app.services.fmg_client import FMGClient
from app.services.id_resolver import resolver

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reference", tags=["reference"])


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
