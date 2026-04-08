"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  fetchApplicationSignatures,
  fetchIpsSignatures,
  ReferenceListResponse,
} from "@/lib/api";

type ReferenceKind = "application-signatures" | "ips-signatures";
type FilterOperator = "contains" | "not_contains" | "equals" | "regex";

interface Props {
  kind: ReferenceKind;
  title: string;
  description: string;
}

interface FilterRule {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "Contains",
  not_contains: "Does Not Contain",
  equals: "Equals",
  regex: "Regex",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${key}: ${formatValue(child)}`)
      .join(" | ");
  }
  return String(value);
}

function getFetcher(kind: ReferenceKind) {
  return kind === "application-signatures"
    ? fetchApplicationSignatures
    : fetchIpsSignatures;
}

function matchesFilter(value: string, rule: FilterRule): boolean {
  if (!rule.value.trim()) return true;

  const subject = value.toLowerCase();
  const query = rule.value.toLowerCase();

  switch (rule.operator) {
    case "contains":
      return subject.includes(query);
    case "not_contains":
      return !subject.includes(query);
    case "equals":
      return subject === query;
    case "regex":
      try {
        return new RegExp(rule.value, "i").test(value);
      } catch {
        return false;
      }
  }
}

export default function ReferenceExplorer({ kind, title, description }: Props) {
  const [data, setData] = useState<ReferenceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterRule[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const next = await getFetcher(kind)();
        if (!cancelled) {
          setData(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load reference data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [kind]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const item of data?.items ?? []) {
      Object.keys(item).forEach((key) => keys.add(key));
    }
    return [...keys];
  }, [data]);

  const deferredSearch = useDeferredValue(search);

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    const searchQuery = deferredSearch.trim().toLowerCase();

    return items.filter((item) => {
      if (searchQuery) {
        const haystack = Object.values(item)
          .map((value) => formatValue(value))
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(searchQuery)) {
          return false;
        }
      }

      for (const rule of filters) {
        const value = formatValue(item[rule.column]);
        if (!matchesFilter(value, rule)) {
          return false;
        }
      }

      return true;
    });
  }, [data, deferredSearch, filters]);

  const addFilter = (column?: string) => {
    const defaultColumn = column ?? columns[0];
    if (!defaultColumn) return;

    setFilters((current) => [
      ...current,
      {
        id: `${defaultColumn}-${current.length}-${Date.now()}`,
        column: defaultColumn,
        operator: "contains",
        value: "",
      },
    ]);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-[1600px] px-6 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link href="/" className="text-sm text-slate-500 transition hover:text-slate-300">
              ← Back to dashboard
            </Link>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">{description}</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Rows</div>
            <div className="text-2xl font-semibold text-white">
              {data?.count ?? 0}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search all columns..."
              className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-600"
            />

            <button
              onClick={() => addFilter()}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-600 hover:text-white"
            >
              Add Column Filter
            </button>

            <div className="ml-auto text-sm text-slate-500">
              Showing {filteredItems.length} of {data?.count ?? 0}
            </div>
          </div>

          {filters.length > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              {filters.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center gap-2">
                  <select
                    value={rule.column}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((entry) =>
                          entry.id === rule.id
                            ? { ...entry, column: event.target.value }
                            : entry
                        )
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                  >
                    {columns.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>

                  <select
                    value={rule.operator}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((entry) =>
                          entry.id === rule.id
                            ? { ...entry, operator: event.target.value as FilterOperator }
                            : entry
                        )
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                  >
                    {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>

                  <input
                    value={rule.value}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((entry) =>
                          entry.id === rule.id
                            ? { ...entry, value: event.target.value }
                            : entry
                        )
                      )
                    }
                    placeholder="Filter value"
                    className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                  />

                  <button
                    onClick={() =>
                      setFilters((current) => current.filter((entry) => entry.id !== rule.id))
                    }
                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 transition hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-slate-500">Loading reference data…</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="min-w-full table-fixed border-collapse">
                <thead className="sticky top-0 bg-slate-950">
                  <tr className="border-b border-slate-800">
                    {columns.map((column) => (
                      <th
                        key={column}
                        className="px-3 py-3 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate">{column}</span>
                          <button
                            onClick={() => addFilter(column)}
                            className="rounded border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:border-slate-700 hover:text-slate-300"
                            title={`Filter ${column}`}
                          >
                            +
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, index) => (
                    <tr key={`${kind}-${index}`} className="border-b border-slate-900 align-top">
                      {columns.map((column) => (
                        <td key={column} className="px-3 py-2.5 align-top">
                          <div className="max-w-[22rem] whitespace-pre-wrap break-words text-xs leading-5 text-slate-200">
                            {formatValue(item[column])}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}

                  {filteredItems.length === 0 && (
                    <tr>
                      <td
                        colSpan={Math.max(columns.length, 1)}
                        className="px-4 py-10 text-center text-sm text-slate-500"
                      >
                        No rows match the current search and filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
