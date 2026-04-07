"use client";

import { useEffect, useState } from "react";
import { fetchProfileTypes, fetchProfiles, ProfileType } from "@/lib/api";

interface Props {
  onCompare: (type: string, names: string[]) => void;
}

export default function ProfileSelector({ onCompare }: Props) {
  const [types, setTypes] = useState<ProfileType[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProfileTypes().then(setTypes).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedType) return;
    setLoading(true);
    setSelected(new Set());
    fetchProfiles(selectedType)
      .then(setProfiles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedType]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-5">
      <h2 className="text-lg font-semibold text-white">Select Profiles to Compare</h2>

      {/* Profile Type */}
      <div>
        <label className="block text-sm text-slate-400 mb-1.5">Profile Type</label>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="">Choose a type...</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Profile Checklist */}
      {selectedType && (
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">
            Profiles ({selected.size} selected)
          </label>
          {loading ? (
            <p className="text-slate-500 text-sm">Loading...</p>
          ) : profiles.length === 0 ? (
            <p className="text-slate-500 text-sm">No profiles found</p>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-1 border border-slate-700 rounded-lg p-2">
              {profiles.map((name) => (
                <label
                  key={name}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition ${
                    selected.has(name)
                      ? "bg-cyan-900/30 text-cyan-300"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(name)}
                    onChange={() => toggle(name)}
                    className="accent-cyan-500"
                  />
                  <span className="text-sm font-mono">{name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compare Button */}
      <button
        disabled={selected.size < 2}
        onClick={() => onCompare(selectedType, Array.from(selected))}
        className="w-full py-2.5 rounded-lg font-medium transition disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 text-white"
      >
        Compare {selected.size} Profiles
      </button>
    </div>
  );
}
