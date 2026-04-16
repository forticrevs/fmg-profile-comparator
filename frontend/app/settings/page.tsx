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
  fetchAiProviders,
  upsertAiProvider,
  deleteAiProvider,
  testAiProvider,
  fetchProviderModels,
  type AiProviderInfo,
} from "@/lib/api";

/* ------------------------------------------------------------------ */
/* Provider type catalog — maps UI-friendly types to backend config    */
/* ------------------------------------------------------------------ */

const PROVIDER_TYPES = [
  {
    slug: "ollama",
    label: "Ollama (Local)",
    kind: "ollama",
    defaultUrl: "http://localhost:11434",
    keyRequired: false,
    models: [] as string[],
    desc: "Locally-hosted models via Ollama",
    color: "cyan",
  },
  {
    slug: "openai",
    label: "OpenAI",
    kind: "openai_compat",
    defaultUrl: "https://api.openai.com/v1",
    keyRequired: true,
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
    desc: "GPT-4.1, o3, and other OpenAI models",
    color: "emerald",
  },
  {
    slug: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    defaultUrl: "https://api.anthropic.com/v1",
    keyRequired: true,
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-5-20251001"],
    desc: "Claude 4.x family",
    color: "amber",
  },
  {
    slug: "google",
    label: "Google Gemini",
    kind: "google",
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyRequired: true,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    desc: "Gemini 2.5 Pro and Flash",
    color: "blue",
  },
  {
    slug: "openrouter",
    label: "OpenRouter",
    kind: "openai_compat",
    defaultUrl: "https://openrouter.ai/api/v1",
    keyRequired: true,
    models: [] as string[],
    desc: "Multi-provider aggregator \u2014 hundreds of models, one API key",
    color: "purple",
  },
  {
    slug: "fortiaigate",
    label: "FortiAIGate",
    kind: "openai_compat",
    defaultUrl: "",
    keyRequired: false,
    models: [] as string[],
    desc: "Fortinet AI Security Gateway \u2014 prompt/response scanning",
    color: "amber",
  },
  {
    slug: "vllm",
    label: "vLLM",
    kind: "openai_compat",
    defaultUrl: "http://localhost:8000/v1",
    keyRequired: false,
    models: [] as string[],
    desc: "Self-hosted vLLM inference endpoint",
    color: "emerald",
  },
  {
    slug: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai_compat",
    defaultUrl: "",
    keyRequired: false,
    models: [] as string[],
    desc: "Any endpoint that speaks the /v1/chat/completions format",
    color: "slate",
  },
] as const;

type ProviderSlug = (typeof PROVIDER_TYPES)[number]["slug"];

const TYPE_BADGES: Record<string, string> = {
  ollama: "bg-cyan-900/50 text-cyan-400",
  openai_compat: "bg-emerald-900/50 text-emerald-400",
  anthropic: "bg-amber-900/50 text-amber-400",
  google: "bg-blue-900/50 text-blue-400",
};

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

  // ---- AI Provider state ----
  const [aiProviders, setAiProviders] = useState<AiProviderInfo[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [showAddAi, setShowAddAi] = useState(false);

  // Form fields
  const [aiType, setAiType] = useState<ProviderSlug>("ollama");
  const [aiName, setAiName] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiUrl, setAiUrl] = useState("http://localhost:11434");
  const [aiTemp, setAiTemp] = useState("0.7");
  const [aiMaxTokens, setAiMaxTokens] = useState("4096");
  const [aiSaving, setAiSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aiTesting, setAiTesting] = useState<string | null>(null);
  const [aiTestResult, setAiTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  // Models auto-fetched from the provider
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelsFetching, setModelsFetching] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const aiTypeInfo = PROVIDER_TYPES.find((t) => t.slug === aiType)!;
  const showKeyField = aiType !== "ollama";

  // Merged model list: live-fetched models trump static suggestions
  const allModels =
    fetchedModels.length > 0 ? fetchedModels : [...aiTypeInfo.models];

  const loadAiProviders = async () => {
    try {
      const data = await fetchAiProviders();
      setAiProviders(data.filter((p) => !p.is_embedding));
    } catch {
      /* silent — section just shows empty */
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    loadAiProviders();
  }, []);

  // Auto-fetch available models whenever the provider type, URL, or
  // API key changes. Debounced 400ms so rapid typing doesn't spam.
  // For providers that need a key, we wait until one is entered.
  useEffect(() => {
    if (!showAddAi) return;
    const kind = aiTypeInfo.kind;
    const needsKey = aiTypeInfo.keyRequired;
    if (needsKey && !aiKey) {
      setFetchedModels([]);
      return;
    }
    if (!aiUrl) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setModelsFetching(true);
      setModelsError(null);
      try {
        const result = await fetchProviderModels(kind, aiUrl, aiKey);
        if (cancelled) return;
        setFetchedModels(result.models);
        if (result.error) setModelsError(result.error);
        if (result.models.length > 0 && !aiModel) {
          setAiModel(result.models[0]);
        }
      } catch {
        if (!cancelled) setFetchedModels([]);
      } finally {
        if (!cancelled) setModelsFetching(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddAi, aiType, aiUrl, aiKey]);

  const handleAiTypeChange = (slug: ProviderSlug) => {
    const info = PROVIDER_TYPES.find((t) => t.slug === slug)!;
    setAiType(slug);
    setAiUrl(info.defaultUrl);
    setAiKey("");
    setAiModel("");
    setAiName("");
    setFetchedModels([]);
    setModelsError(null);
    setAiTestResult(null);
  };

  const handleAddAi = async (e: React.FormEvent) => {
    e.preventDefault();
    const model = aiModel;
    if (!model) return;
    setAiSaving(true);
    setError(null);
    const id =
      aiName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") ||
      `${aiType}-${model.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
    try {
      await upsertAiProvider({
        id,
        name: aiName.trim() || `${aiTypeInfo.label} \u2014 ${model}`,
        kind: aiTypeInfo.kind,
        base_url: aiUrl,
        api_key: aiKey,
        model,
        temperature: parseFloat(aiTemp) || 0.7,
        max_tokens: parseInt(aiMaxTokens, 10) || 4096,
        is_embedding: false,
        enabled: true,
      });
      // Reset form
      handleAiTypeChange("ollama");
      setShowAddAi(false);
      setShowAdvanced(false);
      setSuccess("AI provider saved");
      await loadAiProviders();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setAiSaving(false);
    }
  };

  const handleDeleteAi = async (p: AiProviderInfo) => {
    if (!confirm(`Remove "${p.name}"?`)) return;
    setError(null);
    try {
      await deleteAiProvider(p.id);
      setSuccess("Provider removed");
      await loadAiProviders();
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError("Failed to remove provider");
    }
  };

  const handleTestAi = async (id: string) => {
    setAiTesting(id);
    setAiTestResult(null);
    try {
      const result = await testAiProvider(id);
      setAiTestResult({
        ok: result.ok,
        msg: result.ok
          ? `Connected \u2014 model replied: "${result.reply}"`
          : result.error ?? "Connection failed",
      });
    } catch (err) {
      setAiTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setAiTesting(null);
    }
  };

  const handleSetDefault = (id: string) => {
    try {
      localStorage.setItem("chat:provider", id);
      setSuccess("Default provider updated");
      setTimeout(() => setSuccess(null), 3000);
    } catch {}
  };

  const defaultProviderId =
    typeof window !== "undefined"
      ? localStorage.getItem("chat:provider")
      : null;

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

        {/* ============================================================ */}
        {/* AI Providers                                                  */}
        {/* ============================================================ */}
        <div className="border-t border-slate-800 pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">AI Providers</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure LLM providers for the AI assistant.
              </p>
            </div>
            <button
              onClick={() => setShowAddAi(!showAddAi)}
              className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium"
            >
              {showAddAi ? "Cancel" : "+ Add Provider"}
            </button>
          </div>

          {aiLoading ? (
            <div className="text-center py-10">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
            </div>
          ) : aiProviders.length === 0 && !showAddAi ? (
            <div className="text-center py-12 border border-dashed border-slate-700 rounded-xl">
              <p className="text-slate-500 mb-3">
                No AI providers configured yet
              </p>
              <button
                onClick={() => setShowAddAi(true)}
                className="text-xs px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium"
              >
                Add Your First Provider
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {aiProviders.map((p) => (
                <div
                  key={p.id}
                  className={`border rounded-xl p-4 transition ${
                    defaultProviderId === p.id
                      ? "border-cyan-600 bg-cyan-950/20"
                      : "border-slate-800 bg-slate-900/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{p.name}</h3>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            TYPE_BADGES[p.kind] ?? "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {p.kind === "openai_compat"
                            ? "OPENAI API"
                            : p.kind.toUpperCase()}
                        </span>
                        {defaultProviderId === p.id && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-400 font-medium">
                            DEFAULT
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {p.model} &middot; {p.base_url}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTestAi(p.id)}
                        disabled={aiTesting === p.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 transition disabled:opacity-50"
                      >
                        {aiTesting === p.id ? "Testing..." : "Test"}
                      </button>
                      {defaultProviderId !== p.id && (
                        <button
                          onClick={() => handleSetDefault(p.id)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 transition"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteAi(p)}
                        className="text-xs px-2 py-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {/* Test result — shown inline under the card that was tested */}
                  {aiTestResult && aiTesting === null && p.id === (aiProviders.find(() => true)?.id) ? null : null}
                </div>
              ))}

              {/* Global test result banner */}
              {aiTestResult && (
                <div
                  className={`rounded-lg p-3 text-sm ${
                    aiTestResult.ok
                      ? "bg-emerald-950/50 border border-emerald-800 text-emerald-300"
                      : "bg-red-950/50 border border-red-800 text-red-300"
                  }`}
                >
                  {aiTestResult.msg}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Add AI Provider form */}
        {showAddAi && (
          <form
            onSubmit={handleAddAi}
            className="border border-slate-800 rounded-xl p-5 space-y-4 bg-slate-900/60"
          >
            <h3 className="font-semibold text-sm">Add AI Provider</h3>

            {/* Provider type selector */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Provider Type
              </label>
              <select
                value={aiType}
                onChange={(e) =>
                  handleAiTypeChange(e.target.value as ProviderSlug)
                }
                className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600"
              >
                {PROVIDER_TYPES.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label} — {t.desc}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Display name */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Display Name{" "}
                  <span className="text-slate-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={aiName}
                  onChange={(e) => setAiName(e.target.value)}
                  placeholder={`e.g. ${aiTypeInfo.label} ${aiModel || "..."}`}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                />
              </div>

              {/* Model — combobox: type freely or pick from suggestions */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Model
                  {modelsFetching && (
                    <span className="ml-2 text-slate-600">fetching...</span>
                  )}
                </label>
                {allModels.length > 0 ? (
                  <select
                    value={allModels.includes(aiModel) ? aiModel : ""}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600"
                  >
                    {!allModels.includes(aiModel) && (
                      <option value="" disabled>
                        {modelsFetching
                          ? "Loading models..."
                          : "Select a model"}
                      </option>
                    )}
                    {allModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder={
                      modelsFetching
                        ? "Loading models..."
                        : aiTypeInfo.keyRequired && !aiKey
                          ? "Enter API key to load models"
                          : "Model name or ID"
                    }
                    required
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                  />
                )}
                {modelsError && (
                  <p className="mt-1 text-[10px] text-amber-400">
                    {modelsError}
                  </p>
                )}
              </div>

              {/* API Key */}
              {showKeyField && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    API Key{" "}
                    {aiTypeInfo.keyRequired ? (
                      <span className="text-red-400">*</span>
                    ) : (
                      <span className="text-slate-600">(optional)</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    required={aiTypeInfo.keyRequired}
                    placeholder={
                      aiTypeInfo.keyRequired
                        ? "sk-..."
                        : "Leave blank if not required"
                    }
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                  />
                </div>
              )}

              {/* Base URL */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={aiUrl}
                  onChange={(e) => setAiUrl(e.target.value)}
                  required
                  placeholder="https://api.example.com/v1"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600 placeholder-slate-600"
                />
              </div>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
            >
              <span
                className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
              >
                ▶
              </span>
              Advanced
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Temperature{" "}
                    <span className="text-slate-600">(0.0 – 2.0)</span>
                  </label>
                  <input
                    type="number"
                    value={aiTemp}
                    onChange={(e) => setAiTemp(e.target.value)}
                    min={0}
                    max={2}
                    step={0.1}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Max Output Tokens
                  </label>
                  <input
                    type="number"
                    value={aiMaxTokens}
                    onChange={(e) => setAiMaxTokens(e.target.value)}
                    min={1}
                    max={128000}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-600"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddAi(false);
                  setShowAdvanced(false);
                  setAiTestResult(null);
                }}
                className="text-xs px-4 py-2 rounded-lg text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={aiSaving || !aiModel}
                className="text-xs px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium disabled:opacity-50"
              >
                {aiSaving ? "Saving..." : "Save Provider"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
