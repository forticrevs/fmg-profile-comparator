"""ARQ worker entrypoint.

Run with:
    cd backend
    arq app.jobs.worker.WorkerSettings

The worker is a separate process from the FastAPI app. It connects to the
same Redis instance, picks up enqueued jobs, executes them, and writes
results back. Routes use `app.jobs.queue.enqueue(...)` to push work.
"""

from __future__ import annotations

import logging

from app.jobs.queue import redis_settings
from app.jobs.tasks import ping, pan_extract

logger = logging.getLogger(__name__)


async def startup(ctx: dict) -> None:
    logger.info("ARQ worker starting")


async def shutdown(ctx: dict) -> None:
    logger.info("ARQ worker shutting down")


class WorkerSettings:
    """ARQ worker configuration. Keep `functions` as the central registry."""

    redis_settings = redis_settings

    functions = [
        ping.ping,
        pan_extract.pan_extract,
    ]

    on_startup = startup
    on_shutdown = shutdown

    # Keep results around for 24h so the frontend can poll after the user
    # navigates away and back.
    keep_result = 60 * 60 * 24

    # Job retry policy: don't auto-retry — surface failures to the user.
    max_tries = 1

    # Default per-job timeout. Override per-task in the function decorator
    # if a particular job needs longer.
    job_timeout = 60 * 30  # 30 min
