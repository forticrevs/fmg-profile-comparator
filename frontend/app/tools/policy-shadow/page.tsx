"use client";

/**
 * Policy Shadow analyzer tool.
 *
 * Lets the user pick packages in the active ADOM, kick off the shadow
 * analyzer subprocess via an ARQ job, poll for completion, and preview
 * the generated HTML report in a sandboxed iframe. XLSX / JSON reports
 * are exposed as plain download links.
 *
 * The iframe renders the report via `srcdoc` (not a blob: URL) so it
 * gets a unique opaque origin distinct from the parent. That lets us
 * use `sandbox="allow-scripts allow-same-origin"` safely: the report's
 * dark-mode toggle can read/write its own `localStorage`, but since
 * the origin differs from the parent it cannot break out of the
 * sandbox or touch the app's cookies, storage, or DOM. The HTML is
 * fetched through an authenticated request so the iframe itself never
 * carries a Bearer token.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import {
  JobStatus,
  PolicyShadowResult,
  downloadJobArtifact,
  fetchJobArtifactText,
  fetchJobStatus,
  fetchPolicyShadowPackages,
  submitPolicyShadowRun,
} from "@/lib/api";

type Phase = "idle" | "loading-pkgs" | "ready" | "running" | "done" | "error";

const ALL_FORMATS = ["html", "xlsx", "json"] as const;
type Format = (typeof ALL_FORMATS)[number];

export default function PolicyShadowPage() {
  return (
    <AuthGuard>
      <PolicyShadowBody />
    </AuthGuard>
  );
}

function PolicyShadowBody() {
  const [phase, setPhase] = useState<Phase>("loading-pkgs");
  const [error, setError] = useState<string | null>(null);

  // Available packages + user selection
  const [packages, setPackages] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [selectAll, setSelectAll] = useState(true);

  // Run options
  const [formats, setFormats] = useState<Set<Format>>(
    new Set(["html", "xlsx", "json"]),
  );
  const [includeDisabled, setIncludeDisabled] = useState(false);

  // Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<PolicyShadowResult | null>(null);
  const [htmlSrcDoc, setHtmlSrcDoc] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus["status"] | null>(null);

  const pollRef = useRef<number | null>(null);

  // -------------------------------------------------------------------
  // Initial load: package list
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPolicyShadowPackages();
        if (cancelled) return;
        setPackages(data.packages);
        setPhase("ready");
      } catch (exc) {
        if (cancelled) return;
        setError(exc instanceof Error ? exc.message : String(exc));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  // -------------------------------------------------------------------
  // Filter + selection helpers
  // -------------------------------------------------------------------
  const visiblePackages = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter((p) => p.toLowerCase().includes(q));
  }, [packages, filter]);

  const toggleOne = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setSelectAll(false);
  };

  const selectVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      visiblePackages.forEach((p) => next.add(p));
      return next;
    });
    setSelectAll(false);
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const toggleFormat = (f: Format) => {
    setFormats((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  // -------------------------------------------------------------------
  // Run
  // -------------------------------------------------------------------
  const run = async () => {
    if (formats.size === 0) {
      setError("Pick at least one output format");
      return;
    }
    setError(null);
    setResult(null);
    setHtmlSrcDoc(null);

    const body = {
      packages: selectAll ? [] : Array.from(selected),
      package_regex: null,
      formats: Array.from(formats),
      include_disabled: includeDisabled,
    };

    setPhase("running");
    setJobStatus("queued");

    try {
      const resp = await submitPolicyShadowRun(body);
      setJobId(resp.job_id);
      startPolling(resp.job_id);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setPhase("error");
    }
  };

  const startPolling = (id: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await fetchJobStatus(id);
        setJobStatus(s.status);
        if (s.status === "complete") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          const res = (s.result ?? null) as PolicyShadowResult | null;
          if (!res) {
            // ARQ reported complete but the task raised or returned
            // nothing. Surface whatever error text it gave us.
            setError(
              s.error ||
                "Analyzer finished but returned no result. Check the ARQ worker logs.",
            );
            setPhase("error");
            return;
          }
          setResult(res);
          setPhase("done");
          // Eagerly fetch the HTML as text for srcdoc rendering so the
          // iframe can render immediately without another spinner.
          if (res.html_report) {
            try {
              const html = await fetchJobArtifactText(id, res.html_report);
              setHtmlSrcDoc(html);
            } catch (exc) {
              console.warn("Failed to load HTML preview", exc);
            }
          }
        } else if (s.status === "not_found") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setError(
            "Job not found in the queue. Is the ARQ worker running and has it been restarted after the policy_shadow task was added?",
          );
          setPhase("error");
        }
      } catch (exc) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setError(exc instanceof Error ? exc.message : String(exc));
        setPhase("error");
      }
    }, 1500);
  };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href="/tools"
            className="text-xs text-slate-500 hover:text-cyan-400 transition"
          >
            ← Back to tools
          </Link>
          <h1 className="mt-3 text-2xl font-bold">Policy shadow analyzer</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Detect shadowed, redundant, and conflicting firewall rules across
            one or more packages in the active ADOM. The analyzer runs out of
            process and can take several minutes on large ADOMs.
          </p>
        </div>

        {phase === "loading-pkgs" && <Spinner label="Loading packages…" />}

        {phase === "error" && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error || "Unknown error"}
          </div>
        )}

        {(phase === "ready" || phase === "running" || phase === "done") && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            {/* Left: package picker + options */}
            <section className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200">
                    Packages
                  </h2>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {packages.length} total
                  </span>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={(e) => {
                      setSelectAll(e.target.checked);
                      if (e.target.checked) setSelected(new Set());
                    }}
                    className="accent-cyan-500"
                  />
                  Analyze all packages
                </label>

                {!selectAll && (
                  <>
                    <input
                      type="text"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter packages…"
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                    />
                    <div className="flex gap-2 text-[10px] uppercase tracking-wide">
                      <button
                        type="button"
                        onClick={selectVisible}
                        className="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300"
                      >
                        Select visible
                      </button>
                      <button
                        type="button"
                        onClick={clearSelection}
                        className="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/60">
                      {visiblePackages.length === 0 && (
                        <div className="p-2 text-[11px] text-slate-600">
                          No packages match
                        </div>
                      )}
                      {visiblePackages.map((p) => (
                        <label
                          key={p}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-900/80 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(p)}
                            onChange={() => toggleOne(p)}
                            className="accent-cyan-500"
                          />
                          <span className="truncate" title={p}>
                            {p}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {selected.size} selected
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <h2 className="text-sm font-semibold text-slate-200">
                  Output formats
                </h2>
                <div className="flex gap-3">
                  {ALL_FORMATS.map((f) => (
                    <label
                      key={f}
                      className="flex items-center gap-1.5 text-xs text-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={formats.has(f)}
                        onChange={() => toggleFormat(f)}
                        className="accent-cyan-500"
                      />
                      {f.toUpperCase()}
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeDisabled}
                    onChange={(e) => setIncludeDisabled(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  Include disabled rules
                </label>
              </div>

              <button
                type="button"
                onClick={run}
                disabled={
                  phase === "running" ||
                  formats.size === 0 ||
                  (!selectAll && selected.size === 0)
                }
                className="w-full rounded-lg bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
              >
                {phase === "running" ? "Analyzing…" : "Run analysis"}
              </button>
            </section>

            {/* Right: status + results */}
            <section className="space-y-4">
              {phase === "running" && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <Spinner
                    label={
                      jobStatus === "in_progress"
                        ? "Analyzer running — this may take a few minutes on large ADOMs…"
                        : "Queued — waiting for a worker slot…"
                    }
                  />
                  {jobId && (
                    <p className="mt-3 text-[10px] uppercase tracking-wide text-slate-600">
                      Job {jobId}
                    </p>
                  )}
                </div>
              )}

              {phase === "done" && result && (
                <ResultPanel
                  jobId={jobId!}
                  result={result}
                  htmlSrcDoc={htmlSrcDoc}
                />
              )}

              {phase === "ready" && !result && (
                <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-xs text-slate-500">
                  Pick your packages and output formats on the left, then
                  click <span className="text-slate-300">Run analysis</span>.
                  Reports will appear here once the analyzer finishes.
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
      {label}
    </div>
  );
}

function exitBadge(code: number | null) {
  if (code === 0) {
    return {
      label: "CLEAN",
      cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
      note: "No shadow / redundancy findings",
    };
  }
  if (code === 1) {
    return {
      label: "FINDINGS",
      cls: "bg-amber-500/20 text-amber-300 border-amber-500/40",
      note: "Analyzer reported shadow or redundancy findings",
    };
  }
  return {
    label: "ERROR",
    cls: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    note: "Analyzer terminated with an error",
  };
}

function ResultPanel({
  jobId,
  result,
  htmlSrcDoc,
}: {
  jobId: string;
  result: PolicyShadowResult;
  htmlSrcDoc: string | null;
}) {
  const badge = exitBadge(result.exit_code);
  const [tab, setTab] = useState<"report" | "logs">("report");
  const nonHtml = result.files.filter((f) => !f.endsWith(".html"));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${badge.cls}`}
            >
              {badge.label}
            </span>
            <span className="text-xs text-slate-400">{badge.note}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-slate-600">
            exit {result.exit_code ?? "—"}
          </span>
        </div>
        {result.error && (
          <p className="mt-3 text-xs text-rose-300">{result.error}</p>
        )}
        {nonHtml.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {nonHtml.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => downloadJobArtifact(jobId, f)}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300"
              >
                ⬇ {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="flex border-b border-slate-800">
          <TabButton
            label="HTML report"
            active={tab === "report"}
            onClick={() => setTab("report")}
            disabled={!result.html_report}
          />
          <TabButton
            label="Logs"
            active={tab === "logs"}
            onClick={() => setTab("logs")}
          />
        </div>

        {tab === "report" && (
          <div className="bg-slate-950">
            {htmlSrcDoc ? (
              // srcdoc gives the iframe a unique opaque origin distinct
              // from the parent, so allow-same-origin is safe here and
              // the report's dark-mode toggle can use its own localStorage.
              <iframe
                srcDoc={htmlSrcDoc}
                sandbox="allow-scripts allow-same-origin"
                className="h-[80vh] w-full border-0 bg-white"
                title="Policy shadow report"
              />
            ) : result.html_report ? (
              <div className="p-8">
                <Spinner label="Loading HTML report…" />
              </div>
            ) : (
              <div className="p-8 text-xs text-slate-500">
                No HTML report was generated for this run.
              </div>
            )}
          </div>
        )}

        {tab === "logs" && (
          <div className="bg-slate-950 p-4 space-y-4">
            <LogBlock label="stdout (tail)" body={result.stdout_tail} />
            <LogBlock label="stderr (tail)" body={result.stderr_tail} />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 text-xs font-medium transition ${
        active
          ? "border-b-2 border-cyan-500 text-cyan-300"
          : "text-slate-500 hover:text-slate-300"
      } disabled:text-slate-700 disabled:cursor-not-allowed disabled:hover:text-slate-700`}
    >
      {label}
    </button>
  );
}

function LogBlock({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <pre className="max-h-64 overflow-auto rounded border border-slate-800 bg-black/40 p-3 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
        {body || "(empty)"}
      </pre>
    </div>
  );
}
