"""Job status and artifact download endpoints.

Used by the frontend to poll on an enqueued ARQ job and then download
whatever artifacts it produced into the user's per-job directory.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.jobs import enqueue, get_job_status
from app.jobs.user_storage import artifact_path
from app.services import auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _extract_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    return header[7:]


def _current_username(request: Request) -> str:
    token = _extract_token(request)
    try:
        auth.decode_token(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    return auth.get_username(token)


@router.post("/ping")
async def enqueue_ping(request: Request, message: str = "pong") -> dict:
    """Smoke-test endpoint — enqueues a trivial ping task."""
    _current_username(request)  # authn only; ping is user-agnostic
    job_id = await enqueue("ping", message=message)
    return {"job_id": job_id}


@router.get("/{job_id}")
async def job_status(job_id: str, request: Request) -> dict:
    """Poll a job's status. Returns result payload when complete."""
    _current_username(request)
    status = await get_job_status(job_id)
    return {
        "job_id": status.job_id,
        "status": status.status,
        "result": status.result,
        "error": status.error,
    }


@router.get("/{job_id}/artifact/{filename}")
async def job_artifact(job_id: str, filename: str, request: Request) -> FileResponse:
    """Download a specific artifact file produced by a job.

    Files are scoped to the authenticated user's directory; path traversal
    is blocked in `user_storage.artifact_path`.
    """
    username = _current_username(request)
    try:
        path = artifact_path(username, job_id, filename)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Artifact not found")

    return FileResponse(
        path,
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{quote(filename)}"'},
    )
