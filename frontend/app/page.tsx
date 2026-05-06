"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import ProfileDashboard from "@/components/ProfileDashboard";
import ProfilePicker from "@/components/ProfilePicker";
import ComparisonTable from "@/components/ComparisonTable";
import { useAuth } from "@/components/AuthGuard";
import { useChatContext } from "@/components/ChatContext";
import {
  fetchProfileTypes,
  fetchProfiles,
  compareProfiles,
  fetchPins,
  ProfileType,
  ComparisonField,
} from "@/lib/api";

type View = "dashboard" | "picker" | "comparison";

const BASELINE_KEY = (type: string) => `baseline:${type}`;

function loadBaseline(type: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BASELINE_KEY(type));
  } catch {
    return null;
  }
}

function saveBaseline(type: string, name: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (name) window.localStorage.setItem(BASELINE_KEY(type), name);
    else window.localStorage.removeItem(BASELINE_KEY(type));
  } catch {
    /* ignore quota / private mode failures */
  }
}

function compactContextValue(value: unknown): unknown {
  if (value === "__MISSING__") return "missing";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 400 ? `${value.slice(0, 400)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (
      value.every(
        (item) =>
          item === null ||
          ["string", "number", "boolean"].includes(typeof item),
      )
    ) {
      return value.length > 20
        ? [...value.slice(0, 20), `... ${value.length - 20} more`]
        : value;
    }
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 5).map(compactContextValue),
    };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("raw" in obj && "display" in obj) {
      return { raw: obj.raw, display: obj.display };
    }
    const json = JSON.stringify(obj);
    return json.length > 400 ? `${json.slice(0, 400)}...` : json;
  }
  return String(value);
}

export default function Home() {
  const { username, activeInstance, needsSetup, logout: doLogout } = useAuth();
  const { setPageContext, clearPageContext } = useChatContext();
  const router = useRouter();
  const [view, setView] = useState<View>("dashboard");
  const [types, setTypes] = useState<ProfileType[]>([]);
  const [selectedType, setSelectedType] = useState<ProfileType | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [baseline, setBaselineState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Comparison state
  const [result, setResult] = useState<{
    profileType: string;
    profileNames: string[];
    fields: ComparisonField[];
    collectionKeys: string[];
    rawProfiles: Record<string, Record<string, unknown>>;
    baseline: string | null;
  } | null>(null);
  const [pins, setPins] = useState<string[]>([]);
  const selectedProfiles = useMemo(() => Array.from(selected), [selected]);

  // Persisted baseline setter — writes through to localStorage scoped by
  // profile type. The user-facing requirement is "remember my baseline
  // across sessions, but let me change it" — single key per type matches
  // the typical "I always compare against THE_GOLDEN" workflow.
  const setBaseline = (name: string | null) => {
    setBaselineState(name);
    if (selectedType) saveBaseline(selectedType.id, name);
  };

  // If the user deselects the profile that's currently the baseline,
  // clear the baseline so we don't ship a stale name to the comparator.
  useEffect(() => {
    if (baseline && !selected.has(baseline)) {
      setBaselineState(null);
      if (selectedType) saveBaseline(selectedType.id, null);
    }
  }, [selected, baseline, selectedType]);

  useEffect(() => {
    fetchProfileTypes().then(setTypes).catch(console.error);
  }, []);

  const handleSelectType = async (type: ProfileType) => {
    setSelectedType(type);
    setSelected(new Set());
    // Restore the user's persisted baseline for this profile type. It
    // gets cleared automatically by the effect above if it isn't in the
    // current selection.
    setBaselineState(loadBaseline(type.id));
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

  // Re-runs the comparison API call. Used both by the initial Compare
  // button and by the in-comparison "change baseline" affordance, so the
  // server-side drift map always reflects the current baseline choice.
  const runComparison = async (
    type: ProfileType,
    names: string[],
    baselineName: string | null,
    refetchPins: boolean,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const comparisonPromise = compareProfiles(type.id, names, baselineName);
      const pinsPromise = refetchPins ? fetchPins(type.id) : Promise.resolve(null);
      const [comparison, currentPins] = await Promise.all([
        comparisonPromise,
        pinsPromise,
      ]);
      setResult({
        profileType: comparison.profile_type,
        profileNames: comparison.profile_names,
        fields: comparison.fields,
        collectionKeys: comparison.collection_keys,
        rawProfiles: comparison.raw_profiles,
        baseline: comparison.baseline ?? null,
      });
      if (currentPins) setPins(currentPins);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
      setView("picker");
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async () => {
    if (!selectedType || selected.size < 2) return;
    setView("comparison");
    await runComparison(selectedType, Array.from(selected), baseline, true);
  };

  // Called from inside ComparisonTable when the user picks a different
  // baseline mid-view. We persist + re-run the diff against the new
  // anchor so the per-cell drift markers stay accurate.
  const handleBaselineChangeInComparison = async (name: string | null) => {
    setBaseline(name);
    if (!selectedType || !result) return;
    await runComparison(selectedType, result.profileNames, name, false);
  };

  const handleBack = () => {
    if (view === "comparison") {
      setView("picker");
      setResult(null);
    } else if (view === "picker") {
      setView("dashboard");
      setSelectedType(null);
      setSelected(new Set());
      setBaselineState(null);
    }
  };

  useEffect(() => {
    return () => clearPageContext("profile-comparator");
  }, [clearPageContext]);

  useEffect(() => {
    if (view === "comparison" && result) {
      const driftFields = result.fields.filter((field) => !field.in_sync);
      const pinSet = new Set(pins);
      setPageContext({
        id: "profile-comparator",
        kind: "profile_comparison",
        label: `Comparing ${result.profileNames.length} ${result.profileType} profiles`,
        data: {
          active_fmg: activeInstance?.name ?? null,
          profile_type: result.profileType,
          profile_names: result.profileNames,
          baseline: result.baseline,
          field_count: result.fields.length,
          sync_field_count: result.fields.length - driftFields.length,
          drift_field_count: driftFields.length,
          collection_keys: result.collectionKeys,
          pinned_count: pins.length,
          pinned_drift_fields: pins.filter((fieldPath) =>
            driftFields.some((field) => field.field_path === fieldPath),
          ),
          top_drift_fields: driftFields.slice(0, 20).map((field) => ({
            field_path: field.field_path,
            label: field.label,
            pinned: pinSet.has(field.field_path),
            values: Object.fromEntries(
              result.profileNames.map((name) => [
                name,
                compactContextValue(field.values[name]),
              ]),
            ),
          })),
        },
      });
      return;
    }

    if (view === "picker" && selectedType) {
      setPageContext({
        id: "profile-comparator",
        kind: "profile_picker",
        label: `${selectedType.label} profile picker`,
        data: {
          active_fmg: activeInstance?.name ?? null,
          profile_type: selectedType.id,
          profile_type_label: selectedType.label,
          profile_count: profiles.length,
          selected_count: selectedProfiles.length,
          selected_profiles: selectedProfiles.slice(0, 30),
          baseline,
          loading,
          error,
        },
      });
      return;
    }

    setPageContext({
      id: "profile-comparator",
      kind: "profile_dashboard",
      label: "Profile Comparator dashboard",
      data: {
        active_fmg: activeInstance?.name ?? null,
        needs_setup: needsSetup,
        available_profile_types: types.map((type) => ({
          id: type.id,
          label: type.label,
        })),
      },
    });
  }, [
    activeInstance?.name,
    baseline,
    error,
    loading,
    needsSetup,
    pins,
    profiles.length,
    result,
    selectedProfiles,
    selectedType,
    setPageContext,
    types,
    view,
  ]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="w-full flex items-center gap-4">
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
              <button
                onClick={() => router.push("/reference/dlp-sensors")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                DLP Sensors
              </button>
              <button
                onClick={() => router.push("/reference/dlp-dictionaries")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                DLP Dictionaries
              </button>
              <button
                onClick={() => router.push("/reference/dlp-data-types")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                DLP Data Types
              </button>
              <button
                onClick={() => router.push("/reference/internet-services")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                Internet Services
              </button>
              <button
                onClick={() => router.push("/reference/metadata-variables")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                Metadata Vars
              </button>
              <button
                onClick={() => router.push("/reference/local-web-categories")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                Local Web Cats
              </button>
              <button
                onClick={() => router.push("/reference/web-rating-overrides")}
                className="text-slate-500 hover:text-cyan-400 transition"
              >
                Web Overrides
              </button>
            </nav>
            <div className="h-4 w-px bg-slate-800" />
            {activeInstance && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-900/40 text-cyan-400 border border-cyan-800/50">
                {activeInstance.name}
              </span>
            )}
            <button
              onClick={() => router.push("/settings")}
              className="text-xs text-slate-500 hover:text-cyan-400 transition"
              title="Settings"
            >
              ⚙
            </button>
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

      <div className="w-full px-6 py-6">
        {/* Setup prompt */}
        {needsSetup && (
          <div className="mb-6 bg-amber-950/30 border border-amber-800/50 rounded-xl p-4 text-amber-300 text-sm flex items-center justify-between">
            <span>
              No FortiManager instances configured.{" "}
              <button
                onClick={() => router.push("/settings")}
                className="underline hover:text-amber-200"
              >
                Add one in Settings
              </button>{" "}
              to get started.
            </span>
          </div>
        )}

        {/* No active FMG */}
        {!needsSetup && !activeInstance && (
          <div className="mb-6 bg-blue-950/30 border border-blue-800/50 rounded-xl p-4 text-blue-300 text-sm flex items-center justify-between">
            <span>
              No FortiManager connected.{" "}
              <button
                onClick={() => router.push("/settings")}
                className="underline hover:text-blue-200"
              >
                Select one in Settings
              </button>{" "}
              to begin comparing profiles.
            </span>
          </div>
        )}

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
            baseline={baseline}
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
            onBaselineChange={setBaseline}
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
            baseline={result.baseline}
            onBaselineChange={handleBaselineChangeInComparison}
            pinnedFields={pins}
            onPinsChange={setPins}
          />
        )}
      </div>
    </main>
  );
}
