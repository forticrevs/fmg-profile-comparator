"""Read-only FortiManager Jinja CLI template development endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import get_current_fmg, get_current_user
from app.services.fmg_client import FMGClient
from app.services import jinja_template_lab as lab

router = APIRouter(prefix="/api/tools/jinja-lab", tags=["tools"])

MAX_TEMPLATE_CHARS = 1024 * 1024


class TemplateUpsertRequest(BaseModel):
    id: str | None = None
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    content: str = Field(..., max_length=MAX_TEMPLATE_CHARS)
    type: str = "jinja"
    target: str = "local"
    source: str = "local"
    fmg_name: str = ""


class GroupUpsertRequest(BaseModel):
    id: str | None = None
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    template_ids: list[str] = Field(default_factory=list)


class RenderRequest(BaseModel):
    device: str = Field(..., min_length=1)
    content: str | None = Field(default=None, max_length=MAX_TEMPLATE_CHARS)
    template_id: str | None = None
    template_ids: list[str] | None = None
    extra_vars: dict[str, Any] = Field(default_factory=dict)


@router.get("/reference")
async def get_reference() -> dict[str, Any]:
    return lab.reference_payload()


@router.get("/devices")
async def get_devices(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    try:
        return {"devices": await lab.list_devices(fmg_client)}
    except Exception as exc:
        raise HTTPException(502, f"FMG device lookup failed: {exc}")


@router.get("/fmg-templates")
async def get_fmg_templates(
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    try:
        return await lab.list_fmg_templates(fmg_client)
    except Exception as exc:
        raise HTTPException(502, f"FMG template lookup failed: {exc}")


@router.get("/templates")
async def get_local_templates(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    return {"templates": lab.list_local_templates(username)}


@router.post("/templates")
async def save_local_template(
    body: TemplateUpsertRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    try:
        template = lab.upsert_local_template(username, body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"template": template}


@router.delete("/templates/{template_id}")
async def delete_local_template(
    template_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    if not lab.delete_local_template(username, template_id):
        raise HTTPException(404, "Template not found")
    return {"deleted": True}


@router.get("/groups")
async def get_local_groups(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    return {"groups": lab.list_local_groups(username)}


@router.post("/groups")
async def save_local_group(
    body: GroupUpsertRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    try:
        group = lab.upsert_local_group(username, body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"group": group}


@router.delete("/groups/{group_id}")
async def delete_local_group(
    group_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    if not lab.delete_local_group(username, group_id):
        raise HTTPException(404, "Group not found")
    return {"deleted": True}


@router.post("/render")
async def render_template(
    body: RenderRequest,
    user: dict = Depends(get_current_user),
    fmg_client: FMGClient = Depends(get_current_fmg),
) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    try:
        return await lab.render_template_payload(
            username,
            fmg_client,
            device=body.device,
            content=body.content,
            template_id=body.template_id,
            template_ids=body.template_ids,
            extra_vars=body.extra_vars,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Template render failed: {exc}")
