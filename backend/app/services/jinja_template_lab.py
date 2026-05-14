"""Local FortiManager-style Jinja CLI template development helpers.

The lab intentionally performs no writes to FortiManager. Templates imported
from FMG are copied into per-user local storage, edited locally, and rendered
locally against read-only device database and metadata-variable context.
"""

from __future__ import annotations

import ipaddress
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

from app.jobs import user_storage
from app.services.fmg_client import FMGClient


PREDEFINED_VARIABLES = [
    {
        "name": "DVMDB.name",
        "description": "FortiManager device name",
        "example": "{{ DVMDB.name }}",
    },
    {"name": "DVMDB.serial", "description": "Device serial number", "example": "{{ DVMDB.serial }}"},
    {"name": "DVMDB.os_type", "description": "Device OS type", "example": "{{ DVMDB.os_type }}"},
    {"name": "DVMDB.platform", "description": "Platform/model string", "example": "{{ DVMDB.platform }}"},
    {"name": "DVMDB.version", "description": "FortiOS version", "example": "{{ DVMDB.version }}"},
    {"name": "DVMDB.hostname", "description": "Device hostname", "example": "{{ DVMDB.hostname }}"},
    {"name": "DVMDB.mgmt_uuid", "description": "Management UUID", "example": "{{ DVMDB.mgmt_uuid }}"},
    {"name": "DVMDB.mgmt_if", "description": "Management interface IP", "example": "{{ DVMDB.mgmt_if }}"},
    {"name": "DVMDB.ip", "description": "Device IP", "example": "{{ DVMDB.ip }}"},
    {"name": "DVMDB.tunnel_ip", "description": "Tunnel IP", "example": "{{ DVMDB.tunnel_ip }}"},
    {"name": "DVMDB.description", "description": "Device description", "example": "{{ DVMDB.description }}"},
    {
        "name": "DEVDB_system_interface",
        "description": "List of device database system interface records",
        "example": "{% for intf in DEVDB_system_interface %}{{ intf.name }}{% endfor %}",
    },
]

INTERFACE_VARIABLES = [
    {"name": "intf.name", "description": "Interface name"},
    {"name": "intf.alias", "description": "Interface alias"},
    {"name": "intf.allowaccess", "description": "Interface allowaccess setting"},
    {"name": "intf.type", "description": "Interface type"},
    {"name": "intf.ip", "description": "Interface IP/mask"},
    {"name": "intf.mode", "description": "Interface mode"},
    {"name": "intf.vdom", "description": "Interface VDOM"},
]

FILTER_REFERENCE = [
    "ipaddr", "ipv4", "ipv6", "ipmath", "ipsubnet", "nthhost",
    "next_nth_usable", "previous_nth_usable", "network_in_network",
    "network_in_usable", "reduce_on_network", "cidr_merge", "ipwrap",
    "hwaddr", "macaddr",
]

_SCRIPT_PATH = "/pm/config/adom/{adom}/obj/fmg/script"
_CLI_TEMPLATE_PATH = "/pm/config/adom/{adom}/obj/cli/template"
_SAFE_TEMPLATE_NAME = re.compile(r"^[A-Za-z0-9_. -]{1,128}$")


def _now() -> float:
    return time.time()


def _store_path(username: str) -> Path:
    root = user_storage.user_root(username) / "jinja_templates"
    root.mkdir(parents=True, exist_ok=True)
    return root / "templates.json"


def _empty_store() -> dict[str, list[dict[str, Any]]]:
    return {"templates": [], "groups": []}


def _load_store(username: str) -> dict[str, list[dict[str, Any]]]:
    path = _store_path(username)
    if not path.exists():
        return _empty_store()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _empty_store()
    if not isinstance(raw, dict):
        return _empty_store()
    templates = raw.get("templates")
    groups = raw.get("groups")
    return {
        "templates": templates if isinstance(templates, list) else [],
        "groups": groups if isinstance(groups, list) else [],
    }


def _save_store(username: str, store: dict[str, list[dict[str, Any]]]) -> None:
    path = _store_path(username)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def list_local_templates(username: str) -> list[dict[str, Any]]:
    return sorted(_load_store(username)["templates"], key=lambda item: str(item.get("updated_at", 0)), reverse=True)


def list_local_groups(username: str) -> list[dict[str, Any]]:
    return sorted(_load_store(username)["groups"], key=lambda item: str(item.get("updated_at", 0)), reverse=True)


def upsert_local_template(username: str, data: dict[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    if not _SAFE_TEMPLATE_NAME.match(name):
        raise ValueError("Template name must be 1-128 safe characters")
    content = str(data.get("content") or "")
    store = _load_store(username)
    template_id = str(data.get("id") or "").strip()
    now = _now()
    existing = next((item for item in store["templates"] if item.get("id") == template_id), None)
    if existing is None:
        existing = {
            "id": uuid.uuid4().hex[:12],
            "created_at": now,
            "source": data.get("source") or "local",
        }
        store["templates"].append(existing)
    existing.update(
        {
            "name": name,
            "description": str(data.get("description") or ""),
            "content": content,
            "type": str(data.get("type") or "jinja"),
            "target": str(data.get("target") or "local"),
            "fmg_name": str(data.get("fmg_name") or ""),
            "updated_at": now,
        }
    )
    _save_store(username, store)
    return existing


def delete_local_template(username: str, template_id: str) -> bool:
    store = _load_store(username)
    before = len(store["templates"])
    store["templates"] = [item for item in store["templates"] if item.get("id") != template_id]
    store["groups"] = [
        {**group, "template_ids": [tid for tid in group.get("template_ids", []) if tid != template_id]}
        for group in store["groups"]
        if isinstance(group, dict)
    ]
    changed = len(store["templates"]) != before
    if changed:
        _save_store(username, store)
    return changed


def upsert_local_group(username: str, data: dict[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    if not _SAFE_TEMPLATE_NAME.match(name):
        raise ValueError("Group name must be 1-128 safe characters")
    template_ids = [str(item) for item in data.get("template_ids", []) if str(item).strip()]
    store = _load_store(username)
    known_ids = {str(item.get("id")) for item in store["templates"]}
    template_ids = [tid for tid in template_ids if tid in known_ids]
    group_id = str(data.get("id") or "").strip()
    now = _now()
    existing = next((item for item in store["groups"] if item.get("id") == group_id), None)
    if existing is None:
        existing = {"id": uuid.uuid4().hex[:12], "created_at": now}
        store["groups"].append(existing)
    existing.update(
        {
            "name": name,
            "description": str(data.get("description") or ""),
            "template_ids": template_ids,
            "updated_at": now,
        }
    )
    _save_store(username, store)
    return existing


def delete_local_group(username: str, group_id: str) -> bool:
    store = _load_store(username)
    before = len(store["groups"])
    store["groups"] = [item for item in store["groups"] if item.get("id") != group_id]
    changed = len(store["groups"]) != before
    if changed:
        _save_store(username, store)
    return changed


async def list_fmg_templates(fmg: FMGClient) -> dict[str, Any]:
    """Return FMG template/script records from known read-only paths."""
    adom = getattr(fmg, "_adom", "root")
    sources = [
        ("fmg-script", _SCRIPT_PATH.format(adom=adom)),
        ("cli-template", _CLI_TEMPLATE_PATH.format(adom=adom)),
    ]
    templates: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for source, url in sources:
        try:
            data = await fmg._call("get", [{"url": url}], verbose=True)
        except Exception as exc:
            errors.append({"source": source, "url": url, "error": str(exc)})
            continue
        items = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("q_origin_key") or "").strip()
            if not name:
                continue
            content = _first_string(item, ("content", "script", "template", "cli", "body"))
            templates.append(
                {
                    "source": source,
                    "url": url,
                    "name": name,
                    "description": str(item.get("desc") or item.get("description") or ""),
                    "type": str(item.get("type") or "jinja"),
                    "target": str(item.get("target") or item.get("scope") or ""),
                    "content": content,
                    "raw": item,
                }
            )
    templates.sort(key=lambda item: (item["source"], item["name"].lower()))
    return {"adom": adom, "templates": templates, "errors": errors}


async def list_devices(fmg: FMGClient) -> list[dict[str, Any]]:
    raw = await fmg._call("get", [{"url": "/dvmdb/device"}], verbose=True)
    if not isinstance(raw, list):
        return []
    devices: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        devices.append(
            {
                "name": name,
                "hostname": item.get("hostname"),
                "serial": item.get("sn") or item.get("serial"),
                "platform": item.get("platform_str") or item.get("platform"),
                "version": _format_version(item),
                "ip": item.get("ip"),
                "os_type": item.get("os_type"),
                "conn_status": item.get("conn_status"),
            }
        )
    devices.sort(key=lambda item: item["name"].lower())
    return devices


async def build_device_context(
    fmg: FMGClient,
    device: str,
    extra_vars: dict[str, Any] | None = None,
) -> dict[str, Any]:
    device_record = await _get_device_record(fmg, device)
    interfaces = await _get_device_interfaces(fmg, device)
    metadata = await _get_device_metadata(fmg, device)
    dvmdb = _dvmdb_context(device_record, device)
    context: dict[str, Any] = {
        "DVMDB": dvmdb,
        "DEVDB_system_interface": interfaces,
        "METADATA": metadata,
    }
    context.update(metadata)
    if extra_vars:
        context.update({str(k): _stringify_meta(v) for k, v in extra_vars.items()})
    return context


async def render_template_payload(
    username: str,
    fmg: FMGClient,
    *,
    device: str,
    content: str | None = None,
    template_id: str | None = None,
    template_ids: list[str] | None = None,
    extra_vars: dict[str, Any] | None = None,
) -> dict[str, Any]:
    local_templates = list_local_templates(username)
    template_map = {
        str(item["id"]): item
        for item in local_templates
        if isinstance(item, dict) and item.get("id")
    }
    render_items: list[dict[str, Any]] = []
    if template_ids:
        for tid in template_ids:
            item = template_map.get(str(tid))
            if item:
                render_items.append(item)
    elif template_id:
        item = template_map.get(str(template_id))
        if item:
            render_items.append(item)
    elif content is not None:
        render_items.append({"id": "ad-hoc", "name": "Ad hoc template", "content": content})

    if not render_items:
        raise ValueError("No template content selected")

    context = await build_device_context(fmg, device, extra_vars=extra_vars)
    loader_templates = _loader_templates(local_templates)
    env = _make_env(loader_templates)

    sections: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    all_variables: set[str] = set()
    referenced_templates: set[str] = set()

    for item in render_items:
        name = str(item.get("name") or item.get("id") or "template")
        body = str(item.get("content") or "")
        analysis = analyze_template(body, env=env)
        all_variables.update(analysis["variables"])
        referenced_templates.update(analysis["referenced_templates"])
        if analysis["errors"]:
            errors.extend([{**err, "template": name} for err in analysis["errors"]])
            sections.append({"name": name, "rendered": "", "ok": False})
            continue
        try:
            template = env.from_string(body)
            rendered = template.render(context)
            sections.append({"name": name, "rendered": rendered, "ok": True})
        except Exception as exc:
            errors.append(_jinja_error(exc, template=name))
            sections.append({"name": name, "rendered": "", "ok": False})

    rendered = "\n\n".join(section["rendered"] for section in sections if section.get("rendered"))
    missing = _missing_variables(sorted(all_variables), context)
    return {
        "ok": not errors and not missing,
        "device": device,
        "rendered": rendered,
        "sections": sections,
        "errors": errors,
        "variables": sorted(all_variables, key=str.casefold),
        "referenced_templates": sorted(referenced_templates, key=str.casefold),
        "missing_variables": missing,
        "context_preview": _context_preview(context),
    }


def analyze_template(content: str, *, env: Any | None = None) -> dict[str, Any]:
    if env is None:
        env = _make_env({})
    try:
        ast = env.parse(content)
    except Exception as exc:
        return {
            "variables": [],
            "referenced_templates": [],
            "errors": [_jinja_error(exc)],
        }
    from jinja2 import meta

    variables = sorted(meta.find_undeclared_variables(ast), key=str.casefold)
    refs = [
        str(ref)
        for ref in meta.find_referenced_templates(ast)
        if ref is not None
    ]
    return {"variables": variables, "referenced_templates": refs, "errors": []}


def reference_payload() -> dict[str, Any]:
    return {
        "predefined_variables": PREDEFINED_VARIABLES,
        "interface_variables": INTERFACE_VARIABLES,
        "filters": FILTER_REFERENCE,
        "strict_undefined": True,
        "notes": [
            "FortiManager uses StrictUndefined; guard optional variables with 'is defined'.",
            "FortiManager metadata variables are strings; cast with int/float/bool when needed.",
            "Local imports/includes resolve against local templates saved in this app.",
        ],
    }


def _make_env(templates: dict[str, str]) -> Any:
    from jinja2 import DictLoader, Environment, StrictUndefined

    env = Environment(
        loader=DictLoader(templates),
        undefined=StrictUndefined,
        trim_blocks=False,
        lstrip_blocks=False,
        autoescape=False,
    )
    env.filters.update(
        {
            "ipaddr": _filter_ipaddr,
            "ipv4": lambda value: _filter_ip_version(value, 4),
            "ipv6": lambda value: _filter_ip_version(value, 6),
            "ipmath": _filter_ipmath,
            "ipsubnet": _filter_ipsubnet,
            "nthhost": _filter_nthhost,
            "next_nth_usable": lambda value, n=1: _filter_nth_usable(value, int(n)),
            "previous_nth_usable": lambda value, n=1: _filter_nth_usable(value, -int(n)),
            "network_in_network": _filter_network_in_network,
            "network_in_usable": _filter_network_in_usable,
            "reduce_on_network": _filter_reduce_on_network,
            "cidr_merge": _filter_cidr_merge,
            "ipwrap": lambda value: _filter_ipaddr(value, "wrap"),
            "hwaddr": _filter_macaddr,
            "macaddr": _filter_macaddr,
        }
    )
    return env


def _loader_templates(items: list[dict[str, Any]]) -> dict[str, str]:
    templates: dict[str, str] = {}
    for item in items:
        content = str(item.get("content") or "")
        names = [
            str(item.get("name") or "").strip(),
            str(item.get("fmg_name") or "").strip(),
            str(item.get("id") or "").strip(),
        ]
        for name in names:
            if name:
                templates[name] = content
    return templates


def _missing_variables(variables: list[str], context: dict[str, Any]) -> list[str]:
    known_roots = {"DVMDB", "DEVDB_system_interface", "METADATA", "range", "dict", "list", "len", "str", "int"}
    missing = []
    for variable in variables:
        if variable in known_roots:
            continue
        if variable not in context or context.get(variable) in (None, ""):
            missing.append(variable)
    return missing


def _jinja_error(exc: Exception, *, template: str | None = None) -> dict[str, Any]:
    return {
        "type": exc.__class__.__name__,
        "message": str(exc),
        "lineno": getattr(exc, "lineno", None),
        "template": template,
    }


async def _get_device_record(fmg: FMGClient, device: str) -> dict[str, Any]:
    data = await fmg._call("get", [{"url": f"/dvmdb/device/{device}"}], verbose=True)
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return {"name": device}


async def _get_device_interfaces(fmg: FMGClient, device: str) -> list[dict[str, Any]]:
    try:
        data = await fmg._call(
            "get",
            [{"url": f"/pm/config/device/{device}/global/system/interface"}],
            verbose=True,
        )
    except Exception:
        return []
    items = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "name": item.get("name") or item.get("q_origin_key"),
                "alias": item.get("alias") or item.get("description") or "",
                "allowaccess": _join_if_list(item.get("allowaccess")),
                "type": item.get("type") or "",
                "ip": _join_if_list(item.get("ip")),
                "mode": item.get("mode") or "",
                "vdom": item.get("vdom") or "root",
            }
        )
    return out


async def _get_device_metadata(fmg: FMGClient, device: str) -> dict[str, str]:
    try:
        variables = await fmg.list_metadata_variables()
    except Exception:
        return {}
    values: dict[str, str] = {}
    for variable in variables:
        if not isinstance(variable, dict):
            continue
        name = str(variable.get("name") or "").strip()
        if not name:
            continue
        mappings = variable.get("dynamic_mapping") or []
        if not isinstance(mappings, list):
            continue
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            scopes = mapping.get("_scope")
            if isinstance(scopes, dict):
                scopes = [scopes]
            if not isinstance(scopes, list):
                continue
            if any(isinstance(scope, dict) and scope.get("name") == device for scope in scopes):
                values[name] = _stringify_meta(mapping.get("value"))
    return values


def _dvmdb_context(device: dict[str, Any], fallback_name: str) -> dict[str, str]:
    return {
        "name": _stringify_meta(device.get("name") or fallback_name),
        "serial": _stringify_meta(device.get("sn") or device.get("serial")),
        "os_type": _stringify_meta(device.get("os_type")),
        "platform": _stringify_meta(device.get("platform_str") or device.get("platform")),
        "version": _format_version(device),
        "hostname": _stringify_meta(device.get("hostname")),
        "mgmt_uuid": _stringify_meta(device.get("mgmt_uuid") or device.get("uuid")),
        "mgmt_if": _stringify_meta(device.get("mgmt_if")),
        "ip": _stringify_meta(device.get("ip")),
        "tunnel_ip": _stringify_meta(device.get("tunnel_ip")),
        "description": _stringify_meta(device.get("description") or device.get("desc")),
    }


def _context_preview(context: dict[str, Any]) -> dict[str, Any]:
    return {
        "DVMDB": context.get("DVMDB", {}),
        "metadata": context.get("METADATA", {}),
        "interface_count": len(context.get("DEVDB_system_interface", [])),
        "interfaces": context.get("DEVDB_system_interface", [])[:12],
    }


def _format_version(device: dict[str, Any]) -> str:
    version = device.get("os_ver") or device.get("version")
    mr = device.get("mr")
    patch = device.get("patch")
    if isinstance(version, int):
        parts = [str(version // 100)]
        if isinstance(mr, int):
            parts.append(str(mr))
        if isinstance(patch, int):
            parts.append(str(patch))
        return ".".join(parts)
    return _stringify_meta(version)


def _first_string(item: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str):
            return value
    return ""


def _stringify_meta(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, sort_keys=True)
    except TypeError:
        return str(value)


def _join_if_list(value: Any) -> str:
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    return _stringify_meta(value)


def _parse_interface(value: Any) -> ipaddress.IPv4Interface | ipaddress.IPv6Interface:
    text = str(value).strip()
    return ipaddress.ip_interface(text)


def _parse_network(value: Any) -> ipaddress.IPv4Network | ipaddress.IPv6Network:
    text = str(value).strip()
    return ipaddress.ip_network(text, strict=False)


def _filter_ipaddr(value: Any, action: str | None = None) -> Any:
    if isinstance(value, list):
        out = [_filter_ipaddr(item, action) for item in value]
        return [item for item in out if item is not False]
    try:
        interface = _parse_interface(value)
        network = interface.network
    except ValueError:
        return False if action != "bool" else False
    ip = interface.ip
    if action in (None, "address", "ip"):
        return str(ip)
    if action == "bool":
        return True
    if action in ("host", "ip/prefix"):
        return f"{ip}/{interface.network.prefixlen}"
    if action in ("cidr",):
        return f"{ip}/{ip.max_prefixlen}"
    if action in ("network", "network_id"):
        return str(network.network_address)
    if action in ("network/prefix", "subnet"):
        return str(network)
    if action == "netmask":
        return str(network.netmask)
    if action == "hostmask":
        return str(network.hostmask)
    if action == "broadcast":
        return str(network.broadcast_address)
    if action == "prefix":
        return network.prefixlen
    if action == "ip_netmask":
        return f"{ip} {network.netmask}"
    if action == "network_netmask":
        return f"{network.network_address} {network.netmask}"
    if action in ("network_wildcard", "wildcard"):
        return f"{network.network_address} {network.hostmask}"
    if action == "first_usable":
        return _usable_host(network, 0)
    if action == "last_usable":
        return _usable_host(network, -1)
    if action == "range_usable":
        return f"{_usable_host(network, 0)}-{_usable_host(network, -1)}"
    if action == "size":
        return network.num_addresses
    if action == "size_usable":
        return max(0, network.num_addresses - (2 if network.version == 4 and network.prefixlen < 31 else 0))
    if action == "int":
        return int(ip)
    if action == "version":
        return ip.version
    if action == "type":
        return "private" if ip.is_private else "public"
    if action == "private":
        return str(value) if ip.is_private else False
    if action == "public":
        return str(value) if not ip.is_private else False
    if action in ("link-local", "loopback", "multicast"):
        attr = action.replace("-", "_")
        return str(value) if getattr(ip, f"is_{attr}", False) else False
    if action == "unicast":
        return str(value) if not ip.is_multicast else False
    if action == "wrap":
        return f"[{ip}]" if ip.version == 6 else str(ip)
    if action == "revdns":
        return ip.reverse_pointer
    if action == "peer":
        hosts = list(network.hosts())
        if ip in hosts and len(hosts) == 2:
            return str(hosts[1] if hosts[0] == ip else hosts[0])
        return False
    return str(value)


def _filter_ip_version(value: Any, version: int) -> Any:
    if isinstance(value, list):
        return [item for item in value if _filter_ipaddr(item, "version") == version]
    return value if _filter_ipaddr(value, "version") == version else False


def _filter_ipmath(value: Any, amount: int) -> str:
    interface = _parse_interface(value)
    return str(ipaddress.ip_address(int(interface.ip) + int(amount)))


def _filter_nthhost(value: Any, n: int) -> str:
    network = _parse_network(value)
    offset = int(n)
    if offset < 0:
        return str(ipaddress.ip_address(int(network.broadcast_address) + offset))
    return str(ipaddress.ip_address(int(network.network_address) + offset))


def _filter_nth_usable(value: Any, n: int) -> str:
    interface = _parse_interface(value)
    return str(ipaddress.ip_address(int(interface.ip) + int(n)))


def _filter_ipsubnet(value: Any, prefix: Any = None, index: int | None = None) -> Any:
    if prefix is None:
        return str(_parse_interface(value))
    network = _parse_network(value)
    if isinstance(prefix, str) and "/" in prefix:
        container = _parse_network(prefix)
        return int(network.network_address) - int(container.network_address)
    prefix_int = int(prefix)
    if index is None:
        if network.prefixlen <= prefix_int:
            return 2 ** (prefix_int - network.prefixlen)
        return str(ipaddress.ip_network(f"{network.network_address}/{prefix_int}", strict=False))
    step = 2 ** (network.max_prefixlen - prefix_int)
    count = 2 ** (prefix_int - network.prefixlen)
    idx = int(index)
    if idx < 0:
        idx = count + idx
    return str(ipaddress.ip_network((int(network.network_address) + (idx * step), prefix_int)))


def _filter_network_in_network(value: Any, candidate: Any) -> bool:
    network = _parse_network(value)
    try:
        return ipaddress.ip_address(str(candidate)) in network
    except ValueError:
        other = _parse_network(candidate)
        return other.subnet_of(network)


def _filter_network_in_usable(value: Any, candidate: Any) -> bool:
    network = _parse_network(value)
    try:
        ip = ipaddress.ip_address(str(candidate))
    except ValueError:
        return False
    if ip not in network:
        return False
    if network.version == 4 and network.prefixlen < 31:
        return ip not in (network.network_address, network.broadcast_address)
    return True


def _filter_reduce_on_network(value: Any, network_value: Any) -> list[Any]:
    values = value if isinstance(value, list) else [value]
    network = _parse_network(network_value)
    out = []
    for item in values:
        try:
            if ipaddress.ip_address(str(item)) in network:
                out.append(item)
        except ValueError:
            continue
    return out


def _filter_cidr_merge(value: Any, action: str | None = None) -> Any:
    values = value if isinstance(value, list) else [value]
    networks = [_parse_network(item) for item in values]
    collapsed = list(ipaddress.collapse_addresses(networks))
    if action == "span" and collapsed:
        return str(next(ipaddress.summarize_address_range(collapsed[0].network_address, collapsed[-1].broadcast_address)))
    return [str(item) for item in collapsed]


def _filter_macaddr(value: Any, fmt: str | None = None) -> Any:
    text = re.sub(r"[^0-9A-Fa-f]", "", str(value))
    if len(text) != 12:
        return False
    pairs = [text[i:i + 2].lower() for i in range(0, 12, 2)]
    if fmt in ("cisco", "dot"):
        return ".".join(["".join(pairs[i:i + 2]) for i in range(0, 6, 2)])
    if fmt in ("windows", "dash"):
        return "-".join(pairs)
    return ":".join(pairs)


def _usable_host(network: ipaddress.IPv4Network | ipaddress.IPv6Network, index: int) -> str:
    if network.num_addresses <= 1:
        return str(network.network_address)
    if network.version == 4 and network.prefixlen < 31:
        return str(
            ipaddress.ip_address(
                int(network.network_address) + 1
                if index >= 0
                else int(network.broadcast_address) - 1
            )
        )
    return str(network.network_address if index >= 0 else network.broadcast_address)
