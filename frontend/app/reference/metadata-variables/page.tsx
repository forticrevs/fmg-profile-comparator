"use client";

import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import AddToChatContextButton from "@/components/AddToChatContextButton";
import { useChatContext } from "@/components/ChatContext";
import {
  fetchMetadataVariables,
  type MetadataVariableRow,
  type MetadataVariablesResponse,
} from "@/lib/api";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500];

type SortDir = "asc" | "desc";

interface SortState {
  key: "device" | string;
  dir: SortDir;
}

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
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-cyan-500/30 text-current">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function rowSearchText(row: MetadataVariableRow): string {
  return [
    row.device,
    ...Object.keys(row.values),
    ...Object.values(row.values),
    ...Object.values(row.vdoms),
  ]
    .join(" ")
    .toLowerCase();
}

function valueForSort(row: MetadataVariableRow, key: string): string {
  if (key === "device") return row.device;
  return row.values[key] ?? "";
}

function compareRows(a: MetadataVariableRow, b: MetadataVariableRow, sort: SortState) {
  const aValue = valueForSort(a, sort.key);
  const bValue = valueForSort(b, sort.key);
  const aNumber = Number(aValue);
  const bNumber = Number(bValue);
  const bothNumeric = aValue !== "" && bValue !== "" && !Number.isNaN(aNumber) && !Number.isNaN(bNumber);
  const result = bothNumeric
    ? aNumber - bNumber
    : aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: "base" });
  return sort.dir === "asc" ? result : -result;
}

function buildDeviceContext(row: MetadataVariableRow, variables: string[]) {
  const metadata = Object.fromEntries(
    variables
      .filter((variable) => row.values[variable])
      .slice(0, 80)
      .map((variable) => [
        variable,
        {
          value: row.values[variable],
          vdom: row.vdoms[variable] ?? "global",
        },
      ]),
  );

  return {
    device: row.device,
    mapped_variable_count: row.set_count,
    metadata,
  };
}

export default function MetadataVariablesPage() {
  const { setPageContext, clearPageContext } = useChatContext();
  const [data, setData] = useState<MetadataVariablesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [variableSearch, setVariableSearch] = useState("");
  const [mappedOnly, setMappedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<SortState>({ key: "device", dir: "asc" });

  const deferredSearch = useDeferredValue(search);
  const deferredVariableSearch = useDeferredValue(variableSearch);

  const loadData = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMetadataVariables(refresh);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metadata variables");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useEffect(() => {
    return () => clearPageContext("reference:metadata-variables");
  }, [clearPageContext]);

  const summaryByVariable = useMemo(() => {
    const map = new Map<string, { mapped: number; unique: number }>();
    for (const summary of data?.variable_summaries ?? []) {
      map.set(summary.name, {
        mapped: summary.mapped_device_count,
        unique: summary.unique_value_count,
      });
    }
    return map;
  }, [data]);

  const visibleVariables = useMemo(() => {
    const q = deferredVariableSearch.trim().toLowerCase();
    return (data?.variables ?? []).filter((variable) => {
      if (mappedOnly && (summaryByVariable.get(variable)?.mapped ?? 0) === 0) {
        return false;
      }
      if (!q) return true;
      return variable.toLowerCase().includes(q);
    });
  }, [data, deferredVariableSearch, mappedOnly, summaryByVariable]);

  const filteredRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const rows = data?.rows ?? [];
    const searched = q
      ? rows.filter((row) => rowSearchText(row).includes(q))
      : rows;
    return searched.slice().sort((a, b) => compareRows(a, b, sort));
  }, [data, deferredSearch, sort]);

  const totalMappings = useMemo(
    () => (data?.rows ?? []).reduce((sum, row) => sum + row.set_count, 0),
    [data],
  );

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, pageSize, safePage]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, deferredVariableSearch, mappedOnly, pageSize]);

  useEffect(() => {
    setPageContext({
      id: "reference:metadata-variables",
      kind: "metadata_variables",
      label: "Metadata Variables",
      data: {
        loading,
        error,
        device_count: data?.device_count ?? 0,
        variable_count: data?.variable_count ?? 0,
        mapped_value_count: totalMappings,
        search: deferredSearch,
        variable_search: deferredVariableSearch,
        visible_variable_count: visibleVariables.length,
        filtered_device_count: filteredRows.length,
        sorted_by: sort,
        visible_variables: visibleVariables.slice(0, 100).map((variable) => ({
          name: variable,
          mapped_device_count: summaryByVariable.get(variable)?.mapped ?? 0,
          unique_value_count: summaryByVariable.get(variable)?.unique ?? 0,
        })),
        sample_rows: filteredRows.slice(0, 30).map((row) => buildDeviceContext(row, visibleVariables)),
      },
    });
  }, [
    data,
    deferredSearch,
    deferredVariableSearch,
    error,
    filteredRows,
    loading,
    setPageContext,
    sort,
    summaryByVariable,
    totalMappings,
    visibleVariables,
  ]);

  const setSortKey = (key: string) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const resetFilters = () => {
    setSearch("");
    setVariableSearch("");
    setMappedOnly(false);
    setSort({ key: "device", dir: "asc" });
  };

  const downloadCsv = () => {
    const headers = ["Device Name", ...visibleVariables];
    const lines = [
      headers.map(csvCell).join(","),
      ...filteredRows.map((row) =>
        [row.device, ...visibleVariables.map((variable) => row.values[variable] ?? "")]
          .map(csvCell)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "device_metavariables.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const startRow = filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endRow = Math.min(filteredRows.length, safePage * pageSize);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto px-6 py-8">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-slate-500 transition hover:text-slate-300"
            >
              Back to dashboard
            </Link>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              Metadata Variables
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Device metadata variable values from the active FortiManager ADOM.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Devices
              </div>
              <div className="text-2xl font-semibold text-white">
                {data?.device_count ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Variables
              </div>
              <div className="text-2xl font-semibold text-white">
                {data?.variable_count ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Values
              </div>
              <div className="text-2xl font-semibold text-white">
                {totalMappings}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices, variables, values, VDOMs..."
            className="h-9 w-full min-w-0 max-w-md rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-cyan-600"
          />
          <input
            value={variableSearch}
            onChange={(e) => setVariableSearch(e.target.value)}
            placeholder="Filter variable columns..."
            className="h-9 w-full min-w-0 max-w-xs rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-cyan-600"
          />
          <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={mappedOnly}
              onChange={(e) => setMappedOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-500"
            />
            Mapped only
          </label>
          <button
            type="button"
            onClick={resetFilters}
            className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-400 transition hover:text-white"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={loading}
            className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-400 transition hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={!data || filteredRows.length === 0 || visibleVariables.length === 0}
            className="h-9 rounded-md border border-cyan-800/60 bg-cyan-950/30 px-3 text-xs text-cyan-300 transition hover:border-cyan-600 hover:bg-cyan-900/40 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-600"
          >
            CSV
          </button>
          <div className="ml-auto text-sm text-slate-500">
            Showing {startRow}-{endRow} of {filteredRows.length}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-slate-500">
            Loading metadata variables...
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50">
            <div className="max-h-[calc(100vh-330px)] overflow-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur">
                  <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="sticky left-0 z-30 min-w-[240px] border-r border-slate-800 bg-slate-950/95 px-3 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => setSortKey("device")}
                        className="font-semibold text-slate-400 transition hover:text-white"
                      >
                        Device {sort.key === "device" ? (sort.dir === "asc" ? "Asc" : "Desc") : ""}
                      </button>
                    </th>
                    <th className="min-w-[90px] border-r border-slate-800 px-3 py-3 text-right">
                      Mapped
                    </th>
                    {visibleVariables.map((variable) => {
                      const stats = summaryByVariable.get(variable);
                      return (
                        <th
                          key={variable}
                          className="min-w-[170px] border-r border-slate-800 px-3 py-3 text-left align-bottom last:border-r-0"
                        >
                          <button
                            type="button"
                            onClick={() => setSortKey(variable)}
                            className="block text-left font-semibold text-slate-400 transition hover:text-white"
                            title={`${stats?.mapped ?? 0} mapped devices, ${stats?.unique ?? 0} unique values`}
                          >
                            <span className="block normal-case tracking-normal text-slate-300">
                              <Highlight text={variable} query={deferredVariableSearch} />
                            </span>
                            <span className="mt-1 block text-[10px] font-normal text-slate-600">
                              {stats?.mapped ?? 0} mapped
                              {sort.key === variable ? ` ${sort.dir}` : ""}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleVariables.length + 2}
                        className="px-4 py-12 text-center text-sm text-slate-500"
                      >
                        No metadata variables match the current filters.
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((row) => (
                      <tr
                        key={row.device}
                        className="border-b border-slate-900 transition hover:bg-slate-800/20"
                      >
                        <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-950 px-3 py-2.5 align-top">
                          <div className="flex items-start gap-2">
                            <AddToChatContextButton
                              item={{
                                id: `metadata-device:${row.device}`,
                                kind: "metadata_device",
                                label: `${row.device} metadata variables`,
                                data: buildDeviceContext(row, data?.variables ?? []),
                              }}
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-slate-100">
                                <Highlight text={row.device} query={deferredSearch} />
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-600">
                                {row.set_count} values
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="border-r border-slate-800 px-3 py-2.5 text-right align-top font-mono text-slate-400">
                          {row.set_count}
                        </td>
                        {visibleVariables.map((variable) => {
                          const value = row.values[variable] ?? "";
                          const vdom = row.vdoms[variable] ?? "global";
                          return (
                            <td
                              key={`${row.device}:${variable}`}
                              className="max-w-[280px] border-r border-slate-900 px-3 py-2.5 align-top last:border-r-0"
                              title={value ? `${variable} (${vdom})` : variable}
                            >
                              {value ? (
                                <span className="whitespace-pre-wrap break-words text-slate-200">
                                  <Highlight text={value} query={deferredSearch} />
                                </span>
                              ) : (
                                <span className="text-slate-700">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-3 py-3">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage <= 1}
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-400 transition hover:text-white disabled:cursor-not-allowed disabled:text-slate-700"
              >
                Previous
              </button>
              <span className="text-xs text-slate-500">
                Page {safePage} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={safePage >= pageCount}
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-400 transition hover:text-white disabled:cursor-not-allowed disabled:text-slate-700"
              >
                Next
              </button>

              <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-cyan-600"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-slate-600">
                {visibleVariables.length} visible variables
              </span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
