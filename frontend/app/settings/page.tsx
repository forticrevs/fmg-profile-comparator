"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthGuard";
import {
  fetchFmgInstances,
  addFmgInstance,
  deleteFmgInstance,
  connectFmg,
  FmgInstance,
} from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const {
    username,
    activeInstance,
    setActiveInstance,
    setInstances: setAuthInstances,
    setNeedsSetup,
  } = useAuth();

  const [instances, setInstances] = useState<FmgInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [fmgUser, setFmgUser] = useState("");
  const [fmgPass, setFmgPass] = useState("");
  const [adom, setAdom] = useState("root");
  const [verifySsl, setVerifySsl] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const loadInstances = async () => {
    try {
      const data = await fetchFmgInstances();
      setInstances(data);
      setAuthInstances(data);
    } catch {
      setError("Failed to load FMG instances");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInstances();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addFmgInstance({
        name,
        host,
        fmg_username: fmgUser,
        fmg_password: fmgPass,
        adom,
        verify_ssl: verifySsl,
      });
      setName("");
      setHost("");
      setFmgUser("");
      setFmgPass("");
      setAdom("root");
      setVerifySsl(false);
      setShowAdd(false);
      setSuccess("FortiManager instance added");
      setNeedsSetup(false);
      await loadInstances();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add instance");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, instanceName: string) => {
    if (!confirm(`Remove "${instanceName}"?`)) return;
    setError(null);
    try {
      await deleteFmgInstance(id);
      setSuccess("Instance removed");
      await loadInstances();
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError("Failed to remove instance");
    }
  };

  const handleConnect = async (id: string) => {
    setConnecting(id);
    setError(null);
    try {
      const inst = await connectFmg(id);
      setActiveInstance(inst);
      setSuccess(`Connected to ${inst.name}`);
      setTimeout(() => {
        setSuccess(null);
        router.push("/");
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-3"
          >
            <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center font-bold text-sm shadow-lg shadow-cyan-900/30">
              FC
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">
                Settings
              </h1>
              <p className="text-[11px] text-slate-500 leading-tight">
                Manage FortiManager Instances
              </p>
            </div>
          </button>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="text-slate-500">{username}</span>
            <button
              onClick={() => router.push("/")}
              className="text-slate-500 hover:text-cyan-400 transition"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Alerts */}
        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-red-300 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-300 ml-3"
            >
              ✕
            </button>
          </div>
        )}
        {success && (
          <div className="bg-emerald-950/50 border border-emerald-800 rounded-lg p-3 text-emerald-300 text-sm">
            {success}
          </div>
        )}

        {/* Instance list */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">FortiManager Instances</h2>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium"
            >
              {showAdd ? "Cancel" : "+ Add Instance"}
            </button>
          </div>

          {loading ? (
            <div className="text-center py-10">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
            </div>
          ) : instances.length === 0 && !showAdd ? (
            <div className="text-center py-12 border border-dashed border-slate-700 rounded-xl">
              <p className="text-slate-500 mb-3">
                No FortiManager instances configured yet
              </p>
              <button
                onClick={() => setShowAdd(true)}
                className="text-xs px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium"
              >
                Add Your First Instance
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {instances.map((inst) => (
                <div
                  key={inst.id}
                  className={`border rounded-xl p-4 transition ${
                    activeInstance?.id === inst.id
                      ? "border-cyan-600 bg-cyan-950/20"
                      : "border-slate-800 bg-slate-900/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{inst.name}</h3>
                        {activeInstance?.id === inst.id && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-400 font-medium">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {inst.host} &middot; {inst.username}@{inst.adom}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeInstance?.id !== inst.id && (
                        <button
                          onClick={() => handleConnect(inst.id)}
                          disabled={connecting === inst.id}
                          className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 transition disabled:opacity-50"
                        >
                          {connecting === inst.id
                            ? "Connecting..."
                            : "Connect"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(inst.id, inst.name)}
                        className="text-xs px-2 py-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add form */}
        {showAdd && (
          <form
            onSubmit={handleAdd}
            className="border border-slate-800 rounded-xl p-5 space-y-4 bg-slate-900/60"
          >
            <h3 className="font-semibold text-sm">Add FortiManager Instance</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Lab FMG"
                  required
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Host / IP
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="10.224.129.21"
                  required
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  FMG Username
                </label>
                <input
                  type="text"
                  value={fmgUser}
                  onChange={(e) => setFmgUser(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  FMG Password
                </label>
                <input
                  type="password"
                  value={fmgPass}
                  onChange={(e) => setFmgPass(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  ADOM
                </label>
                <input
                  type="text"
                  value={adom}
                  onChange={(e) => setAdom(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-slate-400 pb-2">
                  <input
                    type="checkbox"
                    checked={verifySsl}
                    onChange={(e) => setVerifySsl(e.target.checked)}
                    className="rounded"
                  />
                  Verify SSL
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="text-xs px-4 py-2 rounded-lg text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="text-xs px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : "Add Instance"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
