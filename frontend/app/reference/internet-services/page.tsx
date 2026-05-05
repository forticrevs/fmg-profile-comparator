"use client";

/**
 * Internet Service Database — FQDN catalog + IP lookup reference page.
 *
 * FortiManager itself does NOT host the ISDB monitor APIs; every call
 * is proxied through a user-selected managed FortiGate via FMG's
 * `/sys/proxy/json` endpoint. The backend does the proxy heavy-lifting
 * — this page just picks a target device, triggers each lookup, and
 * renders the results.
 *
 * Two features share the page and the same device picker:
 *
 *  1. IP lookup — enrich a single IP (or FQDN that we DNS-resolve) with
 *     reverse DNS, GeoIP, and the ISDB match + reputation records the
 *     FortiGate returns. Rendered as a single glanceable card so an
 *     operator can triage an address without tab-switching.
 *
 *  2. FQDN catalog — the full FortiGuard map of SaaS FQDN groups. Used
 *     as a reference while authoring policies.
 *
 * UX notes:
 *  - Device picker persists per FMG host (localStorage). Offline
 *    devices stay in the list but are dimmed and marked, because the
 *    user may still want to try proxying through a degraded device.
 *  - Catalog rendering uses DataGrid so we inherit expand-on-click,
 *    line-clamp, and responsive stacking from the shared primitive.
 *  - Global search on the catalog scans both group names AND their
 *    FQDNs so an operator looking for `*.adobesigncdn.com` finds the
 *    row even without knowing the group name.
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  fetchIsdbCatalog,
  fetchIsdbDevices,
  fetchIsdbFqdnCatalog,
  fetchIsdbIpLookup,
  fetchIsdbServiceDetails,
  type IsdbDevice,
  type IsdbFqdnCatalog,
  type IsdbFqdnGroup,
  type IsdbLookupResponse,
  type IsdbServiceCatalog,
  type IsdbServiceEntry,
  type IsdbServiceMatch,
} from "@/lib/api";
import DataGrid, { type DataGridColumn } from "@/components/DataGrid";
import AddToChatContextButton from "@/components/AddToChatContextButton";
import { useChatContext } from "@/components/ChatContext";

/* ------------------------------------------------------------------ */
/* Local storage — scoped per FMG so two operators sharing a browser  */
/* don't stomp each other's device choice.                            */
/* ------------------------------------------------------------------ */
const DEVICE_KEY = "isdb:selected-device";

function loadSelectedDevice(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

function saveSelectedDevice(name: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (name) window.localStorage.setItem(DEVICE_KEY, name);
    else window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

/* ------------------------------------------------------------------ */
/* Connection status badge                                             */
/* ------------------------------------------------------------------ */
function ConnStatusDot({ status }: { status: string | null }) {
  const isUp = status === "up";
  const tone = isUp ? "bg-emerald-400/90" : "bg-red-500/80";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${tone}`}
      title={`Connection: ${status ?? "unknown"}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Pretty device picker — styled select with platform + version       */
/* metadata inline.                                                   */
/* ------------------------------------------------------------------ */
function DevicePicker({
  devices,
  selected,
  onSelect,
}: {
  devices: IsdbDevice[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Proxy via
      </label>
      <div className="relative">
        <select
          value={selected ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          className="appearance-none rounded-lg border border-slate-700 bg-slate-900 py-1.5 pl-3 pr-8 text-xs text-slate-200 focus:border-cyan-500/60 focus:outline-none"
        >
          <option value="" disabled>
            — select a FortiGate —
          </option>
          {devices.map((d) => {
            const suffix = [
              d.platform,
              d.os_version ? `v${d.os_version}` : null,
              d.conn_status && d.conn_status !== "up" ? `(${d.conn_status})` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <option key={d.name} value={d.name}>
                {d.name} {suffix ? `— ${suffix}` : ""}
              </option>
            );
          })}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
          ▾
        </span>
      </div>
      {selected && (
        <ConnStatusDot
          status={
            devices.find((d) => d.name === selected)?.conn_status ?? null
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FQDN chip cluster — trimmed to a fold line with expand control     */
/* at the row level (DataGrid handles row-click expand).              */
/* ------------------------------------------------------------------ */
function FqdnChips({ fqdns }: { fqdns: string[] }) {
  return (
    <div
      data-no-clamp
      className="flex flex-wrap gap-1"
    >
      {fqdns.map((f) => (
        <span
          key={f}
          className="inline-flex items-center rounded border border-slate-800 bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-mono text-slate-300"
        >
          {f}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vendor prefix extraction — FortiGuard names groups as              */
/* `FQDN-<Vendor>-<Product>`. We split on the second hyphen so the    */
/* left column shows the vendor cluster (Google, Meta, Adobe, ...)    */
/* ------------------------------------------------------------------ */
function parseGroupName(raw: string): { prefix: string; vendor: string; product: string } {
  // `FQDN-Google-Gmail` → {prefix: "FQDN", vendor: "Google", product: "Gmail"}
  const parts = raw.split("-");
  if (parts.length >= 3) {
    return {
      prefix: parts[0],
      vendor: parts[1],
      product: parts.slice(2).join("-"),
    };
  }
  if (parts.length === 2) {
    return { prefix: parts[0], vendor: parts[1], product: "" };
  }
  return { prefix: raw, vendor: "", product: "" };
}

/* ------------------------------------------------------------------ */
/* Highlight helper — wraps matching substrings with <mark>. Re-used  */
/* from the reference explorer pattern.                               */
/* ------------------------------------------------------------------ */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let parts: string[];
  try {
    parts = text.split(new RegExp(`(${escaped})`, "gi"));
  } catch {
    return <>{text}</>;
  }
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-cyan-500/30 text-current">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Batch lookup types                                                  */
/* ------------------------------------------------------------------ */
interface BatchResult {
  target: string;
  status: "pending" | "loading" | "done" | "error";
  data?: IsdbLookupResponse;
  error?: string;
}

interface ServiceDetailState {
  total: number | null;
  entries: IsdbServiceEntry[];
  loading: boolean;
  error: string | null;
  loadedCount: number;
}

function summarizeServiceEntry(entry: IsdbServiceEntry) {
  return {
    proto: PROTO_NAMES[entry.proto] ?? entry.proto,
    ip_range: formatIpRange(entry.ip_range),
    ports: (entry.port ?? []).map(formatPort),
    country_id: entry.country_id,
    reputation: entry.reputation,
    popularity: entry.popularity,
  };
}

function summarizeLookupResult(result: BatchResult) {
  if (result.status === "error") {
    return {
      target: result.target,
      status: result.status,
      error: result.error,
    };
  }
  if (result.status !== "done" || !result.data) {
    return {
      target: result.target,
      status: result.status,
    };
  }

  const data = result.data;
  return {
    target: result.target,
    status: result.status,
    ip: data.ip,
    resolved_from_fqdn: data.resolved_from_fqdn,
    geo_country: countryName(data.geoip.location),
    reverse_dns: data.reverse_dns.domain ?? null,
    service_match_count: data.matches.services.length,
    service_matches: data.matches.services.slice(0, 10).map((service) => ({
      id: service.id,
      name: service.name,
      owner: service.owner?.name,
      reputation: service.reputation,
      popularity: service.popularity,
    })),
    match_error: data.matches.match_error,
    reputation_error: data.matches.reputation_error,
  };
}

function parseTargets(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ];
}

const PROTO_NAMES: Record<number, string> = {
  1: "ICMP",
  6: "TCP",
  17: "UDP",
  47: "GRE",
  50: "ESP",
  51: "AH",
  58: "ICMPv6",
  132: "SCTP",
};

function formatPort(p: { start_port: number; end_port: number }): string {
  return p.start_port === p.end_port
    ? String(p.start_port)
    : `${p.start_port}\u2013${p.end_port}`;
}

function formatIpRange(r: { start_ip: string; end_ip: string }): string {
  return r.start_ip === r.end_ip
    ? r.start_ip
    : `${r.start_ip} \u2013 ${r.end_ip}`;
}

/* ------------------------------------------------------------------ */
/* IP lookup render helpers                                            */
/* ------------------------------------------------------------------ */

/** Reputation on FortiGuard's 0-5 trust scale, rendered as five pips
 *  so the user can glance at risk without reading a number. */
function ReputationPips({ value }: { value: number | undefined }) {
  if (typeof value !== "number") {
    return <span className="text-slate-600">—</span>;
  }
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`Reputation ${value}/5`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`inline-block h-1.5 w-2.5 rounded-sm ${
            i < filled ? "bg-emerald-400/80" : "bg-slate-800"
          }`}
        />
      ))}
    </span>
  );
}

/** Popularity on the same 0-5 scale but rendered as a filled bar. */
function PopularityBar({ value }: { value: number | undefined }) {
  if (typeof value !== "number") {
    return <span className="text-slate-600">—</span>;
  }
  const pct = Math.max(0, Math.min(5, value)) * 20;
  return (
    <span
      className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-800"
      title={`Popularity ${value}/5`}
    >
      <span
        className="block h-full bg-cyan-500/80"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

function countryName(loc: IsdbLookupResponse["geoip"]["location"]): string | null {
  const country = loc?.country;
  if (!country) return null;
  const en = country.names?.en;
  return en || country.iso_code || null;
}

function cityName(loc: IsdbLookupResponse["geoip"]["location"]): string | null {
  const city = loc?.city;
  if (!city) return null;
  return city.names?.en || null;
}

function subdivisionName(
  loc: IsdbLookupResponse["geoip"]["location"],
): string | null {
  const subs = loc?.subdivisions;
  if (!Array.isArray(subs) || subs.length === 0) return null;
  const top = subs[0];
  return top?.names?.en || top?.iso_code || null;
}

/* ------------------------------------------------------------------ */
/* IP lookup card                                                      */
/* ------------------------------------------------------------------ */
function LookupCard({ data, device }: { data: IsdbLookupResponse; device: string }) {
  const loc = data.geoip.location;
  const geoCountry = countryName(loc);
  const geoCity = cityName(loc);
  const geoSub = subdivisionName(loc);
  const geoCoords = loc?.location
    ? `${loc.location.latitude?.toFixed(3)}, ${loc.location.longitude?.toFixed(3)}`
    : null;
  const geoTz = loc?.location?.time_zone ?? null;
  const geoPostal = loc?.postal?.code ?? null;

  const services = data.matches.services;

  const [expandedServices, setExpandedServices] = useState<
    Map<number, ServiceDetailState>
  >(new Map());

  const handleToggleService = useCallback(
    async (service: IsdbServiceMatch) => {
      const sid = service.id;
      let wasExpanded = false;
      setExpandedServices((prev) => {
        if (prev.has(sid)) {
          wasExpanded = true;
          const next = new Map(prev);
          next.delete(sid);
          return next;
        }
        const next = new Map(prev);
        next.set(sid, {
          total: null,
          entries: [],
          loading: true,
          error: null,
          loadedCount: 0,
        });
        return next;
      });
      if (wasExpanded) return;
      try {
        const [summary, firstPage] = await Promise.all([
          fetchIsdbServiceDetails(device, sid, { summaryOnly: true }),
          fetchIsdbServiceDetails(device, sid, { start: 0, count: 1000 }),
        ]);
        setExpandedServices((prev) => {
          const next = new Map(prev);
          next.set(sid, {
            total: summary.total ?? firstPage.entries?.length ?? 0,
            entries: firstPage.entries ?? [],
            loading: false,
            error: null,
            loadedCount: firstPage.entries?.length ?? 0,
          });
          return next;
        });
      } catch (err) {
        setExpandedServices((prev) => {
          const next = new Map(prev);
          next.set(sid, {
            total: null,
            entries: [],
            loading: false,
            error:
              err instanceof Error ? err.message : "Failed to load details",
            loadedCount: 0,
          });
          return next;
        });
      }
    },
    [device],
  );

  const handleLoadMore = useCallback(
    async (serviceId: number) => {
      let startOffset = 0;
      let found = false;
      setExpandedServices((prev) => {
        const current = prev.get(serviceId);
        if (!current) return prev;
        found = true;
        startOffset = current.loadedCount;
        const next = new Map(prev);
        next.set(serviceId, { ...current, loading: true });
        return next;
      });
      if (!found) return;
      try {
        const page = await fetchIsdbServiceDetails(device, serviceId, {
          start: startOffset,
          count: 1000,
        });
        setExpandedServices((prev) => {
          const existing = prev.get(serviceId);
          if (!existing) return prev;
          const newEntries = [...existing.entries, ...(page.entries ?? [])];
          const next = new Map(prev);
          next.set(serviceId, {
            ...existing,
            entries: newEntries,
            loading: false,
            loadedCount: newEntries.length,
          });
          return next;
        });
      } catch (err) {
        setExpandedServices((prev) => {
          const existing = prev.get(serviceId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(serviceId, {
            ...existing,
            loading: false,
            error:
              err instanceof Error ? err.message : "Failed to load more",
          });
          return next;
        });
      }
    },
    [device],
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
      {/* Header strip — input echo + resolved IP + reverse DNS */}
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Lookup
            </div>
            <div className="mt-0.5 flex items-baseline gap-2 font-mono text-lg text-white">
              <span>{data.ip}</span>
              <span className="text-[10px] font-sans uppercase tracking-wide text-slate-500">
                {data.is_ipv6 ? "ipv6" : "ipv4"}
              </span>
            </div>
            {data.resolved_from_fqdn && (
              <div className="mt-1 text-xs text-slate-500">
                resolved from{" "}
                <span className="font-mono text-slate-300">
                  {data.resolved_from_fqdn}
                </span>
              </div>
            )}
            {data.reverse_dns.ok && data.reverse_dns.resolved && data.reverse_dns.domain && (
              <div className="mt-1 text-xs text-slate-500">
                reverse DNS{" "}
                <span className="font-mono text-cyan-300">
                  {data.reverse_dns.domain}
                </span>
              </div>
            )}
            {data.reverse_dns.ok &&
              (!data.reverse_dns.resolved || !data.reverse_dns.domain) && (
                <div className="mt-1 text-[11px] text-slate-600">
                  reverse DNS: no record
                </div>
              )}
            {!data.reverse_dns.ok && data.reverse_dns.error && (
              <div className="mt-1 text-[11px] text-red-400">
                reverse DNS failed: {data.reverse_dns.error}
              </div>
            )}
          </div>
          {data.cached && (
            <span
              className="inline-flex items-center rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-500"
              title="Served from backend cache"
            >
              cache
            </span>
          )}
        </div>
      </div>

      {/* GeoIP strip */}
      {data.geoip.ok ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-slate-800 bg-slate-950/40 px-5 py-3 text-[11px]">
          {geoCountry && (
            <GeoItem label="Country">
              <span className="text-slate-200">{geoCountry}</span>
              {loc?.country?.iso_code && (
                <span className="ml-1 text-slate-600">
                  ({loc.country.iso_code})
                </span>
              )}
            </GeoItem>
          )}
          {(geoCity || geoSub) && (
            <GeoItem label="Region">
              <span className="text-slate-200">
                {[geoCity, geoSub].filter(Boolean).join(", ")}
              </span>
            </GeoItem>
          )}
          {geoPostal && (
            <GeoItem label="Postal">
              <span className="font-mono text-slate-300">{geoPostal}</span>
            </GeoItem>
          )}
          {geoCoords && (
            <GeoItem label="Coords">
              <span className="font-mono text-slate-300 tabular-nums">
                {geoCoords}
              </span>
            </GeoItem>
          )}
          {geoTz && (
            <GeoItem label="Timezone">
              <span className="font-mono text-slate-300">{geoTz}</span>
            </GeoItem>
          )}
          {data.geoip.fallback && (
            <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300">
              fallback
            </span>
          )}
        </div>
      ) : data.geoip.error ? (
        <div className="border-b border-slate-800 px-5 py-3 text-[11px] text-red-400">
          GeoIP lookup failed: {data.geoip.error}
        </div>
      ) : null}

      {/* Matched services */}
      <div className="px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Matched Internet Services
          </div>
          <div className="text-[10px] text-slate-600">
            {services.length} {services.length === 1 ? "service" : "services"}
          </div>
        </div>

        {data.matches.match_error && (
          <div className="mb-2 text-[10px] text-amber-300">
            match call failed: {data.matches.match_error}
          </div>
        )}
        {data.matches.reputation_error && (
          <div className="mb-2 text-[10px] text-amber-300">
            reputation call failed: {data.matches.reputation_error}
          </div>
        )}

        {services.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-xs text-slate-500">
            This IP is not part of any FortiGuard internet service.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-slate-950/60">
                  <Th>Service</Th>
                  <Th className="w-24">Reputation</Th>
                  <Th className="w-24">Popularity</Th>
                  <Th className="w-32">Owner</Th>
                  <Th className="w-24">Flags</Th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    detail={expandedServices.get(s.id)}
                    onToggle={() => handleToggleService(s)}
                    onLoadMore={() => handleLoadMore(s.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function GeoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </span>
      {children}
    </span>
  );
}

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}

function ServiceEntryTable({
  detail,
  onLoadMore,
}: {
  detail: ServiceDetailState;
  onLoadMore: () => void;
}) {
  const { total, entries, loading, error, loadedCount } = detail;
  return (
    <div className="border-t border-cyan-900/40 bg-slate-950/60 px-3 py-3">
      <div className="mb-2 flex items-center justify-between text-[10px]">
        <span className="font-semibold uppercase tracking-wider text-slate-500">
          IP Range Entries
        </span>
        {total !== null && (
          <span className="tabular-nums text-slate-500">
            {loadedCount.toLocaleString()} of {total.toLocaleString()} loaded
          </span>
        )}
      </div>
      {error && (
        <div className="mb-2 rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      )}
      {entries.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-800/60">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-900/80">
                <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                  Proto
                </th>
                <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                  IP Range
                </th>
                <th className="px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                  Ports
                </th>
                <th className="w-16 px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                  Country
                </th>
                <th className="w-20 px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                  Rep
                </th>
                <th className="w-20 px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                  Pop
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={i}
                  className="border-t border-slate-800/40 hover:bg-slate-900/30"
                >
                  <td className="px-2 py-1 font-mono text-slate-300">
                    {PROTO_NAMES[entry.proto] ?? entry.proto}
                  </td>
                  <td className="px-2 py-1 font-mono text-slate-200">
                    {formatIpRange(entry.ip_range)}
                  </td>
                  <td className="px-2 py-1 font-mono text-slate-300">
                    {entry.port.map(formatPort).join(", ")}
                  </td>
                  <td className="px-2 py-1 tabular-nums text-slate-400">
                    {entry.country_id}
                  </td>
                  <td className="px-2 py-1">
                    <ReputationPips value={entry.reputation} />
                  </td>
                  <td className="px-2 py-1">
                    <PopularityBar value={entry.popularity} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total !== null && loadedCount < total && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="mt-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-cyan-700/60 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading
            ? "Loading\u2026"
            : `Load next ${Math.min(1000, total - loadedCount).toLocaleString()} entries`}
        </button>
      )}
      {loading && entries.length === 0 && (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
          <div className="h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-cyan-400" />
          Loading entries\u2026
        </div>
      )}
    </div>
  );
}

function ServiceRow({
  service,
  detail,
  onToggle,
  onLoadMore,
}: {
  service: IsdbServiceMatch;
  detail?: ServiceDetailState;
  onToggle: () => void;
  onLoadMore: () => void;
}) {
  const hasBotnet =
    typeof service.botnet_id === "number" && service.botnet_id > 0;
  const hasBlocklist =
    Array.isArray(service.blocklist) && service.blocklist.length > 0;
  const expanded = !!detail;
  return (
    <>
      <tr
        className={`border-t border-slate-800/60 cursor-pointer transition ${
          expanded ? "bg-slate-900/60" : "hover:bg-slate-900/40"
        }`}
        onClick={onToggle}
      >
        <td className="px-3 py-2 align-top">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[9px] text-slate-600 transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              ▶
            </span>
            <div>
              <div className="font-mono text-[12px] text-slate-200">
                {service.name ?? `service #${service.id}`}
              </div>
              <div className="text-[10px] text-slate-600">
                id {service.id}
                {typeof service.num_matched_services === "number" &&
                  service.num_matched_services > 1 && (
                    <> · {service.num_matched_services} variants</>
                  )}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 align-top">
          <ReputationPips value={service.reputation} />
        </td>
        <td className="px-3 py-2 align-top">
          <PopularityBar value={service.popularity} />
        </td>
        <td className="px-3 py-2 align-top text-slate-300">
          {service.owner?.name ? (
            <span className="font-mono text-[11px]">{service.owner.name}</span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
        <td className="px-3 py-2 align-top">
          <div className="flex flex-wrap gap-1">
            {hasBotnet && (
              <span className="inline-flex items-center rounded border border-red-800/60 bg-red-950/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-300">
                botnet
              </span>
            )}
            {hasBlocklist && (
              <span className="inline-flex items-center rounded border border-amber-800/60 bg-amber-950/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
                blocklist
              </span>
            )}
            {!hasBotnet && !hasBlocklist && (
              <span className="text-[10px] text-slate-600">—</span>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="p-0">
            <ServiceEntryTable detail={detail!} onLoadMore={onLoadMore} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
interface Row extends IsdbFqdnGroup {
  vendor: string;
  product: string;
  _haystack: string;
}

export default function InternetServicesPage(): ReactNode {
  const { setPageContext, clearPageContext } = useChatContext();
  const [devices, setDevices] = useState<IsdbDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const [selectedDevice, setSelectedDevice] = useState<string | null>(() =>
    loadSelectedDevice(),
  );
  const [catalog, setCatalog] = useState<IsdbFqdnCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // ISDB service catalog — full list of internet services
  const [svcCatalog, setSvcCatalog] = useState<IsdbServiceCatalog | null>(null);
  const [svcCatalogLoading, setSvcCatalogLoading] = useState(false);
  const [svcCatalogError, setSvcCatalogError] = useState<string | null>(null);
  const [svcSearch, setSvcSearch] = useState("");
  const [svcExpanded, setSvcExpanded] = useState<
    Map<number, ServiceDetailState>
  >(new Map());

  const [search, setSearch] = useState("");

  // IP lookup state. Input stays editable during a lookup so the
  // operator can queue a second query on submit. `lookup` is the last
  // successful response; we keep it on the page until explicitly
  // cleared so the results card doesn't flash on re-query.
  const [lookupInput, setLookupInput] = useState("");
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const lookupTargets = useMemo(() => parseTargets(lookupInput), [lookupInput]);

  // Fetch managed devices on mount. We keep the selected device even if
  // it's not in the current list (stale localStorage) so the operator can
  // tell us what happened — dropping silently is worse than a red badge.
  useEffect(() => {
    let cancelled = false;
    setDevicesLoading(true);
    setDevicesError(null);
    fetchIsdbDevices()
      .then((list) => {
        if (cancelled) return;
        setDevices(list);
        // If no device is selected, pick the first ONLINE FortiGate.
        if (!selectedDevice) {
          const firstUp = list.find((d) => d.conn_status === "up");
          const pick = firstUp ?? list[0];
          if (pick) {
            setSelectedDevice(pick.name);
            saveSelectedDevice(pick.name);
          }
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setDevicesError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch both catalogs whenever the selected device changes.
  useEffect(() => {
    if (!selectedDevice) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    fetchIsdbFqdnCatalog(selectedDevice)
      .then((data) => {
        if (cancelled) return;
        setCatalog(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setCatalogError(e.message);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    setSvcCatalogLoading(true);
    setSvcCatalogError(null);
    fetchIsdbCatalog(selectedDevice)
      .then((data) => {
        if (cancelled) return;
        setSvcCatalog(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setSvcCatalogError(e.message);
      })
      .finally(() => {
        if (!cancelled) setSvcCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDevice]);

  const handleDeviceChange = useCallback((name: string) => {
    setSelectedDevice(name);
    saveSelectedDevice(name);
    setCatalog(null);
    setCatalogError(null);
    setSvcCatalog(null);
    setSvcCatalogError(null);
    setSvcExpanded(new Map());
    setBatchResults([]);
    setLookupError(null);
  }, []);

  const handleRefresh = useCallback(() => {
    if (!selectedDevice) return;
    setCatalogLoading(true);
    setCatalogError(null);
    fetchIsdbFqdnCatalog(selectedDevice, "root", true)
      .then((data) => setCatalog(data))
      .catch((e: Error) => setCatalogError(e.message))
      .finally(() => setCatalogLoading(false));
  }, [selectedDevice]);

  const handleSvcRefresh = useCallback(() => {
    if (!selectedDevice) return;
    setSvcCatalogLoading(true);
    setSvcCatalogError(null);
    fetchIsdbCatalog(selectedDevice, "root", true)
      .then((data) => setSvcCatalog(data))
      .catch((e: Error) => setSvcCatalogError(e.message))
      .finally(() => setSvcCatalogLoading(false));
  }, [selectedDevice]);

  const handleToggleSvcExpand = useCallback(
    async (svcId: number) => {
      if (!selectedDevice) return;
      let wasExpanded = false;
      setSvcExpanded((prev) => {
        if (prev.has(svcId)) {
          wasExpanded = true;
          const next = new Map(prev);
          next.delete(svcId);
          return next;
        }
        const next = new Map(prev);
        next.set(svcId, {
          total: null,
          entries: [],
          loading: true,
          error: null,
          loadedCount: 0,
        });
        return next;
      });
      if (wasExpanded) return;
      try {
        const [summary, firstPage] = await Promise.all([
          fetchIsdbServiceDetails(selectedDevice, svcId, { summaryOnly: true }),
          fetchIsdbServiceDetails(selectedDevice, svcId, { start: 0, count: 1000 }),
        ]);
        setSvcExpanded((prev) => {
          const next = new Map(prev);
          next.set(svcId, {
            total: summary.total ?? firstPage.entries?.length ?? 0,
            entries: firstPage.entries ?? [],
            loading: false,
            error: null,
            loadedCount: firstPage.entries?.length ?? 0,
          });
          return next;
        });
      } catch (err) {
        setSvcExpanded((prev) => {
          const next = new Map(prev);
          next.set(svcId, {
            total: null,
            entries: [],
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load details",
            loadedCount: 0,
          });
          return next;
        });
      }
    },
    [selectedDevice],
  );

  const handleSvcLoadMore = useCallback(
    async (svcId: number) => {
      if (!selectedDevice) return;
      const current = svcExpanded.get(svcId);
      if (!current) return;
      try {
        const page = await fetchIsdbServiceDetails(selectedDevice, svcId, {
          start: current.loadedCount,
          count: 1000,
        });
        setSvcExpanded((prev) => {
          const next = new Map(prev);
          const c = next.get(svcId);
          if (!c) return next;
          next.set(svcId, {
            ...c,
            entries: [...c.entries, ...(page.entries ?? [])],
            loadedCount: c.loadedCount + (page.entries?.length ?? 0),
          });
          return next;
        });
      } catch {
        /* best-effort — user can retry */
      }
    },
    [selectedDevice, svcExpanded],
  );

  const handleLookup = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!selectedDevice) return;
      const targets = parseTargets(lookupInput);
      if (targets.length === 0) return;

      const initial: BatchResult[] = targets.map((t) => ({
        target: t,
        status: "pending" as const,
      }));
      setBatchResults(initial);
      setLookupLoading(true);
      setLookupError(null);

      let nextIdx = 0;
      const concurrency = 5;

      async function worker() {
        while (nextIdx < targets.length) {
          const idx = nextIdx++;
          const target = targets[idx];
          setBatchResults((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], status: "loading" };
            return next;
          });
          try {
            const data = await fetchIsdbIpLookup(selectedDevice!, target);
            setBatchResults((prev) => {
              const next = [...prev];
              next[idx] = { target, status: "done", data };
              return next;
            });
          } catch (err) {
            setBatchResults((prev) => {
              const next = [...prev];
              next[idx] = {
                target,
                status: "error",
                error:
                  err instanceof Error ? err.message : "Lookup failed",
              };
              return next;
            });
          }
        }
      }

      const workers = Array.from(
        { length: Math.min(concurrency, targets.length) },
        () => worker(),
      );
      await Promise.all(workers);
      setLookupLoading(false);
    },
    [selectedDevice, lookupInput],
  );

  const handleClearLookup = useCallback(() => {
    setBatchResults([]);
    setLookupError(null);
    setLookupInput("");
  }, []);

  // Derived rows: precompute vendor/product split + a flat haystack
  // for the search filter. Sorting defaults to vendor ascending.
  const rows: Row[] = useMemo(() => {
    if (!catalog) return [];
    return catalog.groups
      .map((g) => {
        const parsed = parseGroupName(g.name);
        return {
          ...g,
          vendor: parsed.vendor,
          product: parsed.product,
          _haystack: `${g.name} ${g.fqdns.join(" ")}`.toLowerCase(),
        };
      })
      .sort((a, b) => {
        // Primary by vendor (empty vendor goes to the end), secondary
        // by product so GRP-Google-Gmail < Google-Drive.
        if (!a.vendor && b.vendor) return 1;
        if (a.vendor && !b.vendor) return -1;
        const v = a.vendor.localeCompare(b.vendor);
        if (v !== 0) return v;
        return a.product.localeCompare(b.product);
      });
  }, [catalog]);

  const filteredRows: Row[] = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => r._haystack.includes(q));
  }, [rows, search]);

  const totalFqdnsInView = useMemo(
    () => filteredRows.reduce((acc, r) => acc + r.fqdns.length, 0),
    [filteredRows],
  );

  // Service catalog: filtered + paginated rows
  const svcPage = 100;
  const [svcPageNum, setSvcPageNum] = useState(1);
  const svcFiltered = useMemo(() => {
    const all = svcCatalog?.services ?? [];
    if (!svcSearch.trim()) return all;
    const q = svcSearch.trim().toLowerCase();
    return all.filter((s) => {
      const hay = [s.name, String(s["internet-service-id"]), s.type ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [svcCatalog, svcSearch]);

  const svcTotalPages = Math.max(1, Math.ceil(svcFiltered.length / svcPage));
  const svcSafePage = Math.min(svcPageNum, svcTotalPages);
  const svcPaginated = useMemo(
    () => svcFiltered.slice((svcSafePage - 1) * svcPage, svcSafePage * svcPage),
    [svcFiltered, svcSafePage],
  );

  // Reset page when search changes
  useEffect(() => { setSvcPageNum(1); }, [svcSearch]);

  useEffect(() => {
    return () => clearPageContext("reference:internet-services");
  }, [clearPageContext]);

  useEffect(() => {
    setPageContext({
      id: "reference:internet-services",
      kind: "internet_services",
      label: "Internet Service Database",
      data: {
        selected_device: selectedDevice,
        devices_loading: devicesLoading,
        device_count: devices.length,
        online_devices: devices
          .filter((device) => device.conn_status === "up")
          .map((device) => device.name),
        lookup: {
          targets: lookupTargets.slice(0, 20),
          loading: lookupLoading,
          error: lookupError,
          result_count: batchResults.length,
          results: batchResults.slice(0, 20).map(summarizeLookupResult),
        },
        fqdn_catalog: {
          loaded: !!catalog,
          loading: catalogLoading,
          error: catalogError,
          group_count: catalog?.group_count ?? 0,
          fqdn_count: catalog?.fqdn_count ?? 0,
          search,
          filtered_group_count: filteredRows.length,
          fqdns_in_view: totalFqdnsInView,
          group_sample: filteredRows.slice(0, 5).map((row) => ({
            name: row.name,
            vendor: row.vendor,
            product: row.product,
            fqdn_count: row.fqdns.length,
            fqdn_sample: row.fqdns.slice(0, 15),
          })),
        },
        service_catalog: {
          loaded: !!svcCatalog,
          loading: svcCatalogLoading,
          error: svcCatalogError,
          service_count: svcCatalog?.service_count ?? 0,
          search: svcSearch,
          filtered_service_count: svcFiltered.length,
          page: svcSafePage,
          page_size: svcPage,
          service_sample: svcPaginated.slice(0, 10).map((svc) => ({
            name: svc.name,
            internet_service_id: svc["internet-service-id"],
            type: svc.type ?? null,
          })),
        },
        expanded_services: Array.from(svcExpanded.entries())
          .slice(0, 10)
          .map(([id, detail]) => ({
            internet_service_id: id,
            loaded_count: detail.loadedCount,
            total: detail.total,
            error: detail.error,
            entry_sample: detail.entries.slice(0, 10).map(summarizeServiceEntry),
          })),
      },
    });
  }, [
    batchResults,
    catalog,
    catalogError,
    catalogLoading,
    clearPageContext,
    devices,
    devicesLoading,
    filteredRows,
    lookupError,
    lookupLoading,
    lookupTargets,
    search,
    selectedDevice,
    setPageContext,
    svcCatalog,
    svcCatalogError,
    svcCatalogLoading,
    svcExpanded,
    svcFiltered.length,
    svcPaginated,
    svcSafePage,
    svcSearch,
    totalFqdnsInView,
  ]);

  /* ---------------------------------------------------------------- */
  /* Column definitions                                                */
  /* ---------------------------------------------------------------- */
  const columns: DataGridColumn<Row>[] = useMemo(
    () => [
      {
        key: "vendor",
        header: <span>Vendor</span>,
        width: "minmax(140px, 0.9fr)",
        render: (row) =>
          row.vendor ? (
            <span className="font-medium text-slate-200">
              <Highlight text={row.vendor} query={search} />
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          ),
      },
      {
        key: "product",
        header: <span>Service</span>,
        width: "minmax(160px, 1.2fr)",
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate text-slate-200">
              <Highlight
                text={row.product || row.name}
                query={search}
              />
            </div>
            <div className="truncate text-[10px] font-mono text-slate-600">
              {row.name}
            </div>
          </div>
        ),
      },
      {
        key: "count",
        header: <span>FQDNs</span>,
        width: "minmax(70px, 0.35fr)",
        render: (row) => (
          <span className="inline-flex items-center rounded bg-slate-900/80 px-1.5 py-0.5 text-[11px] font-mono text-slate-300 tabular-nums">
            {row.fqdns.length}
          </span>
        ),
      },
      {
        key: "fqdns",
        header: <span>Entries</span>,
        width: "minmax(320px, 3fr)",
        render: (row) => <FqdnChips fqdns={row.fqdns} />,
      },
    ],
    [search],
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-[1600px] px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <Link
            href="/"
            className="text-xs text-slate-500 transition hover:text-cyan-400"
          >
            ← Back to dashboard
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold">Internet Service Database</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                FortiGuard&apos;s internet service catalog — IP lookup,
                FQDN groups, and the full service directory. FortiManager
                doesn&apos;t host these APIs directly, so lookups are
                proxied through a managed FortiGate of your choice.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              {devicesLoading ? (
                <div className="text-xs text-slate-500">Loading devices…</div>
              ) : devicesError ? (
                <div className="text-xs text-red-400">{devicesError}</div>
              ) : (
                <DevicePicker
                  devices={devices}
                  selected={selectedDevice}
                  onSelect={handleDeviceChange}
                />
              )}
            </div>
          </div>
        </div>

        {/* IP lookup section */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              IP lookup
            </h2>
            <div className="text-[10px] text-slate-600">
              reverse DNS · GeoIP · ISDB match + reputation
            </div>
          </div>
          <form
            onSubmit={handleLookup}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-start gap-2">
              <textarea
                value={lookupInput}
                onChange={(e) => setLookupInput(e.target.value)}
                placeholder={"IP addresses or FQDNs \u2014 one per line or comma-separated\ne.g. 1.1.1.1, google.com, 8.8.8.8"}
                rows={3}
                className="w-96 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/60 focus:outline-none resize-y"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleLookup();
                  }
                }}
              />
              <div className="flex flex-col gap-1.5">
                <button
                  type="submit"
                  disabled={!selectedDevice || !lookupInput.trim() || lookupLoading}
                  className="rounded-lg border border-cyan-700/60 bg-cyan-950/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-300 transition hover:border-cyan-500 hover:text-cyan-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-600"
                >
                  {lookupLoading ? "Looking up\u2026" : "Lookup"}
                </button>
                {(batchResults.length > 0 || lookupError) && (
                  <button
                    type="button"
                    onClick={handleClearLookup}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            {!selectedDevice && (
              <span className="text-[11px] text-slate-600">
                Select a FortiGate to enable lookups.
              </span>
            )}
            {lookupLoading && batchResults.length > 1 && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <div className="h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-cyan-400" />
                {batchResults.filter(
                  (r) => r.status === "done" || r.status === "error",
                ).length}{" "}
                / {batchResults.length} completed
              </div>
            )}
          </form>
          {lookupError && (
            <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {lookupError}
            </div>
          )}
          {batchResults.map((result, i) => (
            <div key={`${result.target}-${i}`}>
              {result.status === "loading" && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4 text-xs text-slate-400">
                  <div className="h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-cyan-400" />
                  Looking up{" "}
                  <span className="font-mono text-slate-300">
                    {result.target}
                  </span>
                  {"\u2026"}
                </div>
              )}
              {result.status === "error" && (
                <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                  <span className="font-mono text-red-300">
                    {result.target}
                  </span>{" "}
                  {"\u2014"} {result.error}
                </div>
              )}
              {result.status === "done" && result.data && (
                <LookupCard data={result.data} device={selectedDevice!} />
              )}
            </div>
          ))}
        </section>

        {/* FQDN catalog section header */}
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            FQDN catalog
          </h2>
          <div className="text-[10px] text-slate-600">
            FortiGuard SaaS FQDN groups
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups, vendors, or FQDNs…"
            className="w-72 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!selectedDevice || catalogLoading}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-600/60 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            title="Bypass cache and re-fetch from FMG"
          >
            {catalogLoading ? "Refreshing…" : "Refresh"}
          </button>
          {catalog && (
            <div className="ml-auto text-xs tabular-nums text-slate-500">
              <span className="text-slate-300">
                {filteredRows.length}
              </span>{" "}
              of {catalog.group_count} groups ·{" "}
              <span className="text-slate-300">{totalFqdnsInView}</span>{" "}
              FQDNs shown{" "}
              {catalog.cached && (
                <span
                  className="ml-2 inline-flex items-center rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-500"
                  title="Served from backend cache"
                >
                  cache
                </span>
              )}
            </div>
          )}
        </div>

        {/* Errors / empty states */}
        {catalogError && (
          <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {catalogError}
          </div>
        )}

        {!selectedDevice && !devicesLoading && !devicesError && (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/20 px-6 py-16 text-center text-sm text-slate-500">
            Select a FortiGate from the header to proxy your ISDB lookups.
          </div>
        )}

        {/* Catalog grid */}
        {selectedDevice && !catalogError && (
          <>
            {catalogLoading && !catalog ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-12 text-sm text-slate-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
                Fetching FQDN catalog from {selectedDevice}…
              </div>
            ) : catalog ? (
              <DataGrid
                columns={columns}
                rows={filteredRows}
                rowKey={(r) => r.name}
                clampLines={2}
                emptyState={
                  search
                    ? "No groups or FQDNs match your search."
                    : "The catalog is empty. Is FortiGuard ISDB licensed on this device?"
                }
              />
            ) : null}
          </>
        )}

        {/* ------------------------------------------------------------ */}
        {/* Service catalog — browseable list of all ISDB entries         */}
        {/* ------------------------------------------------------------ */}
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Service catalog
          </h2>
          <div className="text-[10px] text-slate-600">
            All FortiGuard internet services
          </div>
        </div>

        {/* Service catalog toolbar */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
          <input
            type="text"
            value={svcSearch}
            onChange={(e) => setSvcSearch(e.target.value)}
            placeholder="Search services by name or ID…"
            className="w-72 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSvcRefresh}
            disabled={!selectedDevice || svcCatalogLoading}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-600/60 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            title="Bypass cache and re-fetch"
          >
            {svcCatalogLoading ? "Refreshing…" : "Refresh"}
          </button>
          {svcCatalog && (
            <div className="ml-auto text-xs tabular-nums text-slate-500">
              <span className="text-slate-300">
                {svcFiltered.length}
              </span>{" "}
              of {svcCatalog.service_count} services
              {svcCatalog.cached && (
                <span
                  className="ml-2 inline-flex items-center rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-500"
                  title="Served from backend cache"
                >
                  cache
                </span>
              )}
            </div>
          )}
        </div>

        {svcCatalogError && (
          <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {svcCatalogError}
          </div>
        )}

        {/* Service catalog list */}
        {selectedDevice && !svcCatalogError && (
          <>
            {svcCatalogLoading && !svcCatalog ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-12 text-sm text-slate-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
                Fetching service catalog from {selectedDevice}…
              </div>
            ) : svcCatalog ? (
              <div className="space-y-px rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[minmax(0,3fr)_120px_100px] gap-px border-b border-slate-800 bg-slate-950/95 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sticky top-0 z-10 backdrop-blur">
                  <div>Name</div>
                  <div>Service ID</div>
                  <div>Type</div>
                </div>
                {svcPaginated.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-slate-500">
                    {svcSearch ? "No services match your search." : "No services found."}
                  </div>
                )}
                {svcPaginated.map((svc) => {
                  const sid = svc["internet-service-id"];
                  const detail = svcExpanded.get(sid);
                  const isExpanded = !!detail;
                  return (
                    <div key={sid}>
                      <div
                        className="grid grid-cols-[minmax(0,3fr)_120px_100px] gap-px px-4 py-2.5 text-left transition hover:bg-slate-800/20 border-b border-slate-900"
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleSvcExpand(sid)}
                          className="flex items-center gap-2 text-xs text-slate-200 text-left min-w-0"
                        >
                          <span
                            className={`text-[10px] text-slate-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          >
                            ▶
                          </span>
                          <span className="truncate">{svc.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleSvcExpand(sid)}
                          className="text-xs font-mono text-slate-500 tabular-nums text-left"
                        >
                          {sid}
                        </button>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleSvcExpand(sid)}
                            className="text-xs text-slate-500 text-left flex-1 min-w-0 truncate"
                          >
                            {svc.type ?? "—"}
                          </button>
                          <AddToChatContextButton
                            item={{
                              id: `isdb_service:${sid}`,
                              kind: "isdb_service",
                              label: `${svc.name} (id ${sid})`,
                              data: {
                                name: svc.name,
                                internet_service_id: sid,
                                type: svc.type ?? null,
                                loaded_entry_count: detail?.loadedCount ?? 0,
                                total_entries: detail?.total ?? null,
                                entry_sample: (detail?.entries ?? [])
                                  .slice(0, 20)
                                  .map(summarizeServiceEntry),
                              },
                            }}
                          />
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-b border-slate-800/60 bg-slate-900/30 px-6 py-3">
                          {detail.loading ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                              <div className="h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-cyan-400" />
                              Loading entries…
                            </div>
                          ) : detail.error ? (
                            <div className="text-xs text-red-400">{detail.error}</div>
                          ) : detail.entries.length === 0 ? (
                            <div className="text-xs text-slate-600 italic">
                              No IP-range entries for this service
                              {detail.total != null && ` (total: ${detail.total})`}.
                            </div>
                          ) : (
                            <>
                              <div className="mb-2 text-[10px] text-slate-500">
                                {detail.loadedCount.toLocaleString()} of{" "}
                                {(detail.total ?? 0).toLocaleString()} entries loaded
                              </div>
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                    <th className="px-2 py-1.5 text-left">Proto</th>
                                    <th className="px-2 py-1.5 text-left">IP Range</th>
                                    <th className="px-2 py-1.5 text-left">Ports</th>
                                    <th className="px-2 py-1.5 text-left">Country</th>
                                    <th className="px-2 py-1.5 text-left">Reputation</th>
                                    <th className="px-2 py-1.5 text-left">Popularity</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.entries.map((entry, i) => (
                                    <tr
                                      key={i}
                                      className="border-t border-slate-800/20 hover:bg-slate-800/20"
                                    >
                                      <td className="px-2 py-1.5 font-mono text-slate-400">
                                        {PROTO_NAMES[entry.proto] ?? entry.proto}
                                      </td>
                                      <td className="px-2 py-1.5 font-mono text-slate-300">
                                        {formatIpRange(entry.ip_range)}
                                      </td>
                                      <td className="px-2 py-1.5 font-mono text-slate-400">
                                        {(entry.port ?? []).map(formatPort).join(", ") || "—"}
                                      </td>
                                      <td className="px-2 py-1.5 text-slate-400">
                                        {entry.country_id || "—"}
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <ReputationPips value={entry.reputation} />
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <PopularityBar value={entry.popularity} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {detail.total != null &&
                                detail.loadedCount < detail.total && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSvcLoadMore(sid);
                                    }}
                                    className="mt-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-cyan-600/60 hover:text-cyan-300"
                                  >
                                    Load next{" "}
                                    {Math.min(
                                      1000,
                                      detail.total - detail.loadedCount,
                                    ).toLocaleString()}{" "}
                                    entries
                                  </button>
                                )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Service catalog pagination */}
            {svcCatalog && svcFiltered.length > svcPage && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => setSvcPageNum(1)}
                  disabled={svcSafePage <= 1}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ««
                </button>
                <button
                  onClick={() => setSvcPageNum((p) => Math.max(1, p - 1))}
                  disabled={svcSafePage <= 1}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ‹ Prev
                </button>
                <span className="text-xs text-slate-400 tabular-nums">
                  Page {svcSafePage} of {svcTotalPages}
                </span>
                <button
                  onClick={() => setSvcPageNum((p) => Math.min(svcTotalPages, p + 1))}
                  disabled={svcSafePage >= svcTotalPages}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next ›
                </button>
                <button
                  onClick={() => setSvcPageNum(svcTotalPages)}
                  disabled={svcSafePage >= svcTotalPages}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  »»
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
