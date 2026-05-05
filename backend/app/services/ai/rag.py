"""Local Fortinet RAG retrieval for chat prompts.

The RAG corpus lives outside this web app, but the serving surfaces are
plain HTTP: Ollama for query embeddings and Qdrant for vector search.
Keep this module dependency-light so the app can use the local pipeline
without importing the standalone ingestion/search scripts.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx

from .summarize import render_page_context

logger = logging.getLogger(__name__)

COLLECTION = os.getenv("RAG_COLLECTION", "fortinet_docs")
QDRANT_URL = os.getenv("RAG_QDRANT_URL", os.getenv("QDRANT_URL", "http://127.0.0.1:6333"))
OLLAMA_URL = os.getenv("RAG_OLLAMA_URL", os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"))
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", "qwen3-embedding:8b")
EMBEDDING_DIM = int(os.getenv("RAG_EMBEDDING_DIM", "4096"))

TOP_K = int(os.getenv("RAG_TOP_K", "5"))
MAX_CONTEXT_CHARS = int(os.getenv("RAG_MAX_CONTEXT_CHARS", "7000"))
MAX_QUERY_CONTEXT_CHARS = int(os.getenv("RAG_MAX_QUERY_CONTEXT_CHARS", "1800"))
MAX_EXCERPT_CHARS = int(os.getenv("RAG_MAX_EXCERPT_CHARS", "1300"))

_TIMEOUT = httpx.Timeout(connect=5, read=60, write=10, pool=5)
_SPACE_RE = re.compile(r"\s+")


def _env_enabled(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _clean_text(value: Any) -> str:
    return _SPACE_RE.sub(" ", str(value or "")).strip()


def _build_query(user_text: str, page_context: dict[str, Any] | None) -> str:
    """Blend the user's question with compact UI context for retrieval only."""
    parts = [user_text.strip()]
    rendered_context = render_page_context(page_context)
    if rendered_context:
        parts.append(rendered_context[:MAX_QUERY_CONTEXT_CHARS])
    return "\n\n".join(part for part in parts if part)


async def _embed_query(client: httpx.AsyncClient, text: str) -> list[float]:
    resp = await client.post(
        f"{OLLAMA_URL.rstrip('/')}/api/embed",
        json={"model": EMBEDDING_MODEL, "input": text},
    )
    resp.raise_for_status()
    data = resp.json()
    vectors = data.get("embeddings") or []
    if not vectors:
        raise ValueError("Ollama embed response did not include embeddings")
    vector = vectors[0]
    if EMBEDDING_DIM and len(vector) != EMBEDDING_DIM:
        raise ValueError(
            f"Embedding dimension mismatch: got {len(vector)}, expected {EMBEDDING_DIM}"
        )
    return vector


async def _query_qdrant(client: httpx.AsyncClient, vector: list[float]) -> list[dict[str, Any]]:
    body = {
        "query": vector,
        "limit": TOP_K,
        "with_payload": True,
    }
    resp = await client.post(
        f"{QDRANT_URL.rstrip('/')}/collections/{COLLECTION}/points/query",
        json=body,
    )
    if resp.status_code == 404:
        legacy = await client.post(
            f"{QDRANT_URL.rstrip('/')}/collections/{COLLECTION}/points/search",
            json={"vector": vector, "limit": TOP_K, "with_payload": True},
        )
        legacy.raise_for_status()
        result = legacy.json().get("result") or []
        return result if isinstance(result, list) else []

    resp.raise_for_status()
    result = resp.json().get("result") or {}
    points = result.get("points") if isinstance(result, dict) else result
    return points if isinstance(points, list) else []


def _format_point(index: int, point: dict[str, Any], remaining: int) -> str:
    payload = point.get("payload") or {}
    score = point.get("score")
    title = _clean_text(payload.get("title")) or "(untitled)"
    product = _clean_text(payload.get("product")) or "unknown"
    source = _clean_text(payload.get("source")) or "unknown"
    file_path = _clean_text(payload.get("file_path"))
    chunk_index = payload.get("chunk_index")
    total_chunks = payload.get("total_chunks")
    text = _clean_text(payload.get("text"))

    excerpt_limit = min(MAX_EXCERPT_CHARS, max(0, remaining))
    excerpt = text[:excerpt_limit]
    if len(text) > excerpt_limit:
        excerpt += " ... [truncated]"

    meta = [
        f"Document {index}",
        f"score={score:.4f}" if isinstance(score, (float, int)) else None,
        f"product={product}",
        f"source={source}",
    ]
    if isinstance(chunk_index, int) and isinstance(total_chunks, int):
        meta.append(f"chunk={chunk_index + 1}/{total_chunks}")
    if file_path:
        meta.append(f"path={file_path}")

    return "\n".join([
        "--- " + " | ".join(part for part in meta if part) + " ---",
        f"Title: {title}",
        excerpt,
    ])


def _format_context(points: list[dict[str, Any]]) -> str | None:
    if not points:
        return None

    blocks: list[str] = []
    used = 0
    for index, point in enumerate(points, 1):
        remaining = MAX_CONTEXT_CHARS - used
        if remaining <= 400:
            break
        block = _format_point(index, point, remaining)
        if used + len(block) > MAX_CONTEXT_CHARS:
            block = block[:remaining] + "\n... [RAG context budget reached]"
        blocks.append(block)
        used += len(block) + 2

    if not blocks:
        return None

    return (
        "Use these Fortinet documentation excerpts only when they are relevant. "
        "Prefer the current UI context for facts about what the user is viewing, "
        "and cite document titles or paths when an excerpt materially informs the answer.\n\n"
        + "\n\n".join(blocks)
    )


async def retrieve_context(
    user_text: str,
    page_context: dict[str, Any] | None = None,
) -> str | None:
    """Return a prompt-ready RAG context block for the chat turn.

    Retrieval is best-effort. A local Ollama/Qdrant outage should not break
    chat, so callers receive ``None`` on failure and the warning is logged.
    """
    if not _env_enabled("RAG_ENABLED", True):
        return None

    query = _build_query(user_text, page_context)
    if not query:
        return None

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            vector = await _embed_query(client, query)
            points = await _query_qdrant(client, vector)
    except Exception:
        logger.warning("RAG retrieval failed", exc_info=True)
        return None

    return _format_context(points)
