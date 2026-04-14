"use client";

/**
 * UrlFilterComparison — grouped view of URL filter lists referenced by a
 * set of webfilter profiles.
 *
 * FMG webfilter profiles reference a `webfilter.urlfilter` object by
 * integer ID. Multiple profiles can (and routinely do) share the same
 * list — e.g. ACME-Web and ACME-Web-AI both point at list id=2
 * "ACME-URL". Rendering a per-profile side-by-side comparison for
 * shared lists duplicates hundreds of identical rows; rendering it for
 * divergent lists aligns URLs by string-match and produces a sea of
 * amber "missing" cells that obscures the real picture.
 *
 * This view instead groups profiles by the ID of the URL filter list
 * they reference, renders each distinct list *once*, and tags each list
 * with the profile(s) that use it. Profiles with no URL filter attached
 * surface in a separate "unassigned" chip block.
 */

import { useEffect, useMemo, useState } from "react";
import ActionBadge, { isActionKey } from "@/components/ActionBadge";
import FieldVisibilityMenu, {
  loadHiddenFields,
} from "@/components/FieldVisibilityMenu";

interface Props {
  profileNames: string[];
  rawProfiles: Record<string, Record<string, unknown>>;
}

type ResolvedValue = { raw: unknown; display: string };
type UrlEntry = Record<string, unknown>;

interface UrlFilterList {
  /** Integer-ish identifier assigned by the ADOM (e.g. 1, 2, ...). */
  id: string;
  /** FMG internal object id — used alongside `id` as a stable grouping
   *  key in the rare case two entities share the same user-visible id. */
  oid: string;
  name: string;
  comment: string | null;
  entries: UrlEntry[];
  /** Other top-level attributes of the `_url_filter` block
   *  (include-subdomains, ip-addr-block, etc.) — surfaced in the card
   *  header as a compact metadata strip. */
  meta: Record<string, unknown>;
  /** Profiles (from the compared set) that reference this list. */
  usedBy: string[];
}

const HIDDEN_ENTRY_KEYS = new Set(["oid", "last-modified"]);
const PRIORITY_ENTRY_KEYS = [
  "obj seq",
  "id",
  "url",
  "type",
  "action",
  "status",
  "antiphish-action",
];
const HIDDEN_META_KEYS = new Set([
  "id",
  "name",
  "comment",
  "entries",
  "oid",
  "obj seq",
]);

function isResolvedValue(v: unknown): v is ResolvedValue {
  return (
    typeof v === "object" &&
    v !== null &&
    "raw" in (v as object) &&
    "display" in (v as object)
  );
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

function humanize(key: string): string {
  return key
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function sortEntryKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = PRIORITY_ENTRY_KEYS.indexOf(a);
    const bi = PRIORITY_ENTRY_KEYS.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.localeCompare(b);
  });
}

function extractUrlFilter(
  profile: Record<string, unknown> | undefined,
): UrlFilterList | null {
  if (!profile || typeof profile !== "object") return null;
  const raw = (profile as Record<string, unknown>)._url_filter;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (id === null || id === undefined || id === "") return null;
  const entries = Array.isArray(obj.entries)
    ? (obj.entries as UrlEntry[]).filter(
        (e): e is UrlEntry => typeof e === "object" && e !== null,
      )
    : [];
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (HIDDEN_META_KEYS.has(k)) continue;
    meta[k] = v;
  }
  return {
    id: String(id),
    oid: String(obj.oid ?? ""),
    name: String(obj.name ?? ""),
    comment:
      typeof obj.comment === "string" && obj.comment.length > 0
        ? obj.comment
        : null,
    entries,
    meta,
    usedBy: [],
  };
}

function groupByList(
  profileNames: string[],
  rawProfiles: Record<string, Record<string, unknown>>,
): { groups: UrlFilterList[]; unassigned: string[] } {
  const groups = new Map<string, UrlFilterList>();
  const unassigned: string[] = [];
  const firstSeen: string[] = [];

  for (const name of profileNames) {
    const list = extractUrlFilter(rawProfiles[name]);
    if (!list) {
      unassigned.push(name);
      continue;
    }
    const key = `${list.id}::${list.oid}`;
    const existing = groups.get(key);
    if (existing) {
      existing.usedBy.push(name);
    } else {
      list.usedBy.push(name);
      groups.set(key, list);
      firstSeen.push(key);
    }
  }

  return {
    groups: firstSeen.map((k) => groups.get(k)!),
    unassigned,
  };
}

// ---------------------------------------------------------------------------
// Per-list card
// ---------------------------------------------------------------------------

function UrlFilterListCard({
  list,
  availableKeys,
  hiddenKeys,
  onHiddenKeysChange,
  visibilityKey,
}: {
  list: UrlFilterList;
  availableKeys: string[];
  hiddenKeys: Set<string>;
  onHiddenKeysChange: (next: Set<string>) => void;
  visibilityKey: string;
}) {
  const [search, setSearch] = useState("");

  const visibleKeys = useMemo(
    () => availableKeys.filter((k) => !hiddenKeys.has(k)),
    [availableKeys, hiddenKeys],
  );

  // Sort by obj seq (then id) so the rendered order matches the
  // top-down processing order FMG applies at runtime.
  const orderedEntries = useMemo(() => {
    const seqOf = (e: UrlEntry): number => {
      const seq = e["obj seq"];
      if (typeof seq === "number") return seq;
      const id = e.id;
      if (typeof id === "number") return id;
      const parsed = Number(seq ?? id);
      return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };
    return [...list.entries].sort((a, b) => seqOf(a) - seqOf(b));
  }, [list.entries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderedEntries;
    return orderedEntries.filter((e) => {
      for (const k of visibleKeys) {
        const v = formatScalar(e[k]).toLowerCase();
        if (v.includes(q)) return true;
      }
      return false;
    });
  }, [orderedEntries, visibleKeys, search]);

  const gridTemplate = useMemo(
    () => `3.5rem ${"minmax(0, 1fr) ".repeat(visibleKeys.length)}`,
    [visibleKeys.length],
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      {/* Card header — list identity + "used by" chips + metadata strip */}
      <div className="border-b border-slate-800 bg-slate-950/60 px-4 py-3 space-y-2">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-100 truncate">
                {list.name || "(unnamed list)"}
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-slate-700/60 bg-slate-900/70 px-1.5 py-px text-[10px] font-mono text-slate-500">
                id: {list.id}
              </span>
              <span className="text-[11px] text-slate-600 tabular-nums">
                {list.entries.length}{" "}
                {list.entries.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            {list.comment && (
              <p className="mt-1 text-[11px] text-slate-500 italic truncate">
                {list.comment}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-slate-600">
              Used by
            </span>
            {list.usedBy.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full border border-cyan-900/60 bg-cyan-950/40 px-2 py-0.5 text-[11px] font-mono text-cyan-300"
                title={name}
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* Meta strip — other top-level list attributes, compactly rendered */}
        {Object.keys(list.meta).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-600">
            {Object.entries(list.meta).map(([k, v]) => {
              const display = formatScalar(v);
              if (display === "—") return null;
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-950/40 px-1.5 py-px"
                  title={`${k}: ${display}`}
                >
                  <span className="text-slate-600 uppercase tracking-wide">
                    {humanize(k)}
                  </span>
                  <span className="text-slate-400 font-mono">{display}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Toolbar — search + column visibility */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-950/40 border-b border-slate-800 flex-wrap">
        <input
          type="text"
          placeholder="Filter entries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-200 rounded-md px-2.5 py-1 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-cyan-600"
        />
        <FieldVisibilityMenu
          storageKey={visibilityKey}
          available={availableKeys}
          hidden={hiddenKeys}
          onChange={onHiddenKeysChange}
          labelOf={humanize}
          buttonLabel="Columns"
        />
        <span className="ml-auto text-[11px] text-slate-600 tabular-nums">
          {filteredEntries.length === orderedEntries.length
            ? `${orderedEntries.length} entries`
            : `${filteredEntries.length} of ${orderedEntries.length}`}
        </span>
      </div>

      {/* Entries grid */}
      <div className="max-h-[36rem] overflow-y-auto">
        <div
          className="grid text-[11px] sticky top-0 z-10 bg-slate-950/90 backdrop-blur-sm border-b border-slate-800"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-600 font-semibold">
            Seq
          </div>
          {visibleKeys.map((k) => (
            <div
              key={k}
              className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-600 font-semibold truncate"
              title={humanize(k)}
            >
              {humanize(k)}
            </div>
          ))}
        </div>

        {filteredEntries.length === 0 && (
          <div className="px-4 py-6 text-center text-slate-600 text-xs">
            No entries match the current filter.
          </div>
        )}

        {filteredEntries.map((entry, idx) => {
          const seq = entry["obj seq"] ?? entry.id ?? idx + 1;
          return (
            <div
              key={`${list.id}::${entry.oid ?? idx}::${seq}`}
              className="grid items-start text-[11px] border-t border-slate-800/40 hover:bg-slate-800/20"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="px-3 py-1.5 text-slate-600 font-mono tabular-nums">
                {String(seq)}
              </div>
              {visibleKeys.map((k) => {
                const v = entry[k];
                if (isActionKey(k)) {
                  return (
                    <div key={k} className="px-3 py-1.5 min-w-0">
                      <ActionBadge value={formatScalar(v)} />
                    </div>
                  );
                }
                return (
                  <div
                    key={k}
                    className="px-3 py-1.5 min-w-0 text-slate-300 break-words"
                  >
                    {formatScalar(v)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UrlFilterComparison({
  profileNames,
  rawProfiles,
}: Props) {
  const { groups, unassigned } = useMemo(
    () => groupByList(profileNames, rawProfiles),
    [profileNames, rawProfiles],
  );

  // Union of entry-key field names across every list we're about to
  // render. Shared between all cards so toggling a column in the
  // FieldVisibilityMenu applies uniformly — the user expects "columns"
  // to mean "columns for URL filter entries", not "columns for this
  // one list but not the next one".
  const availableKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const list of groups) {
      for (const entry of list.entries) {
        for (const k of Object.keys(entry)) {
          if (!HIDDEN_ENTRY_KEYS.has(k)) seen.add(k);
        }
      }
    }
    return sortEntryKeys([...seen]);
  }, [groups]);

  const visibilityKey = "urlfilter:entry:columns";
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHiddenKeys(loadHiddenFields(visibilityKey));
  }, [visibilityKey]);

  // Component is a no-op when none of the compared profiles actually
  // reference a URL filter. Prevents empty cards on e.g. the
  // "default + sniffer-profile" comparison.
  if (groups.length === 0 && unassigned.length === 0) return null;
  if (groups.length === 0) {
    return (
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-white">
            URL Filter Lists
          </h3>
          <p className="text-sm text-slate-500">
            None of the compared profiles reference a URL filter list.
          </p>
        </div>
      </section>
    );
  }

  const totalAssigned = profileNames.length - unassigned.length;
  const summary =
    groups.length === 1
      ? `1 list · ${totalAssigned} of ${profileNames.length} profiles attached`
      : `${groups.length} distinct lists across ${totalAssigned} of ${profileNames.length} profiles`;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-white">URL Filter Lists</h3>
        <p className="text-sm text-slate-500">{summary}</p>
      </div>

      {groups.map((list) => (
        <UrlFilterListCard
          key={`${list.id}::${list.oid}`}
          list={list}
          availableKeys={availableKeys}
          hiddenKeys={hiddenKeys}
          onHiddenKeysChange={setHiddenKeys}
          visibilityKey={visibilityKey}
        />
      ))}

      {unassigned.length > 0 && (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-3">
          <div className="flex items-start gap-2 flex-wrap text-[11px]">
            <span className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">
              No URL filter attached
            </span>
            {unassigned.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/60 px-2 py-0.5 font-mono text-slate-500"
                title={name}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
