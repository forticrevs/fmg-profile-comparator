"""FortiManager JSON-RPC API client.

Also hosts a thin wrapper over the undocumented FMG GUI ``cgi-bin``
module API — specifically the FortiGuard encyclopedia lookup used by the
signature-hover tooltip. The alternative API has a completely separate
session lifecycle (cookie-based, with an ``XSRF-TOKEN`` header) so we
cache its state alongside the JSON-RPC session token on the same
``FMGClient`` instance rather than building a second client class.
"""

from __future__ import annotations

import httpx
import logging
import time
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

# Encyclopedia cache TTL. Signature metadata is fully static per
# FortiGuard release — nothing here needs live freshness. 24 h keeps
# hover tooltips instant without dominating process memory (each entry
# is a few KB).
_ENCY_TTL_SECONDS = 24 * 60 * 60


class FMGClient:
    """Thin async wrapper around FortiManager JSON-RPC API."""

    def __init__(self, host: str | None = None, verify_ssl: bool | None = None) -> None:
        self._host = host or settings.fmg_host
        self._verify = verify_ssl if verify_ssl is not None else settings.fmg_verify_ssl
        self._base = f"https://{self._host}/jsonrpc"
        self._session: str | None = None
        self._http = httpx.AsyncClient(verify=self._verify, timeout=30.0)
        self._req_id = 1
        self._adom = settings.fmg_adom

        # Credentials stashed on successful login so the alt-API session
        # (which has its own expiry independent of the JSON-RPC one) can
        # silently re-authenticate without plumbing creds through every
        # call site.
        self._user: str | None = None
        self._password: str | None = None

        # Alternative GUI CGI API state. ``_cgi_csrf`` is the value we
        # must echo back as the ``XSRF-TOKEN`` header on every subsequent
        # request; it's extracted from the ``HTTP_CSRF_TOKEN`` cookie
        # FMG sets during the flatui_auth login flow. Cookies themselves
        # ride on ``self._http``'s cookie jar automatically.
        self._cgi_csrf: str | None = None

        # Per-client encyclopedia cache. Keyed on (source, id) — two
        # separate FMG hosts necessarily get their own ``FMGClient``
        # instances so the host dimension is implicit.
        self._ency_cache: dict[tuple[str, int], tuple[float, dict[str, Any]]] = {}

    def _is_login_request(self, method: str, params: list[dict[str, Any]]) -> bool:
        if method != "exec":
            return False
        return any(param.get("url") == "/sys/login/user" for param in params)

    def _is_logout_request(self, method: str, params: list[dict[str, Any]]) -> bool:
        if method != "exec":
            return False
        return any(param.get("url") == "/sys/logout" for param in params)

    async def _ensure_session(self) -> None:
        if not self._session:
            await self.login()

    def _is_session_error(self, code: int, message: str) -> bool:
        message_lower = message.lower()
        return "session" in message_lower or "login" in message_lower or code == -11

    # ------------------------------------------------------------------
    # Low-level JSON-RPC
    # ------------------------------------------------------------------

    async def _call(
        self,
        method: str,
        params: list[dict[str, Any]],
        *,
        verbose: bool = False,
        retry_on_session_error: bool = True,
    ) -> Any:
        if not self._is_login_request(method, params) and not self._is_logout_request(method, params):
            await self._ensure_session()

        payload: dict[str, Any] = {
            "method": method,
            "params": params,
            "id": self._req_id,
            "jsonrpc": "1.0",
        }
        if verbose:
            payload["verbose"] = 1
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
            code = status.get("code", -1)
            message = status.get("message", "unknown")
            if code != 0:
                if retry_on_session_error and self._is_session_error(code, message):
                    logger.info("FMG session expired or missing; retrying login")
                    self._session = None
                    await self.login()
                    return await self._call(
                        method,
                        params,
                        verbose=verbose,
                        retry_on_session_error=False,
                    )
                raise RuntimeError(
                    f"FMG API error: {message} "
                    f"(code {code})"
                )
            return entry.get("data", entry)
        return result

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    async def login(self) -> None:
        if not self._host:
            raise RuntimeError("FMG_HOST not configured")
        await self.login_with_credentials(settings.fmg_username, settings.fmg_password)

    async def login_with_credentials(self, username: str, password: str) -> None:
        """Authenticate to FMG with explicit credentials."""
        if not self._host:
            raise RuntimeError("FMG host not configured")
        payload = {
            "method": "exec",
            "params": [
                {
                    "url": "/sys/login/user",
                    "data": {
                        "user": username,
                        "passwd": password,
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
        # Stash for the alt-API session, which expires independently of
        # the JSON-RPC session and needs a silent re-auth path.
        self._user = username
        self._password = password
        logger.info("FMG login successful")

    async def logout(self) -> None:
        if self._session:
            try:
                await self._call("exec", [{"url": "/sys/logout"}])
            except Exception:
                pass
            self._session = None
        # Drop any cgi session state too — the cookies live on the
        # shared httpx client so they'd otherwise leak into the next
        # login for this host.
        self._cgi_csrf = None
        try:
            self._http.cookies.clear()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Alternative GUI CGI API (undocumented, unsupported)
    #
    # Used only for operations the JSON-RPC API cannot express. At the
    # moment this is just the FortiGuard encyclopedia lookup backing the
    # IPS / Application signature hover tooltip. The auth flow is:
    #   1. POST /cgi-bin/module/flatui_auth with {url, method, params}
    #      → cookies (CURRENT_SESSION, HTTP_CSRF_TOKEN) are set on the
    #        response.
    #   2. Every subsequent call echoes HTTP_CSRF_TOKEN back as an
    #      ``XSRF-TOKEN`` header. Cookies ride on httpx automatically.
    # ------------------------------------------------------------------

    async def _cgi_login(self) -> None:
        """Authenticate against the alt-API using the stashed JSON-RPC creds."""
        if not self._host:
            raise RuntimeError("FMG host not configured")
        if not self._user or not self._password:
            # We only stash credentials on login_with_credentials(), so
            # this branch indicates the client was constructed without a
            # full login. Fail loud rather than silently 401.
            raise RuntimeError(
                "FMG alt-API login requires credentials — call "
                "login_with_credentials() first"
            )
        url = f"https://{self._host}/cgi-bin/module/flatui_auth"
        body = {
            "url": "/gui/userauth",
            "method": "login",
            "params": {
                "secretkey": self._password,
                "logintype": 0,
                "username": self._user,
            },
        }
        resp = await self._http.post(
            url,
            json=body,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        # httpx stores Set-Cookie values in resp.cookies; we need to
        # extract the CSRF token so we can echo it in the XSRF-TOKEN
        # header for subsequent calls. HTTP_CSRF_TOKEN persists in the
        # shared client jar too, so either source works.
        csrf = resp.cookies.get("HTTP_CSRF_TOKEN") or self._http.cookies.get(
            "HTTP_CSRF_TOKEN"
        )
        if not csrf:
            raise RuntimeError(
                "FMG alt-API login returned no HTTP_CSRF_TOKEN cookie"
            )
        self._cgi_csrf = csrf
        logger.info("FMG alt-API login successful (host=%s)", self._host)

    async def _cgi_ensure_login(self) -> None:
        if self._cgi_csrf is None:
            await self._cgi_login()

    async def _cgi_call(
        self,
        module: str,
        body: dict[str, Any],
        *,
        referer_path: str = "/",
        retry_on_session_error: bool = True,
    ) -> dict[str, Any]:
        """POST to a ``cgi-bin/module/<module>`` endpoint.

        Handles silent re-login on session expiry and returns the parsed
        JSON body (``{code, data, errors, message}`` for productapi).
        """
        await self._cgi_ensure_login()
        url = f"https://{self._host}/cgi-bin/module/{module}"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Referer": f"https://{self._host}{referer_path}",
            "Origin": f"https://{self._host}",
        }
        if self._cgi_csrf:
            headers["XSRF-TOKEN"] = self._cgi_csrf
        # `nocache` mirrors what the FMG web UI sends — a millisecond
        # timestamp as a cachebuster query param. Harmless elsewhere,
        # but productapi has been observed to 304 without it on some
        # builds, so we keep the habit.
        params = {"nocache": str(int(time.time() * 1000))}
        resp = await self._http.post(url, json=body, headers=headers, params=params)

        # Session-expiry shows up as HTTP 401/403 or a code != 0 with a
        # message mentioning "session". Re-login once and retry.
        if resp.status_code in (401, 403) and retry_on_session_error:
            logger.info("FMG alt-API session expired (HTTP %s); re-auth", resp.status_code)
            self._cgi_csrf = None
            try:
                self._http.cookies.clear()
            except Exception:
                pass
            return await self._cgi_call(
                module, body, referer_path=referer_path, retry_on_session_error=False
            )

        resp.raise_for_status()
        parsed = resp.json()

        # productapi envelope: {code, data, errors, message}. A non-zero
        # code with a session-flavored message is the "retry once" path.
        code = parsed.get("code")
        msg = str(parsed.get("message", ""))
        if code not in (0, None):
            low = msg.lower()
            if retry_on_session_error and ("session" in low or "login" in low or "auth" in low):
                logger.info("FMG alt-API code=%s msg=%r; re-auth and retry", code, msg)
                self._cgi_csrf = None
                try:
                    self._http.cookies.clear()
                except Exception:
                    pass
                return await self._cgi_call(
                    module,
                    body,
                    referer_path=referer_path,
                    retry_on_session_error=False,
                )
            raise RuntimeError(f"FMG alt-API error code={code} message={msg}")
        return parsed

    async def fetch_encyclopedia(self, source: str, signature_id: int) -> dict[str, Any]:
        """Return the FortiGuard encyclopedia record for a signature.

        ``source`` is ``"ips"`` or ``"app"``; ``signature_id`` is the
        numeric rule-id (IPS) or app id. The response ``data`` block
        carries every field the FMG GUI renders in its signature detail
        pane — Name, Risk, Summary, DefaultAction, CVE, os_list,
        app_list, Released/Updated, etc. Cached in-process for 24 h
        since this data is static per FortiGuard release.
        """
        if source not in ("ips", "app"):
            raise ValueError(f"Encyclopedia source must be 'ips' or 'app', got {source!r}")
        key = (source, int(signature_id))
        now = time.monotonic()
        hit = self._ency_cache.get(key)
        if hit and now - hit[0] < _ENCY_TTL_SECONDS:
            return hit[1]

        referer = (
            "/ui/pno/pno_obj_ipssign" if source == "ips" else "/ui/pno/pno_obj_appsignature"
        )
        body = {
            "url": "/v1/fgd/lookup/ency",
            "params": {"source": source, "id": int(signature_id)},
            # `id` here is a client-side correlation token, not the
            # signature id. The FMG UI sends a UUID; any stable string
            # works, but we keep it unique-ish per request.
            "id": f"ency-{source}-{signature_id}",
            "method": "get",
        }
        envelope = await self._cgi_call(
            "productapi", body, referer_path=referer
        )
        data = envelope.get("data")
        if not isinstance(data, dict):
            raise RuntimeError(
                f"FMG encyclopedia lookup returned no data block "
                f"(source={source}, id={signature_id}, envelope={envelope!r})"
            )
        self._ency_cache[key] = (now, data)
        return data

    # ------------------------------------------------------------------
    # Profile retrieval — URL patterns per profile type
    # ------------------------------------------------------------------

    # Security profiles live under /pm/config/adom/{adom}/obj/...
    PROFILE_URLS: dict[str, str] = {
        "application": "/pm/config/adom/{adom}/obj/application/list",
        "webfilter": "/pm/config/adom/{adom}/obj/webfilter/profile",
        "ips": "/pm/config/adom/{adom}/obj/ips/sensor",
        "dlp": "/pm/config/adom/{adom}/obj/dlp/profile",
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
        url = url_tpl.format(adom=self._adom)
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
        url = f"{url_tpl.format(adom=self._adom)}/{name}"
        data = await self._call("get", [{"url": url}], verbose=True)
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
        url = f"/pm/config/adom/{self._adom}/obj/webfilter/profile/{name}"
        data = await self._call("get", [{"url": url}], verbose=True)
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
                        f"/pm/config/adom/{self._adom}"
                        f"/obj/webfilter/urlfilter/{urlfilter_id}"
                    )
                    uf_data = await self._call("get", [{
                        "url": uf_url, "option": ["loadsub"]
                    }], verbose=True)
                    if isinstance(uf_data, dict):
                        result["_url_filter"] = uf_data
                    elif isinstance(uf_data, list) and uf_data:
                        result["_url_filter"] = uf_data[0]
                except Exception:
                    pass

        # Fetch web rating overrides for this ADOM
        try:
            rating_url = (
                f"/pm/config/adom/{self._adom}"
                f"/obj/webfilter/ftgd-local-rating"
            )
            rating_data = await self._call("get", [{
                "url": rating_url, "fields": ["url", "rating", "status", "comment"]
            }], verbose=True)
            if isinstance(rating_data, list) and rating_data:
                result["_web_rating_overrides"] = rating_data
        except Exception:
            pass

        return result

    # ------------------------------------------------------------------
    # SD-WAN template helpers
    # ------------------------------------------------------------------

    async def _list_sdwan(self) -> list[str]:
        url = self.SDWAN_LIST_URL.format(adom=self._adom)
        data = await self._call("get", [{"url": url, "fields": ["name"]}])
        if isinstance(data, list):
            return [item.get("name", "") for item in data if isinstance(item, dict)]
        return []

    async def _get_sdwan(self, name: str) -> dict[str, Any]:
        """Get the full SD-WAN config block for a wanprof template.

        Fetches the parent sdwan object (includes health-check, service, zone
        as nested children via loadsub).
        """
        url = self.SDWAN_DETAIL_URL.format(adom=self._adom, name=name)
        data = await self._call("get", [{"url": url}], verbose=True)

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
                    sub_data = await self._call(
                        "get",
                        [{"url": f"{url}/{sub}"}],
                        verbose=True,
                    )
                    result[sub] = sub_data
                except Exception:
                    pass

        # Add template name for clarity
        result["_template_name"] = name
        return result

    async def list_application_signatures(self) -> list[dict[str, Any]]:
        """Return the global application signature catalog."""
        data = await self._call(
            "get",
            [{"url": "/pm/config/global/_application/list"}],
            verbose=True,
        )
        return data if isinstance(data, list) else []

    async def list_ips_signatures(self) -> list[dict[str, Any]]:
        """Return the ADOM-scoped IPS signature catalog."""
        data = await self._call(
            "get",
            [{"url": f"/pm/config/adom/{self._adom}/_rule/list"}],
            verbose=True,
        )
        return data if isinstance(data, list) else []

    async def list_dlp_sensors(self) -> list[dict[str, Any]]:
        """Return FortiGuard DLP sensor catalog."""
        data = await self._call(
            "get",
            [{"url": f"pm/config/adom/{self._adom}/_fdsdb/dlp/sensor"}],
            verbose=True,
        )
        return data if isinstance(data, list) else []

    async def list_dlp_dictionaries(self) -> list[dict[str, Any]]:
        """Return FortiGuard DLP dictionary catalog."""
        data = await self._call(
            "get",
            [{"url": f"pm/config/adom/{self._adom}/_fdsdb/dlp/dictionary"}],
            verbose=True,
        )
        return data if isinstance(data, list) else []

    async def list_dlp_data_types(self) -> list[dict[str, Any]]:
        """Return FortiGuard DLP data-type catalog."""
        data = await self._call(
            "get",
            [{"url": f"pm/config/adom/{self._adom}/_fdsdb/dlp/data-type"}],
            verbose=True,
        )
        return data if isinstance(data, list) else []

    # ------------------------------------------------------------------
    # Schema / syntax queries
    # ------------------------------------------------------------------

    async def get_syntax(self, url: str) -> Any:
        """Fetch the FMG schema/syntax definition for any URL.

        Returns the raw `data` payload from a `get` call with
        `option=["syntax"]`. Callers are responsible for walking the
        resulting `attr`/`subobj` tree. Returns an empty dict on failure
        rather than raising — schema fetches are best-effort UX polish,
        never load-bearing for correctness.
        """
        try:
            data = await self._call(
                "get",
                [{"url": url, "option": ["syntax"]}],
                verbose=True,
            )
            return data if data is not None else {}
        except Exception as e:
            logger.warning(f"Failed to fetch syntax for {url}: {e}")
            return {}

    def profile_url(self, profile_type: str) -> str | None:
        """Resolve a profile type to its ADOM-qualified FMG URL."""
        if profile_type == "sdwan":
            return self.SDWAN_LIST_URL.format(adom=self._adom)
        tpl = self.PROFILE_URLS.get(profile_type)
        if not tpl:
            return None
        return tpl.format(adom=self._adom)


# Singleton
fmg = FMGClient()
