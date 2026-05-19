"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchRouteViewerDevices,
  queryRouteViewerRoutes,
  type RouteViewerDevice,
  type RouteViewerResponse,
  type RouteViewerRoute,
} from "@/lib/api";
import { useChatContext } from "@/components/ChatContext";

type Phase = "loading" | "idle" | "running" | "complete" | "error";
type RouteKind = "all" | "default" | "connected" | "static" | "dynamic" | "gateway";
type SortKey =
  | "device"
  | "destination"
  | "gateway"
  | "distance"
  | "metric"
  | "interface"
  | "protocol"
  | "type"
  | "vrf"
  | "age";

interface Filters {
  query: string;
  device: string;
  iface: string;
  protocol: string;
  type: string;
  vrf: string;
  gateway: string;
  destination: string;
  kind: RouteKind;
}

const EMPTY_FILTERS: Filters = {
  query: "",
  device: "",
  iface: "",
  protocol: "",
  type: "",
  vrf: "",
  gateway: "",
  destination: "",
  kind: "all",
};

const ROUTE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "device", label: "Device" },
  { key: "destination", label: "Destination" },
  { key: "gateway", label: "Gateway" },
  { key: "distance", label: "Distance" },
  { key: "metric", label: "Metric" },
  { key: "interface", label: "Interface" },
  { key: "protocol", label: "Protocol" },
  { key: "type", label: "Type" },
  { key: "vrf", label: "VRF" },
  { key: "age", label: "Age" },
];

export default function RouteViewerPage() {
  const [devices, setDevices] = useState<RouteViewerDevice[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [deviceSearch, setDeviceSearch] = useState("");
  const [vdom, setVdom] = useState("root");
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteViewerResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "destination",
    dir: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { setPageContext, clearPageContext } = useChatContext();

  useEffect(() => {
    fetchRouteViewerDevices()
      .then((items) => {
        setDevices(items);
        if (items.length) {
          const firstOnline =
            items.find((item) => String(item.conn_status ?? "").toLowerCase() === "up") ??
            items[0];
          setSelectedDevices(new Set([firstOnline.name]));
        }
        setPhase("idle");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load FortiGate devices");
        setPhase("error");
      });
  }, []);

  useEffect(() => {
    return () => clearPageContext("tool:route-viewer");
  }, [clearPageContext]);

  const filteredDevices = useMemo(() => {
    const query = deviceSearch.trim().toLowerCase();
    if (!query) return devices;
    return devices.filter((device) =>
      [
        device.name,
        device.hostname,
        device.platform,
        device.os_version,
        device.ip,
        device.conn_status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [deviceSearch, devices]);

  const facets = useMemo(() => buildFacets(result?.routes ?? []), [result]);
  const filteredRoutes = useMemo(() => {
    const routes = filterRoutes(result?.routes ?? [], filters);
    return sortRoutes(routes, sort.key, sort.dir);
  }, [filters, result, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRoutes.length / pageSize));
  const visibleRoutes = filteredRoutes.slice((page - 1) * pageSize, page * pageSize);
  const filteredStats = useMemo(() => summarizeFiltered(filteredRoutes), [filteredRoutes]);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    setPageContext({
      id: "tool:route-viewer",
      kind: "fortigate_route_viewer",
      label: "FortiGate route viewer",
      data: {
        vdom,
        selected_devices: Array.from(selectedDevices),
        total_routes: result?.route_count ?? 0,
        filtered_routes: filteredRoutes.length,
        filters,
        summary: result?.summary ?? null,
        device_errors:
          result?.devices
            .filter((device) => device.error)
            .map((device) => ({ device: device.device, error: device.error })) ?? [],
      },
    });
  }, [filteredRoutes.length, filters, result, selectedDevices, setPageContext, vdom]);

  const canRun = selectedDevices.size > 0 && phase !== "running";

  const runQuery = async (refresh = false) => {
    if (!canRun) return;
    setPhase("running");
    setError(null);
    try {
      const data = await queryRouteViewerRoutes(
        Array.from(selectedDevices),
        vdom.trim() || "root",
        refresh,
      );
      setResult(data);
      setExpanded(new Set());
      setPhase("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Route collection failed");
      setPhase("error");
    }
  };

  const toggleDevice = (name: string) => {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const exportRows = (format: "csv" | "json") => {
    if (format === "json") {
      downloadText(
        "fortigate-routes.json",
        "application/json",
        JSON.stringify(
          {
            adom: result?.adom,
            vdom: result?.vdom ?? vdom,
            filters,
            count: filteredRoutes.length,
            routes: filteredRoutes,
          },
          null,
          2,
        ),
      );
      return;
    }
    downloadText("fortigate-routes.csv", "text/csv", routesToCsv(filteredRoutes));
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-[1900px] px-6 py-10">
        <div className="mb-6">
          <Link href="/tools" className="text-xs text-slate-500 hover:text-cyan-400">
            Back to tools
          </Link>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">FortiGate Route Viewer</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Collect IPv4 routing tables from FMG-managed FortiGates through
                the FortiManager proxy API and inspect them locally.
              </p>
            </div>
            {result && (
              <div className="text-xs text-slate-500 lg:text-right">
                <div>ADOM</div>
                <div className="font-semibold text-slate-300">{result.adom}</div>
              </div>
            )}
          </div>
        </div>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-200">Devices</h2>
                <span className="text-[11px] text-slate-600">
                  {selectedDevices.size}/{devices.length}
                </span>
              </div>
              <input
                value={deviceSearch}
                onChange={(event) => setDeviceSearch(event.target.value)}
                placeholder="Filter devices"
                className="mt-3 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-cyan-700"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDevices(new Set(filteredDevices.map((device) => device.name)))
                  }
                  className="rounded-md border border-slate-800 px-3 py-1.5 text-[11px] text-slate-300 hover:border-cyan-700"
                >
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDevices(new Set())}
                  className="rounded-md border border-slate-800 px-3 py-1.5 text-[11px] text-slate-300 hover:border-cyan-700"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDevices(
                      new Set(
                        devices
                          .filter(
                            (device) =>
                              String(device.conn_status ?? "").toLowerCase() === "up",
                          )
                          .map((device) => device.name),
                      ),
                    )
                  }
                  className="rounded-md border border-slate-800 px-3 py-1.5 text-[11px] text-slate-300 hover:border-cyan-700"
                >
                  Connected
                </button>
              </div>
              <div className="mt-4 max-h-[460px] space-y-2 overflow-auto pr-1">
                {filteredDevices.map((device) => (
                  <label
                    key={device.name}
                    className="block rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedDevices.has(device.name)}
                        onChange={() => toggleDevice(device.name)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-cyan-600"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-200">
                          {device.name}
                        </div>
                        <div className="mt-1 truncate text-slate-500">
                          {[device.hostname, device.platform, device.os_version]
                            .filter(Boolean)
                            .join(" / ") || "No device metadata"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-600">
                          {device.ip && <span>{device.ip}</span>}
                          {device.conn_status && <span>{device.conn_status}</span>}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Collection</h2>
              <label className="mt-4 block text-xs text-slate-500">
                VDOM
                <input
                  value={vdom}
                  onChange={(event) => setVdom(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-cyan-700"
                />
              </label>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => runQuery(false)}
                  disabled={!canRun}
                  className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
                >
                  {phase === "running" ? "Loading" : "Load routes"}
                </button>
                <button
                  type="button"
                  onClick={() => runQuery(true)}
                  disabled={!canRun}
                  className="rounded-md border border-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-cyan-700 hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-slate-700"
                >
                  Refresh
                </button>
              </div>
              <p className="mt-3 text-[11px] text-slate-600">
                Up to 25 devices per request. Results are cached for 60 seconds
                unless refreshed.
              </p>
            </div>
          </aside>

          <section className="min-w-0 space-y-5">
            {error && (
              <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {result ? (
              <>
                <SummaryStrip
                  totalRoutes={result.route_count}
                  filteredRoutes={filteredRoutes.length}
                  defaultRoutes={filteredStats.defaults}
                  deviceCount={result.device_count}
                  interfaces={Object.keys(filteredStats.interfaces).length}
                  vrfs={Object.keys(filteredStats.vrfs).length}
                  errors={result.summary.devices_with_errors}
                />
                <FilterPanel
                  filters={filters}
                  facets={facets}
                  pageSize={pageSize}
                  onFilter={setFilter}
                  onReset={() => setFilters(EMPTY_FILTERS)}
                  onPageSize={setPageSize}
                  onExport={exportRows}
                />
                <DeviceErrors devices={result.devices} />
                <RoutesTable
                  routes={visibleRoutes}
                  total={filteredRoutes.length}
                  page={page}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  sort={sort}
                  expanded={expanded}
                  onPage={setPage}
                  onSort={toggleSort}
                  onToggleExpanded={(id) =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
                {phase === "loading"
                  ? "Loading managed FortiGates..."
                  : "Select one or more devices and load routes."}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function SummaryStrip({
  totalRoutes,
  filteredRoutes,
  defaultRoutes,
  deviceCount,
  interfaces,
  vrfs,
  errors,
}: {
  totalRoutes: number;
  filteredRoutes: number;
  defaultRoutes: number;
  deviceCount: number;
  interfaces: number;
  vrfs: number;
  errors: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
      <SummaryMetric label="Routes" value={totalRoutes} />
      <SummaryMetric label="Filtered" value={filteredRoutes} />
      <SummaryMetric label="Devices" value={deviceCount} />
      <SummaryMetric label="Default" value={defaultRoutes} />
      <SummaryMetric label="Interfaces" value={interfaces} />
      <SummaryMetric label="VRFs" value={vrfs} />
      <SummaryMetric label="Errors" value={errors} />
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-600">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function FilterPanel({
  filters,
  facets,
  pageSize,
  onFilter,
  onReset,
  onPageSize,
  onExport,
}: {
  filters: Filters;
  facets: ReturnType<typeof buildFacets>;
  pageSize: number;
  onFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onReset: () => void;
  onPageSize: (value: number) => void;
  onExport: (format: "csv" | "json") => void;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FilterInput
          label="Search"
          value={filters.query}
          onChange={(value) => onFilter("query", value)}
          placeholder="Any route field"
        />
        <FilterInput
          label="Destination"
          value={filters.destination}
          onChange={(value) => onFilter("destination", value)}
          placeholder="10.0.0.0/8"
        />
        <FilterInput
          label="Gateway"
          value={filters.gateway}
          onChange={(value) => onFilter("gateway", value)}
          placeholder="Next hop"
        />
        <FilterSelect
          label="Route class"
          value={filters.kind}
          options={[
            ["all", "All routes"],
            ["default", "Default routes"],
            ["connected", "Connected"],
            ["static", "Static"],
            ["dynamic", "Dynamic"],
            ["gateway", "Has gateway"],
          ]}
          onChange={(value) => onFilter("kind", value as RouteKind)}
        />
        <FilterSelect
          label="Device"
          value={filters.device}
          options={facets.devices}
          onChange={(value) => onFilter("device", value)}
        />
        <FilterSelect
          label="Interface"
          value={filters.iface}
          options={facets.interfaces}
          onChange={(value) => onFilter("iface", value)}
        />
        <FilterSelect
          label="Protocol"
          value={filters.protocol}
          options={facets.protocols}
          onChange={(value) => onFilter("protocol", value)}
        />
        <FilterSelect
          label="Type"
          value={filters.type}
          options={facets.types}
          onChange={(value) => onFilter("type", value)}
        />
        <FilterSelect
          label="VRF"
          value={filters.vrf}
          options={facets.vrfs}
          onChange={(value) => onFilter("vrf", value)}
        />
        <FilterSelect
          label="Page size"
          value={String(pageSize)}
          options={["50", "100", "250", "500", "1000"]}
          onChange={(value) => onPageSize(Number(value))}
          includeAll={false}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
        >
          Clear filters
        </button>
        <button
          type="button"
          onClick={() => onExport("csv")}
          className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => onExport("json")}
          className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
        >
          Export JSON
        </button>
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-[11px] uppercase tracking-wide text-slate-600">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs normal-case tracking-normal text-slate-300 outline-none focus:border-cyan-700"
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  includeAll = true,
}: {
  label: string;
  value: string;
  options: string[] | [string, string][];
  onChange: (value: string) => void;
  includeAll?: boolean;
}) {
  return (
    <label className="block text-[11px] uppercase tracking-wide text-slate-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs normal-case tracking-normal text-slate-300 outline-none focus:border-cyan-700"
      >
        {includeAll && <option value="">All</option>}
        {options.map((option) => {
          const [optionValue, optionLabel] = Array.isArray(option)
            ? option
            : [option, option];
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function DeviceErrors({ devices }: { devices: RouteViewerResponse["devices"] }) {
  const failed = devices.filter((device) => device.error);
  if (!failed.length) return null;
  return (
    <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
      <div className="text-sm font-semibold text-amber-200">Device errors</div>
      <div className="mt-3 space-y-2">
        {failed.map((device) => (
          <div key={device.device} className="text-xs text-amber-100/80">
            <span className="font-semibold">{device.device}</span>: {device.error}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutesTable({
  routes,
  total,
  page,
  pageCount,
  pageSize,
  sort,
  expanded,
  onPage,
  onSort,
  onToggleExpanded,
}: {
  routes: RouteViewerRoute[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sort: { key: SortKey; dir: "asc" | "desc" };
  expanded: Set<string>;
  onPage: (page: number) => void;
  onSort: (key: SortKey) => void;
  onToggleExpanded: (id: string) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="flex flex-col gap-2 border-b border-slate-800 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <div>
          Showing {start.toLocaleString()}-{end.toLocaleString()} of{" "}
          {total.toLocaleString()} routes
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded-md border border-slate-800 px-3 py-1.5 text-slate-300 hover:border-cyan-700 disabled:text-slate-700"
          >
            Previous
          </button>
          <span>
            Page {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            className="rounded-md border border-slate-800 px-3 py-1.5 text-slate-300 hover:border-cyan-700 disabled:text-slate-700"
          >
            Next
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1120px] w-full text-left text-xs">
          <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-600">
            <tr>
              <th className="w-16 px-3 py-2 font-medium">Raw</th>
              {ROUTE_COLUMNS.map((column) => (
                <th key={column.key} className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className="flex items-center gap-1 text-left hover:text-cyan-300"
                  >
                    {column.label}
                    {sort.key === column.key && (
                      <span className="text-cyan-500">
                        {sort.dir === "asc" ? "up" : "down"}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <RouteRow
                key={route.id}
                route={route}
                expanded={expanded.has(route.id)}
                onToggle={() => onToggleExpanded(route.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {!routes.length && (
        <div className="px-4 py-8 text-center text-sm text-slate-600">
          No routes match the current filters.
        </div>
      )}
    </div>
  );
}

function RouteRow({
  route,
  expanded,
  onToggle,
}: {
  route: RouteViewerRoute;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-slate-800 align-top hover:bg-slate-900/60">
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
          >
            {expanded ? "Hide" : "Show"}
          </button>
        </td>
        <Cell>{route.device}</Cell>
        <Cell mono highlight={route.is_default}>
          {route.destination}
        </Cell>
        <Cell mono>{route.gateway || "-"}</Cell>
        <Cell>{formatValue(route.distance)}</Cell>
        <Cell>{formatValue(route.metric)}</Cell>
        <Cell>{route.interface || "-"}</Cell>
        <Cell>{route.protocol || "-"}</Cell>
        <Cell>{route.type || "-"}</Cell>
        <Cell>{route.vrf || "-"}</Cell>
        <Cell>{formatValue(route.age)}</Cell>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-800 bg-slate-950/70">
          <td colSpan={ROUTE_COLUMNS.length + 1} className="px-3 py-3">
            <pre className="max-h-80 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-400">
              {JSON.stringify(route.raw, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function Cell({
  children,
  mono = false,
  highlight = false,
}: {
  children: ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <td
      className={`max-w-[260px] px-3 py-2 ${
        mono ? "font-mono text-[11px]" : ""
      } ${highlight ? "text-cyan-200" : "text-slate-300"}`}
    >
      <span className="break-words">{children}</span>
    </td>
  );
}

function buildFacets(routes: RouteViewerRoute[]) {
  return {
    devices: unique(routes.map((route) => route.device)),
    interfaces: unique(routes.map((route) => route.interface || "unset")),
    protocols: unique(routes.map((route) => route.protocol || "unset")),
    types: unique(routes.map((route) => route.type || "unset")),
    vrfs: unique(routes.map((route) => route.vrf || "unset")),
  };
}

function filterRoutes(routes: RouteViewerRoute[], filters: Filters) {
  const query = filters.query.trim().toLowerCase();
  const gateway = filters.gateway.trim().toLowerCase();
  const destination = filters.destination.trim().toLowerCase();
  return routes.filter((route) => {
    if (filters.device && route.device !== filters.device) return false;
    if (filters.iface && (route.interface || "unset") !== filters.iface) return false;
    if (filters.protocol && (route.protocol || "unset") !== filters.protocol) return false;
    if (filters.type && (route.type || "unset") !== filters.type) return false;
    if (filters.vrf && (route.vrf || "unset") !== filters.vrf) return false;
    if (gateway && !route.gateway.toLowerCase().includes(gateway)) return false;
    if (
      destination &&
      ![route.destination, route.destination_raw, route.network ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(destination)
    ) {
      return false;
    }
    if (!matchesKind(route, filters.kind)) return false;
    if (!query) return true;
    return [
      route.device,
      route.vdom,
      route.destination,
      route.destination_raw,
      route.gateway,
      route.interface,
      route.protocol,
      route.type,
      route.vrf,
      route.flags,
      route.selected,
    ]
      .map((value) => String(value ?? "").toLowerCase())
      .some((value) => value.includes(query));
  });
}

function matchesKind(route: RouteViewerRoute, kind: RouteKind) {
  const protocol = `${route.protocol} ${route.type}`.toLowerCase();
  if (kind === "all") return true;
  if (kind === "default") return route.is_default;
  if (kind === "gateway") return Boolean(route.gateway);
  if (kind === "connected") {
    return protocol.includes("connected") || protocol.includes("direct");
  }
  if (kind === "static") return protocol.includes("static");
  if (kind === "dynamic") {
    return (
      !protocol.includes("static") &&
      !protocol.includes("connected") &&
      !protocol.includes("direct")
    );
  }
  return true;
}

function sortRoutes(routes: RouteViewerRoute[], key: SortKey, dir: "asc" | "desc") {
  const multiplier = dir === "asc" ? 1 : -1;
  return [...routes].sort((a, b) => compareValues(sortValue(a, key), sortValue(b, key)) * multiplier);
}

function sortValue(route: RouteViewerRoute, key: SortKey): string | number {
  if (key === "destination") {
    return `${String(route.prefix_length ?? "").padStart(3, "0")}:${route.destination}`;
  }
  const value = route[key];
  if (typeof value === "number") return value;
  return String(value ?? "");
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function summarizeFiltered(routes: RouteViewerRoute[]) {
  return {
    defaults: routes.filter((route) => route.is_default).length,
    interfaces: countMap(routes.map((route) => route.interface || "unset")),
    vrfs: countMap(routes.map((route) => route.vrf || "unset")),
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function countMap(values: string[]) {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function formatValue(value: unknown) {
  if (value === "" || value == null) return "-";
  return String(value);
}

function routesToCsv(routes: RouteViewerRoute[]) {
  const rows = [
    [
      "device",
      "vdom",
      "destination",
      "gateway",
      "distance",
      "metric",
      "interface",
      "protocol",
      "type",
      "vrf",
      "age",
      "is_default",
    ],
    ...routes.map((route) => [
      route.device,
      route.vdom,
      route.destination,
      route.gateway,
      formatValue(route.distance),
      formatValue(route.metric),
      route.interface,
      route.protocol,
      route.type,
      route.vrf,
      formatValue(route.age),
      String(route.is_default),
    ]),
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

function downloadText(filename: string, type: string, text: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
