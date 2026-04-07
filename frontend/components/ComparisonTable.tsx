"use client";

import { useState, useMemo } from "react";
import { ComparisonField, togglePin } from "@/lib/api";

interface Props {
  profileType: string;
  profileNames: string[];
  fields: ComparisonField[];
  pinnedFields: string[];
  onPinsChange: (pins: string[]) => void;
}

type FilterMode = "all" | "in_sync" | "differs" | "pinned";

// ---------------------------------------------------------------------------
// Grouping logic — turns flat dot-notation paths into a nested tree
// ---------------------------------------------------------------------------

interface FieldGroup {
  key: string;          // e.g. "health-check[0]" or "Top-Level Settings"
  label: string;        // human-friendly label
  fields: ComparisonField[];
  children: FieldGroup[];
  syncCount: number;
  diffCount: number;
}

function groupFields(fields: ComparisonField[]): FieldGroup[] {
  // Bucket fields by their top-level key segment
  const buckets = new Map<string, ComparisonField[]>();

  for (const f of fields) {
    const path = f.field_path;
    // Match top-level array keys like "health-check[0].xxx" or "service[2].yyy"
    const arrayMatch = path.match(/^([a-zA-Z_-]+)\[(\d+)\](.*)/);
    if (arrayMatch) {
      const [, arrName, idx] = arrayMatch;
      const bucketKey = `${arrName}[${idx}]`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(f);
    } else {
      // Simple top-level key: "fail-detect", "name", etc.
      const dotIdx = path.indexOf(".");
      if (dotIdx === -1) {
        // Truly scalar top-level field
        if (!buckets.has("__top__")) buckets.set("__top__", []);
        buckets.get("__top__")!.push(f);
      } else {
        // Nested object like "options.something"
        const topKey = path.substring(0, dotIdx);
        if (!buckets.has(topKey)) buckets.set(topKey, []);
        buckets.get(topKey)!.push(f);
      }
    }
  }

  // Now consolidate array buckets into parent groups
  // e.g. health-check[0], health-check[1] → parent "health-check"
  const parentGroups = new Map<string, FieldGroup[]>();

  for (const [key, fieldList] of buckets.entries()) {
    const syncCount = fieldList.filter((f) => f.in_sync).length;
    const diffCount = fieldList.length - syncCount;

    const arrayMatch = key.match(/^([a-zA-Z_-]+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, arrName, idx] = arrayMatch;
      // Try to find a "name" field inside to use as label
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

      const group: FieldGroup = {
        key,
        label,
        fields: fieldList,
        children: [],
        syncCount,
        diffCount,
      };
      parentGroups.set(key, [group]);
    }
  }

  // Build final top-level groups
  const result: FieldGroup[] = [];

  // General settings first
  if (parentGroups.has("__top__")) {
    result.push(...parentGroups.get("__top__")!);
    parentGroups.delete("__top__");
  }

  // Everything else sorted alphabetically
  const sortedKeys = [...parentGroups.keys()].sort();
  for (const parentKey of sortedKeys) {
    const children = parentGroups.get(parentKey)!;

    if (children.length === 1 && !children[0].key.match(/\[\d+\]$/)) {
      // Non-array group, just push directly
      result.push(children[0]);
    } else {
      // Array parent — wrap children
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
    <span className="flex items-center gap-2 text-xs">
      <span
        className="inline-block h-1.5 rounded-full bg-slate-700"
        style={{ width: 60 }}
      >
        <span
          className={`block h-full rounded-full ${
            pct === 100
              ? "bg-emerald-500"
              : pct > 70
              ? "bg-cyan-500"
              : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-slate-500">
        {sync}/{total} in sync
      </span>
      {diff > 0 && (
        <span className="text-amber-400 font-medium">{diff} differ</span>
      )}
    </span>
  );
}

function FieldRow({
  field,
  profileNames,
  isPinned,
  isDrift,
  pinLoading,
  onPin,
  indent,
}: {
  field: ComparisonField;
  profileNames: string[];
  isPinned: boolean;
  isDrift: boolean;
  pinLoading: boolean;
  onPin: () => void;
  indent: number;
}) {
  const formatValue = (v: unknown): string => {
    if (v === "__MISSING__") return "—";
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  // Strip the array prefix from the displayed field path for cleaner look
  const shortPath = field.field_path.replace(/^[a-zA-Z_-]+\[\d+\]\./, "");

  return (
    <tr
      className={`border-t border-slate-800/50 transition ${
        isDrift
          ? "bg-red-950/30"
          : !field.in_sync
          ? "bg-amber-950/10 hover:bg-amber-950/20"
          : "hover:bg-slate-800/30"
      }`}
    >
      <td className="px-3 py-1.5 text-center w-10">
        <button
          onClick={onPin}
          disabled={pinLoading}
          className={`text-sm transition ${
            isPinned ? "text-cyan-400" : "text-slate-700 hover:text-slate-500"
          }`}
          title={isPinned ? "Unpin" : "Pin (must stay consistent)"}
        >
          {isPinned ? "📌" : "○"}
        </button>
      </td>
      <td className="px-3 py-1.5" style={{ paddingLeft: 12 + indent * 16 }}>
        <span className="text-slate-400 text-xs font-mono">{shortPath}</span>
      </td>
      {profileNames.map((name) => (
        <td
          key={name}
          className="px-3 py-1.5 font-mono text-xs max-w-[220px] truncate"
          title={formatValue(field.values[name])}
        >
          <span
            className={
              field.values[name] === "__MISSING__"
                ? "text-slate-600 italic"
                : field.in_sync
                ? "text-slate-400"
                : "text-white"
            }
          >
            {formatValue(field.values[name])}
          </span>
        </td>
      ))}
      <td className="px-3 py-1.5 text-center w-16">
        {isDrift ? (
          <span className="text-red-400 text-xs font-bold">DRIFT</span>
        ) : field.in_sync ? (
          <span className="text-emerald-500/60">✓</span>
        ) : (
          <span className="text-amber-400">≠</span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ComparisonTable({
  profileType,
  profileNames,
  fields,
  pinnedFields,
  onPinsChange,
}: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [pinLoading, setPinLoading] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const pinnedSet = useMemo(() => new Set(pinnedFields), [pinnedFields]);

  // Apply filter/search to raw fields, then group
  const filteredFields = useMemo(() => {
    let result = fields;
    if (filter === "in_sync") result = result.filter((f) => f.in_sync);
    else if (filter === "differs") result = result.filter((f) => !f.in_sync);
    else if (filter === "pinned")
      result = result.filter((f) => pinnedSet.has(f.field_path));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.field_path.toLowerCase().includes(q) ||
          f.label.toLowerCase().includes(q)
      );
    }
    return result;
  }, [fields, filter, search, pinnedSet]);

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

  // Stats
  const syncCount = fields.filter((f) => f.in_sync).length;
  const diffCount = fields.filter((f) => !f.in_sync).length;

  const renderGroup = (group: FieldGroup, depth: number = 0) => {
    const isCollapsed = collapsed.has(group.key);
    const hasChildren = group.children.length > 0;
    const hasFields = group.fields.length > 0;

    return (
      <tbody key={group.key}>
        {/* Section header */}
        <tr
          className={`${
            depth === 0
              ? "bg-slate-800/80 border-t-2 border-slate-600"
              : "bg-slate-800/40 border-t border-slate-700"
          } cursor-pointer select-none`}
          onClick={() => toggleCollapse(group.key)}
        >
          <td
            colSpan={profileNames.length + 3}
            className="px-3 py-2"
            style={{ paddingLeft: 12 + depth * 20 }}
          >
            <div className="flex items-center gap-3">
              <span className="text-slate-500 text-xs w-4">
                {isCollapsed ? "▶" : "▼"}
              </span>
              <span
                className={`font-medium ${
                  depth === 0 ? "text-slate-200 text-sm" : "text-slate-300 text-xs"
                }`}
              >
                {group.label}
              </span>
              <SyncBadge sync={group.syncCount} diff={group.diffCount} />
            </div>
          </td>
        </tr>

        {/* Fields in this group */}
        {!isCollapsed &&
          hasFields &&
          group.fields.map((field) => {
            const isPinned = pinnedSet.has(field.field_path);
            const isDrift = isPinned && !field.in_sync;
            return (
              <FieldRow
                key={field.field_path}
                field={field}
                profileNames={profileNames}
                isPinned={isPinned}
                isDrift={isDrift}
                pinLoading={pinLoading === field.field_path}
                onPin={() => handlePin(field.field_path)}
                indent={depth + 1}
              />
            );
          })}

        {/* Child groups (array entries) */}
        {!isCollapsed &&
          hasChildren &&
          group.children.map((child) => renderGroup(child, depth + 1))}
      </tbody>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats Bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">{fields.length} fields total</span>
        <span className="text-emerald-400">● {syncCount} in sync</span>
        <span className="text-amber-400">● {diffCount} differ</span>
        <span className="text-cyan-400">📌 {pinnedFields.length} pinned</span>
      </div>

      {/* Filter Tabs + Search */}
      <div className="flex items-center gap-3 flex-wrap">
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
            className={`px-3 py-1 rounded-full text-sm font-medium transition ${
              filter === mode
                ? "bg-cyan-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCollapsed(new Set(groups.map((g) => g.key).concat(groups.flatMap((g) => g.children.map((c) => c.key)))))}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Collapse All
          </button>
          <span className="text-slate-700">|</span>
          <button
            onClick={() => setCollapsed(new Set())}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Expand All
          </button>
          <input
            type="text"
            placeholder="Search fields..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-3 bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-1 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-700 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900">
              <th className="text-left px-3 py-2.5 text-slate-500 font-medium w-10">
                Pin
              </th>
              <th className="text-left px-3 py-2.5 text-slate-500 font-medium">
                Field
              </th>
              {profileNames.map((name) => (
                <th
                  key={name}
                  className="text-left px-3 py-2.5 text-slate-500 font-medium font-mono text-xs"
                >
                  {name}
                </th>
              ))}
              <th className="text-center px-3 py-2.5 text-slate-500 font-medium w-16">
                Status
              </th>
            </tr>
          </thead>
          {groups.length > 0 ? (
            groups.map((g) => renderGroup(g))
          ) : (
            <tbody>
              <tr>
                <td
                  colSpan={profileNames.length + 3}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No fields match the current filter.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      <p className="text-xs text-slate-600">
        Showing {filteredFields.length} of {fields.length} fields across{" "}
        {groups.length} groups
      </p>
    </div>
  );
}
