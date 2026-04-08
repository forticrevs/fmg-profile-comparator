"""Authentication API routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    host: str
    username: str
    password: str
    verify_ssl: bool = False


class LoginResponse(BaseModel):
    token: str
    username: str
    host: str


@router.post("/login")
async def login(body: LoginRequest) -> LoginResponse:
    if not body.host or not body.username or not body.password:
        raise HTTPException(400, "Host, username, and password are required")
    try:
        token = await auth.login(
            host=body.host,
            username=body.username,
            password=body.password,
            verify_ssl=body.verify_ssl,
        )
    except Exception as exc:
        raise HTTPException(401, f"Authentication failed: {exc}")
    return LoginResponse(token=token, username=body.username, host=body.host)


@router.post("/logout")
async def logout(request: Request) -> dict[str, str]:
    token = _extract_token(request)
    await auth.logout(token)
    return {"status": "ok"}


@router.get("/verify")
async def verify(request: Request) -> dict[str, str]:
    """Check if the current token is still valid."""
    token = _extract_token(request)
    try:
        payload = auth.decode_token(token)
        # Also verify the FMG session is still alive
        auth.get_fmg_client(token)
        return {"status": "ok", "username": payload.get("sub", "")}
    except Exception:
        raise HTTPException(401, "Invalid or expired session")


def _extract_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    raise HTTPException(401, "Missing or invalid Authorization header")
