"""Converted Fortinet object comparison workflow.

Accepts FortiConverter/FortiGate CLI text, extracts object definitions, and
compares them with objects already present in the active FortiManager ADOM.
The workflow is read-only and exists to prevent migration imports from
overwriting same-named FMG objects that have different behavior.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import get_current_fmg
from app.services.fmg_client import FMGClient
from app.services.object_migration_compare import (
    compare_config_to_fmg,
    supported_families,
)

router = APIRouter(prefix="/api/tools/object-migration", tags=["tools"])

MAX_CONFIG_CHARS = 5 * 1024 * 1024


class ObjectMigrationCompareRequest(BaseModel):
    config_text: str = Field(..., min_length=1)
    families: list[str] | None = None
    include_matches: bool = True


@router.get("/families")
async def list_families() -> dict:
    return {"families": supported_families()}


@router.post("/compare")
async def compare_objects(
    body: ObjectMigrationCompareRequest,
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict:
    if len(body.config_text) > MAX_CONFIG_CHARS:
        raise HTTPException(
            400,
            f"Config payload exceeds {MAX_CONFIG_CHARS // (1024 * 1024)} MiB limit",
        )
    try:
        return await compare_config_to_fmg(
            fmg_client,
            body.config_text,
            families=body.families,
            include_matches=body.include_matches,
        )
    except Exception as exc:
        raise HTTPException(502, f"Object comparison failed: {exc}")
