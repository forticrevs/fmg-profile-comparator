"""Resolves FortiManager internal IDs to human-readable names.

Caches lookup tables fetched from FMG at startup / on first use.
Covers:
  - WebFilter FortiGuard categories (id -> "Drug Abuse", etc.)
  - WebFilter local/custom categories (id -> "custom1", etc.)
  - Application Control categories (id -> "General.Interest", etc.)
  - URL filter lists (id -> name, plus entries)
  - IPS rules (signature IDs -> name via sensor entries)
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class IDResolver:
    """Lazy-loaded, cached ID-to-name resolver."""

    def __init__(self) -> None:
        self._webfilter_cats: dict[str, str] = {}     # "1" -> "Drug Abuse"
        self._webfilter_local_cats: dict[str, str] = {}  # "140" -> "custom1"
        self._app_categories: dict[str, str] = {}     # "12" -> "General.Interest"
        self._url_filters: dict[str, str] = {}         # "2" -> "ACME-URL"
        self._ips_rules: dict[str, str] = {}           # "51006" -> "Apache.Log4j..."
        self._loaded = False

    async def load(self, fmg: Any) -> None:
        """Fetch all lookup tables from FMG. Called once at startup or on first comparison."""
        if self._loaded:
            return

        try:
            await self._load_webfilter_categories(fmg)
        except Exception as e:
            logger.warning(f"Failed to load webfilter categories: {e}")

        try:
            await self._load_app_categories(fmg)
        except Exception as e:
            logger.warning(f"Failed to load app categories: {e}")

        try:
            await self._load_url_filters(fmg)
        except Exception as e:
            logger.warning(f"Failed to load URL filters: {e}")

        try:
            await self._load_ips_rules(fmg)
        except Exception as e:
            logger.warning(f"Failed to load IPS rules: {e}")

        self._loaded = True
        logger.info(
            f"ID resolver loaded: {len(self._webfilter_cats)} wf cats, "
            f"{len(self._webfilter_local_cats)} local cats, "
            f"{len(self._app_categories)} app cats, "
            f"{len(self._url_filters)} url filters, "
            f"{len(self._ips_rules)} ips rules"
        )

    async def _load_webfilter_categories(self, fmg: Any) -> None:
        """Fetch FortiGuard + local webfilter categories via datasrc."""
        from app.config import settings

        data = await fmg._call("get", [{
            "attr": "ftgd-wf/filters/category",
            "option": "datasrc",
            "url": f"/pm/config/adom/{settings.fmg_adom}/obj/webfilter/profile",
        }])

        if isinstance(data, dict):
            # FortiGuard categories
            for cat in data.get("webfilter categories", []):
                cat_id = str(cat.get("id", ""))
                desc = cat.get("obj description", "")
                if cat_id and desc:
                    self._webfilter_cats[cat_id] = desc

            # Local/custom categories
            for cat in data.get("webfilter ftgd-local-cat", []):
                cat_id = str(cat.get("id", ""))
                desc = cat.get("desc", "")
                if cat_id and desc:
                    self._webfilter_local_cats[cat_id] = desc

    async def _load_app_categories(self, fmg: Any) -> None:
        """Fetch application categories via datasrc."""
        from app.config import settings

        data = await fmg._call("get", [{
            "attr": "entries/category",
            "option": "datasrc",
            "url": f"/pm/config/adom/{settings.fmg_adom}/obj/application/list",
        }])

        if isinstance(data, dict):
            for cat in data.get("application categories", []):
                cat_id = str(cat.get("id", ""))
                desc = cat.get("obj description", "")
                if cat_id and desc:
                    self._app_categories[cat_id] = desc

    async def _load_url_filters(self, fmg: Any) -> None:
        """Fetch URL filter list names."""
        from app.config import settings

        data = await fmg._call("get", [{
            "url": f"/pm/config/adom/{settings.fmg_adom}/obj/webfilter/urlfilter",
            "fields": ["id", "name"],
        }])

        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    fid = str(item.get("id", ""))
                    name = item.get("name", "")
                    if fid and name:
                        self._url_filters[fid] = name

    async def _load_ips_rules(self, fmg: Any) -> None:
        """Fetch IPS signature rule-id -> name mapping via FortiGate proxy.

        The IPS signature DB lives on managed FortiGates, not in FMG config.
        We proxy through the first available device to get the full rule table.
        """
        # Find a managed device to proxy through
        try:
            devices = await fmg._call("get", [{
                "url": "/dvmdb/device",
                "fields": ["name"],
                "range": [0, 1],
            }])
        except Exception:
            logger.warning("Cannot list devices for IPS rule lookup")
            return

        if not isinstance(devices, list) or not devices:
            logger.warning("No managed devices available for IPS rule lookup")
            return

        device_name = devices[0].get("name", "")
        if not device_name:
            return

        # Fetch the full IPS rule DB via proxy (rule-id + name only)
        try:
            data = await fmg._call("exec", [{
                "url": "/sys/proxy/json",
                "data": {
                    "target": [f"device/{device_name}"],
                    "action": "get",
                    "resource": "/api/v2/cmdb/ips/rule?format=rule-id|name&count=15000",
                },
            }])
        except Exception as e:
            logger.warning(f"IPS rule proxy call failed: {e}")
            return

        # Response is a list: [{"response": {"results": [...]}, "target": "..."}]
        if isinstance(data, list) and data:
            resp = data[0] if isinstance(data[0], dict) else {}
            inner = resp.get("response", {})
            results = inner.get("results", [])
            for item in results:
                rid = str(item.get("rule-id", ""))
                name = item.get("name", "")
                if rid and name:
                    self._ips_rules[rid] = name
            logger.info(
                f"Loaded {len(self._ips_rules)} IPS rules from device '{device_name}'"
            )
        elif isinstance(data, dict):
            # Single device response (not wrapped in list)
            resp = data.get("response", {})
            results = resp.get("results", [])
            for item in results:
                rid = str(item.get("rule-id", ""))
                name = item.get("name", "")
                if rid and name:
                    self._ips_rules[rid] = name

    # ------------------------------------------------------------------
    # Resolution methods
    # ------------------------------------------------------------------

    def resolve_webfilter_category(self, cat_id: str | int) -> str | None:
        """Resolve a webfilter category ID to its name."""
        key = str(cat_id)
        return self._webfilter_cats.get(key) or self._webfilter_local_cats.get(key)

    def resolve_app_category(self, cat_id: str | int) -> str | None:
        """Resolve an application category ID to its name."""
        return self._app_categories.get(str(cat_id))

    def resolve_url_filter(self, filter_id: str | int) -> str | None:
        """Resolve a URL filter list ID to its name."""
        return self._url_filters.get(str(filter_id))

    def resolve_ips_rule(self, rule_id: str | int) -> str | None:
        """Resolve an IPS signature rule ID to its name."""
        return self._ips_rules.get(str(rule_id))

    def resolve_value(self, field_path: str, value: Any) -> Any:
        """Auto-resolve a value based on the field path context.

        Returns a dict with 'raw' and 'display' if resolved, otherwise
        returns the original value unchanged.
        """
        if value is None or value == "__MISSING__":
            return value

        path_lower = field_path.lower()
        resolved = None

        # WebFilter category fields: ftgd-wf.filters[N].category[M]
        if "category" in path_lower and ("ftgd-wf" in path_lower or "filters" in path_lower):
            resolved = self.resolve_webfilter_category(value)

        # Application category fields
        elif "category" in path_lower and ("application" in path_lower or "entries" in path_lower):
            resolved = self.resolve_app_category(value)

        # URL filter reference (web.urlfilter-table or similar)
        elif "urlfilter-table" in path_lower or (
            "urlfilter" in path_lower and "id" == path_lower.rsplit(".", 1)[-1]
        ):
            resolved = self.resolve_url_filter(value)

        # IPS rule IDs: entries[N].rule[M]
        elif ".rule[" in field_path or field_path.endswith(".rule"):
            resolved = self.resolve_ips_rule(value)

        if resolved:
            return {"raw": value, "display": resolved}
        return value


# Singleton
resolver = IDResolver()
