"use client";

import { useEffect, useState, useMemo } from "react";
import {
  ComparisonField,
  togglePin,
  fetchProfileSchema,
  SchemaResponse,
} from "@/lib/api";
import StructuredCollectionComparison from "@/components/StructuredCollectionComparison";
import WebFilterCategoryTable from "@/components/WebFilterCategoryTable";
import UrlFilterComparison from "@/components/UrlFilterComparison";
import ActionBadge, { isActionKey } from "@/components/ActionBadge";
import CommentCell from "@/components/CommentCell";
import FieldVisibilityMenu, {
  loadHiddenFields,
} from "@/components/FieldVisibilityMenu";
import AddToChatContextButton from "@/components/AddToChatContextButton";

// Free-form prose fields — rendered through <CommentCell /> with a
// click-to-expand preview and (in baseline mode) a diff-aware offset.
const COMMENT_LEAF_NAMES = new Set([
  "comment",
  "comments",
  "description",
  "desc",
  "notes",
]);

function isCommentKey(fieldPath: string): boolean {
  const lastDot = fieldPath.lastIndexOf(".");
  const tail = lastDot === -1 ? fieldPath : fieldPath.slice(lastDot + 1);
  const bracket = tail.indexOf("[");
  const leaf = bracket === -1 ? tail : tail.slice(0, bracket);
  return COMMENT_LEAF_NAMES.has(leaf.toLowerCase());
}

interface Props {
  profileType: string;
  profileNames: string[];
  fields: ComparisonField[];
  collectionKeys: string[];
  rawProfiles: Record<string, Record<string, unknown>>;
  /** Profile selected as the drift baseline, or null for N-way mode. */
  baseline: string | null;
  /** Called when the user changes/clears the baseline from inside the
   *  comparison view. The parent re-runs the comparison API call. */
  onBaselineChange: (name: string | null) => void;
  pinnedFields: string[];
  onPinsChange: (pins: string[]) => void;
}

type FilterMode = "all" | "in_sync" | "differs" | "pinned";

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

interface FieldGroup {
  key: string;
  label: string;
  fields: ComparisonField[];
  children: FieldGroup[];
  syncCount: number;
  diffCount: number;
}

function groupFields(fields: ComparisonField[]): FieldGroup[] {
  const buckets = new Map<string, ComparisonField[]>();

  for (const f of fields) {
    const path = f.field_path;
    const arrayMatch = path.match(/^([a-zA-Z_-]+)\[(\d+)\](.*)/);
    if (arrayMatch) {
      const [, arrName, idx] = arrayMatch;
      const bucketKey = `${arrName}[${idx}]`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(f);
    } else {
      const dotIdx = path.indexOf(".");
      if (dotIdx === -1) {
        if (!buckets.has("__top__")) buckets.set("__top__", []);
        buckets.get("__top__")!.push(f);
      } else {
        const topKey = path.substring(0, dotIdx);
        if (!buckets.has(topKey)) buckets.set(topKey, []);
        buckets.get(topKey)!.push(f);
      }
    }
  }

  const parentGroups = new Map<string, FieldGroup[]>();

  for (const [key, fieldList] of buckets.entries()) {
    const syncCount = fieldList.filter((f) => f.in_sync).length;
    const diffCount = fieldList.length - syncCount;

    const arrayMatch = key.match(/^([a-zA-Z_-]+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, arrName, idx] = arrayMatch;
      const nameField = fieldList.find(
        (f) =>
          f.field_path === `${arrName}[${idx}].name` ||
          f.field_path === `${arrName}[${idx}].id`
      );
      const itemLabel = nameField
        ? String(Object.values(nameField.values)[0] ?? idx)
        : `#${idx}`;

      const group: FieldGroup = {
        key,
        label: itemLabel,
        fields: fieldList,
        children: [],
        syncCount,
        diffCount,
      };

      if (!parentGroups.has(arrName)) parentGroups.set(arrName, []);
      parentGroups.get(arrName)!.push(group);
    } else {
      const label =
        key === "__top__"
          ? "General Settings"
          : key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      parentGroups.set(key, [
        { key, label, fields: fieldList, children: [], syncCount, diffCount },
      ]);
    }
  }

  const result: FieldGroup[] = [];

  if (parentGroups.has("__top__")) {
    result.push(...parentGroups.get("__top__")!);
    parentGroups.delete("__top__");
  }

  const sortedKeys = [...parentGroups.keys()].sort();
  for (const parentKey of sortedKeys) {
    const children = parentGroups.get(parentKey)!;

    if (children.length === 1 && !children[0].key.match(/\[\d+\]$/)) {
      result.push(children[0]);
    } else {
      const allFields = children.flatMap((c) => c.fields);
      const syncCount = allFields.filter((f) => f.in_sync).length;
      const diffCount = allFields.length - syncCount;
      const label = parentKey
        .replace(/[_-]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      result.push({
        key: parentKey,
        label: `${label} (${children.length})`,
        fields: [],
        children,
        syncCount,
        diffCount,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SyncBadge({ sync, diff }: { sync: number; diff: number }) {
  const total = sync + diff;
  if (total === 0) return null;
  const pct = Math.round((sync / total) * 100);
  return (
    <span className="inline-flex items-center gap-2 text-[11px]">
      <span className="inline-block h-1.5 rounded-full bg-slate-700 w-12">
        <span
          className={`block h-full rounded-full transition-all ${
            pct === 100
              ? "bg-emerald-500"
              : pct > 70
              ? "bg-cyan-500"
              : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-slate-500 tabular-nums">
        {sync}/{total}
      </span>
      {diff > 0 && (
        <span className="text-amber-500 tabular-nums">{diff} ≠</span>
      )}
    </span>
  );
}

interface ResolvedValue {
  raw: unknown;
  display: string;
}

/** Reduce a flattened field path like "ftgd-wf.filters[3].action" or
 * "_url_filter.entries[0].url" to its leaf field name ("action", "url").
 * Used for the field-visibility toggle so the user picks columns by
 * semantic name rather than every per-index variant. */
function leafName(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const tail = lastDot === -1 ? path : path.slice(lastDot + 1);
  // Strip any trailing array index like "category[0]".
  const bracket = tail.indexOf("[");
  return bracket === -1 ? tail : tail.slice(0, bracket);
}

function isResolved(v: unknown): v is ResolvedValue {
  return (
    typeof v === "object" &&
    v !== null &&
    "raw" in v &&
    "display" in v
  );
}

function formatValue(v: unknown): { text: string; tooltip: string; resolved: boolean } {
  if (v === "__MISSING__") return { text: "—", tooltip: "Not present", resolved: false };
  if (v === null || v === undefined) return { text: "null", tooltip: "null", resolved: false };
  if (isResolved(v)) {
    return {
      text: `${v.display}`,
      tooltip: `${v.display} (raw: ${v.raw})`,
      resolved: true,
    };
  }
  if (typeof v === "boolean") return { text: v ? "true" : "false", tooltip: String(v), resolved: false };
  if (Array.isArray(v)) {
    // Scalar arrays render as a comma-joined value, not vertical letter soup.
    if (v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x))) {
      const s = v.join(", ");
      return { text: s || "—", tooltip: s, resolved: false };
    }
    const s = JSON.stringify(v);
    return { text: s, tooltip: s, resolved: false };
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return { text: s, tooltip: s, resolved: false };
  }
  return { text: String(v), tooltip: String(v), resolved: false };
}

function compactProfileValue(v: unknown): unknown {
  const formatted = formatValue(v).text;
  return formatted.length > 400 ? `${formatted.slice(0, 400)}...` : formatted;
}

function collectionCounts(profile: Record<string, unknown> | undefined) {
  if (!profile) return {};
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (Array.isArray(value)) counts[key] = value.length;
  }
  return counts;
}

function buildProfileContextSummary({
  name,
  profileType,
  rawProfile,
  fields,
  baseline,
  pinnedSet,
}: {
  name: string;
  profileType: string;
  rawProfile: Record<string, unknown> | undefined;
  fields: ComparisonField[];
  baseline: string | null;
  pinnedSet: Set<string>;
}) {
  const keys = rawProfile ? Object.keys(rawProfile).sort() : [];
  const driftFields = fields.filter((field) => {
    if (baseline) return field.differs_from_baseline?.[name] === true;
    return !field.in_sync;
  });

  return {
    name,
    profile_type: profileType,
    baseline_profile: baseline === name,
    compared_against: baseline,
    raw_key_count: keys.length,
    top_level_keys: keys.slice(0, 40),
    collection_counts: collectionCounts(rawProfile),
    drift_field_count: driftFields.length,
    pinned_drift_fields: driftFields
      .filter((field) => pinnedSet.has(field.field_path))
      .map((field) => field.field_path),
    top_drift_fields: driftFields.slice(0, 30).map((field) => ({
      field_path: field.field_path,
      label: field.label,
      current_value: compactProfileValue(field.values[name]),
      baseline_value:
        baseline && baseline !== name
          ? compactProfileValue(field.values[baseline])
          : undefined,
      pinned: pinnedSet.has(field.field_path),
    })),
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ComparisonTable({
  profileType,
  profileNames,
  fields,
  collectionKeys,
  rawProfiles,
  baseline,
  onBaselineChange,
  pinnedFields,
  onPinsChange,
}: Props) {
  // Force baseline to leftmost column position. The physical position
  // reinforces its role; falls back to the API's order when no baseline
  // is set.
  const orderedNames = useMemo(() => {
    if (!baseline || !profileNames.includes(baseline)) return profileNames;
    return [baseline, ...profileNames.filter((n) => n !== baseline)];
  }, [profileNames, baseline]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [pinLoading, setPinLoading] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Per-profile-type field visibility (persisted in localStorage). We track
  // *hidden* leaf field names so newly-discovered fields default to visible.
  const visibilityKey = `comparison:${profileType}`;
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHiddenFields(loadHiddenFields(visibilityKey));
  }, [visibilityKey]);

  // Available leaf field names discovered from the current dataset.
  const availableLeaves = useMemo(() => {
    const seen = new Set<string>();
    for (const f of fields) seen.add(leafName(f.field_path));
    return [...seen];
  }, [fields]);

  // Schema discovery: lazy-fetch the FMG syntax for this profile type so the
  // visibility menu can present the *full* list of fields the schema knows
  // about — not just the ones that happen to be in this response payload.
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchProfileSchema(profileType)
      .then((s) => { if (!cancelled) setSchema(s); })
      .catch(() => { /* schema is optional polish; fall back to data-driven */ });
    return () => { cancelled = true; };
  }, [profileType]);

  // Union schema fields with data-discovered leaves so every column the user
  // could ever see is pickable from the menu.
  const schemaFields = useMemo(() => {
    if (!schema) return undefined;
    const all = new Map<string, { name: string; label: string; help: string }>();
    for (const f of schema.fields) {
      all.set(f.name, { name: f.name, label: f.label, help: f.help });
    }
    for (const sub of Object.values(schema.subobjects)) {
      for (const f of sub) {
        if (!all.has(f.name)) {
          all.set(f.name, { name: f.name, label: f.label, help: f.help });
        }
      }
    }
    return [...all.values()];
  }, [schema]);

  const mergedAvailable = useMemo(() => {
    if (!schemaFields) return availableLeaves;
    const seen = new Set<string>(availableLeaves);
    for (const f of schemaFields) seen.add(f.name);
    return [...seen];
  }, [availableLeaves, schemaFields]);

  const pinnedSet = useMemo(() => new Set(pinnedFields), [pinnedFields]);

  const profileContextByName = useMemo(
    () =>
      Object.fromEntries(
        orderedNames.map((name) => [
          name,
          buildProfileContextSummary({
            name,
            profileType,
            rawProfile: rawProfiles[name],
            fields,
            baseline,
            pinnedSet,
          }),
        ]),
      ),
    [orderedNames, profileType, rawProfiles, fields, baseline, pinnedSet],
  );

  const filteredFields = useMemo(() => {
    let result = fields;
    if (filter === "in_sync") result = result.filter((f) => f.in_sync);
    else if (filter === "differs") result = result.filter((f) => !f.in_sync);
    else if (filter === "pinned")
      result = result.filter((f) => pinnedSet.has(f.field_path));
    if (hiddenFields.size > 0) {
      result = result.filter((f) => !hiddenFields.has(leafName(f.field_path)));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.field_path.toLowerCase().includes(q) ||
          f.label.toLowerCase().includes(q)
      );
    }
    return result;
  }, [fields, filter, search, pinnedSet, hiddenFields]);

  const groups = useMemo(() => groupFields(filteredFields), [filteredFields]);

  const handlePin = async (fieldPath: string) => {
    const isPinned = pinnedSet.has(fieldPath);
    setPinLoading(fieldPath);
    try {
      const newPins = await togglePin(profileType, fieldPath, !isPinned);
      onPinsChange(newPins);
    } catch (e) {
      console.error(e);
    } finally {
      setPinLoading(null);
    }
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allGroupKeys = useMemo(() => {
    const keys: string[] = [];
    for (const g of groups) {
      keys.push(g.key);
      for (const c of g.children) keys.push(c.key);
    }
    return keys;
  }, [groups]);

  const syncCount = fields.filter((f) => f.in_sync).length;
  const diffCount = fields.filter((f) => !f.in_sync).length;

  // Column count for colSpan
  const colCount = profileNames.length + 3; // pin + field + profiles + status

  const renderFieldRow = (
    field: ComparisonField,
    depth: number
  ) => {
    const isPinned = pinnedSet.has(field.field_path);
    const isDrift = isPinned && !field.in_sync;
    const shortPath = field.field_path.replace(/^[a-zA-Z_-]+\[\d+\]\./, "");

    // Is this a free-form prose field? (comment / description / notes)
    const fieldIsComment = isCommentKey(field.field_path);
    // Baseline text for diff-aware CommentCell preview. Computed once
    // per row so every cell shares the same anchor; null when there is
    // no baseline set, or when the baseline profile's own value is
    // missing (in which case we preview from char 0).
    const commentBaselineText = (() => {
      if (!baseline) return null;
      const bv = field.values[baseline];
      if (bv === "__MISSING__" || bv === null || bv === undefined) return null;
      return formatValue(bv).text;
    })();

    return (
      <tr
        key={field.field_path}
        className={`border-t border-slate-800/40 ${
          isDrift
            ? "bg-red-950/30"
            : !field.in_sync
            ? "bg-amber-950/8 hover:bg-amber-950/15"
            : "hover:bg-slate-800/20"
        }`}
      >
        <td className="px-2 py-1 text-center w-8">
          <button
            onClick={() => handlePin(field.field_path)}
            disabled={pinLoading === field.field_path}
            className={`text-xs transition ${
              isPinned
                ? "text-cyan-400"
                : "text-slate-700 hover:text-slate-500"
            }`}
            title={isPinned ? "Unpin" : "Pin"}
          >
            {isPinned ? "📌" : "○"}
          </button>
        </td>
        <td
          className="px-2 py-1 text-slate-400 text-xs font-mono break-words"
          style={{ paddingLeft: 8 + depth * 16 }}
          title={field.field_path}
        >
          {shortPath}
        </td>
        {orderedNames.map((name) => {
          const fv = formatValue(field.values[name]);
          const isMissing = field.values[name] === "__MISSING__";
          const renderAsAction =
            !isMissing && isActionKey(field.field_path) && fv.text !== "null";
          const renderAsComment = !isMissing && fieldIsComment;
          const isBaselineCol = baseline === name;
          // Per-cell drift marker. Only meaningful when a baseline is
          // set; the backend populates differs_from_baseline for every
          // selected profile in that case (baseline itself is False).
          const driftMap = field.differs_from_baseline ?? {};
          const cellDriftsFromBaseline =
            baseline !== null && !isBaselineCol && driftMap[name] === true;
          // Thin colored left-border for the cell — emerald on the
          // baseline column, red on cells that drift from it. The
          // border is part of the cell so it doesn't push columns.
          const borderClass = isBaselineCol
            ? "border-l-2 border-l-emerald-700/70"
            : cellDriftsFromBaseline
            ? "border-l-2 border-l-red-700/70"
            : "border-l-2 border-l-transparent";
          return (
            <td
              key={name}
              className={`px-2 py-1 align-top ${
                renderAsComment ? "" : "overflow-hidden"
              } ${borderClass} ${isBaselineCol ? "bg-emerald-950/15" : ""}`}
              title={renderAsComment ? undefined : fv.tooltip}
            >
              {renderAsAction ? (
                <ActionBadge value={fv.text} />
              ) : renderAsComment ? (
                <div
                  className={
                    isBaselineCol
                      ? "text-emerald-100"
                      : cellDriftsFromBaseline
                      ? "text-red-200"
                      : field.in_sync
                      ? "text-slate-400"
                      : "text-slate-200"
                  }
                >
                  <CommentCell
                    text={fv.text}
                    baselineText={
                      isBaselineCol ? null : commentBaselineText
                    }
                    tone={
                      isBaselineCol
                        ? "baseline"
                        : cellDriftsFromBaseline
                        ? "drift"
                        : "neutral"
                    }
                  />
                </div>
              ) : (
                <span
                  className={
                    isMissing
                      ? "block whitespace-pre-wrap break-all text-slate-600 italic"
                      : fv.resolved
                      ? "block whitespace-pre-wrap break-all text-cyan-300"
                      : isBaselineCol
                      ? "block whitespace-pre-wrap break-all text-emerald-100"
                      : cellDriftsFromBaseline
                      ? "block whitespace-pre-wrap break-all text-red-200"
                      : field.in_sync
                      ? "block whitespace-pre-wrap break-all text-slate-400"
                      : "block whitespace-pre-wrap break-all text-slate-200"
                  }
                >
                  {fv.text}
                </span>
              )}
            </td>
          );
        })}
        <td className="px-2 py-1 text-center w-14">
          {isDrift ? (
            <span className="text-red-400 text-[10px] font-bold">DRIFT</span>
          ) : field.in_sync ? (
            <span className="text-emerald-600">✓</span>
          ) : (
            <span className="text-amber-400 text-xs">≠</span>
          )}
        </td>
      </tr>
    );
  };

  const renderGroup = (group: FieldGroup, depth: number = 0) => {
    const isCollapsed = collapsed.has(group.key);

    return (
      <tbody key={group.key}>
        {/* Section header */}
        <tr
          className={`cursor-pointer select-none ${
            depth === 0
              ? "bg-slate-800/70 border-t-2 border-slate-600"
              : "bg-slate-800/30 border-t border-slate-700/50"
          }`}
          onClick={() => toggleCollapse(group.key)}
        >
          <td colSpan={colCount} className="px-2 py-1.5" style={{ paddingLeft: 8 + depth * 16 }}>
            <div className="flex items-center gap-2">
              <span className="text-slate-600 text-[10px] w-3">
                {isCollapsed ? "▶" : "▼"}
              </span>
              <span
                className={`font-medium ${
                  depth === 0
                    ? "text-slate-200 text-[13px]"
                    : "text-slate-300 text-xs"
                }`}
              >
                {group.label}
              </span>
              <SyncBadge sync={group.syncCount} diff={group.diffCount} />
            </div>
          </td>
        </tr>

        {!isCollapsed &&
          group.fields.map((field) => renderFieldRow(field, depth + 1))}

        {!isCollapsed &&
          group.children.map((child) => renderGroup(child, depth + 1))}
      </tbody>
    );
  };

  return (
    <div className="space-y-3">
      {/* Webfilter profiles get a category-aligned table that unrolls each
       * filter rule into per-category rows, since two profiles may apply
       * different policies to the same category and the same category lives
       * at different array indices in different profiles. */}
      {profileType === "webfilter" && (
        <WebFilterCategoryTable
          profileNames={orderedNames}
          rawProfiles={rawProfiles}
          schema={schema}
        />
      )}

      {/* Grouped URL filter list view — dedupes shared lists across
       * profiles so a list referenced by N profiles renders once with
       * a "Used by" chip strip rather than N identical collection
       * comparisons. */}
      {profileType === "webfilter" && (
        <UrlFilterComparison
          profileNames={orderedNames}
          rawProfiles={rawProfiles}
        />
      )}

      {collectionKeys.map((collectionKey) => (
        <StructuredCollectionComparison
          key={collectionKey}
          collectionKey={collectionKey}
          profileNames={orderedNames}
          rawProfiles={rawProfiles}
          schema={schema}
        />
      ))}

      {/* Stats Bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400 tabular-nums">
          {fields.length} fields
        </span>
        <span className="text-emerald-400 tabular-nums">● {syncCount} in sync</span>
        <span className="text-amber-400 tabular-nums">● {diffCount} differ</span>
        <span className="text-cyan-400 tabular-nums">
          📌 {pinnedFields.length} pinned
        </span>
      </div>

      {/* Filter + Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            ["all", "All"],
            ["in_sync", "In Sync"],
            ["differs", "Differs"],
            ["pinned", "Pinned"],
          ] as [FilterMode, string][]
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition ${
              filter === mode
                ? "bg-cyan-600 text-white"
                : "bg-slate-800 text-slate-500 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
        <FieldVisibilityMenu
          storageKey={visibilityKey}
          available={mergedAvailable}
          hidden={hiddenFields}
          onChange={setHiddenFields}
          schemaFields={schemaFields}
          presentInData={availableLeaves}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCollapsed(new Set(allGroupKeys))}
            className="text-[11px] text-slate-600 hover:text-slate-300 transition"
          >
            Collapse All
          </button>
          <span className="text-slate-800">|</span>
          <button
            onClick={() => setCollapsed(new Set())}
            className="text-[11px] text-slate-600 hover:text-slate-300 transition"
          >
            Expand All
          </button>
          <input
            type="text"
            placeholder="Search fields..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-2 bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-cyan-600"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden border border-slate-700/50 rounded-lg">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: "18%" }} />
            {orderedNames.map((n) => (
              <col key={n} />
            ))}
            <col style={{ width: 52 }} />
          </colgroup>
          <thead>
            <tr className="bg-slate-900 border-b border-slate-700">
              <th className="px-2 py-2 text-slate-600 font-medium text-[11px] text-center">
                Pin
              </th>
              <th className="px-2 py-2 text-slate-600 font-medium text-[11px] text-left">
                Field
              </th>
              {orderedNames.map((name) => {
                const isBaselineCol = baseline === name;
                return (
                  <th
                    key={name}
                    className={`px-2 py-2 font-medium text-[11px] text-left font-mono break-words ${
                      isBaselineCol
                        ? "bg-emerald-950/30 text-emerald-200 border-l-2 border-l-emerald-700/70"
                        : "text-slate-600 border-l-2 border-l-transparent"
                    }`}
                    title={name}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isBaselineCol && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-emerald-900/60 border border-emerald-700/60 text-[9px] font-bold tracking-wide text-emerald-200 uppercase"
                          title="Baseline — all other profiles are diffed against this one"
                        >
                          ★ Baseline
                        </span>
                      )}
                      <span className="truncate">{name}</span>
                      <AddToChatContextButton
                        item={{
                          id: `${profileType}_profile:${name}`,
                          kind: `${profileType}_profile`,
                          label: name,
                          data: profileContextByName[name] ?? { name },
                        }}
                      />
                      {!isBaselineCol && (
                        <button
                          type="button"
                          onClick={() => onBaselineChange(name)}
                          className="text-[10px] text-slate-700 hover:text-emerald-400 transition"
                          title="Set as baseline"
                        >
                          ☆
                        </button>
                      )}
                      {isBaselineCol && (
                        <button
                          type="button"
                          onClick={() => onBaselineChange(null)}
                          className="text-[10px] text-emerald-500 hover:text-emerald-300 transition ml-auto"
                          title="Clear baseline (return to N-way comparison)"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
              <th className="px-2 py-2 text-slate-600 font-medium text-[11px] text-center">
                Sync
              </th>
            </tr>
          </thead>
          {groups.length > 0 ? (
            groups.map((g) => renderGroup(g))
          ) : (
            <tbody>
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-8 text-center text-slate-600 text-sm"
                >
                  No fields match the current filter.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      <p className="text-[11px] text-slate-700">
        {filteredFields.length} of {fields.length} fields · {groups.length}{" "}
        groups
      </p>
    </div>
  );
}
