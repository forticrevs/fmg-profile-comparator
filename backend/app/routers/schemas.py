"""Schema discovery endpoints.

Exposes FMG `option=["syntax"]` responses, parsed into a flat field list
plus nested subobject field lists, so the frontend's per-page field
visibility menu can offer the *full* set of fields defined by FMG — not
just the fields that happen to appear in the current response payload.

Responses are cached in `services.schema_cache` per (fmg_host, cache_key)
with a 24h TTL. Cache misses trigger a single syntax fetch, subsequent
calls within the TTL are served from memory.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_fmg
from app.services import schema_cache
from app.services.fmg_client import FMGClient

router = APIRouter(prefix="/api/schemas", tags=["schemas"])


# ---------------------------------------------------------------------------
# Profile schemas
# ---------------------------------------------------------------------------

VALID_PROFILE_TYPES = {"application", "webfilter", "ips", "dlp", "sdwan"}


@router.get("/profile/{profile_type}")
async def get_profile_schema(
    profile_type: str,
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict:
    if profile_type not in VALID_PROFILE_TYPES:
        raise HTTPException(400, f"Unknown profile_type: {profile_type}")

    url = fmg_client.profile_url(profile_type)
    if not url:
        raise HTTPException(400, f"No URL for profile_type: {profile_type}")

    async def loader():
        return await fmg_client.get_syntax(url)

    parsed = await schema_cache.get_or_fetch(
        host=fmg_client._host or "",
        cache_key=f"profile:{profile_type}",
        loader=loader,
    )
    return {"profile_type": profile_type, **parsed}


# ---------------------------------------------------------------------------
# Reference catalogue schemas
# ---------------------------------------------------------------------------
# Note: reference tables (`_application/list`, `_rule/list`, `_fdsdb/*`)
# IGNORE `option=["syntax"]` and return full data payloads (thousands of
# items). There is no schema to discover for them — the frontend falls
# back to data-driven column discovery for those pages.


@router.post("/invalidate")
async def invalidate_schema_cache(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict:
    """Drop the cached schema for the current FMG instance."""
    schema_cache.invalidate(fmg_client._host or "")
    return {"status": "ok"}
