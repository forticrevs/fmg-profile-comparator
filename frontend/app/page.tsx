"use client";

import { useState } from "react";
import ProfileSelector from "@/components/ProfileSelector";
import ComparisonTable from "@/components/ComparisonTable";
import { compareProfiles, fetchPins, ComparisonField } from "@/lib/api";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    profileType: string;
    profileNames: string[];
    fields: ComparisonField[];
  } | null>(null);
  const [pins, setPins] = useState<string[]>([]);

  const handleCompare = async (type: string, names: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const [comparison, currentPins] = await Promise.all([
        compareProfiles(type, names),
        fetchPins(type),
      ]);
      setResult({
        profileType: comparison.profile_type,
        profileNames: comparison.profile_names,
        fields: comparison.fields,
      });
      setPins(currentPins);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center font-bold text-sm">
            FC
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              FortiManager Profile Comparator
            </h1>
            <p className="text-xs text-slate-500">
              Compare security profiles &amp; SD-WAN templates — spot drift instantly
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Selector */}
        <ProfileSelector onCompare={handleCompare} />

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
            <p className="text-slate-400 mt-3">Fetching and comparing profiles...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-xl p-4 text-red-300">
            {error}
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <ComparisonTable
            profileType={result.profileType}
            profileNames={result.profileNames}
            fields={result.fields}
            pinnedFields={pins}
            onPinsChange={setPins}
          />
        )}
      </div>
    </main>
  );
}
