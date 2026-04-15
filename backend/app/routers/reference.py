"""Reference data API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import ReferenceListResponse
from app.dependencies import get_current_fmg
from app.services.fmg_client import FMGClient

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
