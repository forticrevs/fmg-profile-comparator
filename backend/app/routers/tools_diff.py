"""Diff utility endpoints.

Accepts multiple uploaded text / structured files and returns unified diffs
between each file and a chosen baseline. Designed for small config files —
the hard caps are intentionally low.

Security:
    Every file goes through `app.services.file_security.validate_batch`:
    size caps, extension allow-list, magic-byte sniff, NUL-byte rejection,
    UTF-8 strict decode, and safe-parser validation (defusedxml for XML,
    yaml.safe_load for YAML, json.loads for JSON). Content is canonicalised
    before diffing. The request handler is stateless — nothing is ever
    written to disk. A per-user sliding-window rate limit caps abuse.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.services import auth
from app.services.diff_engine import diff_against_baseline
from app.services.file_security import (
    ALLOWED_EXTENSIONS,
    FileSecurityError,
    validate_batch,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools/diff", tags=["tools"])


# Hard caps — conservative. Config files in scope are tiny; if we ever need
# to widen this, do it by explicit request instead of default drift.
MAX_FILE_BYTES = 2 * 1024 * 1024      # 2 MiB
MAX_TOTAL_BYTES = 10 * 1024 * 1024    # 10 MiB
MAX_FILE_COUNT = 6
MIN_FILE_COUNT = 2

# Sliding-window rate limit per user. In-memory — fine for a single-node
# deployment; swap for Redis if we ever horizontally scale the API.
_RATE_WINDOW_S = 60
_RATE_MAX = 20
_rate_buckets: dict[str, deque[float]] = defaultdict(deque)


def _current_username(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = header[7:]
    try:
        auth.decode_token(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    return auth.get_username(token)


def _rate_check(username: str) -> None:
    now = time.monotonic()
    bucket = _rate_buckets[username]
    cutoff = now - _RATE_WINDOW_S
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= _RATE_MAX:
        raise HTTPException(
            429,
            f"Rate limit exceeded ({_RATE_MAX} diffs per {_RATE_WINDOW_S}s)",
        )
    bucket.append(now)


@router.get("/limits")
async def limits(request: Request) -> dict:
    """Expose upload constraints so the frontend can pre-validate."""
    _current_username(request)
    return {
        "max_file_bytes": MAX_FILE_BYTES,
        "max_total_bytes": MAX_TOTAL_BYTES,
        "max_file_count": MAX_FILE_COUNT,
        "min_file_count": MIN_FILE_COUNT,
        "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
    }


@router.post("/compare")
async def compare(
    request: Request,
    files: list[UploadFile] = File(...),
    baseline_index: int = Form(0),
) -> dict:
    """Accept a multipart batch and return per-file unified diffs."""
    username = _current_username(request)
    _rate_check(username)

    if not files:
        raise HTTPException(400, "No files uploaded")

    # Read everything into memory — the batch caps keep this bounded.
    payloads: list[tuple[str | None, bytes]] = []
    for upload in files:
        data = await upload.read()
        payloads.append((upload.filename, data))

    try:
        validated = validate_batch(
            payloads,
            min_count=MIN_FILE_COUNT,
            max_count=MAX_FILE_COUNT,
            max_file_bytes=MAX_FILE_BYTES,
            max_total_bytes=MAX_TOTAL_BYTES,
        )
    except FileSecurityError as exc:
        raise HTTPException(400, str(exc))

    # Require all files to share a format — no cross-format diffing in v1.
    formats = {f.format for f in validated}
    if len(formats) > 1:
        raise HTTPException(
            400,
            f"All files must be the same format (got {sorted(formats)})",
        )

    if not 0 <= baseline_index < len(validated):
        raise HTTPException(400, f"baseline_index {baseline_index} out of range")

    try:
        pairs = diff_against_baseline(validated, baseline_index=baseline_index)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    # Audit log — sanitised names + hashes only, never content.
    logger.info(
        "diff.compare user=%s format=%s files=%s",
        username,
        next(iter(formats)),
        [(f.name, f.size, f.sha256[:12]) for f in validated],
    )

    return {
        "format": next(iter(formats)),
        "baseline_index": baseline_index,
        "files": [
            {
                "name": f.name,
                "size": f.size,
                "sha256": f.sha256,
                "format": f.format,
            }
            for f in validated
        ],
        "diffs": [
            {
                "index": p.index,
                "name": p.name,
                "unified": p.unified,
                "added": p.added,
                "removed": p.removed,
                "truncated": p.truncated,
            }
            for p in pairs
        ],
    }
