"use client";

/**
 * Local Web Categories — browse operator-defined webfilter categories
 * with inline expand/collapse showing which URL rating overrides belong
 * to each category.
 *
 * Fetches both `/api/reference/local-web-categories` and
 * `/api/reference/web-rating-overrides`, groups overrides by their
 * `rating` category ID, and nests them under the parent category row.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import {
  fetchLocalWebCategories,
  fetchWebRatingOverrides,
  type ReferenceListResponse,
} from "@/lib/api";
import AddToChatContextButton from "@/components/AddToChatContextButton";
import { useChatContext } from "@/components/ChatContext";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface Category {
  id: number;
  desc: string;
  status: number;
  "_created-by"?: string;
  "_last-modified-by"?: string;
  "_modified timestamp"?: number;
  [key: string]: unknown;
}

interface Override {
  url: string;
  rating: number[];
  rating_display?: string[];
  status: number;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function formatEpoch(ts: number): string {
  try {
    return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return String(ts);
  }
}

function summarizeOverride(override: Override) {
  return {
    url: override.url,
    status: override.status,
    rating: override.rating,
    rating_display: override.rating_display,
  };
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */
export default function LocalWebCategoriesPage() {
  const { setPageContext, clearPageContext } = useChatContext();
  const [cats, setCats] = useState<ReferenceListResponse | null>(null);
  const [overrides, setOverrides] = useState<ReferenceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchLocalWebCategories(), fetchWebRatingOverrides()])
      .then(([catData, overrideData]) => {
        if (cancelled) return;
        setCats(catData);
        setOverrides(overrideData);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Group overrides by category ID → Map<catId, Override[]>
  const overridesByCategory = useMemo(() => {
    const map = new Map<number, Override[]>();
    if (!overrides) return map;
    for (const raw of overrides.items) {
      const item = raw as unknown as Override;
      const ratings = item.rating;
      if (!Array.isArray(ratings)) continue;
      for (const catId of ratings) {
        if (typeof catId !== "number") continue;
        let list = map.get(catId);
        if (!list) {
          list = [];
          map.set(catId, list);
        }
        list.push(item);
      }
    }
    return map;
  }, [overrides]);

  // Build display rows from categories
  const categories = useMemo(() => {
    if (!cats) return [];
    return (cats.items as unknown as Category[])
      .slice()
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }, [cats]);

  // Filter by search
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((cat) => {
      const haystack = [
        String(cat.id),
        cat.desc ?? "",
        ...(overridesByCategory.get(cat.id) ?? []).map((o) => o.url),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [categories, deferredSearch, overridesByCategory]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () =>
    setExpanded(new Set(filtered.map((c) => c.id)));
  const collapseAll = () => setExpanded(new Set());

  const totalOverrides = overrides?.count ?? 0;

  useEffect(() => {
    return () => clearPageContext("reference:local-web-categories");
  }, [clearPageContext]);

  useEffect(() => {
    setPageContext({
      id: "reference:local-web-categories",
      kind: "local_web_categories",
      label: "Local Web Categories",
      data: {
        loading,
        error,
        category_count: cats?.count ?? 0,
        override_count: totalOverrides,
        search: deferredSearch,
        filtered_count: filtered.length,
        expanded_category_count: expanded.size,
        expanded_categories: categories
          .filter((cat) => expanded.has(cat.id))
          .slice(0, 10)
          .map((cat) => {
            const catOverrides = overridesByCategory.get(cat.id) ?? [];
            return {
              id: cat.id,
              desc: cat.desc,
              status: cat.status,
              override_count: catOverrides.length,
              override_sample: catOverrides.slice(0, 20).map(summarizeOverride),
            };
          }),
      },
    });
  }, [
    categories,
    cats?.count,
    clearPageContext,
    deferredSearch,
    error,
    expanded,
    filtered.length,
    loading,
    overridesByCategory,
    setPageContext,
    totalOverrides,
  ]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-slate-500 transition hover:text-slate-300"
            >
              ← Back to dashboard
            </Link>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              Local Web Categories
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Operator-defined webfilter category buckets. Expand a category
              to see which URL rating overrides are pinned to it.
            </p>
          </div>

          <div className="flex gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Categories
              </div>
              <div className="text-2xl font-semibold text-white">
                {cats?.count ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Overrides
              </div>
              <div className="text-2xl font-semibold text-white">
                {totalOverrides}
              </div>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories or URLs…"
            className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-600"
          />
          <button
            type="button"
            onClick={expandAll}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-400 transition hover:text-white"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-400 transition hover:text-white"
          >
            Collapse all
          </button>
          <div className="ml-auto text-sm text-slate-500">
            Showing {filtered.length} of {categories.length}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="py-16 text-center text-slate-500">
            Loading categories and overrides…
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-500">
                No categories match your search.
              </div>
            )}
            {filtered.map((cat) => {
              const isExpanded = expanded.has(cat.id);
              const catOverrides = overridesByCategory.get(cat.id) ?? [];
              const modTs = cat["_modified timestamp"];

              return (
                <div
                  key={cat.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden"
                >
                  {/* Category header row */}
                  <div className="flex items-center gap-4 px-4 py-3 transition hover:bg-slate-800/30">
                  <button
                    type="button"
                    onClick={() => toggle(cat.id)}
                    className="flex items-center gap-4 text-left flex-1 min-w-0"
                  >
                    <span
                      className={`text-[10px] text-slate-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    >
                      ▶
                    </span>

                    <span className="min-w-[48px] rounded bg-slate-800 px-2 py-0.5 text-center text-xs font-mono text-slate-400">
                      {cat.id}
                    </span>

                    <span className="flex-1 text-sm font-medium text-slate-200 truncate">
                      {cat.desc || "—"}
                    </span>

                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        cat.status === 1
                          ? "bg-emerald-950/50 text-emerald-400 border border-emerald-800/40"
                          : "bg-slate-900 text-slate-500 border border-slate-800"
                      }`}
                    >
                      {cat.status === 1 ? "Enabled" : "Disabled"}
                    </span>

                    {cat["_created-by"] && (
                      <span className="text-[11px] text-slate-600">
                        by {cat["_created-by"]}
                      </span>
                    )}

                    {typeof modTs === "number" && modTs > 1e9 && (
                      <span className="text-[11px] tabular-nums text-slate-600">
                        {formatEpoch(modTs)}
                      </span>
                    )}

                    <span
                      className={`min-w-[80px] text-right text-xs tabular-nums ${
                        catOverrides.length > 0
                          ? "text-cyan-400"
                          : "text-slate-600"
                      }`}
                    >
                      {catOverrides.length}{" "}
                      {catOverrides.length === 1 ? "override" : "overrides"}
                    </span>
                  </button>
                  <AddToChatContextButton
                    item={{
                      id: `web_category:${cat.id}`,
                      kind: "web_category",
                      label: `${cat.desc || "Category"} (id ${cat.id})`,
                      data: {
                        id: cat.id,
                        desc: cat.desc,
                        status: cat.status,
                        created_by: cat["_created-by"],
                        last_modified_by: cat["_last-modified-by"],
                        modified_timestamp: cat["_modified timestamp"],
                        override_count: catOverrides.length,
                        override_sample: catOverrides
                          .slice(0, 50)
                          .map(summarizeOverride),
                      },
                    }}
                  />
                  </div>

                  {/* Expanded overrides list */}
                  {isExpanded && (
                    <div className="border-t border-slate-800/60 bg-slate-900/30">
                      {catOverrides.length === 0 ? (
                        <div className="px-6 py-4 text-xs text-slate-600 italic">
                          No rating overrides are pinned to this category.
                        </div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-800/40 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              <th className="px-6 py-2 text-left">URL</th>
                              <th className="px-4 py-2 text-left">Status</th>
                              <th className="px-4 py-2 text-left">
                                All Categories
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {catOverrides.map((ov, i) => (
                              <tr
                                key={`${ov.url}-${i}`}
                                className="border-b border-slate-800/20 transition hover:bg-slate-800/20"
                              >
                                <td className="px-6 py-2 font-mono text-slate-300">
                                  {ov.url}
                                </td>
                                <td className="px-4 py-2">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                      ov.status === 1
                                        ? "bg-emerald-950/50 text-emerald-400"
                                        : "bg-slate-900 text-slate-500"
                                    }`}
                                  >
                                    {ov.status === 1 ? "Enable" : "Disable"}
                                  </span>
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {(ov.rating_display ?? ov.rating.map(String)).map(
                                      (name, j) => (
                                        <span
                                          key={j}
                                          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400"
                                        >
                                          {name}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
