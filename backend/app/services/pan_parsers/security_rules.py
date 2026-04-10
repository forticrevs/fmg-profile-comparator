"""Extract Palo Alto security rules from a merged-running-config XML.

Produces a single CSV with one row per rule, listing the rule name and
the members of its profile-setting, source-user, source, destination,
category, application, and tag sections. Rules with none of those
sections populated are skipped (matches the original script's behaviour).

Ported from `xml_to_csv_rule_reporter.py`.
"""

from __future__ import annotations

import csv
import io
from typing import Any

from app.services.pan_parsers import register

RULES_XPATH = "./devices/entry/vsys/entry/rulebase/security/rules/entry"

COLUMNS = [
    "rule_name",
    "profile_settings",
    "source_users",
    "sources",
    "destinations",
    "categories",
    "applications",
    "tags",
]


def _members_of(rule: Any, section: str) -> list[str]:
    sec = rule.find(section)
    if sec is None:
        return []
    return [m.text.strip() for m in sec.findall(".//member") if m.text]


def parse(root: Any) -> dict[str, bytes]:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(COLUMNS)

    for rule in root.findall(RULES_XPATH):
        name = rule.get("name") or ""
        profile_settings = _members_of(rule, "profile-setting")
        source_users = _members_of(rule, "source-user")
        sources = _members_of(rule, "source")
        destinations = _members_of(rule, "destination")
        categories = _members_of(rule, "category")
        applications = _members_of(rule, "application")
        tags = _members_of(rule, "tag")

        # Only emit rules that have at least one populated section —
        # matches the original script's filter.
        if not any((profile_settings, source_users, sources, destinations,
                    categories, applications, tags)):
            continue

        writer.writerow([
            name,
            ";".join(profile_settings),
            ";".join(source_users),
            ";".join(sources),
            ";".join(destinations),
            ";".join(categories),
            ";".join(applications),
            ";".join(tags),
        ])

    return {"security-rules.csv": buf.getvalue().encode("utf-8")}


register(
    parser_id="security_rules",
    label="Security Rules",
    description="Security policy rules with profile, source-user, source, destination, category, application, and tag members",
    parse=parse,
)
