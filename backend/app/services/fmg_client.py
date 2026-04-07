"""FortiManager JSON-RPC API client."""

from __future__ import annotations

import httpx
import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


class FMGClient:
    """Thin async wrapper around FortiManager JSON-RPC API."""

    def __init__(self) -> None:
        self._base = f"https://{settings.fmg_host}/jsonrpc"
        self._session: str | None = None
        self._http = httpx.AsyncClient(verify=settings.fmg_verify_ssl, timeout=30.0)
        self._req_id = 1

    # ------------------------------------------------------------------
    # Low-level JSON-RPC
    # ------------------------------------------------------------------

    async def _call(self, method: str, params: list[dict[str, Any]]) -> Any:
        payload: dict[str, Any] = {
            "method": method,
            "params": params,
            "id": self._req_id,
            "jsonrpc": "1.0",
        }
        if self._session:
            payload["session"] = self._session
        self._req_id += 1

        resp = await self._http.post(self._base, json=payload)
        resp.raise_for_status()
        body = resp.json()

        # FMG wraps results in body["result"] (list of dicts with "data", "status", "url")
        result = body.get("result")
        if isinstance(result, list) and len(result) == 1:
            entry = result[0]
            status = entry.get("status", {})
            if status.get("code", -1) != 0:
                raise RuntimeError(
                    f"FMG API error: {status.get('message', 'unknown')} "
                    f"(code {status.get('code')})"
                )
            return entry.get("data", entry)
        return result

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    async def login(self) -> None:
        if not settings.fmg_host:
            raise RuntimeError("FMG_HOST not configured")
        payload = {
            "method": "exec",
            "params": [
                {
                    "url": "/sys/login/user",
                    "data": {
                        "user": settings.fmg_username,
                        "passwd": settings.fmg_password,
                    },
                }
            ],
            "id": self._req_id,
            "jsonrpc": "1.0",
        }
        self._req_id += 1
        resp = await self._http.post(self._base, json=payload)
        resp.raise_for_status()
        body = resp.json()
        self._session = body.get("session")
        if not self._session:
            raise RuntimeError("FMG login failed — no session token returned")
        logger.info("FMG login successful")

    async def logout(self) -> None:
        if self._session:
            try:
                await self._call("exec", [{"url": "/sys/logout"}])
            except Exception:
                pass
            self._session = None

    # ------------------------------------------------------------------
    # Profile retrieval
    # ------------------------------------------------------------------

    # URL patterns for each profile type inside an ADOM
    PROFILE_URLS: dict[str, str] = {
        "application": "/pm/config/adom/{adom}/obj/application/list",
        "webfilter": "/pm/config/adom/{adom}/obj/webfilter/profile",
        "ips": "/pm/config/adom/{adom}/obj/ips/sensor",
        "sdwan": "/pm/config/adom/{adom}/obj/dynamic/virtual-wan-link/template",
    }

    async def list_profiles(self, profile_type: str) -> list[str]:
        """Return list of profile names for a given type."""
        url_tpl = self.PROFILE_URLS.get(profile_type)
        if not url_tpl:
            raise ValueError(f"Unknown profile type: {profile_type}")
        url = url_tpl.format(adom=settings.fmg_adom)
        data = await self._call("get", [{"url": url, "fields": ["name"]}])
        if isinstance(data, list):
            return [item.get("name", "") for item in data if isinstance(item, dict)]
        return []

    async def get_profile(self, profile_type: str, name: str) -> dict[str, Any]:
        """Return full configuration for one profile."""
        url_tpl = self.PROFILE_URLS.get(profile_type)
        if not url_tpl:
            raise ValueError(f"Unknown profile type: {profile_type}")
        url = f"{url_tpl.format(adom=settings.fmg_adom)}/{name}"
        data = await self._call("get", [{"url": url}])
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and len(data) == 1:
            return data[0]
        return {"_raw": data}

    # ------------------------------------------------------------------
    # SD-WAN specific (templates live under a different path)
    # ------------------------------------------------------------------

    async def list_sdwan_templates(self) -> list[str]:
        url = f"/pm/config/adom/{settings.fmg_adom}/obj/dynamic/virtual-wan-link/template"
        try:
            data = await self._call("get", [{"url": url, "fields": ["name"]}])
        except RuntimeError:
            # Try the newer sdwan path
            url = f"/pm/config/adom/{settings.fmg_adom}/obj/dynamic/virtual-wan-link/members"
            data = await self._call("get", [{"url": url, "fields": ["name"]}])
        if isinstance(data, list):
            return [item.get("name", "") for item in data if isinstance(item, dict)]
        return []

    async def get_sdwan_template(self, name: str) -> dict[str, Any]:
        url = (
            f"/pm/config/adom/{settings.fmg_adom}"
            f"/obj/dynamic/virtual-wan-link/template/{name}"
        )
        data = await self._call("get", [{"url": url}])
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and len(data) == 1:
            return data[0]
        return {"_raw": data}


# Singleton
fmg = FMGClient()
