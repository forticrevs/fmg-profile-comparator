"""Extract Palo Alto application-group entries into an Excel workbook.

One column per application-group, members listed down each column. Matches
the original `xml_parse_app_groups.py` output shape.
"""

from __future__ import annotations

import io
from typing import Any

from openpyxl import Workbook

from app.services.pan_parsers import register

GROUPS_XPATH = "./devices/entry/vsys/entry/application-group/entry"


def parse(root: Any) -> dict[str, bytes]:
    groups: dict[str, list[str]] = {}
    for entry in root.findall(GROUPS_XPATH):
        name = entry.get("name") or ""
        members_elem = entry.find("members")
        members: list[str] = []
        if members_elem is not None:
            members = [m.text.strip() for m in members_elem.findall("member") if m.text]
        groups[name] = members

    wb = Workbook()
    ws = wb.active
    if ws is None:
        ws = wb.create_sheet("app-groups")
    else:
        ws.title = "app-groups"

    headers = list(groups.keys())
    if headers:
        ws.append(headers)
        max_len = max((len(m) for m in groups.values()), default=0)
        for i in range(max_len):
            ws.append([
                groups[grp][i] if i < len(groups[grp]) else ""
                for grp in headers
            ])

    buf = io.BytesIO()
    wb.save(buf)
    return {"app-groups.xlsx": buf.getvalue()}


register(
    parser_id="app_groups",
    label="Application Groups",
    description="Application-group definitions with one column per group and members listed vertically (xlsx)",
    parse=parse,
)
