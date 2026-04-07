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

  const pinnedSet = useMemo(() => new Set(pinnedFields), [pinnedFields]);

  const filtered = useMemo(() => {
    let result = fields;
    if (filter === "in_sync") result = result.filter((f) => f.in_sync);
    else if (filter === "differs") result = result.filter((f) => !f.in_sync);
    else if (filter === "pinned") result = result.filter((f) => pinnedSet.has(f.field_path));
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

  const formatValue = (v: unknown): string => {
    if (v === "__MISSING__") return "—";
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  // Stats
  const syncCount = fields.filter((f) => f.in_sync).length;
  const diffCount = fields.filter((f) => !f.in_sync).length;

  return (
    <div className="space-y-4">
      {/* Stats Bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">
          {fields.length} fields total
        </span>
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
        <input
          type="text"
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-1 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-700 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80">
              <th className="text-left px-4 py-3 text-slate-400 font-medium w-10">Pin</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Field</th>
              {profileNames.map((name) => (
                <th
                  key={name}
                  className="text-left px-4 py-3 text-slate-400 font-medium font-mono"
                >
                  {name}
                </th>
              ))}
              <th className="text-center px-4 py-3 text-slate-400 font-medium w-20">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((field) => {
              const isPinned = pinnedSet.has(field.field_path);
              const isDrift = isPinned && !field.in_sync;

              return (
                <tr
                  key={field.field_path}
                  className={`border-t border-slate-800 transition ${
                    isDrift
                      ? "bg-red-950/30"
                      : field.in_sync
                      ? "hover:bg-slate-800/50"
                      : "bg-amber-950/10 hover:bg-amber-950/20"
                  }`}
                >
                  {/* Pin Toggle */}
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => handlePin(field.field_path)}
                      disabled={pinLoading === field.field_path}
                      className={`text-lg transition ${
                        isPinned ? "text-cyan-400" : "text-slate-600 hover:text-slate-400"
                      }`}
                      title={isPinned ? "Unpin (field may vary)" : "Pin (must stay consistent)"}
                    >
                      {isPinned ? "📌" : "○"}
                    </button>
                  </td>

                  {/* Field Name */}
                  <td className="px-4 py-2">
                    <div className="text-slate-300 text-xs font-mono truncate max-w-xs" title={field.field_path}>
                      {field.field_path}
                    </div>
                    <div className="text-slate-500 text-xs">{field.label}</div>
                  </td>

                  {/* Values */}
                  {profileNames.map((name) => (
                    <td
                      key={name}
                      className="px-4 py-2 font-mono text-xs max-w-[200px] truncate"
                      title={formatValue(field.values[name])}
                    >
                      <span
                        className={
                          field.values[name] === "__MISSING__"
                            ? "text-slate-600 italic"
                            : "text-slate-200"
                        }
                      >
                        {formatValue(field.values[name])}
                      </span>
                    </td>
                  ))}

                  {/* Sync Status */}
                  <td className="px-4 py-2 text-center">
                    {isDrift ? (
                      <span className="text-red-400 font-bold" title="DRIFT — pinned field has diverged!">
                        ⚠ DRIFT
                      </span>
                    ) : field.in_sync ? (
                      <span className="text-emerald-400" title="In sync">✓</span>
                    ) : (
                      <span className="text-amber-400" title="Differs">≠</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={profileNames.length + 3} className="px-4 py-8 text-center text-slate-500">
                  No fields match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-600">
        Showing {filtered.length} of {fields.length} fields
      </p>
    </div>
  );
}
