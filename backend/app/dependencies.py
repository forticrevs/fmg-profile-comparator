"""FastAPI dependencies for authentication and session management."""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request

from app.services import auth
from app.services.fmg_client import FMGClient


async def get_current_user(request: Request) -> dict[str, Any]:
    """Extract the authenticated user from the Bearer token.

    Returns the decoded JWT payload (always contains ``sub`` = username).
    Does NOT require an active FMG connection — safe for endpoints like
    chat that work without a FortiManager session.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = auth_header[7:]
    try:
        payload = auth.decode_token(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    return {"username": payload.get("sub", ""), **payload}


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
