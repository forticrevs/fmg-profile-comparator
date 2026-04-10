"""Extract Palo Alto custom URL categories into a flat CSV.

One row per (category, url) pair; categories with multiple URLs get
multiple rows. Each row carries the category name, URL, type, and
description.

Ported from `xml_to_csv_custom_url_categories.py`. The original script
used `./entry` as the XPath because it was written to run against a
pre-extracted snippet; against the merged config we walk from
`./devices/entry/vsys/entry/profiles/custom-url-category/entry`.
"""

from __future__ import annotations

import csv
import io
from typing import Any

from app.services.pan_parsers import register

CATS_XPATH = "./devices/entry/vsys/entry/profiles/custom-url-category/entry"

COLUMNS = ["entry name", "urls", "type", "description"]


def parse(root: Any) -> dict[str, bytes]:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(COLUMNS)

    for entry in root.findall(CATS_XPATH):
        name = (entry.get("name") or "").strip()

        type_elem = entry.find("type")
        type_text = type_elem.text.strip() if type_elem is not None and type_elem.text else ""

        desc_elem = entry.find("description")
        desc_text = desc_elem.text.strip() if desc_elem is not None and desc_elem.text else ""

        list_elem = entry.find("list")
        if list_elem is None:
            continue
        for member in list_elem.findall("member"):
            url = member.text.strip() if member.text else ""
            writer.writerow([name, url, type_text, desc_text])

    return {"custom-url-categories.csv": buf.getvalue().encode("utf-8")}


register(
    parser_id="custom_url_categories",
    label="Custom URL Categories",
    description="Custom URL category definitions flattened to one row per (category, URL)",
    parse=parse,
)
