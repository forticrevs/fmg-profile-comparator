"""Policy Shadow analyzer endpoints.

Thin wrapper over the `fmg-policy-shadow` subprocess runner. Workflow:

1. Frontend calls `GET /packages` to populate a package picker — we reuse
   `policy_fetcher.list_packages` from the policy viewer tool so both
   tools see the same ADOM-wide inventory.
2. Frontend posts a run request with package selection + formats. We
   pull the active FMG instance from the JWT session, decrypt its
   credentials from `fmg_registry`, and enqueue an ARQ job. The ARQ
   task spawns `run_shadow.py` in the background.
3. Frontend polls `/api/jobs/{id}` and downloads artifacts from
   `/api/jobs/{id}/artifact/{filename}` using the generic job endpoints.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.dependencies import get_current_fmg
from app.jobs.queue import pool
from app.services import auth, fmg_registry, policy_fetcher
from app.services.fmg_client import FMGClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools/policy-shadow", tags=["tools", "policy-shadow"])

# Output formats we allow through. Matches the analyzer's own set.
_VALID_FORMATS = {"html", "xlsx", "json"}


class PolicyShadowRunRequest(BaseModel):
    """Run-request body for enqueueing a policy shadow job."""

    # Exactly one of `packages` / `package_regex` / all-packages (empty)
    # should be set. Empty + empty regex means "analyze every package".
    packages: list[str] = Field(default_factory=list)
    package_regex: str | None = None
    formats: list[str] = Field(default_factory=lambda: ["html", "xlsx", "json"])
    include_disabled: bool = False


@router.get("/packages")
async def get_packages(fmg: FMGClient = Depends(get_current_fmg)) -> dict[str, Any]:
    """List all policy packages in the active ADOM.

    Shares `policy_fetcher.list_packages` with the policy viewer so both
    tools see identical flattened, folder-nested package names.
    """
    adom = fmg._adom
    try:
        packages = await policy_fetcher.list_packages(fmg, adom)
    except Exception as exc:
        logger.exception("policy-shadow: failed to list packages")
        raise HTTPException(502, f"Failed to list packages: {exc}")
    return {"adom": adom, "packages": packages}


def _extract_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    return header[7:]


@router.post("/run")
async def run_shadow(
    body: PolicyShadowRunRequest,
    request: Request,
) -> dict[str, Any]:
    """Enqueue a policy shadow analysis job for the active FMG instance."""

    token = _extract_token(request)
    try:
        auth.decode_token(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    session = auth.get_session(token)
    username = session["username"]
    active_id = session.get("active_instance")
    if not active_id:
        raise HTTPException(400, "No FMG instance selected — please connect first")

    inst = fmg_registry.get_instance(username, active_id)
    if not inst:
        raise HTTPException(404, "Active FMG instance not found in registry")

    # Validate formats — reject anything unrecognised rather than letting
    # the subprocess error out with a less helpful message.
    formats = [f.strip().lower() for f in body.formats if f.strip()]
    invalid = [f for f in formats if f not in _VALID_FORMATS]
    if invalid:
        raise HTTPException(
            400, f"Invalid format(s): {', '.join(invalid)}. Valid: html, xlsx, json"
        )
    if not formats:
        formats = ["html", "xlsx", "json"]

    # The analyzer requires at least one of: --package / --all-packages /
    # --package-regex. Empty packages + no regex ⇒ run with --all-packages.
    packages = [p.strip() for p in body.packages if p.strip()]
    package_regex = body.package_regex.strip() if body.package_regex else None

    job_id = uuid.uuid4().hex[:16]

    p = await pool()
    job = await p.enqueue_job(
        "policy_shadow",
        _job_id=job_id,
        username=username,
        job_id=job_id,
        fmg_host=inst["host"],
        fmg_username=inst["fmg_username"],
        fmg_password=inst["fmg_password"],
        adom=inst.get("adom", "root"),
        verify_ssl=inst.get("verify_ssl", False),
        packages=packages,
        package_regex=package_regex,
        formats=formats,
        include_disabled=body.include_disabled,
    )
    if job is None:
        raise HTTPException(500, "Failed to enqueue shadow analysis job")

    logger.info(
        "policy-shadow enqueued user=%s job=%s host=%s pkgs=%s regex=%s",
        username,
        job_id,
        inst["host"],
        packages or "(all)",
        package_regex,
    )

    return {
        "job_id": job_id,
        "adom": inst.get("adom", "root"),
        "host": inst["host"],
        "packages": packages,
        "package_regex": package_regex,
        "formats": formats,
    }
