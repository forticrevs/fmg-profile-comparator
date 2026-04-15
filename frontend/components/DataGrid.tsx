"use client";

import { useEffect, useRef, useState, type ReactNode, type HTMLAttributes } from "react";

/**
 * DataGrid — CSS-Grid-based table primitive.
 *
 * Goals:
 *  - Never horizontally scroll. Period.
 *  - Long text wraps via `overflow-wrap: anywhere` (not `break-all`), so
 *    normal words stay intact and only oversized tokens (URLs, hashes)
 *    break.
 *  - Each cell renders to a `--dg-clamp` line ceiling by default; clicking
 *    a row toggles full-content reveal (clamp + peek).
 *  - When `containerWidth / colCount < minColWidth`, the whole grid
 *    auto-pivots to single-column "stacked" mode: each row becomes a
 *    profile-card with column labels inline.
 *  - Cells whose rendered output contains a `[data-no-clamp]` element
 *    (e.g. nested object tables) are exempted from line-clamping via
 *    `:has()`.
 */

export interface DataGridColumn<T> {
  key: string;
  /** Header content (string or rich element). */
  header: ReactNode;
  /** Renders a single cell for this row. */
  render: (row: T) => ReactNode;
  /** Forwarded to the header div — useful for drag-and-drop handlers. */
  headerProps?: HTMLAttributes<HTMLDivElement>;
  /**
   * Optional CSS grid-template-columns fragment for this column
   * (e.g. `"3fr"`, `"minmax(220px, 3fr)"`, `"120px"`). Columns without a
   * spec default to `minmax(0, 1fr)`, matching the legacy uniform layout.
   * When any column sets `width`, the grid switches to a custom template
   * so important columns can claim more horizontal room.
   */
  width?: string;
}

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyState?: ReactNode;
  /**
   * If true, the grid auto-pivots to single-column "stacked" mode when
   * `containerWidth / cols < minColWidth`. Off by default — only enable
   * for tables with a small, fixed column count (e.g. profile
   * comparison) where stacking actually helps. Reference tables with
   * dozens of columns should leave this off and rely on clamp+peek.
   */
  autoStack?: boolean;
  /** Below this column width (px), the grid auto-pivots to stacked mode. */
  minColWidth?: number;
  /** Default line-clamp for cells. */
  clampLines?: number;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

export default function DataGrid<T>({
  columns,
  rows,
  rowKey,
  emptyState,
  autoStack = false,
  minColWidth = 180,
  clampLines = 4,
  className = "",
}: DataGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!autoStack) {
      setStacked(false);
      return;
    }
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const perCol = width / Math.max(columns.length, 1);
      setStacked(perCol < minColWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoStack, columns.length, minColWidth]);

  const toggleRow = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Build a per-instance grid template when any column asks for a custom
  // width. Columns without a width spec fall back to the same
  // `minmax(0, 1fr)` the CSS default uses, so mixing weighted + auto
  // columns in the same grid works without forcing every column to opt in.
  const anyCustomWidth = columns.some((c) => c.width);
  const gridTemplate = anyCustomWidth
    ? columns.map((c) => c.width ?? "minmax(0, 1fr)").join(" ")
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`dg-root rounded-xl border border-slate-800 bg-slate-950/40 ${className}`}
      data-mode={stacked ? "stacked" : "grid"}
      // biome-ignore lint/style/noInlineStyles: CSS custom properties must
      // be set per-instance from runtime props (column count, clamp lines).
      style={
        {
          ["--dg-cols"]: String(columns.length),
          ["--dg-clamp"]: String(clampLines),
          ...(gridTemplate ? { ["--dg-template"]: gridTemplate } : {}),
        } as React.CSSProperties
      }
    >
      {!stacked && (
        <div className="dg-header sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
          {columns.map((col) => (
            <div
              key={col.key}
              {...col.headerProps}
              className={`dg-cell dg-header-cell px-3 py-3 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-400 select-none ${col.headerProps?.className ?? ""}`}
            >
              {col.header}
            </div>
          ))}
        </div>
      )}

      <div className="dg-body">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {emptyState ?? "No rows."}
          </div>
        ) : (
          rows.map((row, i) => {
            const key = rowKey(row, i);
            const isExpanded = expanded.has(key);
            return (
              <div
                key={key}
                className="dg-row border-b border-slate-900 transition-colors hover:bg-slate-800/20"
                data-expanded={isExpanded || undefined}
                onClick={(e) => {
                  // Don't toggle if the user is selecting text or clicking
                  // an interactive child (button/link/input).
                  const sel = window.getSelection?.()?.toString();
                  if (sel) return;
                  const target = e.target as HTMLElement;
                  if (target.closest("button, a, input, select, textarea, [role=button]")) return;
                  toggleRow(key);
                }}
              >
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className="dg-cell px-3 py-2.5 align-top text-xs leading-5 text-slate-200"
                  >
                    {stacked && (
                      <div className="dg-cell-label mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {col.header}
                      </div>
                    )}
                    <div className="dg-cell-content">{col.render(row)}</div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
