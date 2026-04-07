"use client";

import { useMemo, useState } from "react";
import { ProfileType } from "@/lib/api";

interface Props {
  profileType: ProfileType;
  profiles: string[];
  selected: Set<string>;
  loading: boolean;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onCompare: () => void;
  onBack: () => void;
}

export default function ProfilePicker({
  profileType,
  profiles,
  selected,
  loading,
  onToggle,
  onSelectAll,
  onCompare,
  onBack,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return profiles;
    const q = search.toLowerCase();
    return profiles.filter((p) => p.toLowerCase().includes(q));
  }, [profiles, search]);

  const allSelected = selected.size === profiles.length && profiles.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="text-slate-500 hover:text-white transition text-sm"
            >
              ← Back
            </button>
            <h2 className="text-xl font-bold text-white">{profileType.label}</h2>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Select 2 or more profiles to compare side-by-side
          </p>
        </div>

        {/* Compare action */}
        <button
          disabled={selected.size < 2}
          onClick={onCompare}
          className="px-6 py-2.5 rounded-lg font-medium transition disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-900/20"
        >
          Compare {selected.size > 0 ? selected.size : ""} Profile
          {selected.size !== 1 ? "s" : ""}
        </button>
      </div>

      {/* Search + controls */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter profiles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600"
        />
        <button
          onClick={onSelectAll}
          className="text-xs text-slate-500 hover:text-slate-300 transition px-2 py-1"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
        <span className="text-xs text-slate-600 ml-auto">
          {profiles.length} profiles available
        </span>
      </div>

      {/* Profile grid */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
          <p className="text-slate-500 mt-3 text-sm">Loading profiles...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          {search ? "No profiles match your filter." : "No profiles found."}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((name) => {
            const isSelected = selected.has(name);
            return (
              <button
                key={name}
                onClick={() => onToggle(name)}
                className={`relative text-left px-4 py-3 rounded-lg border transition-all duration-150 ${
                  isSelected
                    ? "bg-cyan-950/40 border-cyan-600 shadow-md shadow-cyan-900/10"
                    : "bg-slate-900/50 border-slate-800 hover:border-slate-600 hover:bg-slate-900"
                }`}
              >
                {/* Selection indicator */}
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs transition ${
                      isSelected
                        ? "border-cyan-500 bg-cyan-600 text-white"
                        : "border-slate-600 text-transparent"
                    }`}
                  >
                    ✓
                  </div>
                  <span
                    className={`font-mono text-sm truncate ${
                      isSelected ? "text-cyan-300" : "text-slate-300"
                    }`}
                    title={name}
                  >
                    {name}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected tray */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-xl p-4 shadow-2xl">
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400 shrink-0">
              {selected.size} selected:
            </span>
            <div className="flex flex-wrap gap-2 min-w-0 flex-1">
              {Array.from(selected).map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-cyan-950/50 border border-cyan-800/50 rounded-md text-xs text-cyan-300 font-mono"
                >
                  {name}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(name);
                    }}
                    className="text-cyan-600 hover:text-cyan-300 ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              disabled={selected.size < 2}
              onClick={onCompare}
              className="px-5 py-2 rounded-lg font-medium text-sm transition disabled:opacity-30 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 text-white shrink-0"
            >
              Compare →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
