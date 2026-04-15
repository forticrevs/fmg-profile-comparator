from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any


class ProfileListResponse(BaseModel):
    """List of profile names for a given type."""
    profile_type: str
    profiles: list[str]


class ProfileDetail(BaseModel):
    """Full configuration blob for one profile."""
    name: str
    profile_type: str
    data: dict[str, Any]


class ComparisonField(BaseModel):
    """One row in the comparison matrix."""
    field_path: str
    label: str
    values: dict[str, Any]  # profile_name -> value
    in_sync: bool
    # Per-profile drift map. Only populated when a baseline is set on the
    # comparison; baseline profile is always False, others are True iff
    # their normalized value differs from the baseline's normalized value.
    differs_from_baseline: dict[str, bool] = Field(default_factory=dict)


class ComparisonResponse(BaseModel):
    """Result of comparing multiple profiles."""
    profile_type: str
    profile_names: list[str]
    fields: list[ComparisonField]
    collection_keys: list[str] = Field(default_factory=list)
    raw_profiles: dict[str, dict[str, Any]] = Field(default_factory=dict)
    # Echoed back so the frontend knows which profile was treated as the
    # baseline (or null when comparison was N-way symmetric).
    baseline: str | None = None


class PinToggleRequest(BaseModel):
    """Toggle a field as pinned (must stay consistent) or unpinned."""
    profile_type: str
    field_path: str
    pinned: bool


class PinnedFieldsResponse(BaseModel):
    """Current set of pinned fields for a profile type."""
    profile_type: str
    pinned_fields: list[str]


class ReferenceListResponse(BaseModel):
    """List of reference data items (application signatures, IPS rules, etc.)."""
    reference_type: str
    count: int
    items: list[dict[str, Any]]
