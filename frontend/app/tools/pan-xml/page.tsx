"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  downloadJobArtifact,
  fetchJobStatus,
  fetchPanParsers,
  submitPanExtract,
  type JobStatus,
  type PanParser,
} from "@/lib/api";

type Phase = "idle" | "submitting" | "running" | "complete" | "error";

export default function PanXmlPage() {
  const [parsers, setParsers] = useState<PanParser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [parsersError, setParsersError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPanParsers()
      .then((list) => {
        setParsers(list);
        // Default: everything selected.
        setSelected(new Set(list.map((p) => p.id)));
      })
      .catch((err) =>
        setParsersError(err instanceof Error ? err.message : "Failed to load parsers")
      );
  }, []);

  // Poll job status while running.
  useEffect(() => {
    if (phase !== "running" || !job) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchJobStatus(job.job_id);
        if (cancelled) return;
        setJob(next);
        if (next.status === "complete") {
          setPhase(next.result?.status === "ok" ? "complete" : "error");
          if (next.result?.status !== "ok") {
            setError(next.error || "Extraction failed");
          }
        } else if (next.status === "not_found") {
          setPhase("error");
          setError("Job disappeared — worker may not be running");
        }
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        setError(err instanceof Error ? err.message : "Poll failed");
      }
    };
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, job]);

  const toggleParser = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFile = (f: File | null) => {
    setFile(f);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Select a Palo Alto XML file first");
      return;
    }
    if (selected.size === 0) {
      setError("Select at least one parser");
      return;
    }
    setError(null);
    setPhase("submitting");
    try {
      const { job_id } = await submitPanExtract(file, Array.from(selected));
      setJob({ job_id, status: "queued", result: null, error: null });
      setPhase("running");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Submission failed");
    }
  };

  const handleReset = () => {
    setFile(null);
    setJob(null);
    setPhase("idle");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDownload = async (filename: string) => {
    if (!job) return;
    try {
      await downloadJobArtifact(job.job_id, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const busy = phase === "submitting" || phase === "running";
  const result = job?.result;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div>
          <Link
            href="/tools"
            className="text-xs text-slate-500 hover:text-cyan-400 transition"
          >
            ← Back to tools
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-white">PAN XML Extraction</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Upload a Palo Alto{" "}
            <code className="text-slate-400">running-config.xml</code> and
            select which extractors to run. Each produces CSV, XLSX, or
            FortiGate CLI output that you can download individually or as a
            bundled zip.
          </p>
        </div>

        {/* Parser selection */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-300">
              Extractors
            </h2>
            {parsers.length > 0 && (
              <div className="flex gap-3 text-[11px]">
                <button
                  type="button"
                  className="text-slate-500 hover:text-cyan-400"
                  onClick={() =>
                    setSelected(new Set(parsers.map((p) => p.id)))
                  }
                  disabled={busy}
                >
                  select all
                </button>
                <button
                  type="button"
                  className="text-slate-500 hover:text-cyan-400"
                  onClick={() => setSelected(new Set())}
                  disabled={busy}
                >
                  clear
                </button>
              </div>
            )}
          </div>

          {parsersError ? (
            <p className="text-xs text-red-400">{parsersError}</p>
          ) : parsers.length === 0 ? (
            <p className="text-xs text-slate-600">Loading extractors…</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {parsers.map((p) => {
                const checked = selected.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex gap-3 rounded-xl border p-4 cursor-pointer transition ${
                      checked
                        ? "border-cyan-500/40 bg-cyan-500/5"
                        : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                    } ${busy ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 accent-cyan-500"
                      checked={checked}
                      onChange={() => toggleParser(p.id)}
                      disabled={busy}
                    />
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-200">
                        {p.label}
                      </div>
                      <div className="text-[11px] text-slate-500 leading-relaxed">
                        {p.description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* File picker */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-300">Config file</h2>
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="block w-full text-xs text-slate-400 file:mr-4 file:rounded-md file:border-0 file:bg-cyan-600 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-cyan-500 file:cursor-pointer disabled:opacity-50"
            />
            {file && (
              <p className="mt-3 text-[11px] text-slate-500">
                Selected: <span className="text-slate-300">{file.name}</span>{" "}
                <span className="text-slate-600">
                  ({(file.size / 1024).toFixed(1)} KiB)
                </span>
              </p>
            )}
          </div>
        </section>

        {/* Actions */}
        <section className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !file || selected.size === 0}
            className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed transition"
          >
            {phase === "submitting"
              ? "Uploading…"
              : phase === "running"
              ? "Running…"
              : "Run extractors"}
          </button>
          {(phase === "complete" || phase === "error") && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 hover:border-slate-600 transition"
            >
              Start over
            </button>
          )}
          {job && (
            <span className="text-[11px] text-slate-600 font-mono">
              job {job.job_id} · {job.status}
            </span>
          )}
        </section>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/40 rounded-md p-3">
            {error}
          </p>
        )}

        {/* Results */}
        {phase === "complete" && result && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-300">Output</h2>
            <div className="space-y-2">
              {result.archive && (
                <button
                  type="button"
                  onClick={() => handleDownload(result.archive!)}
                  className="flex items-center justify-between w-full rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 hover:border-cyan-500/50 transition text-left"
                >
                  <div>
                    <div className="text-sm font-semibold text-cyan-300">
                      {result.archive}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Bundled archive of every parser output
                    </div>
                  </div>
                  <span className="text-[11px] text-cyan-400">download ↓</span>
                </button>
              )}

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
                {result.parsers.map((p) => (
                  <div key={p.parser} className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-200">
                        {parsers.find((x) => x.id === p.parser)?.label ??
                          p.parser}
                      </div>
                      <span
                        className={`text-[10px] uppercase tracking-wide ${
                          p.status === "ok"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    {p.error && (
                      <p className="mt-1 text-[11px] text-red-400">{p.error}</p>
                    )}
                    {p.files && p.files.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.files.map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => handleDownload(f)}
                            className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline font-mono"
                          >
                            {f} ↓
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
