"use client";

import { useMemo, useState, useEffect } from "react";
import ActionBadge, { isActionKey } from "@/components/ActionBadge";
import FieldVisibilityMenu, {
  loadHiddenFields,
} from "@/components/FieldVisibilityMenu";
import type { SchemaResponse } from "@/lib/api";

/* ------------------------------------------------------------------ */
/* Fade-in animation style (injected once)                             */
/* ------------------------------------------------------------------ */
const FADE_STYLE_ID = "scc-fade-style";
function ensureFadeStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(FADE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FADE_STYLE_ID;
  style.textContent = `
    @keyframes scc-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .scc-fade-in { animation: scc-fade-in 0.35s ease-out both; }
  `;
  document.head.appendChild(style);
}

interface Props {
  collectionKey: string;
  profileNames: string[];
  rawProfiles: Record<string, Record<string, unknown>>;
  schema?: SchemaResponse | null;
}

type CollectionEntry = Record<string, unknown>;
type ResolvedValue = { raw: unknown; display: string };

const HIDDEN_ENTRY_KEYS = new Set(["oid", "obj seq", "last-modified"]);
const ENTRY_KEY_PRIORITY = [
  "action", "status", "severity", "location", "protocol",
  "application", "rule", "cve", "default-action", "default-status",
  "log", "log-attack-context", "log-packet", "quarantine",
  "quarantine-expiry", "rate-mode", "rate-count", "rate-duration",
];

type FilterMode = "all" | "differs" | "in_sync";

function humanizeKey(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isResolvedValue(value: unknown): value is ResolvedValue {
  return typeof value === "object" && value !== null && "raw" in value && "display" in value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (isResolvedValue(value)) return value.display;
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map(formatValue).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !HIDDEN_ENTRY_KEYS.has(key)
    );
    if (entries.length === 0) return "—";
    return entries.map(([key, item]) => `${humanizeKey(key)}: ${formatValue(item)}`).join(" | ");
  }
  return String(value);
}

/* ------------------------------------------------------------------ */
/* SmartValue — multi-column pill grid for list-like values             */
/* ------------------------------------------------------------------ */
const LIST_THRESHOLD = 4; // render as pill grid when ≥ this many items

function extractListItems(value: unknown): string[] | null {
  // Already an array
  if (Array.isArray(value)) {
    const flat = value.map((v) => {
      if (isResolvedValue(v)) return v.display;
      if (typeof v === "object" && v !== null) return formatValue(v);
      return String(v ?? "");
    });
    if (flat.length >= LIST_THRESHOLD) return flat;
    return null;
  }
  // Resolved value wrapping a comma-separated string
  if (isResolvedValue(value) && typeof value.display === "string") {
    const parts = value.display.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= LIST_THRESHOLD) return parts;
    return null;
  }
  // Plain comma-separated string
  if (typeof value === "string") {
    const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= LIST_THRESHOLD) return parts;
    return null;
  }
  return null;
}

function SmartValue({
  value,
  className,
}: {
  value: unknown;
  className: string;
}) {
  useEffect(() => { ensureFadeStyle(); }, []);

  const listItems = useMemo(() => {
    const items = extractListItems(value);
    return items ? [...items].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })) : null;
  }, [value]);

  if (!listItems) {
    return (
      <span className={`${className} scc-fade-in`}>
        {formatValue(value)}
      </span>
    );
  }

  // Multi-column pill grid
  return (
    <div className={`scc-fade-in ${className}`}>
      <div
        className="gap-1"
        style={{ columns: "2 8rem", columnGap: "0.375rem" }}
      >
        {listItems.map((item, i) => (
          <span
            key={i}
            className="inline-block w-full mb-0.5 rounded bg-slate-800/60 border border-slate-700/40 px-1.5 py-0.5 text-[11px] leading-tight break-all"
            style={{ animationDelay: `${Math.min(i * 15, 300)}ms` }}
          >
            {item}
          </span>
        ))}
      </div>
      <span className="text-[10px] text-slate-600 mt-1 block">
        {listItems.length} items
      </span>
    </div>
  );
}

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isResolvedValue(value)) return JSON.stringify(value.raw);
  if (Array.isArray(value)) {
    // Sort arrays of objects so element order doesn't cause false diffs
    // (e.g. SD-WAN sla entries returned by FMG in non-deterministic order).
    const parts = value.map(canonicalStringify);
    const allObjects =
      value.length > 0 &&
      value.every((v) => typeof v === "object" && v !== null && !isResolvedValue(v));
    if (allObjects) parts.sort();
    return "[" + parts.join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => !HIDDEN_ENTRY_KEYS.has(k))
      .sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

/** Detect a value that should render as a nested mini-table:
 * an array of plain objects (not ResolvedValue wrappers). */
function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "object" && v !== null && !isResolvedValue(v))
  );
}

function normalizeForCompare(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isResolvedValue(value)) return String(value.raw);
  if (typeof value === "object") return canonicalStringify(value);
  return String(value);
}

function isObjectCollection(value: unknown): value is CollectionEntry[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
}

function getCollectionEntries(
  rawProfiles: Record<string, Record<string, unknown>>,
  profileName: string,
  collectionKey: string,
): CollectionEntry[] {
  // Support dot-notation paths like "ftgd-wf.filters" or "_url_filter.entries"
  let obj: unknown = rawProfiles[profileName];
  for (const part of collectionKey.split(".")) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      obj = (obj as Record<string, unknown>)[part];
    } else {
      return [];
    }
  }
  return isObjectCollection(obj) ? obj : [];
}

function sortEntryKeys(keys: string[]): string[] {
  return [...keys].sort((left, right) => {
    const li = ENTRY_KEY_PRIORITY.indexOf(left);
    const ri = ENTRY_KEY_PRIORITY.indexOf(right);
    if (li !== -1 || ri !== -1) {
      if (li === -1) return 1;
      if (ri === -1) return -1;
      return li - ri;
    }
    return left.localeCompare(right);
  });
}

/** Extract a readable label from a value that may be a ResolvedValue,
 * array, primitive, etc. Prefers human-readable display names. */
function categoryMatchToken(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isResolvedValue(value)) {
    // Prefer the display name (e.g. "Personal Websites and Blogs") over the
    // raw integer id — ids can differ across profiles but names align.
    return value.display.toLowerCase().trim();
  }
  if (Array.isArray(value)) {
    return value.map(categoryMatchToken).filter(Boolean).join("|");
  }
  return String(value).toLowerCase().trim();
}

/** Fuzzy URL normalization: strip scheme, www., leading wildcards,
 * trailing slashes and lowercase. Makes "http://www.example.com/" and
 * "*.example.com" match so comparable rows line up.*/
function normalizeUrlForMatch(url: string): string {
  let u = url.toLowerCase().trim();
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/^\*\./, "");
  u = u.replace(/^www\./, "");
  u = u.replace(/\/+$/, "");
  return u;
}

function entryMatchKey(entry: CollectionEntry, matchByUrl: boolean, collectionKey: string): string {
  // For web filter category entries (ftgd-wf.filters), prioritize category name
  // over id — ids can differ across profiles but category names are stable.
  const isFtgdFilter = collectionKey.includes("ftgd-wf") || collectionKey.includes("filters");
  if (isFtgdFilter && entry.category !== undefined && entry.category !== null) {
    const token = categoryMatchToken(entry.category);
    if (token) return `cat:${token}`;
  }
  // URL-filter entries: align by normalized URL first when toggle is on so
  // similar URLs across profiles line up for comparison.
  if (matchByUrl && typeof entry.url === "string") {
    return `url:${normalizeUrlForMatch(entry.url)}`;
  }
  if (entry.id !== undefined && entry.id !== null) return `id:${entry.id}`;
  if (typeof entry.name === "string") return `name:${entry.name}`;
  if (entry.category !== undefined && entry.category !== null)
    return `cat:${categoryMatchToken(entry.category) || normalizeForCompare(entry.category)}`;
  if (entry.rule !== undefined) return `rule:${normalizeForCompare(entry.rule)}`;
  return "";
}

interface MatchedRow {
  matchKey: string;
  label: string;
  entries: (CollectionEntry | null)[];
}

function matchEntries(
  profileNames: string[],
  rawProfiles: Record<string, Record<string, unknown>>,
  collectionKey: string,
  matchByUrl: boolean = true,
): MatchedRow[] {
  const profileMaps: Map<string, CollectionEntry>[] = profileNames.map((name) => {
    const entries = getCollectionEntries(rawProfiles, name, collectionKey);
    const m = new Map<string, CollectionEntry>();
    entries.forEach((e, i) => {
      const key = entryMatchKey(e, matchByUrl, collectionKey) || `pos:${i}`;
      m.set(key, e);
    });
    return m;
  });

  const seen = new Set<string>();
  const orderedKeys: string[] = [];
  for (const map of profileMaps) {
    for (const key of map.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        orderedKeys.push(key);
      }
    }
  }

  return orderedKeys.map((matchKey) => {
    const entries = profileMaps.map((m) => m.get(matchKey) ?? null);
    const first = entries.find((e) => e !== null)!;
    const id = first.id;
    let label = typeof id === "number" || typeof id === "string" ? `Entry ${id}` : matchKey;
    if (first.name && typeof first.name === "string") label = first.name;
    else if (first.category !== undefined && first.category !== null) {
      const catVal = first.category;
      if (Array.isArray(catVal)) {
        label = `Category ${catVal.map((c) => (isResolvedValue(c) ? c.display : String(c))).join(", ")}`;
      } else if (isResolvedValue(catVal)) {
        label = `Category ${catVal.display}`;
      } else {
        label = `Category ${String(catVal)}`;
      }
    } else if (typeof first.url === "string") {
      label = first.url;
    }
    return { matchKey, label, entries };
  });
}

// ---------------------------------------------------------------------------
// NestedObjectTable — render an array-of-objects (e.g. SD-WAN sla list,
// nested DLP entries) as a compact table inside a parent row's cell.
// ---------------------------------------------------------------------------
function NestedObjectTable({ rows }: { rows: Record<string, unknown>[] }) {
  // Collect every column from every row, hiding identifier noise.
  const columns = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!HIDDEN_ENTRY_KEYS.has(key)) seen.add(key);
      }
    }
    return sortEntryKeys([...seen]);
  }, [rows]);

  return (
    <div className="rounded-md border border-slate-700/50 overflow-hidden scc-fade-in">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-slate-800/60">
            {columns.map((col) => (
              <th
                key={col}
                className="px-1.5 py-1 text-left font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-700/40 text-[10px] whitespace-nowrap"
              >
                {humanizeKey(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-slate-800/40 last:border-0 hover:bg-slate-800/20"
            >
              {columns.map((col) => {
                const cell = row[col];
                if (isActionKey(col)) {
                  return (
                    <td key={col} className="px-1.5 py-1 align-top">
                      <ActionBadge value={formatValue(cell)} />
                    </td>
                  );
                }
                return (
                  <td
                    key={col}
                    className="px-1.5 py-1 align-top text-slate-300 break-words"
                  >
                    {formatValue(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-1.5 py-0.5 text-[10px] text-slate-600 bg-slate-900/40 border-t border-slate-800/30">
        {rows.length} {rows.length === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dense entry row — single-line grid row with preview cells + expand-in-place
// detail. Replaces the fat collapsible card layout; preserves expand-to-full
// per-profile matrix behavior.
// ---------------------------------------------------------------------------

const PREVIEW_COLUMN_LIMIT = 3;

/* Fixed-width track for the entry label / field-name column. Both the
 * summary row and the expanded detail grid use this *same* literal so
 * the field column starts and ends at exactly the same x-coordinate in
 * both grids, even when the preview-column count and profile-count
 * differ (e.g. 2-profile comparisons with 3 preview columns). Using an
 * fr unit here would make the label width depend on how many fr
 * neighbours share the row, so 2-profile details drifted ~85px from
 * 3-preview summaries. A percentage track is container-relative and
 * keeps the two grids pinned regardless of neighbour count. */
const LABEL_COL_TRACK = "minmax(9rem, 28%)";

function buildGridTemplate(previewCount: number): string {
  // chevron | label | preview columns... | status pill
  return `14px ${LABEL_COL_TRACK} ${"minmax(0, 1fr) ".repeat(previewCount)}5.5rem`;
}

function buildDetailTemplate(profileCount: number): string {
  // Same skeleton as buildGridTemplate but with per-profile columns
  // filling the middle region; the left/right fixed tracks and the
  // label column are kept identical so rows line up cell-for-cell.
  return `14px ${LABEL_COL_TRACK} ${"minmax(0, 1fr) ".repeat(profileCount)}5.5rem`;
}

interface FieldDiffInfo {
  differs: boolean;
  /** First non-null value across profiles; used as the preview value when all
   *  profiles agree (and ignored when they differ). */
  firstValue: unknown;
}

function computeFieldDiffs(
  entries: (CollectionEntry | null)[],
  keys: string[],
): Record<string, FieldDiffInfo> {
  const result: Record<string, FieldDiffInfo> = {};
  for (const key of keys) {
    const vals = entries.map((e) => (e ? normalizeForCompare(e[key]) : ""));
    const nonMissing = vals.filter((v) => v !== "");
    const differs =
      new Set(nonMissing).size > 1 ||
      (vals.some((v) => v === "") && nonMissing.length > 0);
    const firstIdx = entries.findIndex((e) => e !== null);
    result[key] = {
      differs,
      firstValue: firstIdx >= 0 ? entries[firstIdx]?.[key] : undefined,
    };
  }
  return result;
}

function PreviewCell({
  diff,
  columnKey,
}: {
  diff: FieldDiffInfo | undefined;
  columnKey: string;
}) {
  if (!diff || diff.firstValue === undefined) {
    return <span className="text-slate-700 text-[11px]">—</span>;
  }
  if (diff.differs) {
    return (
      <span
        className="inline-flex items-center rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-px text-[10px] text-amber-300 font-semibold"
        title="Values differ across profiles — click row to expand"
      >
        ≠
      </span>
    );
  }
  const display = formatValue(diff.firstValue);
  if (display === "—") {
    return <span className="text-slate-700 text-[11px]">—</span>;
  }
  if (isActionKey(columnKey)) {
    return <ActionBadge value={display} />;
  }
  return (
    <span
      className="block text-[11px] text-slate-400 truncate"
      title={display}
    >
      {display}
    </span>
  );
}

function StatusPill({
  diffCount,
  missingCount,
}: {
  diffCount: number;
  missingCount: number;
}) {
  if (diffCount === 0 && missingCount === 0) {
    return (
      <div className="flex justify-end">
        <span className="inline-flex items-center rounded-full border border-emerald-900/60 bg-emerald-950/40 px-1.5 py-px text-[10px] text-emerald-300">
          ✓
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1">
      {missingCount > 0 && (
        <span className="rounded-full border border-red-900/60 bg-red-950/40 px-1.5 py-px text-[10px] text-red-300 tabular-nums">
          {missingCount}⌀
        </span>
      )}
      {diffCount > 0 && (
        <span className="rounded-full border border-amber-900/60 bg-amber-950/40 px-1.5 py-px text-[10px] text-amber-300 font-semibold tabular-nums">
          {diffCount}≠
        </span>
      )}
    </div>
  );
}

function DenseEntryRow({
  row,
  profileNames,
  hiddenColumns,
  previewColumns,
  availableColumns,
  expanded,
  onToggle,
  isLast,
}: {
  row: MatchedRow;
  profileNames: string[];
  hiddenColumns: Set<string>;
  previewColumns: string[];
  /** Full field universe for this collection (schema ∪ data across all
   *  rows). When the user expands a row we show every one of these, not
   *  just the keys that happen to be populated in this specific row —
   *  otherwise fields that exist on other rows (or that FMG's schema
   *  defines but this profile leaves unset) silently disappear. */
  availableColumns: string[];
  expanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  // Full sorted field list for this collection, independent of which
  // fields this particular row happens to populate. Noise keys (oid,
  // obj seq, last-modified) are stripped; the FieldVisibilityMenu can
  // hide anything else the user doesn't want to see.
  const allKeys = useMemo(() => {
    return sortEntryKeys(
      availableColumns.filter((k) => !HIDDEN_ENTRY_KEYS.has(k)),
    );
  }, [availableColumns]);

  const fieldDiffs = useMemo(
    () => computeFieldDiffs(row.entries, allKeys),
    [row.entries, allKeys],
  );

  const diffCount = Object.values(fieldDiffs).filter(
    (d) => d.differs,
  ).length;
  const missingCount = row.entries.filter((e) => e === null).length;

  const visibleKeys = useMemo(() => {
    if (hiddenColumns.size === 0) return allKeys;
    return allKeys.filter((k) => !hiddenColumns.has(k));
  }, [allKeys, hiddenColumns]);

  const borderClass = isLast ? "" : "border-b border-slate-800/50";
  const hoverClass = "hover:bg-slate-800/30";
  const driftClass = diffCount > 0 ? "bg-amber-950/10" : "";

  return (
    <>
      {/* Summary row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`scc-entry-row grid items-center gap-2 px-3 py-1.5 cursor-pointer transition ${borderClass} ${hoverClass} ${driftClass}`}
      >
        <span className="text-slate-600 text-[9px] leading-none select-none">
          {expanded ? "▼" : "▶"}
        </span>
        <span
          className="text-[12px] font-medium text-slate-200 min-w-0 truncate"
          title={row.label}
        >
          {row.label}
        </span>
        {previewColumns.map((col) => (
          <div key={col} className="min-w-0">
            <PreviewCell diff={fieldDiffs[col]} columnKey={col} />
          </div>
        ))}
        <StatusPill diffCount={diffCount} missingCount={missingCount} />
      </div>

      {/* Expanded detail — per-field grid rows whose chevron gutter,
          field column, and status gutter align exactly with the parent
          summary row's three fixed tracks. The label track width is a
          fixed percentage of the container (shared with buildGridTemplate
          via LABEL_COL_TRACK), so rows line up regardless of how many
          preview-columns vs. profile-columns share the middle fr pool. */}
      {expanded && (
        <div
          className={`scc-entry-detail bg-slate-950/60 ${isLast ? "" : "border-b border-slate-800/50"}`}
          style={{
            ["--scc-detail-cols" as string]: buildDetailTemplate(
              profileNames.length,
            ),
          }}
        >
          {/* Field-level header — profile names in each profile column */}
          <div
            className="grid items-center gap-2 px-3 py-1.5 border-b border-slate-800/60 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
            style={{ gridTemplateColumns: "var(--scc-detail-cols)" }}
          >
            <span />
            <span>Field</span>
            {profileNames.map((name) => (
              <span
                key={name}
                className="font-mono text-slate-600 truncate normal-case min-w-0"
                title={name}
              >
                {name}
              </span>
            ))}
            <span />
          </div>

          {visibleKeys.map((key) => {
            const diff = fieldDiffs[key];
            return (
              <div
                key={key}
                className={`grid items-start gap-2 px-3 py-1.5 border-t ${
                  diff.differs
                    ? "bg-amber-950/15 border-amber-900/20"
                    : "border-slate-800/30"
                }`}
                style={{ gridTemplateColumns: "var(--scc-detail-cols)" }}
              >
                <span />
                <div className="text-[11px] font-mono text-slate-500 break-all min-w-0">
                  {key}
                  {diff.differs && (
                    <span className="ml-1 text-amber-400 text-[10px]">≠</span>
                  )}
                </div>
                {row.entries.map((entry, i) => {
                  const val = entry ? entry[key] : undefined;
                  const isMissing = !entry;
                  const isAction = isActionKey(key);
                  return (
                    <div key={profileNames[i]} className="min-w-0">
                      {isMissing ? (
                        <span className="block text-[11px] text-slate-700 italic">
                          —
                        </span>
                      ) : isAction ? (
                        <ActionBadge value={formatValue(val)} />
                      ) : isObjectArray(val) ? (
                        <NestedObjectTable rows={val} />
                      ) : (
                        <SmartValue
                          value={val}
                          className={`block whitespace-pre-wrap break-all text-[11px] ${
                            diff.differs
                              ? "text-slate-100 font-medium"
                              : "text-slate-400"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
                <span />
              </div>
            );
          })}
          {visibleKeys.length === 0 && (
            <div className="px-4 py-4 text-center text-slate-600 text-xs">
              No fields visible.
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detect if collection has URL entries (for toggle)
// ---------------------------------------------------------------------------
function collectionHasUrlEntries(
  profileNames: string[],
  rawProfiles: Record<string, Record<string, unknown>>,
  collectionKey: string,
): boolean {
  for (const name of profileNames) {
    const entries = getCollectionEntries(rawProfiles, name, collectionKey);
    if (entries.some((e) => typeof e.url === "string")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StructuredCollectionComparison({
  collectionKey,
  profileNames,
  rawProfiles,
  schema,
}: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expandState, setExpandState] = useState<boolean | undefined>(undefined);
  const [matchByUrl, setMatchByUrl] = useState(true);

  // Per-collection column visibility (persisted in localStorage). Tracks
  // *hidden* entry-key names so newly-discovered keys default to visible.
  const visibilityKey = `scc:${collectionKey}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHiddenColumns(loadHiddenFields(visibilityKey));
  }, [visibilityKey]);

  const label = humanizeKey(collectionKey);

  const hasUrlEntries = useMemo(
    () => collectionHasUrlEntries(profileNames, rawProfiles, collectionKey),
    [profileNames, rawProfiles, collectionKey],
  );

  // Walk the schema's subobjects tree to find the field list for this
  // collection. FMG syntax exposes nested tables under `subobj.<name>`, e.g.
  // webfilter `ftgd-wf.filters` lives at `subobj.ftgd-wf.subobj.filters`.
  // We try the last dotted segment as the subobj name (good enough for the
  // collections we care about) and fall back to data-driven discovery.
  const schemaSubFields = useMemo(() => {
    if (!schema?.subobjects) return undefined;
    const parts = collectionKey.split(".");
    const last = parts[parts.length - 1];
    const hit = schema.subobjects[last] ?? schema.subobjects[collectionKey];
    return hit;
  }, [schema, collectionKey]);

  const matchedRows = useMemo(
    () => matchEntries(profileNames, rawProfiles, collectionKey, matchByUrl),
    [profileNames, rawProfiles, collectionKey, matchByUrl],
  );

  // Discover every entry-key across every matched entry in the current
  // data. This is our fallback (and always present) source of columns.
  const dataColumns = useMemo(() => {
    const seen = new Set<string>();
    for (const row of matchedRows) {
      for (const entry of row.entries) {
        if (!entry) continue;
        for (const k of Object.keys(entry)) {
          if (!HIDDEN_ENTRY_KEYS.has(k)) seen.add(k);
        }
      }
    }
    return [...seen];
  }, [matchedRows]);

  // Merge schema-defined columns with data-observed ones so the user can
  // toggle columns that aren't present on the current profile but exist in
  // the FMG schema (they'll flip back on when another profile populates them).
  const availableColumns = useMemo(() => {
    if (!schemaSubFields) return dataColumns;
    const seen = new Set<string>(dataColumns);
    for (const f of schemaSubFields) seen.add(f.name);
    return [...seen];
  }, [dataColumns, schemaSubFields]);

  const rowsWithCounts = useMemo(() => {
    return matchedRows.map((row) => {
      const allKeys = new Set<string>();
      for (const entry of row.entries) {
        if (entry)
          Object.keys(entry)
            .filter((k) => !HIDDEN_ENTRY_KEYS.has(k))
            .forEach((k) => allKeys.add(k));
      }
      let diffCount = 0;
      for (const key of allKeys) {
        const vals = row.entries.map((e) => (e ? normalizeForCompare(e[key]) : ""));
        const nonMissing = vals.filter((v) => v !== "");
        if (
          new Set(nonMissing).size > 1 ||
          (vals.some((v) => v === "") && nonMissing.length > 0)
        ) {
          diffCount++;
        }
      }
      return { row, diffCount };
    });
  }, [matchedRows]);

  const totalEntries = matchedRows.length;
  const diffEntries = rowsWithCounts.filter((r) => r.diffCount > 0).length;
  const syncEntries = totalEntries - diffEntries;

  const filteredRows = useMemo(() => {
    if (filter === "differs") return rowsWithCounts.filter((r) => r.diffCount > 0);
    if (filter === "in_sync") return rowsWithCounts.filter((r) => r.diffCount === 0);
    return rowsWithCounts;
  }, [rowsWithCounts, filter]);

  if (totalEntries === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-white">{label}</h3>
          <p className="text-sm text-slate-500">
            {totalEntries} matched entries across {profileNames.length} profiles
            {diffEntries > 0 && (
              <span className="text-amber-400 ml-2">
                · {diffEntries} with differences
              </span>
            )}
            {syncEntries > 0 && (
              <span className="text-emerald-400 ml-2">
                · {syncEntries} in sync
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            ["all", "All"],
            ["differs", "Differs"],
            ["in_sync", "In Sync"],
          ] as [FilterMode, string][]
        ).map(([mode, lbl]) => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition ${
              filter === mode
                ? "bg-cyan-600 text-white"
                : "bg-slate-800 text-slate-500 hover:text-white"
            }`}
          >
            {lbl}
          </button>
        ))}

        {hasUrlEntries && (
          <>
            <div className="h-4 w-px bg-slate-800 mx-1" />
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={matchByUrl}
                onChange={(e) => setMatchByUrl(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-cyan-600 focus:ring-offset-0 h-3.5 w-3.5"
              />
              Align by URL
            </label>
          </>
        )}

        <FieldVisibilityMenu
          storageKey={visibilityKey}
          available={availableColumns}
          hidden={hiddenColumns}
          onChange={setHiddenColumns}
          labelOf={(f) => humanizeKey(f)}
          buttonLabel="Columns"
          schemaFields={schemaSubFields}
          presentInData={dataColumns}
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setExpandState(true)}
            className="text-[11px] text-slate-600 hover:text-slate-300 transition"
          >
            Expand All
          </button>
          <span className="text-slate-800">|</span>
          <button
            onClick={() => setExpandState(false)}
            className="text-[11px] text-slate-600 hover:text-slate-300 transition"
          >
            Collapse All
          </button>
        </div>
      </div>

      <DenseEntryList
        filteredRows={filteredRows}
        profileNames={profileNames}
        hiddenColumns={hiddenColumns}
        availableColumns={availableColumns}
        forceExpanded={expandState}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// DenseEntryList — wraps all matched rows in a shared grid container so the
// preview columns align across rows without a per-row <table>.
// ---------------------------------------------------------------------------

function DenseEntryList({
  filteredRows,
  profileNames,
  hiddenColumns,
  availableColumns,
  forceExpanded,
}: {
  filteredRows: { row: MatchedRow; diffCount: number }[];
  profileNames: string[];
  hiddenColumns: Set<string>;
  availableColumns: string[];
  forceExpanded: boolean | undefined;
}) {
  // Preview columns — priority-sorted, visible-only, capped at 3. These are
  // the fields that get shown inline on the collapsed row; everything else
  // lives in the expand-in-place detail.
  const previewColumns = useMemo(() => {
    const visible = availableColumns.filter((k) => !hiddenColumns.has(k));
    return sortEntryKeys(visible).slice(0, PREVIEW_COLUMN_LIMIT);
  }, [availableColumns, hiddenColumns]);

  const gridTemplate = buildGridTemplate(previewColumns.length);

  // Per-row expand state, keyed by matchKey. Expand All / Collapse All hooks
  // into this via the forceExpanded prop.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (forceExpanded === true) {
      setExpandedKeys(new Set(filteredRows.map((r) => r.row.matchKey)));
    } else if (forceExpanded === false) {
      setExpandedKeys(new Set());
    }
  }, [forceExpanded, filteredRows]);

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (filteredRows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 px-4 py-6 text-center text-sm text-slate-500">
        No entries match the current filter.
      </div>
    );
  }

  return (
    <div
      className="scc-entry-grid rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden"
      style={{ ["--scc-grid-cols" as string]: gridTemplate }}
    >
      {/* Header row */}
      <div className="scc-entry-header grid items-center gap-2 px-3 py-1.5 bg-slate-950/70 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
        <span />
        <span>Entry</span>
        {previewColumns.map((col) => (
          <span key={col} className="truncate" title={humanizeKey(col)}>
            {humanizeKey(col)}
          </span>
        ))}
        <span className="text-right">Δ</span>
      </div>

      {filteredRows.map(({ row }, i) => (
        <DenseEntryRow
          key={row.matchKey}
          row={row}
          profileNames={profileNames}
          hiddenColumns={hiddenColumns}
          previewColumns={previewColumns}
          availableColumns={availableColumns}
          expanded={expandedKeys.has(row.matchKey)}
          onToggle={() => toggle(row.matchKey)}
          isLast={i === filteredRows.length - 1}
        />
      ))}
    </div>
  );
}
