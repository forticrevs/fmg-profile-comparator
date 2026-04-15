"use client";

/**
 * WebFilterCategoryTable — alignment by *category*, not by array index.
 *
 * FMG webfilter profiles store ftgd-wf.filters as a list of filter rules,
 * where each rule targets one or more category IDs. Two profiles can apply
 * radically different policies to the same category, and the same category
 * can live at different array indices in different profiles. The flat
 * field-by-field comparison aligns by index and is therefore meaningless
 * for category-level analysis.
 *
 * This view *unrolls* every filter rule into per-category rows. Each row =
 * one category name; each column = one profile. The cell shows what that
 * profile does for that category (action badge by default, full per-field
 * breakdown when expanded).
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import ActionBadge, { isActionKey } from "@/components/ActionBadge";
import FieldVisibilityMenu, {
  loadHiddenFields,
} from "@/components/FieldVisibilityMenu";
import type { SchemaResponse } from "@/lib/api";

interface Props {
  profileNames: string[];
  rawProfiles: Record<string, Record<string, unknown>>;
  /** Optional FMG syntax schema for the current profile type. Used to
   *  surface filter-entry fields that exist in the schema but happen
   *  not to be populated in any of the currently compared profiles. */
  schema?: SchemaResponse | null;
}

type FilterEntry = Record<string, unknown>;
type ResolvedValue = { raw: unknown; display: string };

const HIDDEN_FILTER_KEYS = new Set([
  "oid",
  "obj seq",
  "id",
  "category", // becomes the row key, hide as a column
  "uuid",
  "last-modified",
]);

function isResolvedValue(v: unknown): v is ResolvedValue {
  return (
    typeof v === "object" &&
    v !== null &&
    "raw" in (v as object) &&
    "display" in (v as object)
  );
}

function humanize(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (isResolvedValue(v)) return v.display;
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map(formatScalar).join(", ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* ------------------------------------------------------------------ */
/* Profile-shape navigation                                            */
/* ------------------------------------------------------------------ */

/** Navigate the (potentially wrapped) ftgd-wf block to its filters list. */
function getFilters(profile: Record<string, unknown>): FilterEntry[] {
  let block: unknown = profile["ftgd-wf"];
  // Some FMG responses wrap single objects in a one-element list.
  if (Array.isArray(block) && block.length === 1) block = block[0];
  if (!block || typeof block !== "object") return [];
  const filters = (block as Record<string, unknown>).filters;
  if (!Array.isArray(filters)) return [];
  return filters.filter(
    (f): f is FilterEntry => typeof f === "object" && f !== null,
  );
}

/** A filter's `category` field can be: a scalar id, a single ResolvedValue,
 * a list of scalars, or a list of ResolvedValues. Normalize to a flat list of
 * {key, display} tuples used for grouping rows. */
function extractCategories(
  raw: unknown,
): { key: string; display: string }[] {
  const out: { key: string; display: string }[] = [];
  const push = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (isResolvedValue(v)) {
      const display = String(v.display).trim();
      const rawStr = String(v.raw);
      out.push({ key: display.toLowerCase() || `id:${rawStr}`, display });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    const s = String(v).trim();
    if (s) out.push({ key: `id:${s}`, display: s });
  };
  push(raw);
  return out;
}

/* ------------------------------------------------------------------ */
/* Row builder                                                         */
/* ------------------------------------------------------------------ */

interface CategoryRow {
  key: string;
  display: string;
  /** profile name -> the matching filter entry (or null if absent) */
  byProfile: Record<string, FilterEntry | null>;
}

function buildRows(
  profileNames: string[],
  rawProfiles: Record<string, Record<string, unknown>>,
): CategoryRow[] {
  // Preserve first-seen order so the table feels stable across renders.
  const order: string[] = [];
  const byKey = new Map<string, CategoryRow>();

  for (const name of profileNames) {
    const profile = rawProfiles[name];
    if (!profile) continue;
    for (const filter of getFilters(profile)) {
      const cats = extractCategories(filter.category);
      if (cats.length === 0) continue;
      for (const { key, display } of cats) {
        let row = byKey.get(key);
        if (!row) {
          row = {
            key,
            display,
            byProfile: Object.fromEntries(
              profileNames.map((n) => [n, null]),
            ),
          };
          byKey.set(key, row);
          order.push(key);
        }
        // Last-write-wins is fine: if a single profile has two filter rules
        // targeting the same category (rare/buggy config), the *later* rule
        // is what FMG would apply anyway since rules cascade by index.
        row.byProfile[name] = filter;
      }
    }
  }

  return order.map((k) => byKey.get(k)!);
}

/* ------------------------------------------------------------------ */
/* Diff detection                                                      */
/* ------------------------------------------------------------------ */

function normalizeForCompare(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (isResolvedValue(v)) return String(v.raw);
  if (Array.isArray(v)) {
    return (
      "[" +
      [...v]
        .map(normalizeForCompare)
        .sort()
        .join(",") +
      "]"
    );
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return (
      "{" +
      Object.keys(obj)
        .filter((k) => !HIDDEN_FILTER_KEYS.has(k))
        .sort()
        .map((k) => `${k}:${normalizeForCompare(obj[k])}`)
        .join(",") +
      "}"
    );
  }
  return String(v);
}

function rowDiffCount(
  row: CategoryRow,
  profileNames: string[],
  visibleKeys: string[],
): number {
  let count = 0;
  for (const key of visibleKeys) {
    const vals = profileNames.map((n) => {
      const f = row.byProfile[n];
      return f ? normalizeForCompare(f[key]) : "__missing__";
    });
    if (new Set(vals).size > 1) count++;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

type FilterMode = "all" | "differs" | "in_sync";

export default function WebFilterCategoryTable({
  profileNames,
  rawProfiles,
  schema,
}: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [forceExpand, setForceExpand] = useState<boolean | null>(null);

  // Build rows once per data change.
  const rows = useMemo(
    () => buildRows(profileNames, rawProfiles),
    [profileNames, rawProfiles],
  );

  // Schema-defined fields for the ftgd-wf.filters subobject. FMG exposes
  // these under subobjects["filters"] — we merge them into availableFields
  // so fields defined by the schema but absent from every currently
  // compared profile still show up in the visibility menu.
  const schemaFilterFields = useMemo(() => {
    const subs = schema?.subobjects;
    if (!subs) return undefined;
    return subs["ftgd-wf.filters"] ?? subs["filters"];
  }, [schema]);

  // Discover the union of filter-entry field names (excluding noise like
  // category/id) across every profile and merge with schema-defined
  // fields so the expanded detail and column menu show the complete
  // field universe.
  const availableFields = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const f of Object.values(row.byProfile)) {
        if (!f) continue;
        for (const k of Object.keys(f)) {
          if (!HIDDEN_FILTER_KEYS.has(k)) seen.add(k);
        }
      }
    }
    if (schemaFilterFields) {
      for (const f of schemaFilterFields) {
        if (!HIDDEN_FILTER_KEYS.has(f.name)) seen.add(f.name);
      }
    }
    // Sort with action / log up front since they're the most-watched fields.
    const priority = ["action", "log", "warning-duration", "warning-prompt"];
    return [...seen].sort((a, b) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });
  }, [rows, schemaFilterFields]);

  const visibilityKey = "wfcat:columns";
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHiddenFields(loadHiddenFields(visibilityKey));
  }, []);

  const visibleFields = useMemo(
    () => availableFields.filter((f) => !hiddenFields.has(f)),
    [availableFields, hiddenFields],
  );

  // Per-row diff counts (for filter chips + amber row highlight).
  const rowsWithDiffs = useMemo(
    () =>
      rows.map((row) => ({
        row,
        diffCount: rowDiffCount(row, profileNames, visibleFields),
      })),
    [rows, profileNames, visibleFields],
  );

  const filteredRows = useMemo(() => {
    if (filter === "differs") return rowsWithDiffs.filter((r) => r.diffCount > 0);
    if (filter === "in_sync") return rowsWithDiffs.filter((r) => r.diffCount === 0);
    return rowsWithDiffs;
  }, [rowsWithDiffs, filter]);

  // forceExpand drives a single bulk expand/collapse, then yields back to
  // per-row state on the next user click.
  useEffect(() => {
    if (forceExpand === true) {
      setExpanded(new Set(rows.map((r) => r.key)));
      setForceExpand(null);
    } else if (forceExpand === false) {
      setExpanded(new Set());
      setForceExpand(null);
    }
  }, [forceExpand, rows]);

  const totalRows = rows.length;
  const diffRows = rowsWithDiffs.filter((r) => r.diffCount > 0).length;
  const syncRows = totalRows - diffRows;

  if (totalRows === 0) return null;

  const toggleRow = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-white">
          Web Filter Categories
        </h3>
        <p className="text-sm text-slate-500">
          {totalRows} categories aligned across {profileNames.length} profiles
          {diffRows > 0 && (
            <span className="text-amber-400 ml-2">· {diffRows} differ</span>
          )}
          {syncRows > 0 && (
            <span className="text-emerald-400 ml-2">· {syncRows} in sync</span>
          )}
        </p>
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

        <FieldVisibilityMenu
          storageKey={visibilityKey}
          available={availableFields}
          hidden={hiddenFields}
          onChange={setHiddenFields}
          labelOf={humanize}
          buttonLabel="Columns"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setForceExpand(true)}
            className="text-[11px] text-slate-600 hover:text-slate-300 transition"
          >
            Expand All
          </button>
          <span className="text-slate-800">|</span>
          <button
            onClick={() => setForceExpand(false)}
            className="text-[11px] text-slate-600 hover:text-slate-300 transition"
          >
            Collapse All
          </button>
        </div>
      </div>

      <div className="overflow-hidden border border-slate-700/50 rounded-lg">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: "22%" }} />
            {profileNames.map((n) => (
              <col key={n} />
            ))}
            <col style={{ width: 60 }} />
          </colgroup>
          <thead>
            <tr className="bg-slate-900 border-b border-slate-700">
              <th className="px-3 py-2 text-left text-[11px] font-medium text-slate-500 uppercase">
                Category
              </th>
              {profileNames.map((name) => (
                <th
                  key={name}
                  className="px-3 py-2 text-left text-[11px] font-medium text-slate-500 font-mono break-all"
                  title={name}
                >
                  {name}
                </th>
              ))}
              <th className="px-2 py-2 text-center text-[11px] font-medium text-slate-500">
                Sync
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ row, diffCount }) => {
              const isOpen = expanded.has(row.key);
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => toggleRow(row.key)}
                    className={`cursor-pointer border-t border-slate-800/40 ${
                      diffCount > 0
                        ? "bg-amber-950/10 hover:bg-amber-950/20"
                        : "hover:bg-slate-800/20"
                    }`}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 text-[10px] w-3">
                          {isOpen ? "▼" : "▶"}
                        </span>
                        <span className="text-sm font-medium text-slate-100 truncate">
                          {row.display}
                        </span>
                      </div>
                    </td>
                    {profileNames.map((name) => {
                      const f = row.byProfile[name];
                      if (!f) {
                        return (
                          <td
                            key={name}
                            className="px-3 py-2 align-top text-xs text-slate-600 italic"
                          >
                            —
                          </td>
                        );
                      }
                      const action = formatScalar(f.action);
                      return (
                        <td key={name} className="px-3 py-2 align-top">
                          <ActionBadge value={action} />
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center align-top">
                      {diffCount > 0 ? (
                        <span className="text-amber-400 text-xs">≠</span>
                      ) : (
                        <span className="text-emerald-600">✓</span>
                      )}
                    </td>
                  </tr>
                  {isOpen &&
                    visibleFields.map((field) => {
                      const vals = profileNames.map((n) => {
                        const f = row.byProfile[n];
                        return f ? normalizeForCompare(f[field]) : "__missing__";
                      });
                      const differs = new Set(vals).size > 1;
                      return (
                        <tr
                          key={`${row.key}::${field}`}
                          className={
                            differs
                              ? "bg-amber-950/15 border-t border-amber-900/20"
                              : "bg-slate-950/40 border-t border-slate-800/30"
                          }
                        >
                          <td className="px-3 py-1.5 pl-10 text-[11px] font-mono text-slate-500 align-top break-all">
                            {field}
                            {differs && (
                              <span className="ml-1 text-amber-400 text-[10px]">
                                ≠
                              </span>
                            )}
                          </td>
                          {profileNames.map((name) => {
                            const f = row.byProfile[name];
                            if (!f) {
                              return (
                                <td
                                  key={name}
                                  className="px-3 py-1.5 align-top text-[11px] text-slate-700 italic"
                                >
                                  —
                                </td>
                              );
                            }
                            const val = f[field];
                            if (isActionKey(field)) {
                              return (
                                <td key={name} className="px-3 py-1.5 align-top">
                                  <ActionBadge value={formatScalar(val)} />
                                </td>
                              );
                            }
                            return (
                              <td
                                key={name}
                                className={`px-3 py-1.5 align-top text-[11px] whitespace-pre-wrap break-all ${
                                  differs
                                    ? "text-slate-100 font-medium"
                                    : "text-slate-400"
                                }`}
                              >
                                {formatScalar(val)}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-center align-top">
                            {differs && (
                              <span className="text-amber-400 text-[10px]">
                                ≠
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td
                  colSpan={profileNames.length + 2}
                  className="px-4 py-6 text-center text-slate-600 text-sm"
                >
                  No categories match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
