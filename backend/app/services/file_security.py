"""File upload security utilities.

Shared validation primitives used by any tool that accepts uploaded files.
Each primitive is composable — callers pick what they need.

This module is intentionally paranoid. The product is designed to sit behind
a WAF in production, but WAFs are one layer. This is the app-layer defence:
hard caps, magic-byte sniffing, content validation with safe parsers, and
deterministic filename sanitisation. Everything happens in-memory; callers
are expected not to write raw uploads to disk.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath

logger = logging.getLogger(__name__)


class FileSecurityError(ValueError):
    """Raised when an uploaded file violates a security constraint."""


# ---------------------------------------------------------------------------
# Limits — conservative defaults. Tools widen via explicit arguments only;
# we never loosen the defaults silently.
# ---------------------------------------------------------------------------

DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024    # 2 MiB per file
DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024  # 10 MiB per request
DEFAULT_MAX_FILENAME_LEN = 128

# Extensions → logical format. Kept lowercase, leading dot.
TEXT_EXTENSIONS = {".txt", ".conf", ".cfg"}
STRUCTURED_EXTENSIONS = {".json", ".xml", ".yaml", ".yml"}
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | STRUCTURED_EXTENSIONS

EXT_TO_FORMAT: dict[str, str] = {
    ".txt": "text",
    ".conf": "text",
    ".cfg": "text",
    ".json": "json",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
}

# Safe filename chars — conservative alnum+dot+dash+underscore. Anything else
# collapses to a single underscore.
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


# ---------------------------------------------------------------------------
# Filename sanitisation
# ---------------------------------------------------------------------------

def sanitize_filename(raw: str | None, max_len: int = DEFAULT_MAX_FILENAME_LEN) -> str:
    """Return a safe, flat filename stripped of path components and unsafe
    characters. Never trust the client's original filename directly.

    - Path separators (POSIX + Windows) stripped
    - Control chars / NUL / reserved punctuation replaced with `_`
    - Leading dots stripped so junk can't produce hidden files
    - Length capped; extension preserved when truncating
    - Empty result → `unnamed`
    """
    if not raw:
        return "unnamed"
    # Strip path components under both POSIX and Windows semantics because the
    # client may be running either.
    name = PurePosixPath(raw).name or raw
    name = PureWindowsPath(name).name or name
    if name in ("", ".", ".."):
        return "unnamed"
    cleaned = _SAFE_NAME.sub("_", name)
    cleaned = cleaned.lstrip(".") or "unnamed"
    if len(cleaned) > max_len:
        # Preserve extension when we truncate.
        dot = cleaned.rfind(".")
        if 0 < dot < len(cleaned) - 1:
            ext = cleaned[dot:][:16]
            cleaned = cleaned[: max_len - len(ext)] + ext
        else:
            cleaned = cleaned[:max_len]
    return cleaned


def get_extension(filename: str) -> str:
    """Lowercased extension including leading dot, or `""` when absent."""
    dot = filename.rfind(".")
    if dot < 0:
        return ""
    return filename[dot:].lower()


# ---------------------------------------------------------------------------
# Content validation
# ---------------------------------------------------------------------------

@dataclass
class ValidatedFile:
    """Result of validate_upload() — a known-safe, parsed-or-parseable file."""

    name: str            # sanitised filename
    size: int            # bytes
    sha256: str          # hex digest of raw (post-BOM-strip) bytes
    format: str          # "text" | "json" | "xml" | "yaml"
    extension: str       # e.g. ".txt"
    text: str            # decoded UTF-8 source
    canonical: str       # canonicalised form for diffing (== text for plain)


def _detect_binary(data: bytes) -> bool:
    """Presence of a NUL byte is a strong signal this isn't a text or
    structured-config file. Every format we accept is strictly text."""
    return b"\x00" in data


def _strip_utf8_bom(data: bytes) -> bytes:
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:]
    return data


def _validate_magic(data: bytes, fmt: str) -> None:
    """Lightweight magic-byte sanity check. Not a replacement for parsing —
    the parsers downstream do the real validation. This catches easy cases
    (claiming `.json` with XML content) before we pay the parse cost."""
    head = data.lstrip()[:16]
    if not head:
        raise FileSecurityError("Empty content")
    if fmt == "json":
        first = head[:1]
        # JSON values may begin with `{`, `[`, `"`, `-`, digit, or true/false/null.
        if first not in (b"{", b"[", b'"', b"-") and not (
            first.isdigit()
            or head[:4] in (b"true", b"null")
            or head[:5] == b"false"
        ):
            raise FileSecurityError("Content does not look like JSON")
    elif fmt == "xml":
        if head[:1] != b"<":
            raise FileSecurityError("Content does not look like XML")
    # yaml / text — no reliable magic; parser handles validation.


def _parse_json(text: str) -> str:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise FileSecurityError(
            f"Invalid JSON: {exc.msg} at line {exc.lineno} col {exc.colno}"
        )
    # Canonicalise: sorted keys, stable indent — makes key-order churn
    # invisible to the diff.
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False)


def _parse_xml(text: str) -> str:
    """Parse with defusedxml to block XXE, billion-laughs, external DTDs."""
    try:
        from defusedxml import ElementTree as DET  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise FileSecurityError(
            "XML support requires defusedxml — install backend deps"
        ) from exc
    try:
        root = DET.fromstring(text)
    except Exception as exc:
        raise FileSecurityError(f"Invalid XML: {exc}")
    # Serialise using stdlib ElementTree — parsing was already done by the
    # hardened defusedxml parser, so no attack surface is reopened here.
    import xml.etree.ElementTree as ET
    try:
        return ET.tostring(root, encoding="unicode", short_empty_elements=True)
    except Exception:
        return text


def _parse_yaml(text: str) -> str:
    try:
        import yaml  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise FileSecurityError("YAML support requires PyYAML") from exc
    try:
        value = yaml.safe_load(text)  # safe_load blocks !!python/object tags
    except yaml.YAMLError as exc:
        raise FileSecurityError(f"Invalid YAML: {exc}")
    try:
        return yaml.safe_dump(
            value,
            sort_keys=True,
            default_flow_style=False,
            allow_unicode=True,
        )
    except Exception:
        return text


def validate_upload(
    raw_filename: str | None,
    data: bytes,
    *,
    max_bytes: int = DEFAULT_MAX_FILE_BYTES,
) -> ValidatedFile:
    """Validate and canonicalise a single uploaded file.

    Returns a ValidatedFile on success, raises FileSecurityError on any
    violation. Callers should catch the error and surface to the user.
    """
    # 1. Sanitise name first — we never log an attacker-controlled string.
    name = sanitize_filename(raw_filename)

    # 2. Size check.
    size = len(data)
    if size == 0:
        raise FileSecurityError(f"{name}: empty file")
    if size > max_bytes:
        raise FileSecurityError(
            f"{name}: file exceeds maximum size ({size} > {max_bytes} bytes)"
        )

    # 3. Extension allow-list.
    ext = get_extension(name)
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise FileSecurityError(
            f"{name}: extension {ext or '(none)'} not allowed. Allowed: {allowed}"
        )
    fmt = EXT_TO_FORMAT[ext]

    # 4. Strip a UTF-8 BOM if present — harmless, but some parsers choke on it.
    data = _strip_utf8_bom(data)

    # 5. Binary rejection.
    if _detect_binary(data):
        raise FileSecurityError(
            f"{name}: contains NUL byte — binary files not accepted"
        )

    # 6. UTF-8 strict decode.
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise FileSecurityError(f"{name}: not valid UTF-8 ({exc.reason})")

    # 7. Magic-byte sanity check.
    _validate_magic(data, fmt)

    # 8. Parse with the hardened parser for this format.
    if fmt == "json":
        canonical = _parse_json(text)
    elif fmt == "xml":
        canonical = _parse_xml(text)
    elif fmt == "yaml":
        canonical = _parse_yaml(text)
    else:
        canonical = text

    digest = hashlib.sha256(data).hexdigest()
    return ValidatedFile(
        name=name,
        size=size,
        sha256=digest,
        format=fmt,
        extension=ext,
        text=text,
        canonical=canonical,
    )


def validate_batch(
    files: list[tuple[str | None, bytes]],
    *,
    min_count: int = 2,
    max_count: int = 6,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
) -> list[ValidatedFile]:
    """Validate a batch of uploaded files under collective + per-file caps."""
    if len(files) < min_count:
        raise FileSecurityError(
            f"At least {min_count} files required (got {len(files)})"
        )
    if len(files) > max_count:
        raise FileSecurityError(
            f"At most {max_count} files allowed (got {len(files)})"
        )
    total = sum(len(d) for _, d in files)
    if total > max_total_bytes:
        raise FileSecurityError(
            f"Combined upload size {total} exceeds {max_total_bytes} bytes"
        )

    return [
        validate_upload(raw_name, data, max_bytes=max_file_bytes)
        for raw_name, data in files
    ]
