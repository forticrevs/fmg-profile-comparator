"""FastAPI dependency for extracting the authenticated FMG client."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from app.services import auth
from app.services.fmg_client import FMGClient


async def get_current_fmg(request: Request) -> FMGClient:
    """Extract Bearer token and return the active FMG client for this session."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = auth_header[7:]
    try:
        auth.decode_token(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    try:
        return auth.get_fmg_client(token)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
