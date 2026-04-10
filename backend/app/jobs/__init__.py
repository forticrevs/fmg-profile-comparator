"""Background job infrastructure (ARQ + Redis).

Public surface:
- enqueue(job_name, **kwargs) -> job_id
- get_job_status(job_id) -> JobStatus
- The ARQ worker entrypoint lives in `worker.py`.
"""

from app.jobs.queue import (
    JobStatus,
    enqueue,
    get_job_status,
    pool,
)

__all__ = ["enqueue", "get_job_status", "JobStatus", "pool"]
