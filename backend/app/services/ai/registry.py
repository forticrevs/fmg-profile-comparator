"""AI provider registry — persist, load, and instantiate providers.

Uses the same Fernet key as the FMG instance store so a single
``.fmg_key`` protects all secrets on disk.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet

from .base import EmbeddingProvider, LLMProvider
from .providers import create_embedding, create_llm
from .types import ProviderConfig, ProviderKind

logger = logging.getLogger(__name__)

_KEY_PATH = Path(__file__).resolve().parents[3] / ".fmg_key"
_STORE_PATH = Path(__file__).resolve().parents[3] / "ai_providers.json"


# ---- Fernet helpers (shared key with fmg_registry) ------------------

def _get_cipher() -> Fernet:
    if _KEY_PATH.exists():
        key = _KEY_PATH.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        _KEY_PATH.write_bytes(key)
        _KEY_PATH.chmod(0o600)
    return Fernet(key)


def _encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _get_cipher().encrypt(plaintext.encode()).decode()


def _decrypt(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    return _get_cipher().decrypt(ciphertext.encode()).decode()


# ---- Storage --------------------------------------------------------

def _load_raw() -> dict[str, Any]:
    if _STORE_PATH.exists():
        return json.loads(_STORE_PATH.read_text())
    return {"providers": {}}


def _save_raw(data: dict[str, Any]) -> None:
    _STORE_PATH.write_text(json.dumps(data, indent=2))


# ---- Public API -----------------------------------------------------

def list_providers() -> list[ProviderConfig]:
    """Return every configured provider (API keys stay encrypted)."""
    data = _load_raw()
    out: list[ProviderConfig] = []
    for raw in data.get("providers", {}).values():
        try:
            out.append(ProviderConfig(**raw))
        except Exception:
            logger.warning("Skipping malformed provider entry: %s", raw.get("id"))
    return out


def get_provider_config(provider_id: str) -> ProviderConfig | None:
    data = _load_raw()
    raw = data.get("providers", {}).get(provider_id)
    if raw is None:
        return None
    return ProviderConfig(**raw)


def upsert_provider(
    provider_id: str,
    *,
    name: str,
    kind: ProviderKind,
    base_url: str,
    api_key: str = "",
    model: str,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    is_embedding: bool = False,
    embedding_dim: int = 0,
    enabled: bool = True,
) -> ProviderConfig:
    """Create or update a provider, encrypting the API key on write."""
    data = _load_raw()
    providers = data.setdefault("providers", {})

    # If updating and no new key supplied, keep the old one.
    existing = providers.get(provider_id)
    if existing and not api_key:
        enc_key = existing.get("api_key_enc", "")
    else:
        enc_key = _encrypt(api_key)

    entry = {
        "id": provider_id,
        "name": name,
        "kind": kind.value if isinstance(kind, ProviderKind) else kind,
        "base_url": base_url,
        "api_key_enc": enc_key,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "is_embedding": is_embedding,
        "embedding_dim": embedding_dim,
        "enabled": enabled,
    }
    providers[provider_id] = entry
    _save_raw(data)
    return ProviderConfig(**entry)


def delete_provider(provider_id: str) -> bool:
    data = _load_raw()
    removed = data.get("providers", {}).pop(provider_id, None)
    if removed:
        _save_raw(data)
    return removed is not None


def get_llm(provider_id: str) -> LLMProvider:
    """Instantiate an LLM provider with its decrypted API key."""
    cfg = get_provider_config(provider_id)
    if cfg is None:
        raise ValueError(f"Unknown provider: {provider_id!r}")
    # Decrypt key into the config object the provider will read.
    cfg = cfg.model_copy(update={"api_key_enc": _decrypt(cfg.api_key_enc)})
    return create_llm(cfg)


def get_embedding(provider_id: str) -> EmbeddingProvider:
    cfg = get_provider_config(provider_id)
    if cfg is None:
        raise ValueError(f"Unknown provider: {provider_id!r}")
    cfg = cfg.model_copy(update={"api_key_enc": _decrypt(cfg.api_key_enc)})
    return create_embedding(cfg)
