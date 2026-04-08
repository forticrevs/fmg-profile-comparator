"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ProfileDashboard from "@/components/ProfileDashboard";
import ProfilePicker from "@/components/ProfilePicker";
import ComparisonTable from "@/components/ComparisonTable";
import { useAuth } from "@/components/AuthGuard";
import {
  fetchProfileTypes,
  fetchProfiles,
  compareProfiles,
  fetchPins,
  ProfileType,
  ComparisonField,
} from "@/lib/api";

type View = "dashboard" | "picker" | "comparison";

export default function Home() {
  const { username, logout: doLogout } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<View>("dashboard");
  const [types, setTypes] = useState<ProfileType[]>([]);
  const [selectedType, setSelectedType] = useState<ProfileType | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Comparison state
  const [result, setResult] = useState<{
    profileType: string;
    profileNames: string[];
    fields: ComparisonField[];
    collectionKeys: string[];
    rawProfiles: Record<string, Record<string, unknown>>;
  } | null>(null);
  const [pins, setPins] = useState<string[]>([]);

  useEffect(() => {
    fetchProfileTypes().then(setTypes).catch(console.error);
  }, []);

  const handleSelectType = async (type: ProfileType) => {
    setSelectedType(type);
    setSelected(new Set());
    setView("picker");
    setLoading(true);
    try {
      const names = await fetchProfiles(type.id);
      setProfiles(names);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async () => {
    if (!selectedType || selected.size < 2) return;
    setLoading(true);
    setError(null);
    setView("comparison");
    try {
      const [comparison, currentPins] = await Promise.all([
        compareProfiles(selectedType.id, Array.from(selected)),
        fetchPins(selectedType.id),
      ]);
      setResult({
        profileType: comparison.profile_type,
        profileNames: comparison.profile_names,
        fields: comparison.fields,
        collectionKeys: comparison.collection_keys,
        rawProfiles: comparison.raw_profiles,
      });
      setPins(currentPins);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
      setView("picker");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (view === "comparison") {
      setView("picker");
      setResult(null);
    } else if (view === "picker") {
      setView("dashboard");
      setSelectedType(null);
      setSelected(new Set());
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center gap-4">
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => {
              setView("dashboard");
              setSelectedType(null);
              setSelected(new Set());
              setResult(null);
            }}
          >
            <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center font-bold text-sm shadow-lg shadow-cyan-900/30">
              FC
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">
                Profile Comparator
              </h1>
              <p className="text-[11px] text-slate-500 leading-tight">
                FortiManager Configuration Drift Analysis
              </p>
            </div>
          </div>

          {/* Breadcrumb */}
          {view !== "dashboard" && (
            <nav className="flex items-center gap-2 ml-6 text-sm text-slate-500">
              <button
                onClick={() => {
                  setView("dashboard");
                  setSelectedType(null);
                  setSelected(new Set());
                  setResult(null);
                }}
                className="hover:text-slate-300 transition"
              >
                Dashboard
              </button>
              {selectedType && (
                <>
                  <span className="text-slate-700">/</span>
                  <button
                    onClick={() => {
                      setView("picker");
                      setResult(null);
                    }}
                    className="hover:text-slate-300 transition"
                  >
                    {selectedType.label}
                  </button>
                </>
              )}
              {view === "comparison" && (
                <>
                  <span className="text-slate-700">/</span>
                  <span className="text-slate-400">
                    Comparing {selected.size} profiles
                  </span>
                </>
              )}
            </nav>
          )}

          {/* Right side: nav + user */}
          <div className="ml-auto flex items-center gap-4">
            <nav className="flex items-center gap-3 text-xs">
              <button
                onClick={() => router.push("/reference/application-signatures")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                App Signatures
              </button>
              <button
                onClick={() => router.push("/reference/ips-signatures")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                IPS Signatures
              </button>
            </nav>
            <div className="h-4 w-px bg-slate-800" />
            <span className="text-xs text-slate-500">{username}</span>
            <button
              onClick={doLogout}
              className="text-xs text-slate-600 hover:text-red-400 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Error */}
        {error && (
          <div className="mb-6 bg-red-950/50 border border-red-800 rounded-xl p-4 text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        )}

        {/* Dashboard */}
        {view === "dashboard" && (
          <ProfileDashboard types={types} onSelectType={handleSelectType} />
        )}

        {/* Profile Picker */}
        {view === "picker" && selectedType && (
          <ProfilePicker
            profileType={selectedType}
            profiles={profiles}
            selected={selected}
            loading={loading}
            onToggle={(name) => {
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(name)) next.delete(name);
                else next.add(name);
                return next;
              });
            }}
            onSelectAll={() =>
              setSelected(
                selected.size === profiles.length
                  ? new Set()
                  : new Set(profiles)
              )
            }
            onCompare={handleCompare}
            onBack={handleBack}
          />
        )}

        {/* Loading */}
        {view === "comparison" && loading && (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
            <p className="text-slate-400 mt-4">
              Fetching and comparing {selected.size} profiles...
            </p>
          </div>
        )}

        {/* Comparison */}
        {view === "comparison" && result && !loading && (
          <ComparisonTable
            profileType={result.profileType}
            profileNames={result.profileNames}
            fields={result.fields}
            collectionKeys={result.collectionKeys}
            rawProfiles={result.rawProfiles}
            pinnedFields={pins}
            onPinsChange={setPins}
          />
        )}
      </div>
    </main>
  );
}
