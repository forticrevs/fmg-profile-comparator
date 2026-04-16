"""Chat and AI provider management endpoints.

``POST /api/chat/message`` streams tokens via SSE so the frontend can
render the assistant's reply incrementally.  All other endpoints return
regular JSON.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.services.ai import chat, registry
from app.services.ai.types import ChatRequest, ProviderKind

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat", "ai"])


# ====================================================================
# Chat endpoints
# ====================================================================


@router.post("/api/chat/message")
async def chat_message(
    body: ChatRequest,
    user: dict = Depends(get_current_user),
) -> StreamingResponse:
    """Send a user message and stream the assistant reply as SSE."""
    try:
        provider = registry.get_llm(body.provider_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    # Resolve or create session.
    session = None
    if body.session_id:
        session = chat.get_session(body.session_id)
    if session is None:
        session = chat.new_session(body.provider_id)

    async def generate():
        # First event: session ID so the frontend can track it.
        yield f"data: {json.dumps({'session_id': session.id})}\n\n"
        try:
            async for token in chat.send_message(
                session,
                body.message,
                provider,
                page_context=body.page_context or None,
                system_prompt=body.system_prompt,
            ):
                yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as exc:
            logger.exception("chat stream error")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/api/chat/new")
async def new_chat(
    body: dict[str, str],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    provider_id = body.get("provider_id", "")
    if not provider_id:
        raise HTTPException(400, "provider_id required")
    session = chat.new_session(provider_id)
    return {"session_id": session.id}


@router.post("/api/chat/save")
async def save_chat(
    body: dict[str, str],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    session_id = body.get("session_id", "")
    session = chat.get_session(session_id)
    if session is None:
        raise HTTPException(404, "Session not found")
    username = user.get("username", "anonymous")
    path = chat.save_session(session, username)
    return {"saved": True, "file": path.name}


@router.get("/api/chat/history")
async def list_history(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    sessions = chat.list_saved_sessions(username)
    return {"sessions": sessions}


@router.get("/api/chat/history/{session_id}")
async def load_history(
    session_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    username = user.get("username", "anonymous")
    session = chat.load_saved_session(username, session_id)
    if session is None:
        raise HTTPException(404, "Saved session not found")
    return session.model_dump()


# ====================================================================
# Provider management endpoints
# ====================================================================


class FetchModelsRequest(BaseModel):
    kind: str = Field(..., min_length=1)
    base_url: str = Field(..., min_length=1)
    api_key: str = ""


@router.post("/api/ai/fetch-models")
async def fetch_models(
    body: FetchModelsRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch available models from a provider endpoint.

    Each provider kind has a different discovery mechanism:

    - ``ollama``: ``GET /api/tags`` — returns installed local models.
    - ``openai_compat``: ``GET /models`` — standard OpenAI list-models
      endpoint (works with OpenAI, OpenRouter, vLLM, FortiAIGate, etc).
    - ``anthropic``: no public endpoint — returns a static list.
    - ``google``: ``GET /models`` filtered to chat-capable models.
    """
    import httpx

    models: list[str] = []
    try:
        if body.kind == "ollama":
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{body.base_url.rstrip('/')}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                models = sorted(m["name"] for m in data.get("models", []))

        elif body.kind == "openai_compat":
            headers: dict[str, str] = {}
            if body.api_key:
                headers["Authorization"] = f"Bearer {body.api_key}"
            async with httpx.AsyncClient(timeout=15, verify=False) as client:
                resp = await client.get(
                    f"{body.base_url.rstrip('/')}/models", headers=headers
                )
                resp.raise_for_status()
                data = resp.json()
                models = sorted(
                    m["id"]
                    for m in data.get("data", [])
                    if isinstance(m, dict) and m.get("id")
                )

        elif body.kind == "anthropic":
            models = [
                "claude-sonnet-4-20250514",
                "claude-opus-4-20250514",
                "claude-haiku-4-5-20251001",
            ]

        elif body.kind == "google":
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{body.base_url.rstrip('/')}/models?key={body.api_key}"
                )
                resp.raise_for_status()
                data = resp.json()
                models = sorted(
                    m["name"].removeprefix("models/")
                    for m in data.get("models", [])
                    if isinstance(m, dict)
                    and "generateContent"
                    in str(m.get("supportedGenerationMethods", []))
                )

    except Exception as exc:
        return {"models": models, "error": str(exc)}
    return {"models": models}


@router.get("/api/ai/ollama-models")
async def list_ollama_models(
    base_url: str = "http://localhost:11434",
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Shorthand for fetching Ollama models (used by legacy callers)."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{base_url.rstrip('/')}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"models": sorted(models)}
    except Exception as exc:
        return {"models": [], "error": str(exc)}


class ProviderUpsertRequest(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    kind: ProviderKind
    base_url: str = Field(..., min_length=1)
    api_key: str = ""
    model: str = Field(..., min_length=1)
    temperature: float = 0.7
    max_tokens: int = 4096
    is_embedding: bool = False
    embedding_dim: int = 0
    enabled: bool = True


@router.get("/api/ai/providers")
async def list_providers(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    providers = registry.list_providers()
    # Mask encrypted keys for the UI — just show whether one is set.
    out = []
    for p in providers:
        d = p.model_dump()
        d["has_api_key"] = bool(d.pop("api_key_enc", ""))
        out.append(d)
    return {"providers": out}


@router.post("/api/ai/providers")
async def upsert_provider(
    body: ProviderUpsertRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    cfg = registry.upsert_provider(
        body.id,
        name=body.name,
        kind=body.kind,
        base_url=body.base_url,
        api_key=body.api_key,
        model=body.model,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
        is_embedding=body.is_embedding,
        embedding_dim=body.embedding_dim,
        enabled=body.enabled,
    )
    return {"id": cfg.id, "saved": True}


@router.delete("/api/ai/providers/{provider_id}")
async def delete_provider(
    provider_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    removed = registry.delete_provider(provider_id)
    if not removed:
        raise HTTPException(404, "Provider not found")
    return {"deleted": True}


@router.post("/api/ai/providers/{provider_id}/test")
async def test_provider(
    provider_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        llm = registry.get_llm(provider_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    try:
        reply = await llm.test_connection()
        return {"ok": True, "reply": reply}
    except Exception as exc:
        logger.warning("Provider test failed for %s: %s", provider_id, exc)
        return {"ok": False, "error": str(exc)}
