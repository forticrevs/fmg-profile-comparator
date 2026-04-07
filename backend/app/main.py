"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import profiles
from app.services.fmg_client import fmg


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: login to FMG
    try:
        await fmg.login()
    except Exception as exc:
        import logging
        logging.warning(f"FMG login failed at startup (will retry on requests): {exc}")
    yield
    # Shutdown: logout
    await fmg.logout()


app = FastAPI(
    title="FortiManager Profile Comparator",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(profiles.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
