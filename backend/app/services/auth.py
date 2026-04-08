"""Authentication service — manages per-user FMG sessions."""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import time
from typing import Any

import jwt

from app.services.fmg_client import FMGClient

logger = logging.getLogger(__name__)

# JWT secret — generated once per process, or from environment
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_SECONDS = 3600 * 8  # 8 hours

# In-memory store: token_id -> { "fmg": FMGClient, "host": str, "created": float }
_sessions: dict[str, dict[str, Any]] = {}


def _token_id(token: str) -> str:
    """Derive a short key from a JWT for session lookup."""
    return hashlib.sha256(token.encode()).hexdigest()[:16]


async def login(host: str, username: str, password: str, verify_ssl: bool = False) -> str:
    """Authenticate against FMG and return a JWT on success."""
    client = FMGClient(host=host, verify_ssl=verify_ssl)
    try:
        await client.login_with_credentials(username, password)
    except Exception as exc:
        logger.warning(f"FMG login failed for {username}@{host}: {exc}")
        raise

    payload = {
        "sub": username,
        "host": host,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRE_SECONDS,
        "jti": secrets.token_hex(8),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    tid = _token_id(token)
    _sessions[tid] = {
        "fmg": client,
        "host": host,
        "username": username,
        "created": time.time(),
    }
    logger.info(f"Session created for {username}@{host}")
    return token


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a JWT. Raises on invalid/expired."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_fmg_client(token: str) -> FMGClient:
    """Return the FMG client associated with a valid JWT."""
    tid = _token_id(token)
    session = _sessions.get(tid)
    if not session:
        raise ValueError("Session not found — please login again")
    return session["fmg"]


async def logout(token: str) -> None:
    """Logout the FMG session and remove from store."""
    tid = _token_id(token)
    session = _sessions.pop(tid, None)
    if session:
        try:
            await session["fmg"].logout()
        except Exception:
            pass
        logger.info(f"Session destroyed for {session.get('username', '?')}")


async def cleanup_expired() -> None:
    """Remove expired sessions."""
    now = time.time()
    expired = [
        tid for tid, s in _sessions.items()
        if now - s["created"] > JWT_EXPIRE_SECONDS
    ]
    for tid in expired:
        session = _sessions.pop(tid, None)
        if session:
            try:
                await session["fmg"].logout()
            except Exception:
                pass
