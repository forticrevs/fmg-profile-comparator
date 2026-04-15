"""Thin wrapper over FortiManager's ``/sys/proxy/json`` endpoint.

FortiManager exposes a pass-through that forwards an HTTP request to a
managed FortiGate and returns the decoded response. We use it for the
FortiOS-only APIs that FMG itself does not mirror — specifically the
Internet Service Database (ISDB) lookups.

Request envelope::

    POST /jsonrpc
    {
      "method": "exec",
      "params": [{
        "url": "/sys/proxy/json",
        "data": {
          "target":   ["device/<name>"],
          "action":   "get" | "post" | "put" | "delete",
          "resource": "/api/v2/...",
          "payload":  {...}  # optional body for post/put
          "timeout":  30     # optional seconds (default 60, max 28800)
        }
      }]
    }

Response envelope::

    result[0].status                    # overall FMG status
    result[0].data[0].target            # device name this entry is for
    result[0].data[0].status            # per-target status
    result[0].data[0].response          # decoded FOS response body

The FOS response body itself nests the actual payload under
``response.results``; the other keys (``build``, ``http_method``,
``path``, ``serial``, ``status``, ``vdom``, ``version``) are request
metadata we echo back to callers that ask for it.
"""

from __future__ import annotations

import logging
from typing import Any

from app.services.fmg_client import FMGClient

logger = logging.getLogger(__name__)


class FosProxyError(RuntimeError):
    """Raised when either FMG or the downstream FortiGate returns an error."""


async def proxy_call(
    fmg: FMGClient,
    device: str,
    resource: str,
    *,
    action: str = "get",
    payload: Any = None,
    timeout: int = 30,
) -> dict[str, Any]:
    """Forward an FOS REST API call through FMG and return the FOS body.

    ``resource`` is a FortiOS URI with query string — e.g.
    ``/api/v2/monitor/firewall/internet-service-fqdn?vdom=root``. Caller
    is responsible for URL-encoding and appending ``vdom=`` when needed;
    this layer does no massaging.

    Returns the decoded FOS response dict, which always carries
    ``results`` plus ``build/serial/version/vdom`` metadata.
    """
    if not device:
        raise ValueError("device name is required")

    request_data: dict[str, Any] = {
        "target": [f"device/{device}"],
        "action": action,
        "resource": resource,
        "timeout": timeout,
    }
    if payload is not None:
        request_data["payload"] = payload

    # FMGClient._call already validates the OUTER status and returns
    # the `data` array (list of per-target results). We still have to
    # unwrap the per-target envelope ourselves.
    data = await fmg._call(
        "exec",
        [{"url": "/sys/proxy/json", "data": request_data}],
    )
    if not isinstance(data, list) or not data:
        raise FosProxyError(
            f"FMG proxy returned empty data for device={device!r} resource={resource!r}"
        )
    entry = data[0]
    if not isinstance(entry, dict):
        raise FosProxyError(
            f"FMG proxy returned non-dict entry for device={device!r}: {entry!r}"
        )

    # Per-target status — this is where a device-offline / auth-failed
    # / FOS-timeout surfaces. Be loud about it so the router can map
    # the error back to a useful HTTP code.
    target_status = entry.get("status", {})
    if target_status.get("code") != 0:
        msg = target_status.get("message", "unknown error")
        raise FosProxyError(
            f"FMG proxy per-target error for device={device!r}: {msg} "
            f"(code={target_status.get('code')})"
        )

    fos_body = entry.get("response")
    if not isinstance(fos_body, dict):
        raise FosProxyError(
            f"FMG proxy returned no response body for device={device!r}: {entry!r}"
        )

    # FOS itself may embed a non-success at the body level too.
    body_status = fos_body.get("status")
    if body_status and body_status != "success":
        raise FosProxyError(
            f"FortiOS returned status={body_status!r} for device={device!r} "
            f"resource={resource!r}"
        )

    return fos_body


def _format_version(dev: dict[str, Any]) -> str:
    """Render ``7.6.6`` from FMG's ``version=700`` + ``mr=6`` + ``patch=6``.

    ``version`` is the major line encoded as ``major*100`` (so 700 → 7,
    600 → 6). ``mr`` and ``patch`` are already integers. An empty or
    unexpected value yields an empty string so the UI can fall back.
    """
    version = dev.get("version")
    mr = dev.get("mr")
    patch = dev.get("patch")
    if not isinstance(version, int) or version <= 0:
        return ""
    major = version // 100
    parts = [str(major)]
    if isinstance(mr, int):
        parts.append(str(mr))
        if isinstance(patch, int):
            parts.append(str(patch))
    return ".".join(parts)


async def list_managed_devices(fmg: FMGClient) -> list[dict[str, Any]]:
    """Return the FMG's full managed-device inventory (filtered to FGTs).

    FMG's ``/dvmdb/device`` returns every device across every ADOM.
    With ``verbose=True`` the response uses enum labels, so ``os_type``
    comes through as ``"fos"`` for FortiGates (vs ``"faz"``, ``"fsa"``,
    etc. for the rest of the Security Fabric). The ISDB lookup endpoints
    are FortiGate-specific, so we drop every non-FGT entry up front.
    """
    raw = await fmg._call("get", [{"url": "/dvmdb/device"}], verbose=True)
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for d in raw:
        if not isinstance(d, dict):
            continue
        if d.get("os_type") != "fos":
            continue
        name = d.get("name")
        if not name:
            continue
        out.append(
            {
                "name": name,
                "hostname": d.get("hostname"),
                "platform": d.get("platform_str"),
                "os_version": _format_version(d),
                "ip": d.get("ip"),
                "ha_mode": d.get("ha_mode"),
                "conn_status": d.get("conn_status"),
            }
        )
    # Sort alphabetically so the picker is deterministic.
    out.sort(key=lambda x: x["name"].lower())
    return out
