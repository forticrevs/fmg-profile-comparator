"""Concrete LLM and embedding provider implementations.

Every provider talks plain HTTP via ``httpx`` — no vendor SDK required.
This keeps the dependency footprint to a single package and makes it
trivial to add new OpenAI-compatible endpoints (the majority case).

Provider coverage:

+------------------+-------------------+-------------------------------------+
| ProviderKind     | LLM class         | Embedding class                     |
+==================+===================+=====================================+
| OPENAI_COMPAT    | OpenAICompatLLM   | OpenAICompatEmbedding               |
|                  | (OpenAI, Azure,   |                                     |
|                  |  OpenRouter,      |                                     |
|                  |  FortiAIGate,     |                                     |
|                  |  vLLM, custom)    |                                     |
+------------------+-------------------+-------------------------------------+
| ANTHROPIC        | AnthropicLLM      | —                                   |
+------------------+-------------------+-------------------------------------+
| GOOGLE           | GoogleLLM         | —                                   |
+------------------+-------------------+-------------------------------------+
| OLLAMA           | OllamaLLM         | OllamaEmbedding                     |
+------------------+-------------------+-------------------------------------+
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import httpx

from .base import EmbeddingProvider, LLMProvider
from .types import ProviderConfig

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(connect=10, read=120, write=10, pool=10)


# ====================================================================
# OpenAI-compatible  (covers OpenAI, OpenRouter, FortiAIGate, vLLM, …)
# ====================================================================


class OpenAICompatLLM(LLMProvider):
    """Any endpoint that implements ``POST /chat/completions`` with SSE."""

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        headers: dict[str, str] = {}
        if self.config.api_key_enc:  # already decrypted by registry
            headers["Authorization"] = f"Bearer {self.config.api_key_enc}"

        body = {
            "model": self.config.model,
            "messages": messages,
            "stream": True,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT, verify=False) as client:
            async with client.stream("POST", url, json=body, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                        delta = chunk["choices"][0].get("delta", {})
                        token = delta.get("content")
                        if token:
                            yield token
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        headers: dict[str, str] = {}
        if self.config.api_key_enc:
            headers["Authorization"] = f"Bearer {self.config.api_key_enc}"

        body = {
            "model": self.config.model,
            "messages": messages,
            "stream": False,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT, verify=False) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]


class OpenAICompatEmbedding(EmbeddingProvider):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        url = f"{self.config.base_url.rstrip('/')}/embeddings"
        headers: dict[str, str] = {}
        if self.config.api_key_enc:
            headers["Authorization"] = f"Bearer {self.config.api_key_enc}"

        body = {"model": self.config.model, "input": texts}

        async with httpx.AsyncClient(timeout=_TIMEOUT, verify=False) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return [item["embedding"] for item in data["data"]]

    @property
    def dimension(self) -> int:
        return self.config.embedding_dim


# ====================================================================
# Anthropic
# ====================================================================


class AnthropicLLM(LLMProvider):
    """Anthropic Messages API with SSE streaming."""

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        url = f"{self.config.base_url.rstrip('/')}/messages"
        headers = {
            "x-api-key": self.config.api_key_enc,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        # Anthropic separates system from messages.
        system_text = ""
        user_msgs = []
        for m in messages:
            if m["role"] == "system":
                system_text += m["content"] + "\n"
            else:
                user_msgs.append(m)

        body: dict = {
            "model": self.config.model,
            "messages": user_msgs,
            "stream": True,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
        }
        if system_text.strip():
            body["system"] = system_text.strip()
        if temperature is not None:
            body["temperature"] = temperature
        elif self.config.temperature != 0.7:
            body["temperature"] = self.config.temperature

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream("POST", url, json=body, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        event = json.loads(line[6:])
                        if event.get("type") == "content_block_delta":
                            text = event.get("delta", {}).get("text")
                            if text:
                                yield text
                    except json.JSONDecodeError:
                        continue

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        url = f"{self.config.base_url.rstrip('/')}/messages"
        headers = {
            "x-api-key": self.config.api_key_enc,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        system_text = ""
        user_msgs = []
        for m in messages:
            if m["role"] == "system":
                system_text += m["content"] + "\n"
            else:
                user_msgs.append(m)

        body: dict = {
            "model": self.config.model,
            "messages": user_msgs,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
        }
        if system_text.strip():
            body["system"] = system_text.strip()
        if temperature is not None:
            body["temperature"] = temperature
        elif self.config.temperature != 0.7:
            body["temperature"] = self.config.temperature

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            blocks = data.get("content", [])
            return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


# ====================================================================
# Google Gemini
# ====================================================================


class GoogleLLM(LLMProvider):
    """Google Generative AI (Gemini) with SSE streaming."""

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        model = self.config.model
        url = (
            f"{self.config.base_url.rstrip('/')}/models/{model}"
            f":streamGenerateContent?alt=sse&key={self.config.api_key_enc}"
        )

        contents = []
        system_text = ""
        for m in messages:
            if m["role"] == "system":
                system_text += m["content"] + "\n"
            else:
                role = "model" if m["role"] == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": m["content"]}]})

        body: dict = {"contents": contents}
        if system_text.strip():
            body["systemInstruction"] = {"parts": [{"text": system_text.strip()}]}
        gen_config: dict = {}
        if temperature is not None:
            gen_config["temperature"] = temperature
        if max_tokens is not None:
            gen_config["maxOutputTokens"] = max_tokens
        if gen_config:
            body["generationConfig"] = gen_config

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream("POST", url, json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        chunk = json.loads(line[6:])
                        for cand in chunk.get("candidates", []):
                            for part in cand.get("content", {}).get("parts", []):
                                text = part.get("text")
                                if text:
                                    yield text
                    except json.JSONDecodeError:
                        continue

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        model = self.config.model
        url = (
            f"{self.config.base_url.rstrip('/')}/models/{model}"
            f":generateContent?key={self.config.api_key_enc}"
        )

        contents = []
        system_text = ""
        for m in messages:
            if m["role"] == "system":
                system_text += m["content"] + "\n"
            else:
                role = "model" if m["role"] == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": m["content"]}]})

        body: dict = {"contents": contents}
        if system_text.strip():
            body["systemInstruction"] = {"parts": [{"text": system_text.strip()}]}
        gen_config: dict = {}
        if temperature is not None:
            gen_config["temperature"] = temperature
        if max_tokens is not None:
            gen_config["maxOutputTokens"] = max_tokens
        if gen_config:
            body["generationConfig"] = gen_config

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
            parts = []
            for cand in data.get("candidates", []):
                for part in cand.get("content", {}).get("parts", []):
                    if part.get("text"):
                        parts.append(part["text"])
            return "".join(parts)


# ====================================================================
# Ollama
# ====================================================================


class OllamaLLM(LLMProvider):
    """Ollama ``/api/chat`` with line-delimited JSON streaming."""

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        url = f"{self.config.base_url.rstrip('/')}/api/chat"
        body: dict = {
            "model": self.config.model,
            "messages": messages,
            "stream": True,
        }
        options: dict = {}
        if temperature is not None:
            options["temperature"] = temperature
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        if options:
            body["options"] = options

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream("POST", url, json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("message", {}).get("content")
                        if token:
                            yield token
                        if chunk.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        url = f"{self.config.base_url.rstrip('/')}/api/chat"
        body: dict = {
            "model": self.config.model,
            "messages": messages,
            "stream": False,
        }
        options: dict = {}
        if temperature is not None:
            options["temperature"] = temperature
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        if options:
            body["options"] = options

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "")


class OllamaEmbedding(EmbeddingProvider):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        url = f"{self.config.base_url.rstrip('/')}/api/embed"
        body = {"model": self.config.model, "input": texts}

        async with httpx.AsyncClient(timeout=httpx.Timeout(300)) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
            return data["embeddings"]

    @property
    def dimension(self) -> int:
        return self.config.embedding_dim


# ====================================================================
# Factory
# ====================================================================

_LLM_MAP: dict[str, type[LLMProvider]] = {
    "openai_compat": OpenAICompatLLM,
    "anthropic": AnthropicLLM,
    "google": GoogleLLM,
    "ollama": OllamaLLM,
}

_EMBED_MAP: dict[str, type[EmbeddingProvider]] = {
    "openai_compat": OpenAICompatEmbedding,
    "ollama": OllamaEmbedding,
}


def create_llm(config: ProviderConfig) -> LLMProvider:
    cls = _LLM_MAP.get(config.kind.value)
    if cls is None:
        raise ValueError(f"No LLM implementation for kind={config.kind!r}")
    return cls(config)


def create_embedding(config: ProviderConfig) -> EmbeddingProvider:
    cls = _EMBED_MAP.get(config.kind.value)
    if cls is None:
        raise ValueError(f"No embedding implementation for kind={config.kind!r}")
    return cls(config)
