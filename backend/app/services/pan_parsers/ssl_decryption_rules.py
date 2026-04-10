"""Extract Palo Alto SSL-decryption rules into a flat CSV.

One row per rule under `<rulebase><decryption><rules>`, with the fields
captured by the original script: category, service, type, from, to,
source, destination, source-user, description, action, disabled, profile.

Ported from `xml_ssldecryption_to_csv.py`.
"""

from __future__ import annotations

import csv
import io
from typing import Any

from app.services.pan_parsers import register

RULES_XPATH = "./devices/entry/vsys/entry/rulebase/decryption/rules/entry"

FIELDS = [
    "category",
    "service",
    "type",
    "from",
    "to",
    "source",
    "destination",
    "source-user",
    "description",
    "action",
    "disabled",
    "profile",
]


def _gather_members(parent: Any, tag: str) -> str:
    el = parent.find(tag)
    if el is None:
        return ""
    members = [m.text.strip() for m in el.findall("member") if m.text and m.text.strip()]
    return ";".join(members)


def _extract_type(parent: Any) -> str:
    """<type> wraps a single child element whose tag is the rule type
    (e.g. `<ssl-forward-proxy/>`). Return that child tag or ""."""
    t = parent.find("type")
    if t is None:
        return ""
    for child in t:
        return child.tag
    return ""


def _extract_text(parent: Any, tag: str) -> str:
    el = parent.find(tag)
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def parse(root: Any) -> dict[str, bytes]:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()

    for ent in root.findall(RULES_XPATH):
        writer.writerow({
            "category":    _gather_members(ent, "category"),
            "service":     _gather_members(ent, "service"),
            "type":        _extract_type(ent),
            "from":        _gather_members(ent, "from"),
            "to":          _gather_members(ent, "to"),
            "source":      _gather_members(ent, "source"),
            "destination": _gather_members(ent, "destination"),
            "source-user": _gather_members(ent, "source-user"),
            "description": _extract_text(ent, "description"),
            "action":      _extract_text(ent, "action"),
            "disabled":    _extract_text(ent, "disabled"),
            "profile":     _extract_text(ent, "profile"),
        })

    return {"ssl-decryption-rules.csv": buf.getvalue().encode("utf-8")}


register(
    parser_id="ssl_decryption_rules",
    label="SSL Decryption Rules",
    description="SSL decryption policy rules (category, service, type, source, destination, action, profile)",
    parse=parse,
)
