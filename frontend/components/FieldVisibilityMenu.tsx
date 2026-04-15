"use client";

/**
 * Per-page field visibility selector.
 *
 * Accepts both schema-defined and data-discovered field lists. The
 * schema (fetched from FMG `option=["syntax"]`) is the authoritative
 * source of every field this endpoint could ever return; data-discovered
 * fields are the subset actually present in the current response. Fields
 * that exist in the schema but not in the current data are shown dimmed
 * with an "(empty)" marker so the user can still toggle them — when a
 * future profile populates them they'll already be configured to show.
 *
 * Convention for hidden set: an empty set means "show everything". A
 * non-empty set is the explicit hidden list — we track *hidden* fields
 * rather than *visible* so newly-discovered fields are visible by default
 * when the FMG schema gains a column.
 */

import { useEffect, useMemo, useRef, useState } from "react";

interface SchemaFieldMeta {
  name: string;
  label: string;
  help: string;
}

interface Props {
  /** Stable identifier — e.g. "comparison:webfilter" or "ref:ips-signatures". */
  storageKey: string;
  /** All field names (union of schema + data). */
  available: string[];
  /** Currently hidden field names. */
  hidden: Set<string>;
  /** Called whenever the user changes the hidden set. */
  onChange: (hidden: Set<string>) => void;
  /** Optional human-readable label transformer for display. */
  labelOf?: (field: string) => string;
  /** Optional button label override (default "Fields"). */
  buttonLabel?: string;
  /** Optional rich schema field list (name + label + help tooltip). */
  schemaFields?: SchemaFieldMeta[] | null;
  /** Optional list of field names actually present in the current data. */
  presentInData?: string[];
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
  schemaFields,
  presentInData,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  // Flip left/right anchoring so the menu never spills off-screen when the
  // trigger sits near the edge of the viewport. Measured on each open.
  const [anchor, setAnchor] = useState<"left" | "right">("right");

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Pick anchor side when opening: if there isn't enough room to the left of
  // the button for a right-anchored w-96 (384px) panel, fall back to
  // left-anchoring so the menu stays fully inside the viewport.
  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const MENU_WIDTH = 384; // matches w-96
    const PAD = 16;
    const roomLeft = rect.right;         // space from viewport left to button's right edge
    const roomRight = window.innerWidth - rect.left;
    if (roomLeft < MENU_WIDTH + PAD && roomRight >= MENU_WIDTH + PAD) {
      setAnchor("left");
    } else {
      setAnchor("right");
    }
  }, [open]);

  // Persist whenever hidden set changes.
  useEffect(() => {
    saveHiddenFields(storageKey, hidden);
  }, [storageKey, hidden]);

  // Build per-field metadata: help tooltip, "present in current data" flag.
  const meta = useMemo(() => {
    const m = new Map<string, { help: string; present: boolean; label: string }>();
    const presentSet = new Set(presentInData ?? available);
    for (const name of available) {
      m.set(name, {
        help: "",
        present: presentSet.has(name),
        label: labelOf?.(name) ?? name,
      });
    }
    if (schemaFields) {
      for (const sf of schemaFields) {
        const existing = m.get(sf.name);
        if (existing) {
          existing.help = sf.help;
          if (labelOf) existing.label = labelOf(sf.name);
          else if (sf.label) existing.label = sf.label;
        }
      }
    }
    return m;
  }, [available, schemaFields, presentInData, labelOf]);

  const sortedAvailable = useMemo(
    () => [...available].sort((a, b) => a.localeCompare(b)),
    [available],
  );

  const filtered = useMemo(() => {
    if (!query) return sortedAvailable;
    const q = query.toLowerCase();
    return sortedAvailable.filter((f) => {
      const info = meta.get(f);
      return (
        f.toLowerCase().includes(q) ||
        (info?.label ?? f).toLowerCase().includes(q) ||
        (info?.help ?? "").toLowerCase().includes(q)
      );
    });
  }, [sortedAvailable, query, meta]);

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
        <div
          className={`fv-menu absolute z-50 mt-1 ${
            anchor === "right" ? "right-0" : "left-0"
          } w-96 max-h-96 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl flex flex-col`}
        >
          <div className="p-2 border-b border-slate-800 flex items-center gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Search fields or descriptions..."
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
            {schemaFields && (
              <span className="ml-2 text-[9px] text-cyan-600 uppercase tracking-wide">
                schema
              </span>
            )}
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
              filtered.map((field, i) => {
                const isHidden = hidden.has(field);
                const info = meta.get(field);
                const isEmpty = info && !info.present;
                return (
                  <label
                    key={field}
                    className="fv-menu-row flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-slate-800/60 cursor-pointer select-none"
                    style={{ animationDelay: `${Math.min(i * 8, 160)}ms` }}
                    title={info?.help || field}
                  >
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggle(field)}
                      className="mt-0.5 rounded border-slate-700 bg-slate-950 text-cyan-600 focus:ring-cyan-600 focus:ring-offset-0 h-3.5 w-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono break-all ${
                            isHidden
                              ? "text-slate-600 line-through"
                              : isEmpty
                              ? "text-slate-500"
                              : "text-slate-200"
                          }`}
                        >
                          {info?.label ?? field}
                        </span>
                        {isEmpty && !isHidden && (
                          <span className="text-[9px] text-slate-700 uppercase tracking-wide">
                            empty
                          </span>
                        )}
                      </div>
                      {info?.help && (
                        <div className="mt-0.5 text-[10px] text-slate-600 leading-snug line-clamp-2">
                          {info.help}
                        </div>
                      )}
                    </div>
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
