"""In-memory store for pinned (must-stay-consistent) fields.

Production would persist this to a DB or file; for now, in-memory dict
keyed by profile_type -> set of field_paths.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_STORE_FILE = Path(os.getenv("PIN_STORE_PATH", "pin_store.json"))

_pins: dict[str, set[str]] = {}


def _load() -> None:
    global _pins
    if _STORE_FILE.exists():
        raw = json.loads(_STORE_FILE.read_text())
        _pins = {k: set(v) for k, v in raw.items()}


def _save() -> None:
    raw = {k: sorted(v) for k, v in _pins.items()}
    _STORE_FILE.write_text(json.dumps(raw, indent=2))


def get_pinned(profile_type: str) -> list[str]:
    if not _pins:
        _load()
    return sorted(_pins.get(profile_type, set()))


def set_pin(profile_type: str, field_path: str, pinned: bool) -> None:
    if not _pins:
        _load()
    bucket = _pins.setdefault(profile_type, set())
    if pinned:
        bucket.add(field_path)
    else:
        bucket.discard(field_path)
    _save()
