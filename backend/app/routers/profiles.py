"""API routes for profile listing, detail, and comparison."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from typing import Any

from app.models.schemas import (
    ComparisonResponse,
    PinToggleRequest,
    PinnedFieldsResponse,
    ProfileDetail,
    ProfileListResponse,
)
from app.services.fmg_client import fmg
from app.services.comparator import compare_profiles
from app.services import pin_store

router = APIRouter(prefix="/api/profiles", tags=["profiles"])

VALID_TYPES = {"application", "webfilter", "ips", "sdwan"}


def _validate_type(profile_type: str) -> None:
    if profile_type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid profile_type. Must be one of: {VALID_TYPES}")


# ------------------------------------------------------------------
# List
# ------------------------------------------------------------------

@router.get("/types")
async def get_profile_types() -> list[dict[str, str]]:
    return [
        {"id": "application", "label": "Application Control"},
        {"id": "webfilter", "label": "Web Filter"},
        {"id": "ips", "label": "IPS Sensor"},
        {"id": "sdwan", "label": "SD-WAN Template"},
    ]


@router.get("/{profile_type}")
async def list_profiles(profile_type: str) -> ProfileListResponse:
    _validate_type(profile_type)
    try:
        names = await fmg.list_profiles(profile_type)
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")
    return ProfileListResponse(profile_type=profile_type, profiles=names)


# ------------------------------------------------------------------
# Detail
# ------------------------------------------------------------------

@router.get("/{profile_type}/{name}")
async def get_profile(profile_type: str, name: str) -> ProfileDetail:
    _validate_type(profile_type)
    try:
        data = await fmg.get_profile(profile_type, name)
    except Exception as exc:
        raise HTTPException(502, f"FMG error: {exc}")
    return ProfileDetail(name=name, profile_type=profile_type, data=data)


# ------------------------------------------------------------------
# Compare
# ------------------------------------------------------------------

@router.get("/{profile_type}/compare")
async def compare(
    profile_type: str,
    names: list[str] = Query(..., alias="name"),
) -> ComparisonResponse:
    _validate_type(profile_type)
    if len(names) < 2:
        raise HTTPException(400, "Need at least 2 profiles to compare")

    profiles: dict[str, dict[str, Any]] = {}
    for n in names:
        try:
            profiles[n] = await fmg.get_profile(profile_type, n)
        except Exception as exc:
            raise HTTPException(502, f"FMG error fetching '{n}': {exc}")

    fields = compare_profiles(profiles)
    return ComparisonResponse(
        profile_type=profile_type,
        profile_names=names,
        fields=fields,
    )


# ------------------------------------------------------------------
# Pinned fields
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
