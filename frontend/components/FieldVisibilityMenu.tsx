"use client";

/**
 * Reusable per-page field visibility selector.
 *
 * Discovers the available schema *from the data itself* (we don't have a
 * fixed FMG schema), presents it as a searchable checkbox list, and
 * persists the user's selection in localStorage under a caller-supplied
 * storage key so it survives reloads. Each comparison/reference page
 * passes a unique storage key.
 *
 * Convention for storedSet: an empty set means "show everything"
 * (default state). A non-empty set is the explicit hidden list — we
 * track *hidden* fields rather than *visible* so newly-discovered
 * fields are visible by default when the FMG schema gains a column.
 */

import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  /** Stable identifier — e.g. "comparison:webfilter" or "ref:ips-signatures". */
  storageKey: string;
  /** All field names that exist in the current dataset. */
  available: string[];
  /** Currently hidden field names. */
  hidden: Set<string>;
  /** Called whenever the user changes the hidden set. */
  onChange: (hidden: Set<string>) => void;
  /** Optional human-readable label transformer for display. */
  labelOf?: (field: string) => string;
  /** Optional button label override (default "Fields"). */
  buttonLabel?: string;
}

export function loadHiddenFields(storageKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`fieldvis:${storageKey}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

export function saveHiddenFields(storageKey: string, hidden: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    if (hidden.size === 0) {
      window.localStorage.removeItem(`fieldvis:${storageKey}`);
    } else {
      window.localStorage.setItem(
        `fieldvis:${storageKey}`,
        JSON.stringify([...hidden]),
      );
    }
  } catch {
    /* ignore quota / privacy mode failures */
  }
}

export default function FieldVisibilityMenu({
  storageKey,
  available,
  hidden,
  onChange,
  labelOf,
  buttonLabel = "Fields",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Persist whenever hidden set changes.
  useEffect(() => {
    saveHiddenFields(storageKey, hidden);
  }, [storageKey, hidden]);

  const sortedAvailable = useMemo(
    () => [...available].sort((a, b) => a.localeCompare(b)),
    [available],
  );

  const filtered = useMemo(() => {
    if (!query) return sortedAvailable;
    const q = query.toLowerCase();
    return sortedAvailable.filter(
      (f) => f.toLowerCase().includes(q) || (labelOf?.(f) ?? f).toLowerCase().includes(q),
    );
  }, [sortedAvailable, query, labelOf]);

  const toggle = (field: string) => {
    const next = new Set(hidden);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    onChange(next);
  };

  const showAll = () => onChange(new Set());
  const hideAll = () => onChange(new Set(available));
  const visibleCount = available.length - hidden.size;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition flex items-center gap-1 ${
          hidden.size > 0
            ? "bg-cyan-900/60 text-cyan-200 border border-cyan-700/60"
            : "bg-slate-800 text-slate-400 hover:text-white border border-transparent"
        }`}
        title="Show or hide fields on this page"
      >
        {buttonLabel}
        <span className="text-[10px] opacity-70 tabular-nums">
          {visibleCount}/{available.length}
        </span>
        <span className="text-[9px]">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 right-0 w-80 max-h-96 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl flex flex-col">
          <div className="p-2 border-b border-slate-800 flex items-center gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Search fields..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-cyan-600"
            />
          </div>
          <div className="px-2 py-1 border-b border-slate-800 flex items-center gap-2 text-[10px]">
            <button
              onClick={showAll}
              className="text-slate-400 hover:text-cyan-300 transition"
            >
              Show all
            </button>
            <span className="text-slate-700">|</span>
            <button
              onClick={hideAll}
              className="text-slate-400 hover:text-amber-300 transition"
            >
              Hide all
            </button>
            <span className="ml-auto text-slate-600 tabular-nums">
              {filtered.length} shown
            </span>
          </div>
          <div className="overflow-y-auto flex-1 py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-600">
                No matches.
              </div>
            ) : (
              filtered.map((field) => {
                const isHidden = hidden.has(field);
                return (
                  <label
                    key={field}
                    className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-slate-800/60 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggle(field)}
                      className="rounded border-slate-700 bg-slate-950 text-cyan-600 focus:ring-cyan-600 focus:ring-offset-0 h-3.5 w-3.5"
                    />
                    <span
                      className={`font-mono break-all ${
                        isHidden ? "text-slate-600 line-through" : "text-slate-200"
                      }`}
                      title={field}
                    >
                      {labelOf?.(field) ?? field}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
