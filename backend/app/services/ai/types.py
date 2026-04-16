"""Shared data models for the AI / chat subsystem."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ProviderKind(str, Enum):
    """Logical provider flavour.

    ``OPENAI_COMPAT`` covers every endpoint that speaks the
    ``/v1/chat/completions`` wire format: OpenAI proper, Azure OpenAI,
    OpenRouter, FortiAIGate, vLLM, LiteLLM, LocalAI, and anything else
    the operator spins up behind that interface.
    """

    OPENAI_COMPAT = "openai_compat"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    OLLAMA = "ollama"


class ProviderConfig(BaseModel):
    """Persisted provider definition — one per model the operator wants."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, description="Human label shown in the UI")
    kind: ProviderKind
    base_url: str = Field(..., min_length=1)
    api_key_enc: str = ""  # Fernet-encrypted; empty for key-less endpoints
    model: str = Field(..., min_length=1)

    # Tunables
    temperature: float = 0.7
    max_tokens: int = 4096

    # Embedding providers reuse the same config shape.  When
    # ``is_embedding`` is true the registry exposes the provider through
    # the embedding interface instead of the LLM one.
    is_embedding: bool = False
    embedding_dim: int = 0

    enabled: bool = True


class ChatMessage(BaseModel):
    role: str  # "system", "user", "assistant"
    content: str


class ChatRequest(BaseModel):
    """Inbound request from the frontend chat widget."""

    provider_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    session_id: str | None = None
    page_context: dict[str, Any] = Field(default_factory=dict)
    system_prompt: str | None = None


class ChatSession(BaseModel):
    id: str
    provider_id: str
    messages: list[ChatMessage] = Field(default_factory=list)
    created_at: float = 0.0
