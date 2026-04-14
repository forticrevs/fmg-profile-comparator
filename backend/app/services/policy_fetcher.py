"""Policy package and policy list retrieval from FortiManager.

Thin wrapper around FMGClient that understands how policy packages nest
(packages may live inside folders) and flattens them into slash-joined
names for the UI. Policy objects are returned verbatim — mapping of
numeric enum values to human strings happens on the frontend so we
don't lose fidelity for JSON export.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.services.fmg_client import FMGClient

logger = logging.getLogger(__name__)


async def list_packages(fmg: FMGClient, adom: str) -> list[str]:
    """Return all policy package names under an ADOM (folders flattened)."""
    url = f"/pm/pkg/adom/{adom}"
    page_size = 100
    offset = 0
    raw: list[dict[str, Any]] = []
    while True:
        data = await fmg._call(
            "get",
            [{"url": url, "range": [offset, page_size]}],
            verbose=True,
        )
        chunk = data if isinstance(data, list) else []
        if not chunk:
            break
        raw.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return _flatten_package_tree(raw)


def _flatten_package_tree(pkgs: list[dict[str, Any]], prefix: str = "") -> list[str]:
    names: list[str] = []
    for p in pkgs:
        if not isinstance(p, dict):
            continue
        name = p.get("name") or ""
        full = f"{prefix}/{name}" if prefix else name
        if p.get("type") == "pkg":
            names.append(full)
        sub = p.get("subobj") or []
        if isinstance(sub, list):
            names.extend(_flatten_package_tree(sub, full))
    return names


async def fetch_policies(
    fmg: FMGClient,
    adom: str,
    package: str,
    fields: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Return the firewall policy list for a given package.

    When ``fields`` is omitted the viewer gets every field FMG exposes
    (~127 per-policy on 7.x), which the UI uses for the expand-to-details
    view. Passing an explicit list still works for callers that need a
    narrower payload (e.g. the legacy CSV exporter).
    """
    params: dict[str, Any] = {
        "url": f"/pm/config/adom/{adom}/pkg/{package}/firewall/policy",
        "loadsub": 0,
    }
    if fields:
        params["fields"] = fields
    data = await fmg._call("get", [params], verbose=True)
    return data if isinstance(data, list) else []


async def fetch_hitcounts(
    fmg: FMGClient,
    adom: str,
    package: str,
    *,
    timeout_seconds: float = 30.0,
    poll_interval_seconds: float = 0.4,
) -> dict[int, dict[str, Any]]:
    """Run the three-step FMG hitcount retrieval for a policy package.

    FMG exposes policy hitcounts as an on-demand refresh operation:

    1. ``exec /sys/hitcount`` with ``{adom, pkg}`` returns a ``task`` id.
    2. Poll ``get /task/task/{id}`` until ``state == 'done'`` (or error).
    3. ``exec /sys/task/result`` with ``{taskid}`` returns the full stats
       payload keyed by ``firewall policy``, ``firewall policy6``, etc.

    Only the IPv4 ``firewall policy`` records are indexed here — the
    viewer is IPv4-only today. Returns ``{policyid: {hitcount, pkts,
    byte, first_hit, last_hit, first_session, last_session, sesscount}}``
    so the frontend can merge by policyid without re-matching on name.
    Requires FMG ≥ 6.4.7 / 7.0.3; callers should treat an empty dict as
    "feature not supported on this FMG version" rather than a hard error.
    """
    # Step 1 — trigger. FMG returns the task id nested under ``data.task``
    # (not the top-level ``taskid`` the public docs suggest — confirmed
    # against lab 7.x).
    trigger = await fmg._call(
        "exec",
        [{"url": "/sys/hitcount", "data": {"adom": adom, "pkg": package}}],
        verbose=True,
    )
    task_id: Any = None
    if isinstance(trigger, dict):
        task_id = trigger.get("task") or trigger.get("taskid")
    if not task_id:
        logger.warning("hitcount trigger returned no task id: %r", trigger)
        return {}

    # Step 2 — poll until done. We bound the loop with both a deadline
    # and an iteration cap so a stalled task can't wedge the request.
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_seconds
    task_url = f"/task/task/{task_id}"
    while True:
        td = await fmg._call("get", [{"url": task_url}], verbose=True)
        state = td.get("state") if isinstance(td, dict) else None
        if state == "done":
            break
        if state == "error":
            err_detail = td.get("line") if isinstance(td, dict) else td
            raise RuntimeError(f"hitcount task failed: {err_detail}")
        if loop.time() >= deadline:
            raise TimeoutError(
                f"hitcount task {task_id} did not complete within "
                f"{timeout_seconds}s"
            )
        await asyncio.sleep(poll_interval_seconds)

    # Step 3 — collect. Result payload nests the policy stats under
    # ``data['firewall policy']``.
    result = await fmg._call(
        "exec",
        [{"url": "/sys/task/result", "data": {"taskid": task_id}}],
        verbose=True,
    )
    if not isinstance(result, dict):
        return {}
    records = result.get("firewall policy") or []
    if not isinstance(records, list):
        return {}

    out: dict[int, dict[str, Any]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        pid = rec.get("policyid")
        if pid is None:
            continue
        try:
            pid_int = int(pid)
        except (TypeError, ValueError):
            continue
        # Only the fields the viewer actually surfaces — drops noisy
        # per-record duplicates like srcintf/dstintf/name which already
        # live on the base policy object.
        out[pid_int] = {
            "hitcount": rec.get("hitcount", 0),
            "pkts": rec.get("pkts", 0),
            "byte": rec.get("byte", 0),
            "sesscount": rec.get("sesscount", 0),
            "first_hit": rec.get("first_hit", 0),
            "last_hit": rec.get("last_hit", 0),
            "first_session": rec.get("first_session", 0),
            "last_session": rec.get("last_session", 0),
        }
    return out


async def fetch_policy_schema(fmg: FMGClient, adom: str) -> dict[str, Any]:
    """Return the full firewall-policy schema via the FMG ``syntax`` option.

    Uses the ADOM-level ``obj/firewall/policy`` URL so we don't depend on
    a valid policy-package existing — the schema is identical regardless
    of which package path you target, and the ADOM path avoids the -6
    ``Invalid url`` failure you'd get when passing a placeholder pkg name.

    Returns the inner ``firewall policy`` object (the dict containing
    ``alimit`` / ``attr`` / ``category`` / ``help`` / ``mkey`` / ...)
    rather than the outer single-key wrapper, so callers can go straight
    to ``schema['attr']`` for the field map.
    """
    url = f"/pm/config/adom/{adom}/obj/firewall/policy"
    data = await fmg._call(
        "get",
        [{"url": url, "option": ["syntax"]}],
        verbose=True,
    )
    if isinstance(data, dict):
        inner = data.get("firewall policy")
        if isinstance(inner, dict):
            return inner
        return data
    return {}
