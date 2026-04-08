"""API routes for profile listing, detail, and comparison."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Any

from app.models.schemas import (
    ComparisonResponse,
    PinToggleRequest,
    PinnedFieldsResponse,
    ProfileDetail,
    ProfileListResponse,
)
from app.dependencies import get_current_fmg
from app.services.fmg_client import FMGClient
from app.services.comparator import compare_profiles, find_collection_keys
from app.services.id_resolver import resolver
from app.services import pin_store

router = APIRouter(prefix="/api/profiles", tags=["profiles"])

VALID_TYPES = {"application", "webfilter", "ips", "sdwan"}


def _validate_type(profile_type: str) -> None:
    if profile_type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid profile_type. Must be one of: {VALID_TYPES}")


async def _ensure_resolver(fmg_client: FMGClient) -> None:
    """Lazy-load the resolver on first use."""
    if not resolver._loaded:
        await resolver.load(fmg_client)


# ------------------------------------------------------------------
# Static routes first
# ------------------------------------------------------------------

@router.get("/types")
async def get_profile_types() -> list[dict[str, str]]:
    return [
        {"id": "application", "label": "Application Control"},
        {"id": "webfilter", "label": "Web Filter"},
        {"id": "ips", "label": "IPS Sensor"},
        {"id": "sdwan", "label": "SD-WAN Template"},
    ]


# ------------------------------------------------------------------
# Compare (MUST come before /{profile_type}/{name} to avoid conflict)
# ------------------------------------------------------------------

@router.get("/{profile_type}/compare")
async def compare(
    profile_type: str,
    names: list[str] = Query(..., alias="name"),
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ComparisonResponse:
    _validate_type(profile_type)
    if len(names) < 2:
        raise HTTPException(400, "Need at least 2 profiles to compare")

    await _ensure_resolver(fmg_client)

    profiles: dict[str, dict[str, Any]] = {}
    for n in names:
        try:
            profiles[n] = await fmg_client.get_profile(profile_type, n)
        except Exception as exc:
            raise HTTPException(502, f"FMG error fetching '{n}': {exc}")

    collection_keys = find_collection_keys(profiles)
    fields = compare_profiles(
        profiles,
        resolver=resolver,
        excluded_roots=collection_keys,
    )
    enriched_profiles = {
        name: resolver.enrich_object(profile)
        for name, profile in profiles.items()
    }

    # Fetch default values for this profile type (for hide-defaults feature)
    defaults = await fmg_client.get_profile_defaults(profile_type)

    return ComparisonResponse(
        profile_type=profile_type,
        profile_names=names,
        fields=fields,
        collection_keys=collection_keys,
        raw_profiles=enriched_profiles,
        defaults=defaults,
    )


# ------------------------------------------------------------------
# Pinned fields (MUST come before /{profile_type}/{name})
# ------------------------------------------------------------------

@router.get("/{profile_type}/pins")
async def get_pins(profile_type: str) -> PinnedFieldsResponse:
    _validate_type(profile_type)
    return PinnedFieldsResponse(
        profile_type=profile_type,
        pinned_fields=pin_store.get_pinned(profile_type),
    )


@router.post("/{profile_type}/pins")
async def toggle_pin(profile_type: str, body: PinToggleRequest) -> PinnedFieldsResponse:
    _validate_type(profile_type)
    pin_store.set_pin(profile_type, body.field_path, body.pinned)
    return PinnedFieldsResponse(
        profile_type=profile_type,
        pinned_fields=pin_store.get_pinned(profile_type),
    )


# ------------------------------------------------------------------
# List profiles
# ------------------------------------------------------------------

@router.get("/{profile_type}")
async def list_profiles(
    profile_type: str,
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ProfileListResponse:
    _validate_type(profile_type)
    try:
        names = await fmg_client.list_profiles(profile_type)
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")
    return ProfileListResponse(profile_type=profile_type, profiles=names)


# ------------------------------------------------------------------
# Detail (catch-all — MUST be last)
# ------------------------------------------------------------------

@router.get("/{profile_type}/{name}")
async def get_profile(
    profile_type: str,
    name: str,
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> ProfileDetail:
    _validate_type(profile_type)
    try:
        data = await fmg_client.get_profile(profile_type, name)
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")
    return ProfileDetail(name=name, profile_type=profile_type, data=data)
