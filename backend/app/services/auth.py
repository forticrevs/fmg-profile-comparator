"""Authentication service — local user auth + per-instance FMG sessions."""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import time
from typing import Any

import jwt

from app.services import user_store, fmg_registry
from app.services.fmg_client import FMGClient

logger = logging.getLogger(__name__)

# JWT secret — generated once per process, or from environment
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_SECONDS = 3600 * 8  # 8 hours

# In-memory store: token_id -> session data
_sessions: dict[str, dict[str, Any]] = {}


def _token_id(token: str) -> str:
    """Derive a short key from a JWT for session lookup."""
    return hashlib.sha256(token.encode()).hexdigest()[:16]


# ------------------------------------------------------------------
# Local user authentication
# ------------------------------------------------------------------

async def login(username: str, password: str) -> str:
    """Authenticate a local user and return a JWT."""
    if not user_store.verify_password(username, password):
        raise ValueError("Invalid username or password")

    payload = {
        "sub": username,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRE_SECONDS,
        "jti": secrets.token_hex(8),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    tid = _token_id(token)
    _sessions[tid] = {
        "username": username,
        "created": time.time(),
        "fmg_clients": {},  # instance_id -> FMGClient
        "active_instance": None,  # currently selected FMG instance ID
    }
    logger.info(f"Local login for {username}")
    return token


async def register(username: str, password: str) -> str:
    """Register a new local user and return a JWT."""
    user_store.create_user(username, password)
    return await login(username, password)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a JWT. Raises on invalid/expired."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_session(token: str) -> dict[str, Any]:
    """Return the full session dict for a valid JWT."""
    tid = _token_id(token)
    session = _sessions.get(tid)
    if not session:
        raise ValueError("Session not found — please login again")
    return session


def get_username(token: str) -> str:
    """Return the username associated with a token."""
    payload = decode_token(token)
    return payload.get("sub", "")


# ------------------------------------------------------------------
# FMG instance connection management
# ------------------------------------------------------------------

async def connect_fmg(token: str, instance_id: str) -> FMGClient:
    """Connect to an FMG instance and store the client in the session."""
    session = get_session(token)
    username = session["username"]

    # Check if already connected
    existing = session["fmg_clients"].get(instance_id)
    if existing:
        session["active_instance"] = instance_id
        return existing

    # Look up instance config
    inst = fmg_registry.get_instance(username, instance_id)
    if not inst:
        raise ValueError(f"FMG instance '{instance_id}' not found")

    # Create and authenticate client
    client = FMGClient(host=inst["host"], verify_ssl=inst.get("verify_ssl", False))
    client._adom = inst.get("adom", "root")
    await client.login_with_credentials(inst["fmg_username"], inst["fmg_password"])

    session["fmg_clients"][instance_id] = client
    session["active_instance"] = instance_id
    logger.info(f"Connected to FMG {inst['host']} as {inst['fmg_username']} for user {username}")
    return client


def get_fmg_client(token: str) -> FMGClient:
    """Return the active FMG client for the current session."""
    session = get_session(token)
    active_id = session.get("active_instance")
    if not active_id:
        raise ValueError("No FMG instance selected — please connect to one first")
    client = session["fmg_clients"].get(active_id)
    if not client:
        raise ValueError("FMG instance not connected — please reconnect")
    return client


def get_active_instance_id(token: str) -> str | None:
    """Return the currently active FMG instance ID."""
    session = get_session(token)
    return session.get("active_instance")


# ------------------------------------------------------------------
# Logout & cleanup
# ------------------------------------------------------------------

async def logout(token: str) -> None:
    """Logout all FMG sessions and remove from store."""
    tid = _token_id(token)
    session = _sessions.pop(tid, None)
    if session:
        for inst_id, client in session.get("fmg_clients", {}).items():
            try:
                await client.logout()
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
            for client in session.get("fmg_clients", {}).values():
                try:
                    await client.logout()
                except Exception:
                    pass
