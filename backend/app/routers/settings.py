"""Settings API — FMG instance CRUD."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import auth, fmg_registry

router = APIRouter(prefix="/api/settings", tags=["settings"])


# -----------------------------------------------------------------------
# Request / response models
# -----------------------------------------------------------------------

class AddInstanceRequest(BaseModel):
    name: str
    host: str
    fmg_username: str
    fmg_password: str
    adom: str = "root"
    verify_ssl: bool = False


class UpdateInstanceRequest(BaseModel):
    name: str | None = None
    host: str | None = None
    fmg_username: str | None = None
    fmg_password: str | None = None
    adom: str | None = None
    verify_ssl: bool | None = None


# -----------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------

@router.get("/fmg-instances")
async def list_instances(request: Request) -> list[dict]:
    token = _extract_token(request)
    username = auth.get_username(token)
    return fmg_registry.list_instances(username)


@router.post("/fmg-instances")
async def add_instance(body: AddInstanceRequest, request: Request) -> dict:
    token = _extract_token(request)
    username = auth.get_username(token)
    result = fmg_registry.add_instance(
        username=username,
        name=body.name,
        host=body.host,
        fmg_username=body.fmg_username,
        fmg_password=body.fmg_password,
        adom=body.adom,
        verify_ssl=body.verify_ssl,
    )
    return result


@router.put("/fmg-instances/{instance_id}")
async def update_instance(
    instance_id: str,
    body: UpdateInstanceRequest,
    request: Request,
) -> dict:
    token = _extract_token(request)
    username = auth.get_username(token)
    ok = fmg_registry.update_instance(
        username=username,
        instance_id=instance_id,
        name=body.name,
        host=body.host,
        fmg_username=body.fmg_username,
        fmg_password=body.fmg_password,
        adom=body.adom,
        verify_ssl=body.verify_ssl,
    )
    if not ok:
        raise HTTPException(404, "Instance not found")
    return {"status": "ok"}


@router.delete("/fmg-instances/{instance_id}")
async def remove_instance(instance_id: str, request: Request) -> dict:
    token = _extract_token(request)
    username = auth.get_username(token)
    ok = fmg_registry.remove_instance(username, instance_id)
    if not ok:
        raise HTTPException(404, "Instance not found")
    return {"status": "ok"}


# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------

def _extract_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    raise HTTPException(401, "Missing or invalid Authorization header")
