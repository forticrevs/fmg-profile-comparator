"""Local user store — JSON-backed user management with bcrypt passwords."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import bcrypt

logger = logging.getLogger(__name__)

_STORE_PATH = Path(__file__).resolve().parents[2] / "user_store.json"


def _load() -> dict[str, Any]:
    if _STORE_PATH.exists():
        return json.loads(_STORE_PATH.read_text())
    return {"users": {}}


def _save(data: dict[str, Any]) -> None:
    _STORE_PATH.write_text(json.dumps(data, indent=2))


def user_exists(username: str) -> bool:
    store = _load()
    return username in store.get("users", {})


def list_users() -> list[str]:
    store = _load()
    return list(store.get("users", {}).keys())


def create_user(username: str, password: str) -> None:
    """Create a new local user with a bcrypt-hashed password."""
    store = _load()
    users = store.setdefault("users", {})
    if username in users:
        raise ValueError(f"User '{username}' already exists")
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    users[username] = {"password_hash": hashed}
    _save(store)
    logger.info(f"Created local user: {username}")


def verify_password(username: str, password: str) -> bool:
    """Verify a user's password against the stored hash."""
    store = _load()
    user = store.get("users", {}).get(username)
    if not user:
        return False
    return bcrypt.checkpw(password.encode(), user["password_hash"].encode())


def change_password(username: str, new_password: str) -> None:
    """Change a user's password."""
    store = _load()
    users = store.get("users", {})
    if username not in users:
        raise ValueError(f"User '{username}' not found")
    hashed = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    users[username]["password_hash"] = hashed
    _save(store)


def has_any_users() -> bool:
    """Check if any users exist (for first-run setup)."""
    store = _load()
    return len(store.get("users", {})) > 0
