"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    profiles,
    reference,
    auth,
    settings,
    jobs,
    tools_pan,
    tools_diff,
    tools_policy_viewer,
    tools_policy_shadow,
    tools_isdb,
    schemas,
    chat,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Shutdown: cleanup any expired sessions
    from app.services.auth import cleanup_expired
    await cleanup_expired()


app = FastAPI(
    title="FortiManager Profile Comparator",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(profiles.router)
app.include_router(reference.router)
app.include_router(settings.router)
app.include_router(jobs.router)
app.include_router(tools_pan.router)
app.include_router(tools_diff.router)
app.include_router(tools_policy_viewer.router)
app.include_router(tools_policy_shadow.router)
app.include_router(tools_isdb.router)
app.include_router(schemas.router)
app.include_router(chat.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
