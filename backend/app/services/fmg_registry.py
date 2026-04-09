"""FMG instance registry — per-user FortiManager connection management.

Stored in a JSON file with FMG passwords encrypted via Fernet.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

_STORE_PATH = Path(__file__).resolve().parents[2] / "fmg_instances.json"
_KEY_PATH = Path(__file__).resolve().parents[2] / ".fmg_key"


def _get_cipher() -> Fernet:
    """Return a Fernet cipher, generating the key file on first use."""
    if _KEY_PATH.exists():
        key = _KEY_PATH.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        _KEY_PATH.write_bytes(key)
        _KEY_PATH.chmod(0o600)
    return Fernet(key)


def _load() -> dict[str, Any]:
    if _STORE_PATH.exists():
        return json.loads(_STORE_PATH.read_text())
    return {"instances": {}}


def _save(data: dict[str, Any]) -> None:
    _STORE_PATH.write_text(json.dumps(data, indent=2))


def _encrypt(plaintext: str) -> str:
    return _get_cipher().encrypt(plaintext.encode()).decode()


def _decrypt(ciphertext: str) -> str:
    return _get_cipher().decrypt(ciphertext.encode()).decode()


# -----------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------

def list_instances(username: str) -> list[dict[str, Any]]:
    """Return all FMG instances for a user (password excluded)."""
    store = _load()
    user_instances = store.get("instances", {}).get(username, [])
    return [
        {
            "id": inst["id"],
            "name": inst["name"],
            "host": inst["host"],
            "username": inst["fmg_username"],
            "adom": inst.get("adom", "root"),
            "verify_ssl": inst.get("verify_ssl", False),
        }
        for inst in user_instances
    ]


def get_instance(username: str, instance_id: str) -> dict[str, Any] | None:
    """Return a single FMG instance config including decrypted password."""
    store = _load()
    for inst in store.get("instances", {}).get(username, []):
        if inst["id"] == instance_id:
            return {
                **inst,
                "fmg_password": _decrypt(inst["fmg_password_enc"]),
            }
    return None


def add_instance(
    username: str,
    name: str,
    host: str,
    fmg_username: str,
    fmg_password: str,
    adom: str = "root",
    verify_ssl: bool = False,
) -> dict[str, str]:
    """Add a new FMG instance for a user. Returns {id, name}."""
    store = _load()
    user_instances = store.setdefault("instances", {}).setdefault(username, [])

    instance_id = secrets.token_hex(6)
    user_instances.append({
        "id": instance_id,
        "name": name,
        "host": host,
        "fmg_username": fmg_username,
        "fmg_password_enc": _encrypt(fmg_password),
        "adom": adom,
        "verify_ssl": verify_ssl,
    })
    _save(store)
    logger.info(f"Added FMG instance '{name}' ({host}) for user {username}")
    return {"id": instance_id, "name": name}


def update_instance(
    username: str,
    instance_id: str,
    *,
    name: str | None = None,
    host: str | None = None,
    fmg_username: str | None = None,
    fmg_password: str | None = None,
    adom: str | None = None,
    verify_ssl: bool | None = None,
) -> bool:
    """Update an existing FMG instance. Returns True if found and updated."""
    store = _load()
    for inst in store.get("instances", {}).get(username, []):
        if inst["id"] == instance_id:
            if name is not None:
                inst["name"] = name
            if host is not None:
                inst["host"] = host
            if fmg_username is not None:
                inst["fmg_username"] = fmg_username
            if fmg_password is not None:
                inst["fmg_password_enc"] = _encrypt(fmg_password)
            if adom is not None:
                inst["adom"] = adom
            if verify_ssl is not None:
                inst["verify_ssl"] = verify_ssl
            _save(store)
            return True
    return False


def remove_instance(username: str, instance_id: str) -> bool:
    """Remove an FMG instance. Returns True if found and removed."""
    store = _load()
    user_instances = store.get("instances", {}).get(username, [])
    for i, inst in enumerate(user_instances):
        if inst["id"] == instance_id:
            user_instances.pop(i)
            _save(store)
            logger.info(f"Removed FMG instance {instance_id} for user {username}")
            return True
    return False
