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
    # Profile retrieval — URL patterns per profile type
    # ------------------------------------------------------------------

    # Security profiles live under /pm/config/adom/{adom}/obj/...
    PROFILE_URLS: dict[str, str] = {
        "application": "/pm/config/adom/{adom}/obj/application/list",
        "webfilter": "/pm/config/adom/{adom}/obj/webfilter/profile",
        "ips": "/pm/config/adom/{adom}/obj/ips/sensor",
    }

    # SD-WAN templates use wanprof scope
    SDWAN_LIST_URL = "/pm/wanprof/adom/{adom}"
    SDWAN_DETAIL_URL = "/pm/config/adom/{adom}/wanprof/{name}/system/sdwan"

    async def list_profiles(self, profile_type: str) -> list[str]:
        """Return list of profile names for a given type."""
        if profile_type == "sdwan":
            return await self._list_sdwan()

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
        if profile_type == "sdwan":
            return await self._get_sdwan(name)
        if profile_type == "webfilter":
            return await self._get_webfilter(name)

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
    # WebFilter enrichment — resolve URL filter table references
    # ------------------------------------------------------------------

    async def _get_webfilter(self, name: str) -> dict[str, Any]:
        """Get a webfilter profile with enriched URL filter entries."""
        url = f"/pm/config/adom/{settings.fmg_adom}/obj/webfilter/profile/{name}"
        data = await self._call("get", [{"url": url}])
        result: dict[str, Any] = {}
        if isinstance(data, dict):
            result = data
        elif isinstance(data, list) and len(data) == 1:
            result = data[0]
        else:
            return {"_raw": data}

        # Resolve URL filter table reference to include actual URL entries
        # The web profile references a urlfilter table by ID in web.urlfilter-table
        web_block = result.get("web", {})
        if isinstance(web_block, dict):
            urlfilter_ref = web_block.get("urlfilter-table")
            # Value may be an int, string, or list like ['2']
            urlfilter_id = None
            if isinstance(urlfilter_ref, list) and urlfilter_ref:
                urlfilter_id = urlfilter_ref[0]
            elif urlfilter_ref:
                urlfilter_id = urlfilter_ref
            if urlfilter_id:
                try:
                    uf_url = (
                        f"/pm/config/adom/{settings.fmg_adom}"
                        f"/obj/webfilter/urlfilter/{urlfilter_id}"
                    )
                    uf_data = await self._call("get", [{
                        "url": uf_url, "option": ["loadsub"]
                    }])
                    if isinstance(uf_data, dict):
                        result["_url_filter"] = uf_data
                    elif isinstance(uf_data, list) and uf_data:
                        result["_url_filter"] = uf_data[0]
                except Exception:
                    pass

        # Fetch web rating overrides for this ADOM
        try:
            rating_url = (
                f"/pm/config/adom/{settings.fmg_adom}"
                f"/obj/webfilter/ftgd-local-rating"
            )
            rating_data = await self._call("get", [{
                "url": rating_url, "fields": ["url", "rating", "status", "comment"]
            }])
            if isinstance(rating_data, list) and rating_data:
                result["_web_rating_overrides"] = rating_data
        except Exception:
            pass

        return result

    # ------------------------------------------------------------------
    # SD-WAN template helpers
    # ------------------------------------------------------------------

    async def _list_sdwan(self) -> list[str]:
        url = self.SDWAN_LIST_URL.format(adom=settings.fmg_adom)
        data = await self._call("get", [{"url": url, "fields": ["name"]}])
        if isinstance(data, list):
            return [item.get("name", "") for item in data if isinstance(item, dict)]
        return []

    async def _get_sdwan(self, name: str) -> dict[str, Any]:
        """Get the full SD-WAN config block for a wanprof template.

        Fetches the parent sdwan object (includes health-check, service, zone
        as nested children via loadsub).
        """
        url = self.SDWAN_DETAIL_URL.format(adom=settings.fmg_adom, name=name)
        data = await self._call("get", [{"url": url}])

        # Also fetch service rules and health checks explicitly for richer data
        result: dict[str, Any] = {}
        if isinstance(data, dict):
            result = data
        elif isinstance(data, list) and len(data) == 1:
            result = data[0]
        else:
            result = {"_raw": data}

        # Enrich with sub-tables if not already present
        for sub in ("service", "health-check", "zone", "members"):
            if sub not in result or not result[sub]:
                try:
                    sub_data = await self._call("get", [{"url": f"{url}/{sub}"}])
                    result[sub] = sub_data
                except Exception:
                    pass

        # Add template name for clarity
        result["_template_name"] = name
        return result


# Singleton
fmg = FMGClient()
