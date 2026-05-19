"""FortiGate route viewer endpoints.

Routes are collected through FortiManager's read-only ``/sys/proxy/json``
path, matching the standalone fortimanager-get-routes script while using the
web app's active per-session FMG connection.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import get_current_fmg
from app.services import fos_proxy, route_viewer
from app.services.fmg_client import FMGClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools/routes", tags=["tools", "routes"])


class RouteQueryRequest(BaseModel):
    devices: list[str] = Field(..., min_length=1, max_length=route_viewer.MAX_ROUTE_DEVICES)
    vdom: str = Field(default="root", min_length=1, max_length=63)
    refresh: bool = False


@router.get("/devices")
async def get_devices(fmg: FMGClient = Depends(get_current_fmg)) -> dict:
    try:
        devices = await fos_proxy.list_managed_devices(fmg)
    except Exception as exc:
        logger.exception("routes: failed to list managed devices")
        raise HTTPException(502, f"Failed to list managed devices: {exc}")
    return {"count": len(devices), "devices": devices}


@router.post("/query")
async def query_routes(
    body: RouteQueryRequest,
    fmg: FMGClient = Depends(get_current_fmg),
) -> dict:
    try:
        return await route_viewer.fetch_routes_for_devices(
            fmg,
            body.devices,
            vdom=body.vdom,
            refresh=body.refresh,
        )
    except Exception as exc:
        logger.exception("routes: failed to collect routes")
        raise HTTPException(502, f"Failed to collect routes: {exc}")
