"""Fortinet object migration comparison helpers.

The migration workflow compares FortiConverter/FortiGate CLI objects against
the active FortiManager ADOM without writing anything back to FMG. It is meant
to answer the risky migration question: "does this converted object already
exist, and if so, is it actually the same object?"
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import shlex
from dataclasses import dataclass
from typing import Any

from app.services.fmg_client import FMGClient


@dataclass(frozen=True)
class ObjectFamilySpec:
    id: str
    label: str
    cli_path: tuple[str, ...]
    fmg_path: str
    key_fields: tuple[str, ...]
    focus_fields: tuple[str, ...]
    loadsub: bool = False


OBJECT_FAMILIES: tuple[ObjectFamilySpec, ...] = (
    ObjectFamilySpec(
        id="address",
        label="Address",
        cli_path=("firewall", "address"),
        fmg_path="firewall/address",
        key_fields=("name",),
        focus_fields=(
            "type",
            "subnet",
            "start-ip",
            "end-ip",
            "fqdn",
            "country",
            "macaddr",
            "wildcard",
            "wildcard-fqdn",
            "associated-interface",
            "interface",
            "allow-routing",
            "fabric-object",
        ),
    ),
    ObjectFamilySpec(
        id="address-group",
        label="Address Group",
        cli_path=("firewall", "addrgrp"),
        fmg_path="firewall/addrgrp",
        key_fields=("name",),
        focus_fields=(
            "member",
            "exclude",
            "exclude-member",
            "type",
            "category",
            "fabric-object",
        ),
    ),
    ObjectFamilySpec(
        id="service",
        label="Service",
        cli_path=("firewall", "service", "custom"),
        fmg_path="firewall/service/custom",
        key_fields=("name",),
        focus_fields=(
            "protocol",
            "protocol-number",
            "tcp-portrange",
            "udp-portrange",
            "sctp-portrange",
            "udplite-portrange",
            "icmptype",
            "icmpcode",
            "iprange",
            "fqdn",
            "helper",
            "category",
            "proxy",
            "fabric-object",
        ),
    ),
    ObjectFamilySpec(
        id="service-group",
        label="Service Group",
        cli_path=("firewall", "service", "group"),
        fmg_path="firewall/service/group",
        key_fields=("name",),
        focus_fields=("member", "proxy", "fabric-object"),
    ),
    ObjectFamilySpec(
        id="local-web-categories",
        label="Local Web Categories",
        cli_path=("webfilter", "ftgd-local-cat"),
        fmg_path="webfilter/ftgd-local-cat",
        key_fields=("desc", "name", "id"),
        focus_fields=("desc", "id", "status"),
    ),
    ObjectFamilySpec(
        id="web-rating-overrides",
        label="Local Web Rating Overrides",
        cli_path=("webfilter", "ftgd-local-rating"),
        fmg_path="webfilter/ftgd-local-rating",
        key_fields=("url", "name"),
        focus_fields=("url", "rating", "status"),
    ),
    ObjectFamilySpec(
        id="ssl-exemptions",
        label="SSL Exemptions",
        cli_path=("firewall", "ssl-ssh-profile"),
        fmg_path="firewall/ssl-ssh-profile",
        key_fields=("name",),
        focus_fields=("ssl-exempt", "ssl-exemption-ip-rating", "ssl-exemption-log"),
        loadsub=True,
    ),
    ObjectFamilySpec(
        id="url-filters",
        label="URL Filters",
        cli_path=("webfilter", "urlfilter"),
        fmg_path="webfilter/urlfilter",
        key_fields=("name", "id"),
        focus_fields=(
            "name",
            "id",
            "entries",
            "include-subdomains",
            "ip-addr-block",
            "ip4-mapped-ip6",
            "one-arm-ips-urlfilter",
        ),
        loadsub=True,
    ),
    ObjectFamilySpec(
        id="wildcard-fqdns",
        label="Wildcard FQDNs",
        cli_path=("firewall", "wildcard-fqdn", "custom"),
        fmg_path="firewall/wildcard-fqdn/custom",
        key_fields=("name",),
        focus_fields=("wildcard-fqdn", "fabric-object"),
    ),
    ObjectFamilySpec(
        id="wildcard-fqdn-groups",
        label="Wildcard FQDN Groups",
        cli_path=("firewall", "wildcard-fqdn", "group"),
        fmg_path="firewall/wildcard-fqdn/group",
        key_fields=("name",),
        focus_fields=("member",),
    ),
)

FAMILY_BY_ID = {spec.id: spec for spec in OBJECT_FAMILIES}
FAMILY_BY_CLI_PATH = {spec.cli_path: spec for spec in OBJECT_FAMILIES}
ABSOLUTE_CLI_NAMESPACES = {
    "firewall",
    "webfilter",
    "application",
    "ips",
    "dlp",
    "router",
    "system",
    "vpn",
    "user",
}

VOLATILE_FIELDS = {
    "_created timestamp",
    "_created-by",
    "_image-base64",
    "_last-modified-by",
    "_modified timestamp",
    "_scope",
    "_scope member",
    "color",
    "comment",
    "dirty",
    "dynamic_mapping",
    "name",
    "obj flags",
    "obj seq",
    "obj ver",
    "oid",
    "q_origin_key",
    "tagging",
    "uuid",
}

DEFAULT_VALUES: dict[str, Any] = {
    "action": "exempt",
    "antiphish-action": "block",
    "dns-address-family": "ipv4",
    "fabric-object": "disable",
    "helper": "auto",
    "include-subdomains": "enable",
    "ip-addr-block": "disable",
    "ip4-mapped-ip6": "disable",
    "one-arm-ips-urlfilter": "disable",
    "proxy": "disable",
    "status": "enable",
}

ADDRESS_TYPE_BY_NUMBER = {
    0: "ipmask",
    1: "iprange",
    2: "fqdn",
    3: "wildcard",
    4: "geography",
    15: "dynamic",
    16: "interface-subnet",
    17: "mac",
    20: "route-tag",
    255: "wildcard-fqdn",
}
LIST_FIELDS = {
    "address",
    "address6",
    "country",
    "entries",
    "exempt",
    "exclude-member",
    "fortiguard-category",
    "macaddr",
    "member",
    "rating",
    "referrer-host",
    "regex",
    "server-cert",
    "ssl-exempt",
    "sctp-portrange",
    "subnet",
    "supported-alpn",
    "tcp-portrange",
    "udplite-portrange",
    "udp-portrange",
    "wildcard",
    "wildcard-fqdn",
}

INT_FIELDS = {
    "fortiguard-category",
    "icmpcode",
    "icmptype",
    "id",
    "protocol-number",
    "rating",
}
ROW_FILTERS = {
    "source",
    "fmg",
    "match",
    "missing",
    "conflict",
    "duplicate-source",
}


@dataclass
class _ParseContext:
    path: tuple[str, ...]
    key: str
    parent: dict[str, Any] | None
    items: list[dict[str, Any]]
    current: dict[str, Any] | None = None
    values: dict[str, Any] | None = None


def supported_families() -> list[dict[str, str]]:
    return [{"id": spec.id, "label": spec.label} for spec in OBJECT_FAMILIES]


def parse_fortios_cli(text: str) -> dict[str, list[dict[str, Any]]]:
    """Parse relevant FortiGate CLI object blocks from FortiConverter output."""
    records: dict[str, list[dict[str, Any]]] = {spec.id: [] for spec in OBJECT_FAMILIES}
    stack: list[_ParseContext] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("--"):
            continue
        try:
            tokens = shlex.split(line, comments=False, posix=True)
        except ValueError:
            continue
        if not tokens:
            continue

        cmd = tokens[0].lower()
        args = tokens[1:]

        if cmd == "config" and args:
            path = _resolve_config_path(stack, args)
            parent = stack[-1].current if stack else None
            stack.append(
                _ParseContext(
                    path=path,
                    key=args[-1],
                    parent=parent if isinstance(parent, dict) else None,
                    items=[],
                    values={},
                )
            )
            continue

        if not stack:
            continue

        ctx = stack[-1]
        if cmd == "edit" and args:
            key = _join_cli_values(args)
            current: dict[str, Any] = {"_edit_key": key}
            if not _looks_numeric(key):
                current["name"] = key
            else:
                current["id"] = int(key)
            ctx.current = current
            continue

        if cmd in {"set", "append"} and args:
            key = args[0]
            target = ctx.current if ctx.current is not None else ctx.values
            if target is None:
                continue
            value = _parse_cli_value(key, args[1:])
            if cmd == "append":
                existing = _as_list(target.get(key))
                existing.extend(_as_list(value))
                target[key] = existing
            else:
                target[key] = value
            continue

        if cmd == "unset" and args:
            target = ctx.current if ctx.current is not None else ctx.values
            if target is not None:
                target[args[0]] = None
            continue

        if cmd == "next":
            if ctx.current is not None:
                ctx.items.append(ctx.current)
                ctx.current = None
            continue

        if cmd == "end":
            _close_context(stack, records)

    while stack:
        _close_context(stack, records)

    return records


async def compare_config_to_fmg(
    fmg: FMGClient,
    config_text: str,
    *,
    families: list[str] | None = None,
    include_matches: bool = True,
    row_limit_per_family: int | None = None,
    view_filter: str | None = None,
) -> dict[str, Any]:
    selected_specs = _select_specs(families)
    parsed = parse_fortios_cli(config_text)
    adom = getattr(fmg, "_adom", "root")
    normalized_filter = view_filter if view_filter in ROW_FILTERS else None

    fetched = await asyncio.gather(
        *[_fetch_fmg_family(fmg, adom, spec) for spec in selected_specs],
        return_exceptions=True,
    )

    family_results: list[dict[str, Any]] = []
    for spec, fmg_result in zip(selected_specs, fetched, strict=True):
        if isinstance(fmg_result, Exception):
            family_results.append(_error_family_result(spec, parsed.get(spec.id, []), fmg_result))
            continue
        family_results.append(
            _compare_family(
                spec,
                parsed.get(spec.id, []),
                fmg_result,
                include_matches=include_matches,
                row_limit_per_family=row_limit_per_family,
                view_filter=normalized_filter,
            )
        )

    totals = {
        "source": sum(item["source_count"] for item in family_results),
        "fmg": sum(item["fmg_count"] for item in family_results),
        "matched": sum(item["matched"] for item in family_results),
        "missing": sum(item["missing"] for item in family_results),
        "conflicts": sum(item["conflicts"] for item in family_results),
        "duplicates": sum(item["duplicates"] for item in family_results),
        "errors": sum(1 for item in family_results if item.get("error")),
    }

    return {
        "adom": adom,
        "families": family_results,
        "summary": totals,
    }


def _resolve_config_path(stack: list[_ParseContext], args: list[str]) -> tuple[str, ...]:
    if args[0] in ABSOLUTE_CLI_NAMESPACES:
        return tuple(args)
    if stack:
        return (*stack[-1].path, *args)
    return tuple(args)


def _close_context(
    stack: list[_ParseContext],
    records: dict[str, list[dict[str, Any]]],
) -> None:
    ctx = stack.pop()
    if ctx.current is not None:
        ctx.items.append(ctx.current)
        ctx.current = None

    spec = FAMILY_BY_CLI_PATH.get(ctx.path)
    if spec and ctx.items:
        records[spec.id].extend(ctx.items)

    payload: Any
    if ctx.items:
        payload = ctx.items
    elif ctx.values:
        payload = ctx.values
    else:
        payload = None

    if ctx.parent is not None and payload is not None:
        ctx.parent[ctx.key] = payload


def _parse_cli_value(key: str, args: list[str]) -> Any:
    cleaned = [arg.rstrip(",") for arg in args if arg.rstrip(",") != ""]
    if not cleaned:
        return True
    values = [_coerce_cli_scalar(key, item) for item in cleaned]
    if len(values) == 1 and key not in LIST_FIELDS:
        return values[0]
    return values


def _coerce_cli_scalar(key: str, value: str) -> Any:
    if key in INT_FIELDS and _looks_numeric(value):
        return int(value)
    return value


def _join_cli_values(args: list[str]) -> str:
    return " ".join(arg.rstrip(",") for arg in args)


def _looks_numeric(value: str) -> bool:
    return bool(re.fullmatch(r"-?\d+", value))


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _select_specs(families: list[str] | None) -> list[ObjectFamilySpec]:
    if not families:
        return list(OBJECT_FAMILIES)
    selected: list[ObjectFamilySpec] = []
    for family in families:
        spec = FAMILY_BY_ID.get(family)
        if spec:
            selected.append(spec)
    return selected or list(OBJECT_FAMILIES)


async def _fetch_fmg_family(
    fmg: FMGClient,
    adom: str,
    spec: ObjectFamilySpec,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "url": f"/pm/config/adom/{adom}/obj/{spec.fmg_path}",
    }
    if spec.loadsub:
        params["option"] = ["loadsub"]
    data = await fmg._call("get", [params], verbose=True)
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _compare_family(
    spec: ObjectFamilySpec,
    source_items: list[dict[str, Any]],
    fmg_items: list[dict[str, Any]],
    *,
    include_matches: bool,
    row_limit_per_family: int | None,
    view_filter: str | None,
) -> dict[str, Any]:
    source_by_key, duplicates = _index_items(spec, source_items, source=True)
    fmg_by_key, _ = _index_items(spec, fmg_items, source=False)
    rows: list[dict[str, Any]] = []
    matched = missing = conflicts = duplicate_count = 0
    total_visible = 0

    def emit(row: dict[str, Any]) -> None:
        nonlocal total_visible
        if not _row_visible(row, include_matches=include_matches, view_filter=view_filter):
            return
        total_visible += 1
        if row_limit_per_family is None or len(rows) < row_limit_per_family:
            rows.append(row)

    for key in sorted(source_by_key, key=str.lower):
        source_group = source_by_key[key]
        source = source_group[0]
        duplicate_total = len(source_group) - 1
        duplicate_count += duplicate_total
        fmg_group = fmg_by_key.get(key)
        fmg_obj = fmg_group[0] if fmg_group else None
        source_norm = normalize_object(spec, source, source=True)

        if duplicate_total:
            status = "duplicate-source"
            duplicate_count += 0
            row = {
                "key": key,
                "status": status,
                "source": source_norm,
                "fmg": None,
                "diffs": [],
                "duplicate_count": len(source_group),
            }
            emit(row)
            continue

        if not fmg_obj:
            missing += 1
            emit({
                "key": key,
                "status": "missing",
                "source": source_norm,
                "fmg": None,
                "diffs": [],
                "duplicate_count": 1,
            })
            continue

        fmg_norm = normalize_object(spec, fmg_obj, source=False)
        diffs = _diff_values(source_norm, fmg_norm)
        if diffs:
            conflicts += 1
            emit({
                "key": key,
                "status": "conflict",
                "source": source_norm,
                "fmg": fmg_norm,
                "diffs": diffs[:50],
                "duplicate_count": 1,
            })
        else:
            matched += 1
            if include_matches or view_filter in {"source", "fmg", "match"}:
                emit({
                    "key": key,
                    "status": "match",
                    "source": source_norm,
                    "fmg": fmg_norm,
                    "diffs": [],
                    "duplicate_count": 1,
                })

    return {
        "id": spec.id,
        "label": spec.label,
        "source_count": len(source_items),
        "fmg_count": len(fmg_items),
        "matched": matched,
        "missing": missing,
        "conflicts": conflicts,
        "duplicates": duplicate_count,
        "duplicate_keys": duplicates,
        "results": rows,
        "returned_count": len(rows),
        "total_visible": total_visible,
        "truncated": row_limit_per_family is not None and total_visible > len(rows),
        "error": None,
    }


def _error_family_result(
    spec: ObjectFamilySpec,
    source_items: list[dict[str, Any]],
    exc: Exception,
) -> dict[str, Any]:
    return {
        "id": spec.id,
        "label": spec.label,
        "source_count": len(source_items),
        "fmg_count": 0,
        "matched": 0,
        "missing": 0,
        "conflicts": 0,
        "duplicates": 0,
        "duplicate_keys": [],
        "results": [],
        "returned_count": 0,
        "total_visible": 0,
        "truncated": False,
        "error": str(exc),
    }


def _row_visible(
    row: dict[str, Any],
    *,
    include_matches: bool,
    view_filter: str | None,
) -> bool:
    if view_filter == "source":
        return True
    if view_filter == "fmg":
        return row.get("fmg") is not None
    if view_filter:
        return row.get("status") == view_filter
    return include_matches or row.get("status") != "match"


def _index_items(
    spec: ObjectFamilySpec,
    items: list[dict[str, Any]],
    *,
    source: bool,
) -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
    indexed: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        keys = object_keys(spec, item, source=source)
        if not keys:
            continue
        # Source duplicates are meaningful only by the primary identity. FMG
        # objects are indexed by every known alias so source IDs can match FMG
        # records that also expose a name/description.
        keys_to_add = keys[:1] if source else keys
        for key in keys_to_add:
            indexed.setdefault(key, []).append(item)
    duplicates = sorted(key for key, values in indexed.items() if len(values) > 1)
    return indexed, duplicates


def object_key(spec: ObjectFamilySpec, item: dict[str, Any], *, source: bool) -> str | None:
    keys = object_keys(spec, item, source=source)
    return keys[0] if keys else None


def object_keys(spec: ObjectFamilySpec, item: dict[str, Any], *, source: bool) -> list[str]:
    prepared = _prepare_family_shape(spec, item, source=source)
    keys: list[str] = []
    for field in spec.key_fields:
        value = prepared.get(field)
        if value is not None and value != "":
            keys.append(str(value))
    edit_key = prepared.get("_edit_key")
    if edit_key not in (None, ""):
        keys.append(str(edit_key))
    return list(dict.fromkeys(keys))


def normalize_object(
    spec: ObjectFamilySpec,
    item: dict[str, Any],
    *,
    source: bool,
) -> dict[str, Any]:
    prepared = _prepare_family_shape(spec, item, source=source)
    focused = {field: prepared.get(field) for field in spec.focus_fields if field in prepared}
    if spec.id == "address":
        return _normalize_address(focused)
    return _canonicalize(focused)


def _prepare_family_shape(
    spec: ObjectFamilySpec,
    item: dict[str, Any],
    *,
    source: bool,
) -> dict[str, Any]:
    out = dict(item)
    edit_key = out.get("_edit_key")
    if spec.id == "local-web-categories" and "desc" not in out and edit_key not in (None, ""):
        out["desc"] = edit_key
    if spec.id == "web-rating-overrides" and "url" not in out and edit_key not in (None, ""):
        out["url"] = edit_key
    if spec.id == "url-filters" and "id" not in out and _looks_numeric(str(edit_key)):
        out["id"] = int(str(edit_key))
    if source and spec.id == "address" and "type" not in out:
        out["type"] = _infer_address_type(out)
    return out


def _infer_address_type(item: dict[str, Any]) -> str:
    if item.get("fqdn"):
        return "fqdn"
    if item.get("country"):
        return "geography"
    if item.get("macaddr"):
        return "mac"
    if item.get("wildcard"):
        return "wildcard"
    if item.get("wildcard-fqdn"):
        return "wildcard-fqdn"
    if item.get("start-ip") or item.get("end-ip"):
        return "iprange"
    return "ipmask"


def _normalize_address(item: dict[str, Any]) -> dict[str, Any]:
    addr_type = _normalize_address_type(item.get("type"))
    normalized: dict[str, Any] = {"type": addr_type}
    if addr_type == "ipmask":
        if "subnet" in item:
            normalized["subnet"] = _normalize_subnet(item["subnet"])
    elif addr_type == "iprange":
        normalized["start-ip"] = item.get("start-ip")
        normalized["end-ip"] = item.get("end-ip")
    elif addr_type == "fqdn":
        normalized["fqdn"] = _lower_string(item.get("fqdn"))
    elif addr_type == "geography":
        normalized["country"] = _sorted_scalars(item.get("country"), upper=True)
    elif addr_type == "mac":
        normalized["macaddr"] = _sorted_scalars(item.get("macaddr"), lower=True)
    elif addr_type == "wildcard":
        normalized["wildcard"] = _as_list(item.get("wildcard"))
    elif addr_type == "wildcard-fqdn":
        normalized["wildcard-fqdn"] = _lower_string(item.get("wildcard-fqdn"))
    else:
        normalized.update(item)
    for field in ("associated-interface", "interface", "allow-routing", "fabric-object"):
        if field in item:
            normalized[field] = item[field]
    return _canonicalize(normalized, keep_address_type=True)


def _normalize_address_type(raw: Any) -> str:
    if isinstance(raw, int):
        return ADDRESS_TYPE_BY_NUMBER.get(raw, "ipmask")
    if isinstance(raw, str) and raw:
        if raw.isdigit():
            return ADDRESS_TYPE_BY_NUMBER.get(int(raw), raw)
        return raw
    return "ipmask"


def _normalize_subnet(value: Any) -> Any:
    if isinstance(value, str) and "/" in value:
        try:
            network = ipaddress.ip_network(value, strict=False)
            return [str(network.network_address), str(network.netmask)]
        except ValueError:
            return value
    values = _as_list(value)
    if len(values) == 1 and isinstance(values[0], str) and "/" in values[0]:
        return _normalize_subnet(values[0])
    return values


def _lower_string(value: Any) -> Any:
    return value.lower() if isinstance(value, str) else value


def _sorted_scalars(value: Any, *, lower: bool = False, upper: bool = False) -> list[Any]:
    values = _as_list(value)
    out = []
    for item in values:
        if isinstance(item, str) and lower:
            out.append(item.lower())
        elif isinstance(item, str) and upper:
            out.append(item.upper())
        else:
            out.append(item)
    return sorted(out, key=lambda item: str(item).lower())


def _canonicalize(
    value: Any,
    *,
    keep_address_type: bool = False,
    key: str | None = None,
    list_item: bool = False,
) -> Any:
    if key in LIST_FIELDS and not isinstance(value, list) and not list_item:
        value = [value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if k in VOLATILE_FIELDS or k.startswith("_"):
                continue
            canonical = _canonicalize(v, key=k)
            if _is_prunable(k, canonical, keep_address_type=keep_address_type):
                continue
            out[k] = canonical
        return dict(sorted(out.items()))
    if isinstance(value, list):
        values = [_canonicalize(item, key=key, list_item=True) for item in value]
        values = [item for item in values if not _is_empty(item)]
        if all(not isinstance(item, dict) for item in values):
            return sorted(values, key=lambda item: str(item).lower())
        return sorted(values, key=_stable_json)
    if isinstance(value, str):
        stripped = value.strip()
        if key in INT_FIELDS and _looks_numeric(stripped):
            return int(stripped)
        return stripped
    return value


def _is_prunable(key: str, value: Any, *, keep_address_type: bool) -> bool:
    if _is_empty(value):
        return True
    if keep_address_type and key == "type":
        return False
    default = DEFAULT_VALUES.get(key)
    if default is not None and _canonicalize(default) == value:
        return True
    return False


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _diff_values(source: Any, fmg: Any, path: str = "") -> list[dict[str, Any]]:
    # FortiConverter often emits unset fields as null, and missing source
    # fields arrive here as None when only FMG has a default value. Treat those
    # as "source did not assert a value" instead of a meaningful conflict.
    if source is None:
        return []
    if isinstance(source, dict) and isinstance(fmg, dict):
        diffs: list[dict[str, Any]] = []
        for key in sorted(set(source) | set(fmg)):
            child = f"{path}.{key}" if path else key
            diffs.extend(_diff_values(source.get(key), fmg.get(key), child))
        return diffs
    if isinstance(source, list) and isinstance(fmg, list):
        if _stable_json(source) == _stable_json(fmg):
            return []
        return [{"path": path, "source": source, "fmg": fmg}]
    if source != fmg:
        return [{"path": path, "source": source, "fmg": fmg}]
    return []
