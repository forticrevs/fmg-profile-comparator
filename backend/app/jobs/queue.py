"""ARQ queue helpers — enqueue jobs from FastAPI request handlers.

The ARQ worker (started separately via `arq app.jobs.worker.WorkerSettings`)
consumes jobs and writes results back into Redis. This module is the thin
glue used by routes to push work onto that queue.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from arq.jobs import JobStatus as ArqJobStatus

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))

redis_settings = RedisSettings(host=REDIS_HOST, port=REDIS_PORT, database=REDIS_DB)

# Lazily-created shared pool. ARQ pools are async, so we initialise on first
# use from inside an event loop.
_pool: ArqRedis | None = None


async def pool() -> ArqRedis:
    """Return the shared ARQ Redis pool, creating it on first call."""
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings)
    return _pool


@dataclass
class JobStatus:
    """Snapshot of a job's state, safe to JSON-serialise back to clients."""

    job_id: str
    status: str  # "queued" | "in_progress" | "complete" | "not_found"
    result: Any | None = None
    error: str | None = None


_STATUS_MAP = {
    ArqJobStatus.deferred: "queued",
    ArqJobStatus.queued: "queued",
    ArqJobStatus.in_progress: "in_progress",
    ArqJobStatus.complete: "complete",
    ArqJobStatus.not_found: "not_found",
}


async def enqueue(job_name: str, *args: Any, **kwargs: Any) -> str:
    """Push a job onto the ARQ queue and return its id.

    `job_name` must match a function registered in `app.jobs.worker.WorkerSettings.functions`.
    """
    p = await pool()
    job = await p.enqueue_job(job_name, *args, **kwargs)
    if job is None:
        raise RuntimeError(f"Failed to enqueue job {job_name!r}")
    return job.job_id


async def get_job_status(job_id: str) -> JobStatus:
    """Look up a job by id and return its status + result (if complete)."""
    from arq.jobs import Job

    p = await pool()
    job = Job(job_id, redis=p)
    status = await job.status()
    mapped = _STATUS_MAP.get(status, "not_found")

    if status == ArqJobStatus.complete:
        try:
            result = await job.result(timeout=0)
            return JobStatus(job_id=job_id, status="complete", result=result)
        except Exception as exc:
            return JobStatus(job_id=job_id, status="complete", error=str(exc))

    return JobStatus(job_id=job_id, status=mapped)
