"""Authentication API routes — local user auth + FMG instance connections."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import auth, user_store, fmg_registry

router = APIRouter(prefix="/api/auth", tags=["auth"])


# -----------------------------------------------------------------------
# Request / response models
# -----------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    username: str
    needsSetup: bool = False  # True when user has no FMG instances yet


class ConnectFmgRequest(BaseModel):
    instance_id: str


# -----------------------------------------------------------------------
# Auth endpoints
# -----------------------------------------------------------------------

@router.post("/login")
async def login(body: LoginRequest) -> AuthResponse:
    if not body.username or not body.password:
        raise HTTPException(400, "Username and password are required")
    try:
        token = await auth.login(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(401, str(exc))
    instances = fmg_registry.list_instances(body.username)
    return AuthResponse(
        token=token,
        username=body.username,
        needsSetup=len(instances) == 0,
    )


@router.post("/register")
async def register(body: RegisterRequest) -> AuthResponse:
    if not body.username or not body.password:
        raise HTTPException(400, "Username and password are required")
    if len(body.password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    try:
        token = await auth.register(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return AuthResponse(token=token, username=body.username, needsSetup=True)


@router.post("/logout")
async def logout(request: Request) -> dict[str, str]:
    token = _extract_token(request)
    await auth.logout(token)
    return {"status": "ok"}


@router.get("/verify")
async def verify(request: Request) -> dict:
    """Check if the current token is still valid and return FMG connection info."""
    token = _extract_token(request)
    try:
        payload = auth.decode_token(token)
        username = payload.get("sub", "")
        session = auth.get_session(token)
        active_id = session.get("active_instance")
        instances = fmg_registry.list_instances(username)

        # Try to get active FMG info
        active_fmg = None
        if active_id:
            for inst in instances:
                if inst["id"] == active_id:
                    active_fmg = inst
                    break

        return {
            "status": "ok",
            "username": username,
            "activeInstance": active_fmg,
            "instances": instances,
            "needsSetup": len(instances) == 0,
        }
    except Exception:
        raise HTTPException(401, "Invalid or expired session")


# -----------------------------------------------------------------------
# FMG connection
# -----------------------------------------------------------------------

@router.post("/connect-fmg")
async def connect_fmg(body: ConnectFmgRequest, request: Request) -> dict:
    """Connect to a specific FMG instance."""
    token = _extract_token(request)
    try:
        await auth.connect_fmg(token, body.instance_id)
        instance = None
        username = auth.get_username(token)
        for inst in fmg_registry.list_instances(username):
            if inst["id"] == body.instance_id:
                instance = inst
                break
        return {"status": "ok", "activeInstance": instance}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Failed to connect to FMG: {exc}")


@router.get("/setup-required")
async def setup_required() -> dict:
    """Check if any users exist (first-run check, no auth needed)."""
    return {"setupRequired": not user_store.has_any_users()}


# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------

def _extract_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    raise HTTPException(401, "Missing or invalid Authorization header")
