"""Converted Fortinet object comparison workflow.

Accepts FortiConverter/FortiGate CLI text, extracts object definitions, and
compares them with objects already present in the active FortiManager ADOM.
The workflow is read-only and exists to prevent migration imports from
overwriting same-named FMG objects that have different behavior.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
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
    include_matches: bool = False
    result_limit_per_family: int | None = Field(default=100, ge=0, le=1000)
    view_filter: str | None = None


class ObjectMigrationExportRequest(ObjectMigrationCompareRequest):
    format: Literal["json", "csv"] = "json"


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
            row_limit_per_family=body.result_limit_per_family,
            view_filter=body.view_filter,
        )
    except Exception as exc:
        raise HTTPException(502, f"Object comparison failed: {exc}")


@router.post("/export")
async def export_objects(
    body: ObjectMigrationExportRequest,
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> Response:
    if len(body.config_text) > MAX_CONFIG_CHARS:
        raise HTTPException(
            400,
            f"Config payload exceeds {MAX_CONFIG_CHARS // (1024 * 1024)} MiB limit",
        )
    try:
        result = await compare_config_to_fmg(
            fmg_client,
            body.config_text,
            families=body.families,
            include_matches=True,
            row_limit_per_family=None,
            view_filter=None,
        )
    except Exception as exc:
        raise HTTPException(502, f"Object comparison export failed: {exc}")

    if body.format == "csv":
        return Response(
            _result_to_csv(result),
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="object-migration-compare.csv"',
            },
        )

    return Response(
        json.dumps(result, indent=2, default=str),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="object-migration-compare.json"',
        },
    )


def _result_to_csv(result: dict) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(
        [
            "family",
            "object",
            "status",
            "duplicate_count",
            "diff_path",
            "source_value",
            "fmg_value",
            "source_object",
            "fmg_object",
        ]
    )

    for family in result.get("families", []):
        if family.get("error"):
            writer.writerow([family.get("label"), "", "error", "", "", family["error"], "", "", ""])
        for row in family.get("results", []):
            diffs = row.get("diffs") or [{"path": "", "source": "", "fmg": ""}]
            for diff in diffs:
                writer.writerow(
                    [
                        family.get("label"),
                        row.get("key"),
                        row.get("status"),
                        row.get("duplicate_count"),
                        diff.get("path"),
                        _csv_value(diff.get("source")),
                        _csv_value(diff.get("fmg")),
                        _csv_value(row.get("source")),
                        _csv_value(row.get("fmg")),
                    ]
                )
    return out.getvalue()


def _csv_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True, default=str)
