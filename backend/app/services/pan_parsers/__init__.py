"""PAN (Palo Alto) XML parsers — Phase 1 conversion utilities.

Each parser is a module with a single public `parse(root) -> dict[str, bytes]`
function. Given the root of a parsed Palo Alto `running-config.xml` (an
`lxml` Element), it walks the relevant subtree and returns one or more
output files (filename → bytes). The ARQ `pan_extract` task runs the
user-selected subset and writes the outputs into the per-user job dir.

The central `REGISTRY` maps stable string ids (used by the API and
frontend) to parser entries. Each parser module self-registers by calling
`register(...)` at import time.
"""

from __future__ import annotations

from typing import Any, Callable, TypedDict


class ParserEntry(TypedDict):
    id: str
    label: str
    description: str
    parse: Callable[[Any], dict[str, bytes]]


REGISTRY: dict[str, ParserEntry] = {}


def register(
    parser_id: str,
    label: str,
    description: str,
    parse: Callable[[Any], dict[str, bytes]],
) -> None:
    REGISTRY[parser_id] = ParserEntry(
        id=parser_id,
        label=label,
        description=description,
        parse=parse,
    )


def list_parsers() -> list[dict[str, str]]:
    """Public listing for the frontend — id, label, description only."""
    return [
        {"id": e["id"], "label": e["label"], "description": e["description"]}
        for e in REGISTRY.values()
    ]


# Side-effect imports so parser modules self-register. Import order
# drives the default display order in the frontend.
#
# Note: `pan_analyze_ssl_decrypt_diffs.py` is intentionally NOT ported
# into this registry — it's a post-processor that merges multiple
# already-extracted SSL-decrypt CSVs from different PAN configs, not a
# parser of the raw XML. It belongs in a follow-up "diff two extracts"
# sub-tool with its own multi-file upload UX.
from app.services.pan_parsers import security_rules          # noqa: E402, F401
from app.services.pan_parsers import profile_groups          # noqa: E402, F401
from app.services.pan_parsers import app_groups              # noqa: E402, F401
from app.services.pan_parsers import custom_url_categories   # noqa: E402, F401
from app.services.pan_parsers import url_filter_profiles     # noqa: E402, F401
from app.services.pan_parsers import ssl_decryption_rules    # noqa: E402, F401
from app.services.pan_parsers import wildcard_objects        # noqa: E402, F401
