"""Compress chat-context payloads so we don't blow the LLM's token budget.

Frontend sends `page_context = {"page": {kind, label, data}, "items": [...]}`.
`page` describes the current screen automatically; `items` are explicit
"ask about this" attachments. Raw objects can easily be tens of KB, so we
apply generic compression plus per-kind hooks to strip the most painful fields.
"""

from __future__ import annotations

import json
from typing import Any

# ---- Budgets --------------------------------------------------------------

PER_ITEM_JSON_BYTES = 3_000
TOTAL_BLOCK_BYTES = 12_000
MAX_STRING_LEN = 300
MAX_ARRAY_LEN = 20
MAX_TEMPLATE_STRING_LEN = 3_000

# Fields that are almost never useful in an LLM prompt — dropped eagerly
# when the per-item JSON is still over budget after generic truncation.
BULKY_FIELDS = {
  "cve.summary",
  "cve.cvss_vector",
  "desc",
  "description",
  "comment",
  "comments",
  "notes",
  "raw",
  "_raw",
  "metadata",
}

TEMPLATE_CONTEXT_KINDS = {"jinja_template", "jinja_template_lab"}
TEMPLATE_FIELDS = {"content", "rendered", "rendered_preview", "template"}


def _truncate_str(s: str) -> str:
  if len(s) <= MAX_STRING_LEN:
    return s
  return s[:MAX_STRING_LEN] + f"… [+{len(s) - MAX_STRING_LEN} chars]"


def _compress(value: Any) -> Any:
  """Recursively compress a value: truncate strings, cap arrays."""
  if isinstance(value, str):
    return _truncate_str(value)
  if isinstance(value, list):
    compressed = [_compress(v) for v in value[:MAX_ARRAY_LEN]]
    if len(value) > MAX_ARRAY_LEN:
      compressed.append(f"… [{len(value) - MAX_ARRAY_LEN} more]")
    return compressed
  if isinstance(value, dict):
    return {k: _compress(v) for k, v in value.items()}
  return value


def _compress_template_context(value: Any) -> Any:
  """Compress Jinja template context while preserving useful code bodies."""
  if isinstance(value, str):
    if len(value) <= MAX_TEMPLATE_STRING_LEN:
      return value
    return value[:MAX_TEMPLATE_STRING_LEN] + f"… [+{len(value) - MAX_TEMPLATE_STRING_LEN} chars]"
  if isinstance(value, list):
    compressed = [_compress_template_context(v) for v in value[:MAX_ARRAY_LEN]]
    if len(value) > MAX_ARRAY_LEN:
      compressed.append(f"… [{len(value) - MAX_ARRAY_LEN} more]")
    return compressed
  if isinstance(value, dict):
    out: dict[str, Any] = {}
    for k, v in value.items():
      if k in TEMPLATE_FIELDS and isinstance(v, str):
        out[k] = _compress_template_context(v)
      else:
        out[k] = _compress(v)
    return out
  return value


def _strip_bulky(value: Any) -> Any:
  """Remove known-bulky fields from a dict (recursively)."""
  if isinstance(value, dict):
    return {
      k: _strip_bulky(v)
      for k, v in value.items()
      if k not in BULKY_FIELDS
    }
  if isinstance(value, list):
    return [_strip_bulky(v) for v in value]
  return value


def _compress_item_data(data: Any) -> Any:
  """Two-pass: generic compress, then strip bulky fields if still too big."""
  first = _compress(data)
  if len(json.dumps(first, default=str)) <= PER_ITEM_JSON_BYTES:
    return first
  return _compress(_strip_bulky(data))


def _render_item(item: dict[str, Any]) -> str:
  kind = item.get("kind") or "item"
  label = item.get("label") or "(unlabeled)"
  data = (
    _compress_template_context(item.get("data"))
    if kind in TEMPLATE_CONTEXT_KINDS
    else _compress_item_data(item.get("data"))
  )
  body = json.dumps(data, indent=2, default=str)
  if len(body) > PER_ITEM_JSON_BYTES:
    body = body[:PER_ITEM_JSON_BYTES] + "\n… [truncated]"
  return f"=== [{kind}] {label} ===\n{body}"


def _render_page(page: dict[str, Any]) -> str:
  kind = page.get("kind") or "current_page"
  label = page.get("label") or "(current page)"
  data = (
    _compress_template_context(page.get("data"))
    if kind in TEMPLATE_CONTEXT_KINDS
    else _compress_item_data(page.get("data"))
  )
  body = json.dumps(data, indent=2, default=str)
  if len(body) > PER_ITEM_JSON_BYTES:
    body = body[:PER_ITEM_JSON_BYTES] + "\n… [truncated]"
  return f"=== [current view: {kind}] {label} ===\n{body}"


def render_page_context(page_context: dict[str, Any] | None) -> str | None:
  """Turn a frontend page_context payload into a prompt-ready block.

  Returns None if there's nothing to render.
  """
  if not page_context:
    return None

  page = page_context.get("page")
  items = page_context.get("items")
  has_structured_context = isinstance(page, dict) or isinstance(items, list)

  if not has_structured_context:
    # Back-compat: treat the whole payload as a single freeform context.
    blob = json.dumps(_compress(page_context), indent=2, default=str)
    if len(blob) > TOTAL_BLOCK_BYTES:
      blob = blob[:TOTAL_BLOCK_BYTES] + "\n… [truncated]"
    return (
      "The user is viewing the following UI context:\n" + blob
    )

  rendered: list[str] = []
  used = 0
  dropped = 0

  if isinstance(page, dict):
    block = _render_page(page)
    if len(block) <= TOTAL_BLOCK_BYTES:
      rendered.append(block)
      used += len(block)
    else:
      dropped += 1

  if not isinstance(items, list):
    items = []

  for item in items:
    if not isinstance(item, dict):
      dropped += 1
      continue
    block = _render_item(item)
    if used + len(block) > TOTAL_BLOCK_BYTES:
      dropped += 1
      continue
    rendered.append(block)
    used += len(block)

  if not rendered:
    return None

  attachment_count = sum(1 for item in items if isinstance(item, dict))
  header = "Use this UI context as primary context when answering."
  if isinstance(page, dict) and attachment_count:
    header += (
      f" The user is viewing one page and attached {attachment_count} item"
      f"{'s' if attachment_count != 1 else ''}."
    )
  elif attachment_count:
    header += (
      f" The user attached {attachment_count} item"
      f"{'s' if attachment_count != 1 else ''} from the current page."
    )
  elif isinstance(page, dict):
    header += " The user has not manually attached any extra item."
  if dropped:
    header += f" ({dropped} context block(s) dropped to stay under token budget.)"

  return header + "\n\n" + "\n\n".join(rendered)
