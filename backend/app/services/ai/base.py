"""Abstract base classes for LLM and embedding providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncGenerator

from .types import ProviderConfig


class LLMProvider(ABC):
    """Thin wrapper around one chat-completion endpoint.

    Concrete subclasses only handle the HTTP wire format; all
    context-assembly and session logic lives in ``chat.py``.
    """

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """Yield content tokens as they arrive from the model."""
        ...  # pragma: no cover

    @abstractmethod
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Return the full assistant response (non-streaming)."""
        ...  # pragma: no cover

    async def test_connection(self) -> str:
        """Verify the provider is reachable and return the model name."""
        resp = await self.complete(
            [{"role": "user", "content": "Reply with exactly: OK"}],
            max_tokens=8,
        )
        return resp.strip()


class EmbeddingProvider(ABC):
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...  # pragma: no cover

    @property
    @abstractmethod
    def dimension(self) -> int:
        ...  # pragma: no cover
