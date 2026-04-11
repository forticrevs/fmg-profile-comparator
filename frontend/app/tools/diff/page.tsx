"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDiffLimits,
  submitDiffCompare,
  type DiffCompareResult,
  type DiffLimits,
} from "@/lib/api";

/**
 * Diff utility — upload 2-6 text or structured config files, select a
 * baseline, and get unified diffs per candidate.
 *
 * Everything shown here is client-side pre-validation; the authoritative
 * security checks live in the backend (`app/services/file_security.py`).
 * We replicate the shape of the checks here purely so the user gets fast
 * feedback before submitting — never trust the client.
 */

type Phase = "idle" | "submitting" | "complete" | "error";

interface StagedFile {
  id: string;       // stable client-side id (crypto.randomUUID)
  file: File;
  error?: string;   // client-side pre-validation failure
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export default function DiffToolPage() {
  const [limits, setLimits] = useState<DiffLimits | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiffCompareResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDiffLimits()
      .then(setLimits)
      .catch((e) =>
        setLimitsError(e instanceof Error ? e.message : "Failed to load limits"),
      );
  }, []);

  // Keep the first staged file as the default baseline unless the user
  // picks otherwise. Clears cleanly when the list empties.
  useEffect(() => {
    if (staged.length === 0) {
      setBaselineId(null);
      return;
    }
    if (!baselineId || !staged.some((s) => s.id === baselineId)) {
      setBaselineId(staged[0].id);
    }
  }, [staged, baselineId]);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const next: StagedFile[] = [];
    for (const f of Array.from(files)) {
      next.push({
        id: uid(),
        file: f,
        error: preValidate(f, limits),
      });
    }
    setStaged((prev) => {
      const combined = [...prev, ...next];
      if (limits && combined.length > limits.max_file_count) {
        setError(
          `At most ${limits.max_file_count} files allowed — extras ignored.`,
        );
        return combined.slice(0, limits.max_file_count);
      }
      return combined;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeStaged = (id: string) => {
    setStaged((prev) => prev.filter((s) => s.id !== id));
  };

  const clearAll = () => {
    setStaged([]);
    setResult(null);
    setError(null);
    setPhase("idle");
  };

  const handleSubmit = async () => {
    if (!limits) return;
    if (staged.length < limits.min_file_count) {
      setError(`At least ${limits.min_file_count} files required`);
      return;
    }
    const invalid = staged.filter((s) => s.error);
    if (invalid.length > 0) {
      setError(`Fix staged file errors before submitting`);
      return;
    }
    const baselineIdx = staged.findIndex((s) => s.id === baselineId);
    if (baselineIdx < 0) {
      setError("Pick a baseline file");
      return;
    }
    setError(null);
    setPhase("submitting");
    try {
      const res = await submitDiffCompare(
        staged.map((s) => s.file),
        baselineIdx,
      );
      setResult(res);
      setPhase("complete");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Diff failed");
    }
  };

  const busy = phase === "submitting";
  const totalBytes = staged.reduce((acc, s) => acc + s.file.size, 0);

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
          <h1 className="mt-3 text-2xl font-bold text-white">Diff utility</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Compare 2–6 text or structured config files against a baseline.
            Supported formats: txt, conf, cfg, json, xml, yaml. JSON, YAML,
            and XML are canonicalised before diffing so key-order churn
            disappears.
          </p>
        </div>

        {limitsError && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/40 rounded-md p-3">
            {limitsError}
          </p>
        )}

        {limits && (
          <LimitsPanel limits={limits} totalBytes={totalBytes} count={staged.length} />
        )}

        {/* File picker */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-300">Files</h2>
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={limits?.allowed_extensions.join(",") ?? ".txt,.conf,.cfg,.json,.xml,.yaml,.yml"}
              onChange={(e) => addFiles(e.target.files)}
              disabled={busy}
              className="block w-full text-xs text-slate-400 file:mr-4 file:rounded-md file:border-0 file:bg-cyan-600 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-cyan-500 file:cursor-pointer disabled:opacity-50"
            />
            <p className="mt-3 text-[11px] text-slate-600">
              Selected files stay in your browser until you click “Run diff”.
              Server never writes uploads to disk.
            </p>
          </div>

          {staged.length > 0 && (
            <StagedList
              staged={staged}
              baselineId={baselineId}
              onPickBaseline={setBaselineId}
              onRemove={removeStaged}
              onClear={clearAll}
              busy={busy}
            />
          )}
        </section>

        {/* Actions */}
        <section className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !limits || staged.length < (limits?.min_file_count ?? 2)}
            className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed transition"
          >
            {busy ? "Running…" : "Run diff"}
          </button>
          {(phase === "complete" || phase === "error") && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 hover:border-slate-600 transition"
            >
              Start over
            </button>
          )}
        </section>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/40 rounded-md p-3">
            {error}
          </p>
        )}

        {phase === "complete" && result && <DiffResults result={result} />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Client-side pre-validation — *hints only*, backend is authoritative.
// ---------------------------------------------------------------------------

function preValidate(file: File, limits: DiffLimits | null): string | undefined {
  if (!limits) return undefined;
  if (file.size === 0) return "empty file";
  if (file.size > limits.max_file_bytes) {
    return `too large (${formatBytes(file.size)} > ${formatBytes(limits.max_file_bytes)})`;
  }
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!limits.allowed_extensions.includes(ext)) {
    return `extension ${ext || "(none)"} not allowed`;
  }
  return undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function LimitsPanel({
  limits,
  totalBytes,
  count,
}: {
  limits: DiffLimits;
  totalBytes: number;
  count: number;
}) {
  const totalPct = Math.min(100, (totalBytes / limits.max_total_bytes) * 100);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-[11px] text-slate-500 space-y-2">
      <div className="flex items-center justify-between">
        <span>
          {count} / {limits.max_file_count} files
        </span>
        <span className="tabular-nums">
          {formatBytes(totalBytes)} / {formatBytes(limits.max_total_bytes)}
        </span>
      </div>
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            totalPct > 90 ? "bg-red-500" : totalPct > 70 ? "bg-amber-500" : "bg-cyan-500"
          }`}
          style={{ width: `${totalPct}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-600">
        Max {formatBytes(limits.max_file_bytes)} per file · allowed:{" "}
        {limits.allowed_extensions.join(" ")}
      </p>
    </div>
  );
}

function StagedList({
  staged,
  baselineId,
  onPickBaseline,
  onRemove,
  onClear,
  busy,
}: {
  staged: StagedFile[];
  baselineId: string | null;
  onPickBaseline: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950/60 border-b border-slate-800">
        <span className="text-[10px] uppercase tracking-wide text-slate-600">
          Staged — pick one as the baseline
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-[10px] text-slate-600 hover:text-red-400 transition disabled:opacity-50"
        >
          clear all
        </button>
      </div>
      <ul className="divide-y divide-slate-800/60">
        {staged.map((s) => {
          const isBaseline = s.id === baselineId;
          return (
            <li
              key={s.id}
              className={`flex items-center gap-3 px-4 py-2.5 transition ${
                isBaseline ? "bg-emerald-950/20" : ""
              } ${s.error ? "bg-red-950/20" : ""}`}
            >
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="diff-baseline"
                  checked={isBaseline}
                  onChange={() => onPickBaseline(s.id)}
                  disabled={busy || !!s.error}
                  className="accent-emerald-500"
                />
              </label>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200 font-mono truncate">
                    {s.file.name}
                  </span>
                  {isBaseline && (
                    <span className="text-[9px] uppercase tracking-wider text-emerald-400 font-semibold">
                      baseline
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-600 tabular-nums">
                  {formatBytes(s.file.size)}
                </div>
                {s.error && (
                  <div className="text-[10px] text-red-400 mt-0.5">{s.error}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                disabled={busy}
                className="text-slate-600 hover:text-red-400 transition text-sm disabled:opacity-50"
                aria-label={`Remove ${s.file.name}`}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DiffResults({ result }: { result: DiffCompareResult }) {
  const baseline = result.files[result.baseline_index];
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-slate-300">Diffs</h2>
        <span className="text-[11px] text-slate-600">
          format: <span className="text-slate-400 font-mono">{result.format}</span> ·
          baseline:{" "}
          <span className="text-emerald-400 font-mono">{baseline?.name}</span>
        </span>
      </div>

      <div className="space-y-4">
        {result.diffs.length === 0 && (
          <p className="text-xs text-slate-600 italic">
            No candidate files to diff.
          </p>
        )}
        {result.diffs.map((d) => (
          <DiffBlock key={d.name + d.index} diff={d} />
        ))}
      </div>
    </section>
  );
}

function DiffBlock({ diff }: { diff: DiffCompareResult["diffs"][number] }) {
  const lines = useMemo(
    () => (diff.unified ? diff.unified.split("\n") : []),
    [diff.unified],
  );
  const unchanged = diff.added === 0 && diff.removed === 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950/60 border-b border-slate-800">
        <span className="text-sm font-mono text-slate-300 truncate">
          {diff.name}
        </span>
        <div className="flex items-center gap-2 text-[10px] font-semibold tabular-nums">
          {unchanged ? (
            <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-emerald-300">
              ✓ identical
            </span>
          ) : (
            <>
              <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-emerald-300">
                +{diff.added}
              </span>
              <span className="rounded-full border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-red-300">
                −{diff.removed}
              </span>
            </>
          )}
          {diff.truncated && (
            <span className="rounded-full border border-amber-900/60 bg-amber-950/40 px-2 py-0.5 text-amber-300">
              truncated
            </span>
          )}
        </div>
      </div>
      {!unchanged && (
        <pre className="m-0 text-[11px] font-mono leading-relaxed bg-slate-950/40 overflow-x-auto">
          {lines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </pre>
      )}
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  // Unified-diff line prefixes: `+++ ` / `--- ` (file headers), `@@` (hunks),
  // `+ ` / `- ` (changes), ` ` (context). Color-code accordingly. React
  // escapes `line` automatically — no XSS surface via injected diff content.
  let cls = "block px-3 text-slate-500";
  if (line.startsWith("+++") || line.startsWith("---")) {
    cls = "block px-3 text-slate-400 bg-slate-900/60 font-semibold";
  } else if (line.startsWith("@@")) {
    cls = "block px-3 text-cyan-400 bg-cyan-950/20 font-semibold";
  } else if (line.startsWith("+")) {
    cls = "block px-3 text-emerald-300 bg-emerald-950/20";
  } else if (line.startsWith("-")) {
    cls = "block px-3 text-red-300 bg-red-950/20";
  }
  return <span className={cls}>{line || "\u00a0"}</span>;
}
