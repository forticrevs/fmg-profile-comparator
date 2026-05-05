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
  fetchLocalWebCategories,
  fetchWebRatingOverrides,
  ReferenceListResponse,
} from "@/lib/api";
import SharedActionBadge from "@/components/ActionBadge";
import DataGrid, { type DataGridColumn } from "@/components/DataGrid";
import FieldVisibilityMenu, {
  loadHiddenFields,
  saveHiddenFields,
} from "@/components/FieldVisibilityMenu";
import SignatureTooltip from "@/components/SignatureTooltip";
import { useChatContext } from "@/components/ChatContext";

type ReferenceKind =
  | "application-signatures"
  | "ips-signatures"
  | "dlp-sensors"
  | "dlp-dictionaries"
  | "dlp-data-types"
  | "local-web-categories"
  | "web-rating-overrides";
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
/* Per-reference defaults                                              */
/*                                                                     */
/* On first visit (or after a version bump) a reference page seeds    */
/* its visibility + column order from this config. The IPS catalog is  */
/* the obvious case: FMG returns ~35 fields per rule, most of them     */
/* internal bookkeeping, and a fresh user should land on the 11 that   */
/* actually matter for signature triage.                               */
/*                                                                     */
/* `widths` lets a column claim extra horizontal space via a CSS       */
/* grid-template fragment — `name` is the most important column in    */
/* the IPS view, so it gets an oversize share plus a hard minimum.     */
/*                                                                     */
/* `DEFAULTS_VERSION` is a manual migration trigger. Bump it when the  */
/* shipped defaults change semantically — every browser that still     */
/* holds an older version will re-apply the new defaults exactly once  */
/* and then respect subsequent customizations. Skipping this knob      */
/* would either never reset (stale customers keep broken layouts) or   */
/* reset every visit (would destroy customizations).                   */
/* ------------------------------------------------------------------ */
const DEFAULTS_VERSION = 3;

interface ReferenceDefaults {
  visibleColumns: string[];
  columnOrder: string[];
  widths?: Record<string, string>;
}

const REFERENCE_DEFAULTS: Partial<Record<ReferenceKind, ReferenceDefaults>> = {
  "ips-signatures": {
    // Ordered: name first (most important), then the other ten in the
    // alphabetical order the user requested.
    columnOrder: [
      "name",
      "action",
      "application",
      "cve",
      "date",
      "group",
      "location",
      "os",
      "service",
      "severity",
      "status",
      "vuln_type",
    ],
    visibleColumns: [
      "name",
      "action",
      "application",
      "cve",
      "date",
      "group",
      "location",
      "os",
      "service",
      "severity",
      "status",
      "vuln_type",
    ],
    widths: {
      // Name gets an oversize share plus a hard minimum so long
      // signature names stay readable even when the viewport is narrow.
      name: "minmax(260px, 3fr)",
    },
  },
  "local-web-categories": {
    // Operator-defined webfilter category buckets. `desc` is the
    // user-visible name and does the heavy lifting; internal `oid` and
    // `obj flags` / `obj ver` are hidden by default but still available
    // from the Fields menu if someone needs them for debugging.
    columnOrder: [
      "desc",
      "id",
      "status",
      "_created-by",
      "_last-modified-by",
      "_modified timestamp",
    ],
    visibleColumns: [
      "desc",
      "id",
      "status",
      "_created-by",
      "_last-modified-by",
      "_modified timestamp",
    ],
    widths: {
      desc: "minmax(220px, 2.5fr)",
    },
  },
  "web-rating-overrides": {
    // Each entry pins a URL to one or more custom/FortiGuard
    // categories. `rating_display` is the backend-resolved names;
    // `rating` keeps the raw IDs alongside for operators who need to
    // cross-reference by ID.
    columnOrder: [
      "url",
      "rating_display",
      "rating",
      "status",
      "_created-by",
      "_last-modified-by",
      "_modified timestamp",
    ],
    visibleColumns: [
      "url",
      "rating_display",
      "rating",
      "status",
      "_created-by",
      "_last-modified-by",
      "_modified timestamp",
    ],
    widths: {
      url: "minmax(240px, 2.5fr)",
      rating_display: "minmax(160px, 1.3fr)",
    },
  },
};

/* Column order persistence — keyed per visibilityKey. Ordering is
 * orthogonal to visibility, so it gets its own localStorage entry
 * rather than piggybacking on the hidden-fields blob. */
function loadColumnOrder(storageKey: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`colorder:${storageKey}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.every((s) => typeof s === "string")
      ? arr
      : null;
  } catch {
    return null;
  }
}

function saveColumnOrder(storageKey: string, order: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `colorder:${storageKey}`,
      JSON.stringify(order),
    );
  } catch {
    /* ignore quota / privacy mode failures */
  }
}

/* ------------------------------------------------------------------ */
/* Action colour helpers                                               */
/* ------------------------------------------------------------------ */
const RED = { bg: "bg-red-900/70", text: "text-red-100", border: "border-red-700/70" };
const GREEN = { bg: "bg-emerald-900/70", text: "text-emerald-100", border: "border-emerald-700/70" };
const BLUE = { bg: "bg-blue-900/70", text: "text-blue-100", border: "border-blue-700/70" };
const ORANGE = { bg: "bg-orange-900/70", text: "text-orange-100", border: "border-orange-700/70" };
const GREY = { bg: "bg-slate-700/70", text: "text-slate-100", border: "border-slate-500/70" };

const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  block: RED, blocked: RED,
  deny: RED, denied: RED,
  drop: RED, dropped: RED,
  reject: RED, rejected: RED,
  allow: GREEN, allowed: GREEN,
  permit: GREEN, permitted: GREEN,
  pass: GREEN, accept: GREEN, accepted: GREEN,
  monitor: BLUE, monitored: BLUE, log: BLUE, observe: BLUE,
  warn: ORANGE, warning: ORANGE, alert: ORANGE, notify: ORANGE,
  exempt: GREY, exempted: GREY,
  skip: GREY, skipped: GREY,
  ignore: GREY, ignored: GREY,
  bypass: GREY, bypassed: GREY,
};
const ACTION_DEFAULT = { bg: "bg-amber-950/50", text: "text-amber-100", border: "border-amber-700/60" };

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

/** FMG returns audit timestamps as Unix-epoch seconds in fields named
 *  like `_created timestamp` / `_modified timestamp`. Detect them so
 *  CellContent can render a human-friendly ISO date instead of a
 *  10-digit blob. Any column whose name ends in " timestamp" counts.
 */
function isEpochTimestampColumn(col: string): boolean {
  return /\stimestamp$/i.test(col);
}

function formatEpoch(raw: string): string {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return raw;
  // FMG returns seconds; JS Date expects milliseconds.
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return raw;
  // Render as `YYYY-MM-DD HH:MM` — the seconds are rarely useful
  // for an audit-log column and the shorter form fits in the grid.
  const pad = (v: number) => v.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
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
/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */
type SortDir = "asc" | "desc";

function loadSort(storageKey: string): { col: string; dir: SortDir } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`sort:${storageKey}`);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj.col === "string" && (obj.dir === "asc" || obj.dir === "desc"))
      return obj;
    return null;
  } catch {
    return null;
  }
}

function saveSort(storageKey: string, col: string, dir: SortDir): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`sort:${storageKey}`, JSON.stringify({ col, dir }));
  } catch { /* ignore */ }
}

function clearSort(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`sort:${storageKey}`);
  } catch { /* ignore */ }
}

/** Extract a comparable primitive from a cell value. Understands numbers,
 *  CVE strings, dates in YYYYMMDD form, and epoch timestamps. Returns
 *  the original string as fallback for lexicographic comparison. */
function sortKey(col: string, value: unknown): string | number {
  const s = formatValue(value);
  if (s === "—") return "";

  // Numeric columns — compare as number when possible
  const n = Number(s);
  if (s !== "" && !isNaN(n)) return n;

  // CVE column — normalise so "CVE-2023-0001" sorts numerically
  if (isCVEColumn(col)) {
    const formatted = formatCVE(s);
    const m = formatted.match(/^CVE-(\d+)-(\d+)$/);
    if (m) return Number(m[1]) * 1e7 + Number(m[2]);
  }

  // Date column — "20220502" already sorts lexicographically, but
  // we normalise to number for safety
  if (isDateColumn(col)) {
    const dn = Number(s.replace(/-/g, ""));
    if (!isNaN(dn)) return dn;
  }

  return s.toLowerCase();
}

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

function compactReferenceValue(value: unknown): unknown {
  const text = formatValue(value);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function compactReferenceRow(
  row: Record<string, unknown>,
  columns: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    columns.slice(0, 8).map((column) => [
      column,
      compactReferenceValue(row[column]),
    ]),
  );
}

/** Format a cell value for search — applies the same display transforms
 *  (CVE dashes, date dashes, epoch→ISO) so users can search by what they see. */
function formatValueForSearch(col: string, value: unknown): string {
  const base = formatValue(value);
  if (base === "—") return base;
  if (isCVEColumn(col)) {
    return base
      .split(", ")
      .map((v) => formatCVE(v.trim()))
      .join(", ");
  }
  if (isDateColumn(col)) return formatDateValue(base);
  if (isEpochTimestampColumn(col)) {
    const n = Number(base);
    if (!isNaN(n) && n > 1e9) return new Date(n * 1000).toISOString();
  }
  return base;
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
    case "local-web-categories":
      return fetchLocalWebCategories;
    case "web-rating-overrides":
      return fetchWebRatingOverrides;
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
    <div data-no-clamp className="rounded-md border border-slate-700/50 overflow-hidden">
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
/* Action badge — re-exported from shared ActionBadge module           */
/* ------------------------------------------------------------------ */
const ActionBadge = SharedActionBadge;

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

  // FMG audit epoch timestamp → formatted ISO short
  if (isEpochTimestampColumn(column) && text !== "—") {
    return (
      <span className="text-slate-200 tabular-nums">
        <HighlightText text={formatEpoch(text)} query={query} />
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
  const { setPageContext, clearPageContext } = useChatContext();
  const [data, setData] = useState<ReferenceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null);

  // Sort state — persisted per reference kind
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  // Reference pages don't have a FMG syntax schema — FortiGuard tables
  // (`_application/list`, `_rule/list`, `_fdsdb/*`) ignore
  // `option=["syntax"]` and just return data, so we use data-discovered
  // columns only. The visibility menu still works; it just has no help
  // tooltips or schema-only "(empty)" columns for these pages.
  const availableColumns = detectedColumns;

  // Per-reference column visibility (persisted to localStorage). Tracks
  // *hidden* column names so newly-discovered columns default to visible.
  const visibilityKey = `ref:${kind}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHiddenColumns(loadHiddenFields(visibilityKey));
    const persisted = loadSort(visibilityKey);
    if (persisted) {
      setSortCol(persisted.col);
      setSortDir(persisted.dir);
    }
  }, [visibilityKey]);

  // Use user-ordered columns if set, otherwise detected; then drop any
  // columns the user has hidden via the visibility menu.
  const columns = useMemo(() => {
    const ordered = columnOrder ?? detectedColumns;
    if (hiddenColumns.size === 0) return ordered;
    return ordered.filter((c) => !hiddenColumns.has(c));
  }, [columnOrder, detectedColumns, hiddenColumns]);

  // Seed column order + visibility on first data load, or migrate an
  // older `refcols-init:<key>` sentinel forward. Three paths:
  //
  //  1. No stored sentinel OR stored version < DEFAULTS_VERSION → apply
  //     the per-kind defaults and stamp the current version into the
  //     sentinel. This catches brand-new browsers AND any browser that
  //     was opened before a defaults change (including the v1→v2 bump
  //     introduced to fix the original prior-prefs guard mistake).
  //
  //  2. Stored version == DEFAULTS_VERSION → defaults already applied.
  //     Restore persisted column order if any, otherwise fall back to
  //     detected order so drag-and-drop tweaks survive reloads.
  //
  //  3. No defaults for this kind → behave as before: column order
  //     mirrors detected order, no sentinel touched.
  useEffect(() => {
    if (detectedColumns.length === 0 || columnOrder !== null) return;

    const defaults = REFERENCE_DEFAULTS[kind];
    const initFlag = `refcols-init:${visibilityKey}`;
    const storedVersion =
      typeof window !== "undefined"
        ? Number.parseInt(
            window.localStorage.getItem(initFlag) ?? "",
            10,
          )
        : NaN;
    const needsMigration =
      !Number.isFinite(storedVersion) || storedVersion < DEFAULTS_VERSION;

    if (defaults && needsMigration) {
      // First visit, or migrating from an older defaults version.
      // Ignore filter sections entirely in the detected universe we
      // hide from — if FMG's `_rule/list` ever grows a new field we
      // don't know about, appending it to the trailing order means it
      // remains hideable via the menu without silently vanishing.
      const detectedSet = new Set(detectedColumns);
      const wantedOrder = defaults.columnOrder.filter((c) =>
        detectedSet.has(c),
      );
      const wantedSet = new Set(wantedOrder);
      const trailing = detectedColumns.filter((c) => !wantedSet.has(c));
      const newOrder = [...wantedOrder, ...trailing];

      const visibleSet = new Set(defaults.visibleColumns);
      const newHidden = new Set(
        detectedColumns.filter((c) => !visibleSet.has(c)),
      );

      setColumnOrder(newOrder);
      setHiddenColumns(newHidden);
      saveColumnOrder(visibilityKey, newOrder);
      saveHiddenFields(visibilityKey, newHidden);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(initFlag, String(DEFAULTS_VERSION));
      }
      return;
    }

    // Returning visit (or no defaults configured) — restore persisted
    // order if any, otherwise fall back to detected order.
    const persisted = loadColumnOrder(visibilityKey);
    if (persisted) {
      const detectedSet = new Set(detectedColumns);
      const kept = persisted.filter((c) => detectedSet.has(c));
      const trailing = detectedColumns.filter((c) => !kept.includes(c));
      setColumnOrder([...kept, ...trailing]);
    } else {
      setColumnOrder(detectedColumns);
    }
  }, [detectedColumns, columnOrder, kind, visibilityKey]);

  const deferredSearch = useDeferredValue(search);

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    const searchQuery = deferredSearch.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (searchQuery) {
        const haystack = Object.entries(item)
          .map(([col, value]) => formatValueForSearch(col, value))
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(searchQuery)) {
          return false;
        }
      }

      for (const rule of filters) {
        const value = formatValueForSearch(rule.column, item[rule.column]);
        if (!matchesFilter(value, rule)) {
          return false;
        }
      }

      return true;
    });

    if (sortCol) {
      const dir = sortDir === "asc" ? 1 : -1;
      filtered.sort((a, b) => {
        const ka = sortKey(sortCol, a[sortCol]);
        const kb = sortKey(sortCol, b[sortCol]);
        if (ka === kb) return 0;
        if (ka === "") return 1;   // blanks to bottom regardless of dir
        if (kb === "") return -1;
        if (typeof ka === "number" && typeof kb === "number")
          return (ka - kb) * dir;
        return String(ka).localeCompare(String(kb)) * dir;
      });
    }

    return filtered;
  }, [data, deferredSearch, filters, sortCol, sortDir]);

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

  useEffect(() => {
    return () => clearPageContext(`reference:${kind}`);
  }, [clearPageContext, kind]);

  useEffect(() => {
    setPageContext({
      id: `reference:${kind}`,
      kind: "reference_table",
      label: title,
      data: {
        reference_kind: kind,
        title,
        description,
        loading,
        error,
        total_count: data?.count ?? 0,
        filtered_count: filteredItems.length,
        visible_columns: columns.slice(0, 24),
        hidden_column_count: hiddenColumns.size,
        search: deferredSearch,
        filters: filters.map((rule) => ({
          column: rule.column,
          operator: rule.operator,
          value: rule.value,
        })),
        sort: sortCol ? { column: sortCol, direction: sortDir } : null,
        page: safePage,
        page_size: pageSize,
        visible_row_sample: paginatedItems
          .slice(0, 5)
          .map((row) => compactReferenceRow(row, columns)),
      },
    });
  }, [
    clearPageContext,
    columns,
    data?.count,
    deferredSearch,
    description,
    error,
    filteredItems.length,
    filters,
    hiddenColumns.size,
    kind,
    loading,
    pageSize,
    paginatedItems,
    safePage,
    setPageContext,
    sortCol,
    sortDir,
    title,
  ]);

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

  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        if (sortDir === "asc") {
          setSortDir("desc");
          saveSort(visibilityKey, col, "desc");
        } else {
          // Third click clears sort
          setSortCol(null);
          setSortDir("asc");
          clearSort(visibilityKey);
        }
      } else {
        setSortCol(col);
        setSortDir("asc");
        saveSort(visibilityKey, col, "asc");
      }
      setPage(1);
    },
    [sortCol, sortDir, visibilityKey],
  );

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
      saveColumnOrder(visibilityKey, cols);
      return cols;
    });

    dragCol.current = null;
    dragOverCol.current = null;
  }, [detectedColumns, visibilityKey]);

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

            <FieldVisibilityMenu
              storageKey={visibilityKey}
              available={availableColumns}
              hidden={hiddenColumns}
              onChange={setHiddenColumns}
              buttonLabel="Columns"
            />

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
              <DataGrid
                columns={columns.map<DataGridColumn<Record<string, unknown>>>((column) => ({
                  key: column,
                  width: REFERENCE_DEFAULTS[kind]?.widths?.[column],
                  headerProps: {
                    draggable: true,
                    onDragStart: () => handleDragStart(column),
                    onDragOver: (e) => handleDragOver(e, column),
                    onDrop: handleDrop,
                    className: "cursor-grab active:cursor-grabbing",
                  },
                  header: (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 text-[10px]">⠿</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSort(column);
                        }}
                        className="truncate hover:text-slate-200 transition"
                        title={`Sort by ${column}`}
                      >
                        {column}
                        {sortCol === column && (
                          <span className="ml-1 text-cyan-400">
                            {sortDir === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addFilter(column);
                        }}
                        className="rounded border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:border-slate-700 hover:text-slate-300"
                        title={`Filter ${column}`}
                      >
                        +
                      </button>
                    </div>
                  ),
                  render: (row) => {
                    const cell = (
                      <CellContent
                        value={row[column]}
                        column={column}
                        query={deferredSearch}
                      />
                    );
                    // Name column on IPS/App signature pages is
                    // wrapped in a hover tooltip that fetches the full
                    // FortiGuard encyclopedia record on demand. Every
                    // other column, and every other reference kind,
                    // renders unchanged.
                    if (column === "name") {
                      if (kind === "ips-signatures") {
                        const id = row["rule-id"];
                        const name = typeof row.name === "string" ? row.name : "";
                        if (
                          typeof id === "number" ||
                          (typeof id === "string" && id.length > 0)
                        ) {
                          return (
                            <SignatureTooltip
                              source="ips"
                              signatureId={id as number | string}
                              name={name}
                            >
                              {cell}
                            </SignatureTooltip>
                          );
                        }
                      } else if (kind === "application-signatures") {
                        const id = row.id;
                        const name = typeof row.name === "string" ? row.name : "";
                        if (
                          typeof id === "number" ||
                          (typeof id === "string" && id.length > 0)
                        ) {
                          return (
                            <SignatureTooltip
                              source="app"
                              signatureId={id as number | string}
                              name={name}
                            >
                              {cell}
                            </SignatureTooltip>
                          );
                        }
                      }
                    }
                    return cell;
                  },
                }))}
                rows={paginatedItems}
                rowKey={(_row, index) =>
                  `${kind}-${(safePage - 1) * pageSize + index}`
                }
                emptyState="No rows match the current search and filter criteria."
              />

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
