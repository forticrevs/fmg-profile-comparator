"""Smoke-test task — used to verify the ARQ worker end-to-end."""

from __future__ import annotations

import time


async def ping(ctx: dict, message: str = "pong") -> dict:
    """Trivial task: echo back the message with a timestamp."""
    return {
        "message": message,
        "worker_started_at": ctx.get("enqueue_time"),
        "completed_at": time.time(),
    }
