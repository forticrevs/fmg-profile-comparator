"""Extract Palo Alto profile-group entries from a merged-running-config XML.

One CSV row per profile-group entry, with the first member of each
section (virus, spyware, vulnerability, file-blocking, wildfire-analysis,
url-filtering).

Ported from `xml_parse_profile_groups.py`.
"""

from __future__ import annotations

import csv
import io
from typing import Any

from app.services.pan_parsers import register

GROUPS_XPATH = "./devices/entry/vsys/entry/profile-group/entry"

HEADERS = [
    "entry name",
    "virus",
    "spyware",
    "vulnerability",
    "file-blocking",
    "wildfire-analysis",
    "url-filtering",
]

SECTIONS = [
    "virus",
    "spyware",
    "vulnerability",
    "file-blocking",
    "wildfire-analysis",
    "url-filtering",
]


def _first_member(entry: Any, section: str) -> str:
    sec = entry.find(section)
    if sec is None:
        return ""
    m = sec.find("member")
    if m is None or m.text is None:
        return ""
    return m.text.strip()


def parse(root: Any) -> dict[str, bytes]:
    buf = io.StringIO()
    # QUOTE_ALL — see custom_url_categories.py for the rationale.
    writer = csv.writer(buf, quoting=csv.QUOTE_ALL)
    writer.writerow(HEADERS)

    for entry in root.findall(GROUPS_XPATH):
        name = entry.get("name") or ""
        writer.writerow([name] + [_first_member(entry, s) for s in SECTIONS])

    return {"profile-groups.csv": buf.getvalue().encode("utf-8")}


register(
    parser_id="profile_groups",
    label="Profile Groups",
    description="Security profile groups linking virus / spyware / vulnerability / file-blocking / wildfire / URL-filtering profiles",
    parse=parse,
)
