"""Per-user job artifact storage.

All conversion-tool job outputs are scoped to the authenticated user. This
module is the single source of truth for the on-disk layout:

    backend/user_data/<username>/jobs/<job_id>/
        <parser-output-files>
        pan-extract-<job_id>.zip

`backend/user_data/` is gitignored. Paths are validated on read to prevent
traversal across user boundaries.
"""

from __future__ import annotations

import re
from pathlib import Path

# Allow only conservative identifiers for username / job_id to avoid any
# path-traversal games. Usernames come from user_store (already validated
# at registration) and job ids come from ARQ (hex strings), but we still
# gate on a strict regex for defence in depth.
_SAFE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")

_BASE = Path(__file__).resolve().parents[2] / "user_data"


def _check(part: str, what: str) -> None:
    if not _SAFE.match(part):
        raise ValueError(f"Invalid {what}: {part!r}")


def user_root(username: str) -> Path:
    """Return the root directory for a given user's stored data."""
    _check(username, "username")
    return _BASE / username


def jobs_root(username: str) -> Path:
    """Return the directory that holds all of a user's job subdirs."""
    return user_root(username) / "jobs"


def job_dir(username: str, job_id: str) -> Path:
    """Return the directory for a single job."""
    _check(job_id, "job_id")
    return jobs_root(username) / job_id


def uploads_dir(username: str) -> Path:
    """Return the directory where raw uploaded files land before processing."""
    return user_root(username) / "uploads"


def artifact_path(username: str, job_id: str, filename: str) -> Path:
    """Resolve + validate a request to download a specific artifact.

    Raises FileNotFoundError if the file isn't within the expected job dir
    (defends against `..` tricks) or doesn't exist.
    """
    _check(job_id, "job_id")
    # Filename can contain a single path separator only for the zip name —
    # but we treat it as a flat basename here for safety.
    if "/" in filename or "\\" in filename or filename in ("", ".", ".."):
        raise FileNotFoundError(filename)

    base = job_dir(username, job_id).resolve()
    candidate = (base / filename).resolve()
    if not candidate.is_file():
        raise FileNotFoundError(filename)
    # Ensure the resolved path is actually inside the job dir.
    try:
        candidate.relative_to(base)
    except ValueError:
        raise FileNotFoundError(filename)
    return candidate
