"use client";

import { useMemo, useState, useEffect } from "react";

interface Props {
  collectionKey: string;
  profileNames: string[];
  rawProfiles: Record<string, Record<string, unknown>>;
  defaults?: Record<string, unknown>;
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

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
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
  const value = rawProfiles[profileName]?.[collectionKey];
  return isObjectCollection(value) ? value : [];
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

function entryMatchKey(entry: CollectionEntry): string {
  if (entry.id !== undefined && entry.id !== null) return `id:${entry.id}`;
  if (typeof entry.name === "string") return `name:${entry.name}`;
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
): MatchedRow[] {
  const profileMaps: Map<string, CollectionEntry>[] = profileNames.map((name) => {
    const entries = getCollectionEntries(rawProfiles, name, collectionKey);
    const m = new Map<string, CollectionEntry>();
    entries.forEach((e, i) => {
      const key = entryMatchKey(e) || `pos:${i}`;
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
    return { matchKey, label, entries };
  });
}

function isDefaultValue(
  key: string,
  value: unknown,
  defaults: Record<string, unknown> | undefined,
): boolean {
  if (!defaults) return false;
  const defVal = defaults[key];
  if (defVal === undefined) return false;
  return normalizeForCompare(value) === normalizeForCompare(defVal);
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function MatchedEntryRow({
  row,
  profileNames,
  hideDefaults,
  defaults,
  forceExpanded,
}: {
  row: MatchedRow;
  profileNames: string[];
  hideDefaults: boolean;
  defaults?: Record<string, unknown>;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (forceExpanded !== undefined) setExpanded(forceExpanded);
  }, [forceExpanded]);

  const allKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of row.entries) {
      if (entry) Object.keys(entry).filter((k) => !HIDDEN_ENTRY_KEYS.has(k)).forEach((k) => keys.add(k));
    }
    return sortEntryKeys([...keys]);
  }, [row.entries]);

  const fieldDiffs = useMemo(() => {
    const result: Record<string, { differs: boolean }> = {};
    for (const key of allKeys) {
      const vals = row.entries.map((e) => (e ? normalizeForCompare(e[key]) : ""));
      const nonMissing = vals.filter((v) => v !== "");
      const differs =
        new Set(nonMissing).size > 1 ||
        (vals.some((v) => v === "") && nonMissing.length > 0);
      result[key] = { differs };
    }
    return result;
  }, [allKeys, row.entries]);

  const diffCount = Object.values(fieldDiffs).filter((d) => d.differs).length;
  const allPresent = row.entries.every((e) => e !== null);
  const missingCount = row.entries.filter((e) => e === null).length;

  const visibleKeys = useMemo(() => {
    if (!hideDefaults) return allKeys;
    return allKeys.filter((key) =>
      row.entries.some((entry) => {
        if (!entry) return true;
        return !isDefaultValue(key, entry[key], defaults);
      }),
    );
  }, [allKeys, hideDefaults, defaults, row.entries]);

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        diffCount > 0
          ? "border-amber-900/50 bg-slate-900/60"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/40 transition"
      >
        <span className="text-slate-600 text-[10px] w-3">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="text-sm font-semibold text-slate-100 min-w-0 truncate">
          {row.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!allPresent && (
            <span className="rounded-full border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-[10px] text-red-300">
              {missingCount} missing
            </span>
          )}
          {diffCount > 0 ? (
            <span className="rounded-full border border-amber-900/60 bg-amber-950/40 px-2 py-0.5 text-[10px] text-amber-300 font-semibold">
              {diffCount} differ{diffCount !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300">
              ✓ In sync
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: "15%" }} />
              {profileNames.map((n) => (
                <col key={n} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800">
                <th className="px-3 py-2 text-left text-[11px] font-medium text-slate-500 uppercase">
                  Field
                </th>
                {profileNames.map((name) => (
                  <th
                    key={name}
                    className="px-3 py-2 text-left text-[11px] font-medium text-slate-500 font-mono break-all"
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleKeys.map((key) => {
                const diff = fieldDiffs[key];
                return (
                  <tr
                    key={key}
                    className={
                      diff.differs
                        ? "bg-amber-950/20 border-t border-amber-900/30"
                        : "border-t border-slate-800/40"
                    }
                  >
                    <td className="px-3 py-2 text-xs font-mono text-slate-400 break-all align-top">
                      {key}
                      {diff.differs && (
                        <span className="ml-1 text-amber-400 text-[10px]">≠</span>
                      )}
                    </td>
                    {row.entries.map((entry, i) => {
                      const val = entry ? entry[key] : undefined;
                      const formatted = entry ? formatValue(val) : "—";
                      const isMissing = !entry;
                      const isFieldDefault =
                        !!entry && isDefaultValue(key, val, defaults);
                      return (
                        <td key={profileNames[i]} className="px-3 py-2 align-top">
                          <span
                            className={`block whitespace-pre-wrap break-all text-xs ${
                              isMissing
                                ? "text-slate-600 italic"
                                : diff.differs
                                ? "text-slate-100 font-medium"
                                : isFieldDefault
                                ? "text-slate-600"
                                : "text-slate-400"
                            }`}
                          >
                            {formatted}
                            {isFieldDefault && (
                              <span className="ml-1 text-[10px] text-slate-700">
                                (default)
                              </span>
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {visibleKeys.length === 0 && (
                <tr>
                  <td
                    colSpan={profileNames.length + 1}
                    className="px-4 py-6 text-center text-slate-600 text-sm"
                  >
                    {hideDefaults
                      ? "All fields are at default values."
                      : "No fields found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StructuredCollectionComparison({
  collectionKey,
  profileNames,
  rawProfiles,
  defaults,
}: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [hideDefaults, setHideDefaults] = useState(false);
  const [expandState, setExpandState] = useState<boolean | undefined>(undefined);

  const label = humanizeKey(collectionKey);

  // Extract entry-level defaults from the full profile defaults object
  const entryDefaults = useMemo(() => {
    if (!defaults) return undefined;
    const col = defaults[collectionKey];
    if (Array.isArray(col) && col.length > 0 && typeof col[0] === "object") {
      return col[0] as Record<string, unknown>;
    }
    return undefined;
  }, [defaults, collectionKey]);

  const matchedRows = useMemo(
    () => matchEntries(profileNames, rawProfiles, collectionKey),
    [profileNames, rawProfiles, collectionKey],
  );

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

        <div className="h-4 w-px bg-slate-800 mx-1" />

        <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideDefaults}
            onChange={(e) => setHideDefaults(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-cyan-600 focus:ring-offset-0 h-3.5 w-3.5"
          />
          Hide defaults
        </label>

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

      <div className="space-y-2">
        {filteredRows.map(({ row }) => (
          <MatchedEntryRow
            key={row.matchKey}
            row={row}
            profileNames={profileNames}
            hideDefaults={hideDefaults}
            defaults={entryDefaults}
            forceExpanded={expandState}
          />
        ))}
        {filteredRows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 px-4 py-6 text-center text-sm text-slate-500">
            No entries match the current filter.
          </div>
        )}
      </div>
    </section>
  );
}
