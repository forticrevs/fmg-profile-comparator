"""PAN XML extraction tool endpoints.

Single upload surface for the unified "PAN XML Extraction" tool. The user
POSTs a Palo Alto `running-config.xml` plus the set of parser ids they want
run, and we enqueue an ARQ job that fans out across
`app.services.pan_parsers.REGISTRY`.

The actual work lives in `app.jobs.tasks.pan_extract`. This router is just
a thin edge: authenticate, stash the upload in the user's dir, enqueue,
return the job id. Status polling and artifact downloads reuse
`/api/jobs/*` from `routers.jobs`.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.jobs.queue import pool
from app.jobs.user_storage import uploads_dir
from app.services import auth
from app.services.pan_parsers import REGISTRY, list_parsers

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools/pan-xml", tags=["tools"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MiB — PAN running-configs stay well under this


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


@router.get("/parsers")
async def parsers(request: Request) -> dict:
    """List the parsers that the frontend can offer as checkboxes."""
    _current_username(request)
    return {"parsers": list_parsers()}


@router.post("/extract")
async def extract(
    request: Request,
    file: UploadFile = File(...),
    parsers: str = Form(...),
) -> dict:
    """Accept an uploaded PAN XML and enqueue a `pan_extract` job.

    `parsers` is a comma-separated list of parser ids (form field, not JSON,
    because the request is multipart).
    """
    username = _current_username(request)

    parser_ids = [p.strip() for p in parsers.split(",") if p.strip()]
    if not parser_ids:
        raise HTTPException(400, "No parsers selected")

    unknown = [p for p in parser_ids if p not in REGISTRY]
    if unknown:
        raise HTTPException(400, f"Unknown parsers: {', '.join(unknown)}")

    # Read the upload — streaming to disk would be nicer for very large
    # files but PAN configs are comfortably under the 50 MiB cap.
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Upload exceeds maximum size")
    if not data:
        raise HTTPException(400, "Empty upload")

    # Quick sanity check: must at least look like XML.
    head = data.lstrip()[:64]
    if not head.startswith(b"<"):
        raise HTTPException(400, "File does not appear to be XML")

    # Use the same id for ARQ's job handle AND the on-disk artifact dir so
    # the frontend only has one id to track across polling and downloads.
    job_id = uuid.uuid4().hex[:16]
    up_dir = uploads_dir(username)
    up_dir.mkdir(parents=True, exist_ok=True)
    xml_path = up_dir / f"pan-{job_id}.xml"
    xml_path.write_bytes(data)

    p = await pool()
    job = await p.enqueue_job(
        "pan_extract",
        _job_id=job_id,
        username=username,
        job_id=job_id,
        xml_path=str(xml_path),
        parsers=parser_ids,
    )
    if job is None:
        raise HTTPException(500, "Failed to enqueue extraction job")

    logger.info(
        "pan-xml extract enqueued user=%s job=%s parsers=%s",
        username,
        job_id,
        parser_ids,
    )

    return {
        "job_id": job_id,
        "parsers": parser_ids,
    }
