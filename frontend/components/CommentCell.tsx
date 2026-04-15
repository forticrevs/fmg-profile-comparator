"use client";

import { useMemo, useState } from "react";

/**
 * CommentCell — dense renderer for free-form prose fields (comment,
 * description, notes).
 *
 * Default state: single-line preview with a soft right-edge fade + a
 * `… N chars` chip that expands the cell in place. Click the cell (or
 * the chip) to toggle expansion; click again to collapse.
 *
 * Diff-aware preview: when `baselineText` is provided and differs from
 * the current text, the preview is offset to start ~20 chars before
 * the first divergence, and the diverging suffix is highlighted. This
 * means "show me what's different" works at a glance without having
 * to read the entire comment on both sides.
 *
 * Full text always lives in the DOM (inside the collapsed grid row)
 * so copy-paste grabs the real thing, not the ellipsis.
 */

const PREVIEW_CHARS = 80;
const DIVERGENCE_CONTEXT = 20;

interface Props {
  text: string;
  /** The baseline profile's value for the same field, when one is set
   *  and different from `text`. Drives the diff-aware preview offset
   *  and highlight. */
  baselineText?: string | null;
  /** Visual mode — matches the cell's drift state so the expand chip
   *  picks a palette that reads correctly on the cell background. */
  tone?: "neutral" | "baseline" | "drift";
}

/** Length of the longest common prefix of two strings. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

interface PreviewPlan {
  /** Characters clipped off the front of the preview. */
  leadingClip: number;
  /** Characters clipped off the end of the preview. */
  trailingClip: number;
  /** Substring actually rendered in the preview. */
  slice: string;
  /** Index into `slice` at which the diverging highlight starts, or
   *  -1 when there is no divergence to highlight. */
  divergeStart: number;
}

function planPreview(text: string, baselineText: string | null | undefined): PreviewPlan {
  if (text.length <= PREVIEW_CHARS) {
    return {
      leadingClip: 0,
      trailingClip: 0,
      slice: text,
      divergeStart: -1,
    };
  }

  // No baseline or texts match → preview from the start.
  if (baselineText == null || baselineText === text) {
    return {
      leadingClip: 0,
      trailingClip: text.length - PREVIEW_CHARS,
      slice: text.slice(0, PREVIEW_CHARS),
      divergeStart: -1,
    };
  }

  // Diff-aware offset: anchor the preview window around the first
  // character where the two strings diverge.
  const diverge = commonPrefixLength(text, baselineText);
  const idealStart = Math.max(0, diverge - DIVERGENCE_CONTEXT);
  // Clamp so we don't sail off the end of `text` on very long matches.
  const start = Math.min(idealStart, Math.max(0, text.length - PREVIEW_CHARS));
  const end = Math.min(text.length, start + PREVIEW_CHARS);

  return {
    leadingClip: start,
    trailingClip: text.length - end,
    slice: text.slice(start, end),
    divergeStart: diverge >= start && diverge < end ? diverge - start : -1,
  };
}

function formatCount(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
}

export default function CommentCell({ text, baselineText, tone = "neutral" }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Empty / placeholder strings — render exactly like every other
  // "missing" cell so alignment stays consistent. No interaction.
  const isEmpty = !text || text === "—" || text === "null" || text === "__MISSING__";

  const plan = useMemo(() => planPreview(text ?? "", baselineText), [text, baselineText]);

  if (isEmpty) {
    return <span className="text-slate-600 italic">—</span>;
  }

  const tooShort = text.length <= PREVIEW_CHARS;

  // Palette picked so the expand chip remains legible on top of the
  // (already color-tinted) cell background in baseline / drift mode.
  const chipClass =
    tone === "baseline"
      ? "bg-emerald-900/60 border-emerald-700/60 text-emerald-200 hover:bg-emerald-900/80"
      : tone === "drift"
      ? "bg-red-950/70 border-red-800/60 text-red-200 hover:bg-red-950/90"
      : "bg-slate-800/80 border-slate-700/60 text-slate-300 hover:bg-slate-800";

  const toggle = (e: React.MouseEvent) => {
    // Don't collapse on accidental text-selection drags.
    if (window.getSelection?.()?.toString()) return;
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  if (tooShort) {
    // Short enough to render inline without any affordances.
    return (
      <span className="cc-inline whitespace-pre-wrap break-words">{text}</span>
    );
  }

  // Render the diverging suffix of the preview slice with a red
  // highlight so drift leaps out. Leading "…" is shown whenever the
  // preview window is offset from the start of the string.
  const { slice, divergeStart, leadingClip } = plan;
  const previewBefore = divergeStart >= 0 ? slice.slice(0, divergeStart) : slice;
  const previewHighlight = divergeStart >= 0 ? slice.slice(divergeStart) : "";

  return (
    <div className="cc-root" onClick={toggle}>
      {/* Collapsed preview — hidden when expanded. */}
      {!expanded && (
        <div className="cc-preview relative flex items-center gap-1.5 min-w-0">
          <span className="cc-preview-text min-w-0 flex-1 truncate">
            {leadingClip > 0 && <span className="text-slate-600">…</span>}
            <span>{previewBefore}</span>
            {previewHighlight && (
              <span className="bg-red-900/50 text-red-100 rounded-sm px-0.5">
                {previewHighlight}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={toggle}
            className={`cc-chip shrink-0 rounded border px-1.5 py-px text-[10px] font-medium tabular-nums transition ${chipClass}`}
            title="Expand to full text"
          >
            … {formatCount(text.length)}
          </button>
        </div>
      )}

      {/* Full text — in the DOM at all times so copy grabs the real
          value, wrapped in a grid-rows container that animates 0fr→1fr
          for a smooth, measurement-free expand. */}
      <div className="cc-wrapper" data-expanded={expanded || undefined}>
        <div className="cc-full">
          <span className="whitespace-pre-wrap break-words">{text}</span>
          {expanded && (
            <button
              type="button"
              onClick={toggle}
              className={`cc-chip ml-2 inline-block rounded border px-1.5 py-px text-[10px] font-medium align-middle transition ${chipClass}`}
              title="Collapse"
            >
              collapse
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
