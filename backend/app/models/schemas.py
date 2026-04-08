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


class ComparisonResponse(BaseModel):
    """Result of comparing multiple profiles."""
    profile_type: str
    profile_names: list[str]
    fields: list[ComparisonField]
    collection_keys: list[str] = Field(default_factory=list)
    raw_profiles: dict[str, dict[str, Any]] = Field(default_factory=dict)
    defaults: dict[str, Any] = Field(default_factory=dict)


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
    """A searchable reference dataset fetched from FortiManager."""
    reference_type: str
    count: int
    items: list[dict[str, Any]]
