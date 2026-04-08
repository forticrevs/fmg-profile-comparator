"""Reference data API routes."""

from __future__ import annotations

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
