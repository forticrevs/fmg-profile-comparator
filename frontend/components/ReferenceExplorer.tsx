"use client";

import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  fetchApplicationSignatures,
  fetchIpsSignatures,
  fetchDlpSensors,
  fetchDlpDictionaries,
  fetchDlpDataTypes,
  ReferenceListResponse,
} from "@/lib/api";

type ReferenceKind =
  | "application-signatures"
  | "ips-signatures"
  | "dlp-sensors"
  | "dlp-dictionaries"
  | "dlp-data-types";
type FilterOperator = "contains" | "not_contains" | "equals" | "regex";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500];

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

/* ------------------------------------------------------------------ */
/* Action colour helpers                                               */
/* ------------------------------------------------------------------ */
const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  block: { bg: "bg-red-950/60", text: "text-red-300", border: "border-red-800/60" },
  deny: { bg: "bg-red-950/60", text: "text-red-300", border: "border-red-800/60" },
  drop: { bg: "bg-red-950/60", text: "text-red-300", border: "border-red-800/60" },
  reject: { bg: "bg-red-950/60", text: "text-red-300", border: "border-red-800/60" },
  allow: { bg: "bg-emerald-950/60", text: "text-emerald-300", border: "border-emerald-800/60" },
  pass: { bg: "bg-emerald-950/60", text: "text-emerald-300", border: "border-emerald-800/60" },
  accept: { bg: "bg-emerald-950/60", text: "text-emerald-300", border: "border-emerald-800/60" },
  monitor: { bg: "bg-blue-950/60", text: "text-blue-300", border: "border-blue-800/60" },
  warning: { bg: "bg-blue-950/60", text: "text-blue-300", border: "border-blue-800/60" },
  authenticate: { bg: "bg-blue-950/60", text: "text-blue-300", border: "border-blue-800/60" },
  exempt: { bg: "bg-slate-800/60", text: "text-slate-400", border: "border-slate-700/60" },
};
const ACTION_DEFAULT = { bg: "bg-amber-950/50", text: "text-amber-300", border: "border-amber-800/60" };

function getActionStyle(val: string) {
  const lower = val.toLowerCase().trim();
  return ACTION_COLORS[lower] ?? ACTION_DEFAULT;
}

/* ------------------------------------------------------------------ */
/* Severity colour helpers                                             */
/* ------------------------------------------------------------------ */
const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-950/60", text: "text-red-300", border: "border-red-800/60" },
  high: { bg: "bg-orange-950/60", text: "text-orange-300", border: "border-orange-800/60" },
  medium: { bg: "bg-amber-950/50", text: "text-amber-300", border: "border-amber-800/60" },
  low: { bg: "bg-cyan-950/50", text: "text-cyan-300", border: "border-cyan-800/60" },
  info: { bg: "bg-slate-800/60", text: "text-slate-400", border: "border-slate-700/60" },
};

function getSeverityStyle(val: string) {
  return SEVERITY_COLORS[val.toLowerCase().trim()];
}

/* ------------------------------------------------------------------ */
/* CVE & date formatting                                               */
/* ------------------------------------------------------------------ */
function formatCVE(raw: string): string {
  // Pattern: bare number like "20050277" → "CVE-2005-0277"
  // Already has dashes? return as-is
  if (raw.includes("-")) return raw;
  const m = raw.match(/^(\d{4})(\d+)$/);
  if (m) return `CVE-${m[1]}-${m[2]}`;
  return raw;
}

function formatDateValue(raw: string): string {
  // Pattern: "20220502" → "2022-05-02"
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

/* ------------------------------------------------------------------ */
/* Detect if a column is action/severity/cve/date-like                 */
/* ------------------------------------------------------------------ */
function isActionColumn(col: string): boolean {
  const l = col.toLowerCase();
  return l === "action" || l === "default-action";
}

function isSeverityColumn(col: string): boolean {
  return col.toLowerCase() === "severity";
}

function isCVEColumn(col: string): boolean {
  const l = col.toLowerCase();
  return l === "cve" || l === "cve_lf";
}

function isDateColumn(col: string): boolean {
  return col.toLowerCase() === "date";
}

/* ------------------------------------------------------------------ */
/* Check if value is an array of objects (needs nested table)          */
/* ------------------------------------------------------------------ */
function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
  );
}

/* ------------------------------------------------------------------ */
/* Format helpers                                                      */
/* ------------------------------------------------------------------ */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value))
    return value.map((item) => formatValue(item)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${key}: ${formatValue(child)}`)
      .join(" | ");
  }
  return String(value);
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getFetcher(kind: ReferenceKind) {
  switch (kind) {
    case "application-signatures":
      return fetchApplicationSignatures;
    case "ips-signatures":
      return fetchIpsSignatures;
    case "dlp-sensors":
      return fetchDlpSensors;
    case "dlp-dictionaries":
      return fetchDlpDictionaries;
    case "dlp-data-types":
      return fetchDlpDataTypes;
  }
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

function HighlightText({ text, query }: { text: string; query: string }) {
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
          <mark key={i} className="bg-cyan-500/30 text-current rounded-sm">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Nested mini-table for array-of-objects cells (DLP entries etc.)     */
/* ------------------------------------------------------------------ */
function NestedTable({
  items,
  query,
}: {
  items: Record<string, unknown>[];
  query: string;
}) {
  const subCols = useMemo(() => {
    const keys = new Set<string>();
    for (const item of items) Object.keys(item).forEach((k) => keys.add(k));
    return [...keys];
  }, [items]);

  return (
    <div className="rounded-md border border-slate-700/50 overflow-hidden">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-800/60">
            {subCols.map((col) => (
              <th
                key={col}
                className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-700/40"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={idx}
              className="border-b border-slate-800/30 last:border-0 hover:bg-slate-800/20"
            >
              {subCols.map((col) => {
                const val = item[col];
                const text = formatScalar(val);
                const isAction = isActionColumn(col);

                return (
                  <td key={col} className="px-2 py-1 align-top">
                    {isAction ? (
                      <ActionBadge value={text} />
                    ) : (
                      <span className="text-slate-300 break-all whitespace-pre-wrap">
                        <HighlightText text={text} query={query} />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-0.5 text-[10px] text-slate-600 bg-slate-900/40 border-t border-slate-800/30">
        {items.length} {items.length === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Action badge component                                              */
/* ------------------------------------------------------------------ */
function ActionBadge({ value }: { value: string }) {
  if (value === "—") return <span className="text-slate-600">—</span>;
  const style = getActionStyle(value);
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text} ${style.border}`}
    >
      {value}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Severity badge component                                            */
/* ------------------------------------------------------------------ */
function SeverityBadge({ value }: { value: string }) {
  if (value === "—") return <span className="text-slate-600">—</span>;
  const style = getSeverityStyle(value);
  if (!style) return <span className="text-slate-300">{value}</span>;
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text} ${style.border}`}
    >
      {value}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Smart cell renderer — handles nested tables, actions, CVE, dates   */
/* ------------------------------------------------------------------ */
function CellContent({
  value,
  column,
  query,
}: {
  value: unknown;
  column: string;
  query: string;
}) {
  // Nested table for array-of-objects
  if (isObjectArray(value)) {
    return <NestedTable items={value} query={query} />;
  }

  const text = formatValue(value);

  // Action column → colour badge
  if (isActionColumn(column)) {
    return <ActionBadge value={text} />;
  }

  // Severity → colour badge
  if (isSeverityColumn(column)) {
    return <SeverityBadge value={text} />;
  }

  // CVE column → formatted with dashes
  if (isCVEColumn(column) && text !== "—") {
    const parts = text.split(",").map((s) => s.trim());
    return (
      <span className="text-slate-200">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <HighlightText text={formatCVE(p)} query={query} />
          </span>
        ))}
      </span>
    );
  }

  // Date column → formatted
  if (isDateColumn(column) && text !== "—") {
    return (
      <span className="text-slate-200 tabular-nums">
        <HighlightText text={formatDateValue(text)} query={query} />
      </span>
    );
  }

  // Default
  return <HighlightText text={text} query={query} />;
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
export default function ReferenceExplorer({ kind, title, description }: Props) {
  const [data, setData] = useState<ReferenceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null);

  // Drag state for column reordering
  const dragCol = useRef<string | null>(null);
  const dragOverCol = useRef<string | null>(null);

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
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load reference data",
          );
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

  // Detect columns from data
  const detectedColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const item of data?.items ?? []) {
      Object.keys(item).forEach((key) => keys.add(key));
    }
    return [...keys];
  }, [data]);

  // Use user-ordered columns if set, otherwise detected
  const columns = useMemo(
    () => columnOrder ?? detectedColumns,
    [columnOrder, detectedColumns],
  );

  // Sync detected columns into column order when data first loads
  useEffect(() => {
    if (detectedColumns.length > 0 && columnOrder === null) {
      setColumnOrder(detectedColumns);
    }
  }, [detectedColumns, columnOrder]);

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

  // Reset to page 1 when filters/search change
  useEffect(() => {
    setPage(1);
  }, [deferredSearch, filters]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredItems.length / pageSize),
  );
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(
    () =>
      filteredItems.slice(
        (safePage - 1) * pageSize,
        safePage * pageSize,
      ),
    [filteredItems, safePage, pageSize],
  );

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

  // Column drag-and-drop handlers
  const handleDragStart = useCallback((col: string) => {
    dragCol.current = col;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, col: string) => {
      e.preventDefault();
      dragOverCol.current = col;
    },
    [],
  );

  const handleDrop = useCallback(() => {
    const from = dragCol.current;
    const to = dragOverCol.current;
    if (!from || !to || from === to) return;

    setColumnOrder((prev) => {
      const cols = [...(prev ?? detectedColumns)];
      const fromIdx = cols.indexOf(from);
      const toIdx = cols.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return cols;
      cols.splice(fromIdx, 1);
      cols.splice(toIdx, 0, from);
      return cols;
    });

    dragCol.current = null;
    dragOverCol.current = null;
  }, [detectedColumns]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto px-6 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-slate-500 transition hover:text-slate-300"
            >
              ← Back to dashboard
            </Link>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              {title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              {description}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Rows
            </div>
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
              Showing {paginatedItems.length} of {filteredItems.length}{" "}
              (total {data?.count ?? 0})
            </div>
          </div>

          {filters.length > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              {filters.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center gap-2"
                >
                  <select
                    value={rule.column}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((entry) =>
                          entry.id === rule.id
                            ? { ...entry, column: event.target.value }
                            : entry,
                        ),
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
                            ? {
                                ...entry,
                                operator: event.target
                                  .value as FilterOperator,
                              }
                            : entry,
                        ),
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                  >
                    {Object.entries(OPERATOR_LABELS).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>

                  <input
                    value={rule.value}
                    onChange={(event) =>
                      setFilters((current) =>
                        current.map((entry) =>
                          entry.id === rule.id
                            ? { ...entry, value: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    placeholder="Filter value"
                    className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                  />

                  <button
                    onClick={() =>
                      setFilters((current) =>
                        current.filter(
                          (entry) => entry.id !== rule.id,
                        ),
                      )
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
            <div className="py-16 text-center text-slate-500">
              Loading reference data…
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-slate-950 z-10">
                    <tr className="border-b border-slate-800">
                      {columns.map((column) => (
                        <th
                          key={column}
                          draggable
                          onDragStart={() => handleDragStart(column)}
                          onDragOver={(e) => handleDragOver(e, column)}
                          onDrop={handleDrop}
                          className="px-3 py-3 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-400 cursor-grab active:cursor-grabbing select-none whitespace-nowrap"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600 text-[10px]">⠿</span>
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
                    {paginatedItems.map((item, index) => (
                      <tr
                        key={`${kind}-${(safePage - 1) * pageSize + index}`}
                        className="border-b border-slate-900 align-top hover:bg-slate-800/20 transition-colors"
                      >
                        {columns.map((column) => (
                          <td
                            key={column}
                            className="px-3 py-2.5 align-top"
                          >
                            <div className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-200">
                              <CellContent
                                value={item[column]}
                                column={column}
                                query={deferredSearch}
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}

                    {paginatedItems.length === 0 && (
                      <tr>
                        <td
                          colSpan={Math.max(columns.length, 1)}
                          className="px-4 py-10 text-center text-sm text-slate-500"
                        >
                          No rows match the current search and filter
                          criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls */}
              <div className="flex items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    Rows per page:
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white outline-none"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(1)}
                    disabled={safePage <= 1}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ««
                  </button>
                  <button
                    onClick={() =>
                      setPage((p) => Math.max(1, p - 1))
                    }
                    disabled={safePage <= 1}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ‹ Prev
                  </button>
                  <span className="text-xs text-slate-400 tabular-nums">
                    Page {safePage} of {totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setPage((p) =>
                        Math.min(totalPages, p + 1),
                      )
                    }
                    disabled={safePage >= totalPages}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next ›
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={safePage >= totalPages}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    »»
                  </button>
                </div>

                <div className="text-xs text-slate-500 tabular-nums">
                  {(safePage - 1) * pageSize + 1}–
                  {Math.min(
                    safePage * pageSize,
                    filteredItems.length,
                  )}{" "}
                  of {filteredItems.length}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
