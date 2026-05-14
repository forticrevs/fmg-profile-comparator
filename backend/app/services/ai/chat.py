"""Chat session manager — conversation state, context assembly, streaming.

Each session is an in-memory conversation that tracks messages and the
current page context. Sessions are ephemeral by default (cleared on
logout / browser refresh); the frontend can explicitly save one to
persist it across logins.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator

from .base import LLMProvider
from .summarize import render_page_context
from .types import ChatMessage, ChatSession

logger = logging.getLogger(__name__)

_HISTORY_DIR = Path(__file__).resolve().parents[3] / "chat_history"

# In-memory session store — keyed by session ID.
_sessions: dict[str, ChatSession] = {}

# Default system prompt.  The page-context block is injected between
# this preamble and the user's conversation.
_SYSTEM_PREAMBLE = """\
You are the AI assistant embedded in a FortiManager profile comparison and
migration web application.

Your job is to help Fortinet operators understand, compare, troubleshoot, and
migrate Fortinet security configuration using the current UI context, attached
chat context items, and optional Fortinet documentation excerpts from RAG.

Use the available context in this priority order:
1. Current UI context and explicitly attached items.
2. Retrieved Fortinet documentation excerpts.
3. General Fortinet product knowledge.
If these sources conflict, call that out clearly and prefer the live UI/app
context.

You understand these application capabilities:
- FortiManager multi-instance, per-session ADOM/profile comparison.
- Profile comparison with baseline selection, pinned drift fields, flat fields,
  structured collections, and resolved raw/display values.
- SD-WAN, webfilter, application control, IPS, DLP, DNS filter, antivirus,
  SSL/SSH inspection, and related FortiManager profile data.
- Reference catalogs for application signatures, IPS signatures, DLP sensors,
  DLP dictionaries, DLP data types, local web categories, web rating overrides,
  Internet Services/ISDB, and metadata variables.
- Policy viewer and policy shadow analysis.
- Palo Alto XML extraction/conversion tools and config diff tooling.
- Optional AI providers and optional RAG backed by Qdrant and
  qwen3-embedding:8b.

When answering:
- Be concise, operational, and specific.
- Mention exact profile names, field paths, package names, object names, IDs,
  or table rows when they are present in context.
- Explain whether differences are meaningful drift, expected defaults, schema
  noise, ordering noise, or likely migration risk.
- For comparison results, separate "what changed", "why it matters", and
  "recommended next action".
- For migration work, favor practical FortiManager/FortiGate configuration
  guidance and validation steps.
- For CLI/API examples, provide commands or JSON-RPC paths only when relevant
  and label assumptions such as ADOM, VDOM, package, or device.
- If context is insufficient, ask for the missing profile/package/object names
  or tell the user what page/data to attach.
- Do not invent FortiManager schema fields, object relationships, policy hits,
  or device state that are not in the provided context.
- Do not claim you changed FortiManager, FortiGate, Qdrant, GitHub, files, or
  providers unless the app/tooling explicitly did so.
- Do not expose, request, or repeat secrets, API keys, passwords, session
  tokens, or encrypted store contents.
- Treat AI providers and RAG as optional; if RAG context is absent, still
  answer from UI context and say when documentation verification would help.

Your tone should be that of a senior Fortinet-focused engineer: calm, direct,
accurate, and helpful.
"""


def new_session(provider_id: str) -> ChatSession:
    sid = uuid.uuid4().hex[:12]
    session = ChatSession(
        id=sid,
        provider_id=provider_id,
        messages=[],
        created_at=time.time(),
    )
    _sessions[sid] = session
    return session


def get_session(session_id: str) -> ChatSession | None:
    return _sessions.get(session_id)


def delete_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


def _build_messages(
    session: ChatSession,
    page_context: dict[str, Any] | None = None,
    system_prompt: str | None = None,
    rag_context: str | None = None,
) -> list[dict[str, str]]:
    """Assemble the full message list sent to the LLM.

    Order: system preamble → RAG context → page context → conversation.
    """
    parts = [system_prompt or _SYSTEM_PREAMBLE]

    if rag_context:
        parts.append(
            "\n\n--- Relevant knowledge base excerpts ---\n" + rag_context
        )

    ctx_block = render_page_context(page_context)
    if ctx_block:
        parts.append(
            "\n\n--- Current UI context (what the user is looking at) ---\n"
            + ctx_block
        )

    messages: list[dict[str, str]] = [
        {"role": "system", "content": "\n".join(parts)},
    ]
    for m in session.messages:
        messages.append({"role": m.role, "content": m.content})
    return messages


async def send_message(
    session: ChatSession,
    user_text: str,
    provider: LLMProvider,
    *,
    page_context: dict[str, Any] | None = None,
    system_prompt: str | None = None,
    rag_context: str | None = None,
) -> AsyncGenerator[str, None]:
    """Append the user message, stream the assistant reply, and persist both.

    Yields content tokens as they arrive.  The full assistant message
    is appended to the session only after the stream completes so that
    interrupted streams don't leave partial messages in history.
    """
    session.messages.append(ChatMessage(role="user", content=user_text))

    messages = _build_messages(
        session,
        page_context=page_context,
        system_prompt=system_prompt,
        rag_context=rag_context,
    )

    full_reply: list[str] = []
    async for token in provider.stream(messages):
        full_reply.append(token)
        yield token

    assistant_text = "".join(full_reply)
    session.messages.append(ChatMessage(role="assistant", content=assistant_text))


# ---- Persistence (explicit save / load) -----------------------------

def save_session(session: ChatSession, username: str) -> Path:
    _HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{username}_{session.id}_{int(session.created_at)}.json"
    path = _HISTORY_DIR / fname
    path.write_text(session.model_dump_json(indent=2))
    return path


def list_saved_sessions(username: str) -> list[dict[str, Any]]:
    if not _HISTORY_DIR.exists():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted(_HISTORY_DIR.glob(f"{username}_*.json"), reverse=True):
        try:
            data = json.loads(p.read_text())
            out.append({
                "id": data["id"],
                "provider_id": data.get("provider_id", ""),
                "message_count": len(data.get("messages", [])),
                "created_at": data.get("created_at", 0),
                "file": p.name,
            })
        except Exception:
            continue
    return out


def load_saved_session(username: str, session_id: str) -> ChatSession | None:
    if not _HISTORY_DIR.exists():
        return None
    for p in _HISTORY_DIR.glob(f"{username}_{session_id}_*.json"):
        try:
            data = json.loads(p.read_text())
            session = ChatSession(**data)
            _sessions[session.id] = session
            return session
        except Exception:
            continue
    return None
