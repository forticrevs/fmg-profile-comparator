"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  compareObjectMigrationConfig,
  exportObjectMigrationConfig,
  fetchObjectMigrationFamilies,
  type ObjectMigrationCompareResult,
  type ObjectMigrationFamily,
  type ObjectMigrationFamilyResult,
  type ObjectMigrationRow,
  type ObjectMigrationStatus,
} from "@/lib/api";
import { useChatContext } from "@/components/ChatContext";

type Phase = "idle" | "loading" | "running" | "complete" | "error";
type ResultFilter =
  | "source"
  | "fmg"
  | "match"
  | "missing"
  | "conflict"
  | "duplicate-source"
  | "errors";

type SummaryMetric = {
  id: ResultFilter;
  label: string;
  value: number;
};

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function ObjectMigrationComparePage() {
  const [families, setFamilies] = useState<ObjectMigrationFamily[]>([]);
  const [selectedFamilies, setSelectedFamilies] = useState<Set<string>>(new Set());
  const [configText, setConfigText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [includeMatches, setIncludeMatches] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ObjectMigrationCompareResult | null>(null);
  const [activeFilter, setActiveFilter] = useState<ResultFilter | null>(null);
  const [rowLimit, setRowLimit] = useState(100);
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { setPageContext, clearPageContext } = useChatContext();

  useEffect(() => {
    fetchObjectMigrationFamilies()
      .then((items) => {
        setFamilies(items);
        setSelectedFamilies(new Set(items.map((item) => item.id)));
        setPhase("idle");
      })
      .catch((e) => {
        setPhase("error");
        setError(e instanceof Error ? e.message : "Failed to load object families");
      });
  }, []);

  useEffect(() => {
    return () => clearPageContext("tool:object-migration");
  }, [clearPageContext]);

  useEffect(() => {
    setPageContext({
      id: "tool:object-migration",
      kind: "object_migration_compare",
      label: "Object migration comparison",
      data: {
        file_name: fileName,
        selected_families: Array.from(selectedFamilies),
        source_size: configText.length,
        summary: result?.summary ?? null,
        conflict_families:
          result?.families
            .filter((family) => family.conflicts > 0 || family.missing > 0)
            .map((family) => ({
              id: family.id,
              label: family.label,
              missing: family.missing,
              conflicts: family.conflicts,
              duplicates: family.duplicates,
            })) ?? [],
      },
    });
  }, [configText.length, fileName, result, selectedFamilies, setPageContext]);

  const selectedCount = selectedFamilies.size;
  const canRun = configText.trim().length > 0 && selectedCount > 0 && phase !== "running";
  const summaryRows = useMemo<SummaryMetric[]>(() => {
    if (!result) return [];
    return [
      { id: "source", label: "Source", value: result.summary.source },
      { id: "fmg", label: "FMG", value: result.summary.fmg },
      { id: "match", label: "Match", value: result.summary.matched },
      { id: "missing", label: "Missing", value: result.summary.missing },
      { id: "conflict", label: "Conflict", value: result.summary.conflicts },
      { id: "duplicate-source", label: "Duplicate", value: result.summary.duplicates },
      { id: "errors", label: "Errors", value: result.summary.errors },
    ];
  }, [result]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setActiveFilter(null);
    if (file.size > DEFAULT_MAX_FILE_BYTES) {
      setError("Config file exceeds the 5 MiB limit");
      return;
    }
    try {
      setConfigText(await file.text());
      setFileName(file.name);
    } catch {
      setError("Failed to read config file");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleFamily = (id: string) => {
    setSelectedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runCompare = async (
    viewFilter: ResultFilter | null = activeFilter,
    nextRowLimit = rowLimit,
    nextIncludeMatches = includeMatches,
  ) => {
    if (!canRun) return;
    setPhase("running");
    setError(null);
    setResult(null);
    setActiveFilter(viewFilter);
    try {
      const data = await compareObjectMigrationConfig(
        configText,
        Array.from(selectedFamilies),
        {
          includeMatches: nextIncludeMatches,
          resultLimitPerFamily: nextRowLimit,
          viewFilter,
        },
      );
      setResult(data);
      setPhase("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Object comparison failed");
      setPhase("error");
    }
  };

  const clearInput = () => {
    setConfigText("");
    setFileName(null);
    setResult(null);
    setError(null);
    setActiveFilter(null);
    setPhase(families.length ? "idle" : "loading");
  };

  const drillTo = (filter: ResultFilter) => {
    setActiveFilter(filter);
    if (canRun) {
      void runCompare(filter);
    }
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const clearFilter = () => {
    setActiveFilter(null);
    if (canRun) {
      void runCompare(null);
    }
  };

  const changeRowLimit = (value: number) => {
    setRowLimit(value);
    if (canRun && result) {
      void runCompare(activeFilter, value);
    }
  };

  const exportResult = async (format: "json" | "csv") => {
    if (!configText.trim() || selectedFamilies.size === 0) return;
    setExporting(format);
    setError(null);
    try {
      const blob = await exportObjectMigrationConfig(
        configText,
        Array.from(selectedFamilies),
        format,
      );
      downloadBlob(
        `object-migration-compare.${format}`,
        blob,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Object comparison export failed");
    } finally {
      setExporting(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-[1900px] px-6 py-10 space-y-8">
        <div>
          <Link
            href="/tools"
            className="text-xs text-slate-500 hover:text-cyan-400 transition"
          >
            Back to tools
          </Link>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                Object Migration Compare
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Compare FortiConverter output against same-named objects in the
                active FortiManager ADOM before importing migrated policy data.
              </p>
            </div>
            {result && (
              <div className="text-right text-xs text-slate-500">
                <div>ADOM</div>
                <div className="font-semibold text-slate-300">{result.adom}</div>
              </div>
            )}
          </div>
        </div>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Input</h2>
              <input
                ref={fileInputRef}
                type="file"
                accept=".conf,.cfg,.txt"
                onChange={(event) => handleFile(event.target.files?.[0])}
                disabled={phase === "running"}
                className="mt-4 block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-cyan-500 disabled:opacity-50"
              />
              {fileName && (
                <div className="mt-3 truncate text-xs text-slate-500">
                  Loaded <span className="text-slate-300">{fileName}</span>
                </div>
              )}
              <textarea
                value={configText}
                onChange={(event) => {
                  setConfigText(event.target.value);
                  setFileName(null);
                  setResult(null);
                  setActiveFilter(null);
                }}
                spellCheck={false}
                placeholder="config firewall address&#10;    edit &quot;obj-name&quot;&#10;        set subnet 10.0.0.1 255.255.255.255&#10;    next&#10;end"
                className="mt-4 h-72 w-full resize-y rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300 outline-none focus:border-cyan-700"
              />
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-600">
                <span>{configText.length.toLocaleString()} chars</span>
                <button
                  type="button"
                  onClick={clearInput}
                  disabled={phase === "running" || !configText}
                  className="text-slate-500 hover:text-slate-300 disabled:text-slate-700"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-200">Object Types</h2>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedFamilies(
                      selectedFamilies.size === families.length
                        ? new Set()
                        : new Set(families.map((family) => family.id)),
                    )
                  }
                  className="text-[11px] text-cyan-500 hover:text-cyan-300"
                >
                  {selectedFamilies.size === families.length ? "None" : "All"}
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {families.map((family) => (
                  <label
                    key={family.id}
                    className="flex items-center gap-2 text-xs text-slate-400"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFamilies.has(family.id)}
                      onChange={() => toggleFamily(family.id)}
                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-cyan-600"
                    />
                    <span>{family.label}</span>
                  </label>
                ))}
              </div>
              <label className="mt-4 flex items-center gap-2 border-t border-slate-800 pt-4 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={includeMatches}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setIncludeMatches(next);
                    if (result && canRun) {
                      void runCompare(activeFilter, rowLimit, next);
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-cyan-600"
                />
                <span>Show matching objects</span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => runCompare(null)}
              disabled={!canRun}
              className="w-full rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
            >
              {phase === "running" ? "Comparing..." : "Compare to FortiManager"}
            </button>
          </aside>

          <section className="min-w-0 space-y-5">
            {error && (
              <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {result ? (
              <div ref={resultsRef} className="space-y-5">
                <SummaryStrip
                  rows={summaryRows}
                  activeFilter={activeFilter}
                  onSelect={drillTo}
                />
                <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-slate-500">
                    {activeFilter ? (
                      <>
                        Showing{" "}
                        <span className="font-semibold text-cyan-300">
                          {filterLabel(activeFilter)}
                        </span>{" "}
                        entries.
                      </>
                    ) : includeMatches ? (
                      "Showing all comparison rows, including matches."
                    ) : (
                      "Showing missing, conflicting, and duplicate source rows."
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeFilter && (
                      <button
                        type="button"
                        onClick={clearFilter}
                        className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-400 hover:border-cyan-700 hover:text-cyan-200"
                      >
                        Clear filter
                      </button>
                    )}
                    <select
                      value={rowLimit}
                      onChange={(event) => changeRowLimit(Number(event.target.value))}
                      disabled={phase === "running"}
                      className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none hover:border-cyan-700 focus:border-cyan-600 disabled:text-slate-600"
                    >
                      {[50, 100, 250, 500, 1000].map((value) => (
                        <option key={value} value={value}>
                          {value} rows/family
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => exportResult("json")}
                      disabled={Boolean(exporting)}
                      className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
                    >
                      {exporting === "json" ? "Exporting..." : "Export full JSON"}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportResult("csv")}
                      disabled={Boolean(exporting)}
                      className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
                    >
                      {exporting === "csv" ? "Exporting..." : "Export full CSV"}
                    </button>
                  </div>
                </div>
                <FamilyResults
                  families={result.families}
                  includeMatches={includeMatches}
                  activeFilter={activeFilter}
                />
              </div>
            ) : (
              <EmptyState phase={phase} />
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function SummaryStrip({
  rows,
  activeFilter,
  onSelect,
}: {
  rows: SummaryMetric[];
  activeFilter: ResultFilter | null;
  onSelect: (filter: ResultFilter) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onSelect(row.id)}
          className={`rounded-lg border p-4 text-left transition ${
            activeFilter === row.id
              ? "border-cyan-600 bg-cyan-950/30 shadow-[0_0_0_1px_rgba(8,145,178,0.35)]"
              : "border-slate-800 bg-slate-900/60 hover:border-cyan-700 hover:bg-cyan-950/10"
          }`}
        >
          <div className="text-[11px] uppercase tracking-wide text-slate-600">
            {row.label}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {row.value}
          </div>
        </button>
      ))}
    </div>
  );
}

function FamilyResults({
  families,
  includeMatches,
  activeFilter,
}: {
  families: ObjectMigrationFamilyResult[];
  includeMatches: boolean;
  activeFilter: ResultFilter | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeFilter) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const family of families) {
        if (visibleRows(family, includeMatches, activeFilter).length || hasVisibleError(family, activeFilter)) {
          next.delete(family.id);
        }
      }
      return next;
    });
  }, [activeFilter, families, includeMatches]);

  const familiesToRender = activeFilter
    ? families.filter(
        (family) =>
          visibleRows(family, includeMatches, activeFilter).length > 0 ||
          hasVisibleError(family, activeFilter),
      )
    : families;

  return (
    <div className="space-y-4">
      {familiesToRender.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-600">
          No {activeFilter ? filterLabel(activeFilter).toLowerCase() : "comparison"} entries found.
        </div>
      )}
      {familiesToRender.map((family) => {
        const rows = visibleRows(family, includeMatches, activeFilter);
        const collapsedFamily = collapsed.has(family.id);
        return (
          <section
            key={family.id}
            id={`family-${family.id}`}
            className="rounded-lg border border-slate-800 bg-slate-900/40"
          >
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(family.id)) next.delete(family.id);
                  else next.add(family.id);
                  return next;
                })
              }
              aria-expanded={!collapsedFamily}
              className="flex w-full flex-col gap-3 border-b border-slate-800 px-4 py-3 text-left md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-slate-500">
                    {collapsedFamily ? "[+]" : "[-]"}
                  </span>
                  <h2 className="truncate text-sm font-semibold text-slate-200">
                    {family.label}
                  </h2>
                </div>
                {family.error && (
                  <p className="mt-1 text-xs text-red-300">{family.error}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                <Metric label="source" value={family.source_count} />
                <Metric label="fmg" value={family.fmg_count} />
                <Metric label="match" value={family.matched} />
                <Metric label="missing" value={family.missing} />
                <Metric label="conflict" value={family.conflicts} />
                <Metric label="dupe" value={family.duplicates} />
                {family.truncated && (
                  <Metric
                    label="shown"
                    value={`${family.returned_count}/${family.total_visible}`}
                  />
                )}
              </div>
            </button>
            {!collapsedFamily && (
              <>
                {rows.length > 0 ? (
                  <div className="space-y-3 p-4">
                    {rows.map((row) => (
                      <ResultRow
                        key={`${family.id}:${row.key}:${row.status}`}
                        familyId={family.id}
                        row={row}
                      />
                    ))}
                    {family.truncated && (
                      <div className="rounded-md border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-500">
                        Showing {family.returned_count.toLocaleString()} of{" "}
                        {family.total_visible.toLocaleString()} entries for this section.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-sm text-slate-600">
                    {emptyFamilyMessage(family, includeMatches, activeFilter)}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ResultRow({
  familyId,
  row,
}: {
  familyId: string;
  row: ObjectMigrationRow;
}) {
  const [showValues, setShowValues] = useState(false);

  return (
    <article
      id={`row-${familyId}-${slugify(row.key)}-${row.status}`}
      className="rounded-lg border border-slate-800 bg-slate-950/60"
    >
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-600">
            Object
          </div>
          <h3 className="mt-1 break-all font-mono text-sm font-semibold text-slate-100">
            {row.key}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={row.status} />
          {row.duplicate_count > 1 && (
            <span className="rounded border border-purple-900/70 bg-purple-950/30 px-2 py-1 text-[11px] text-purple-200">
              {row.duplicate_count} source entries
            </span>
          )}
          <span className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-500">
            {row.diffs.length} diff{row.diffs.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setShowValues((value) => !value)}
            className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
          >
            {showValues ? "Hide values" : "Show values"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4">
        <div>
          <h4 className="text-xs font-semibold text-slate-300">Differences</h4>
          {row.diffs.length ? (
            <div className="mt-3 overflow-x-auto rounded-md border border-slate-800">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/70 text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">FMG</th>
                  </tr>
                </thead>
                <tbody>
                  {row.diffs.map((diff) => (
                    <tr key={diff.path} className="border-t border-slate-800 align-top">
                      <td className="px-3 py-2 font-mono text-[11px] text-amber-300">
                        {diff.path}
                      </td>
                      <td className="px-3 py-2">
                        <code className="break-all text-[11px] text-slate-300">
                          {formatValue(diff.source, 360)}
                        </code>
                      </td>
                      <td className="px-3 py-2">
                        <code className="break-all text-[11px] text-slate-300">
                          {formatValue(diff.fmg, 360)}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-600">
              No meaningful differences.
            </div>
          )}
        </div>
        {showValues && (
          <div>
            <h4 className="text-xs font-semibold text-slate-300">Object Values</h4>
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
              <LabeledJsonPreview label="Source" value={row.source} />
              <LabeledJsonPreview label="FortiManager" value={row.fmg} missingLabel="Missing" />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: ObjectMigrationStatus }) {
  const classes: Record<ObjectMigrationStatus, string> = {
    match: "border-emerald-800 bg-emerald-950/50 text-emerald-300",
    missing: "border-amber-800 bg-amber-950/50 text-amber-300",
    conflict: "border-red-800 bg-red-950/50 text-red-300",
    "duplicate-source": "border-purple-800 bg-purple-950/50 text-purple-300",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${classes[status]}`}>
      {status}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="rounded border border-slate-800 bg-slate-950 px-2 py-1">
      {label}: <span className="text-slate-300">{value}</span>
    </span>
  );
}

function LabeledJsonPreview({
  label,
  value,
  missingLabel = "None",
}: {
  label: string;
  value: unknown;
  missingLabel?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-600">
        {label}
      </div>
      {value ? (
        <JsonPreview value={value} />
      ) : (
        <div className="rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-600">
          {missingLabel}
        </div>
      )}
    </div>
  );
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-400">
      {formatValue(value, 5000)}
    </pre>
  );
}

function EmptyState({ phase }: { phase: Phase }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
      {phase === "loading"
        ? "Loading object families..."
        : "Load Fortinet CLI output and run a comparison."}
    </div>
  );
}

function formatValue(value: unknown, maxLength: number): string {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2) ?? String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function visibleRows(
  family: ObjectMigrationFamilyResult,
  includeMatches: boolean,
  activeFilter: ResultFilter | null,
): ObjectMigrationRow[] {
  if (activeFilter === "errors") return [];
  if (activeFilter === "source") return family.results;
  if (activeFilter === "fmg") return family.results.filter((row) => row.fmg !== null);
  if (activeFilter) return family.results.filter((row) => row.status === activeFilter);
  return includeMatches
    ? family.results
    : family.results.filter((row) => row.status !== "match");
}

function hasVisibleError(
  family: ObjectMigrationFamilyResult,
  activeFilter: ResultFilter | null,
) {
  return activeFilter === "errors" && Boolean(family.error);
}

function emptyFamilyMessage(
  family: ObjectMigrationFamilyResult,
  includeMatches: boolean,
  activeFilter: ResultFilter | null,
) {
  if (hasVisibleError(family, activeFilter)) return family.error;
  if (activeFilter) return `No ${filterLabel(activeFilter).toLowerCase()} entries in this family.`;
  return includeMatches
    ? "No objects found in the input for this family."
    : "No missing, conflicting, or duplicate source objects in this family.";
}

function filterLabel(filter: ResultFilter) {
  const labels: Record<ResultFilter, string> = {
    source: "source",
    fmg: "FMG-backed",
    match: "matching",
    missing: "missing",
    conflict: "conflicting",
    "duplicate-source": "duplicate source",
    errors: "error",
  };
  return labels[filter];
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}
