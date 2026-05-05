"use client";

/**
 * SignatureTooltip — hover card that surfaces the full FortiGuard
 * encyclopedia record for an IPS or Application signature.
 *
 * Backed by an undocumented FMG CGI endpoint (see
 * `backend/app/services/fmg_client.py::fetch_encyclopedia`). The API
 * returns plain JSON with `<br/>` sprinkled through the long-form
 * fields (Summary, Symptoms, Action); we split on the tag rather than
 * round-tripping through dangerouslySetInnerHTML, and we linkify bare
 * URLs encountered during that split.
 *
 * Presentation notes:
 *  - Portal-rendered to document.body to escape clipping ancestors
 *    (the reference table has `overflow: hidden` on cells).
 *  - Trigger uses hover-intent (300 ms open / 150 ms close) to avoid
 *    flicker when the mouse sweeps through a row.
 *  - Positioning is a simple below-right attempt, flipping to
 *    above/left if viewport clipping would occur. Pinned with `fixed`
 *    so page scrolling doesn't require reflow math.
 *  - Fetches share a module-level Map so adjacent rows that look up
 *    the same signature only round-trip once per session (on top of
 *    the backend's 24 h per-client cache).
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  fetchApplicationEncyclopedia,
  fetchIpsEncyclopedia,
  type ApplicationEncyclopedia,
  type EncyclopediaResponse,
  type IpsEncyclopedia,
} from "@/lib/api";
import AddToChatContextButton from "@/components/AddToChatContextButton";

type Source = "ips" | "app";

interface Props {
  source: Source;
  /** Numeric signature id (rule-id for IPS, id for App). */
  signatureId: number | string | null | undefined;
  /** The visible name to wrap in the hover trigger. */
  name: string;
  /** Passed-through children for the visible trigger. Typically the
   *  highlighted-name span from the caller so search highlighting keeps
   *  working under the tooltip. */
  children: ReactNode;
}

/* ------------------------------------------------------------------ */
/* Module-level fetch cache                                            */
/*                                                                     */
/* Keyed on `${source}:${id}`. Value is either a resolved record or a  */
/* pending promise — the pending case dedupes racing hovers across     */
/* multiple trigger instances on the same page.                        */
/* ------------------------------------------------------------------ */
const cache = new Map<string, Promise<EncyclopediaResponse> | EncyclopediaResponse>();

function cacheKey(source: Source, id: number): string {
  return `${source}:${id}`;
}

async function lookup(source: Source, id: number): Promise<EncyclopediaResponse> {
  const key = cacheKey(source, id);
  const hit = cache.get(key);
  if (hit && !(hit instanceof Promise)) return hit;
  if (hit instanceof Promise) return hit;
  const p = (source === "ips"
    ? fetchIpsEncyclopedia(id)
    : fetchApplicationEncyclopedia(id)
  ).then((data) => {
    cache.set(key, data);
    return data;
  });
  cache.set(key, p);
  try {
    return await p;
  } catch (err) {
    // Evict so the next hover retries.
    cache.delete(key);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Safe text rendering                                                 */
/*                                                                     */
/* The encyclopedia fields are plain-text with occasional inline       */
/* `<br/>` tags and bare URLs. We split on the tag (handles `<br>`,    */
/* `<br/>`, `<br />`) and then linkify URL substrings inside each      */
/* segment. Nothing ever reaches dangerouslySetInnerHTML.              */
/* ------------------------------------------------------------------ */
const BR_REGEX = /<br\s*\/?>/gi;
const URL_REGEX = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

function renderSegment(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  let i = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    out.push(
      <a
        key={`${keyPrefix}-u${i++}`}
        href={match[0]}
        target="_blank"
        rel="noreferrer noopener"
        className="text-cyan-300 underline decoration-cyan-700/60 underline-offset-2 hover:text-cyan-200 hover:decoration-cyan-400 break-all"
      >
        {match[0]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function RichText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const segments = text.split(BR_REGEX);
  return (
    <>
      {segments.map((seg, i) => (
        <span key={i} className="block">
          {seg.trim().length === 0 ? "\u00a0" : renderSegment(seg, `s${i}`)}
        </span>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Visual helpers                                                      */
/* ------------------------------------------------------------------ */
const RISK_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-950/70", text: "text-red-200", border: "border-red-800/70" },
  high: { bg: "bg-orange-950/70", text: "text-orange-200", border: "border-orange-800/70" },
  medium: { bg: "bg-amber-950/60", text: "text-amber-200", border: "border-amber-800/60" },
  low: { bg: "bg-cyan-950/60", text: "text-cyan-200", border: "border-cyan-800/60" },
  info: { bg: "bg-slate-800/60", text: "text-slate-300", border: "border-slate-700/70" },
};
const RISK_FALLBACK = {
  bg: "bg-slate-800/60",
  text: "text-slate-300",
  border: "border-slate-700/70",
};

function RiskPill({ value }: { value: string }) {
  const style = RISK_STYLES[value.toLowerCase()] ?? RISK_FALLBACK;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.bg} ${style.text} ${style.border}`}
    >
      {value || "unknown"}
    </span>
  );
}

const ACTION_STYLES: Record<string, string> = {
  drop: "bg-red-950/70 text-red-200 border-red-800/70",
  block: "bg-red-950/70 text-red-200 border-red-800/70",
  reset: "bg-red-950/70 text-red-200 border-red-800/70",
  pass: "bg-emerald-950/70 text-emerald-200 border-emerald-800/70",
  allow: "bg-emerald-950/70 text-emerald-200 border-emerald-800/70",
  monitor: "bg-blue-950/70 text-blue-200 border-blue-800/70",
};

function ActionPill({ value }: { value: string }) {
  const style =
    ACTION_STYLES[value.toLowerCase()] ??
    "bg-slate-800/60 text-slate-300 border-slate-700/70";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase ${style}`}
      title="Default action"
    >
      {value || "—"}
    </span>
  );
}

function Chip({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "cyan" | "emerald" }) {
  const map: Record<string, string> = {
    slate: "bg-slate-800/50 text-slate-300 border-slate-700/60",
    cyan: "bg-cyan-950/40 text-cyan-200 border-cyan-800/50",
    emerald: "bg-emerald-950/40 text-emerald-200 border-emerald-800/50",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Positioning                                                         */
/* ------------------------------------------------------------------ */
interface Position {
  top: number;
  left: number;
  placement: "below" | "above";
}

const TOOLTIP_WIDTH = 480;
const TOOLTIP_MARGIN = 12;
const VIEWPORT_PAD = 16;

function computePosition(triggerRect: DOMRect, tooltipHeight: number): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: prefer anchoring to the trigger's left edge, flipping
  // to the right edge if that would clip. Clamp to viewport padding.
  let left = triggerRect.left;
  if (left + TOOLTIP_WIDTH + VIEWPORT_PAD > vw) {
    left = Math.max(VIEWPORT_PAD, vw - TOOLTIP_WIDTH - VIEWPORT_PAD);
  }
  left = Math.max(VIEWPORT_PAD, left);

  // Vertical: below unless there isn't room, then above.
  const spaceBelow = vh - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  let placement: "below" | "above" = "below";
  let top = triggerRect.bottom + TOOLTIP_MARGIN;
  if (spaceBelow < tooltipHeight + TOOLTIP_MARGIN && spaceAbove > spaceBelow) {
    placement = "above";
    top = triggerRect.top - tooltipHeight - TOOLTIP_MARGIN;
  }
  top = Math.max(VIEWPORT_PAD, top);
  return { top, left, placement };
}

/* ------------------------------------------------------------------ */
/* Tooltip body                                                        */
/* ------------------------------------------------------------------ */
function EncyclopediaCard({ data }: { data: EncyclopediaResponse }) {
  const isIps = data.Type === "ips";
  const ips = isIps ? (data as IpsEncyclopedia) : null;
  const app = !isIps ? (data as ApplicationEncyclopedia) : null;

  // CVE surfaces on both shapes but is typed differently; normalize to
  // a printable string and split on whitespace/comma so multiple
  // entries each get their own chip.
  const cveRaw = (data as { CVE?: string | null }).CVE ?? "";
  const cves = cveRaw
    ? cveRaw
        .toString()
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return (
    <div className="max-h-[70vh] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {isIps ? "IPS signature" : "Application signature"} · {data.ID}
            </div>
            <div className="mt-0.5 break-all font-mono text-[13px] font-semibold text-white">
              {data.Name}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              <AddToChatContextButton
                item={{
                  id: `${isIps ? "ips_signature" : "app_signature"}:${data.ID}`,
                  kind: isIps ? "ips_signature" : "app_signature",
                  label: data.Name,
                  data,
                }}
              />
              <RiskPill value={data.Risk} />
            </div>
            <ActionPill value={data.DefaultAction} />
          </div>
        </div>
        {/* Inline metadata strip */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {app?.Category && (
            <Chip tone="cyan">{app.Category}</Chip>
          )}
          {ips?.VulnType && (
            <Chip tone="cyan">{ips.VulnType}</Chip>
          )}
          {app?.Vendor && (
            <Chip tone="slate">Vendor: {app.Vendor}</Chip>
          )}
          {data.os_list?.map((os) => (
            <Chip key={`os-${os}`} tone="slate">
              {os}
            </Chip>
          ))}
          {data.app_list?.map((a) => (
            <Chip key={`app-${a}`} tone="slate">
              {a}
            </Chip>
          ))}
          {cves.map((cve) => (
            <Chip key={`cve-${cve}`} tone="emerald">
              {cve}
            </Chip>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3 text-[12px] leading-relaxed text-slate-300">
        {data.Summary && (
          <Section label="Summary">
            <RichText text={data.Summary} />
          </Section>
        )}
        {data.Symptoms && (
          <Section label="Symptoms">
            <RichText text={data.Symptoms} />
          </Section>
        )}
        {data.Analysis && (
          <Section label="Analysis">
            <RichText text={data.Analysis} />
          </Section>
        )}
        {data.Action && (
          <Section label="Recommended action">
            <RichText text={data.Action} />
          </Section>
        )}
        {app?.AppPort && (
          <Section label="Ports">
            <span className="font-mono text-cyan-200">{app.AppPort}</span>
          </Section>
        )}
        {app?.References && app.References.length > 0 && (
          <Section label="References">
            <ul className="space-y-0.5">
              {app.References.map((ref) => (
                <li key={ref}>
                  <a
                    href={ref}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="break-all text-cyan-300 underline decoration-cyan-700/60 hover:text-cyan-200"
                  >
                    {ref}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {data.BehaviorList && data.BehaviorList.length > 0 && (
          <Section label="Behavior">
            <div className="flex flex-wrap gap-1">
              {data.BehaviorList.map((b) => (
                <Chip key={b} tone="slate">
                  {b}
                </Chip>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Footer — dates */}
      <div className="border-t border-slate-800 bg-slate-950/60 px-4 py-2 text-[10px] uppercase tracking-wide text-slate-500">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {data.Released && (
            <span>
              Released{" "}
              <span className="text-slate-300">{formatDate(data.Released)}</span>
            </span>
          )}
          {data.Updated && (
            <span>
              Updated{" "}
              <span className="text-slate-300">{formatDate(data.Updated)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-slate-300">{children}</div>
    </div>
  );
}

function formatDate(raw: string): string {
  // FMG returns "YYYY-MM-DD HH:MM:SS"; keep just the date portion.
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : raw;
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 150;

export default function SignatureTooltip({ source, signatureId, name, children }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EncyclopediaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const tooltipId = useId();

  // Parse the signature id up front. Hyphenated IPS `rule-id` comes in
  // as a string via row lookups; coerce to number when possible.
  const numericId =
    typeof signatureId === "number"
      ? signatureId
      : typeof signatureId === "string"
      ? Number.parseInt(signatureId, 10)
      : NaN;
  const hasId = Number.isFinite(numericId);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Seed state from the module cache synchronously — a second hover on
  // the same signature should never show the loading state.
  useEffect(() => {
    if (!hasId) return;
    const hit = cache.get(cacheKey(source, numericId));
    if (hit && !(hit instanceof Promise)) {
      setData(hit);
      setError(null);
    }
  }, [source, numericId, hasId]);

  const loadIfNeeded = useCallback(() => {
    if (!hasId) return;
    if (data) return;
    const hit = cache.get(cacheKey(source, numericId));
    if (hit && !(hit instanceof Promise)) {
      setData(hit);
      return;
    }
    setLoading(true);
    setError(null);
    lookup(source, numericId)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message || "Lookup failed");
        setLoading(false);
      });
  }, [source, numericId, hasId, data]);

  const scheduleOpen = useCallback(() => {
    clearTimers();
    if (!hasId) return;
    openTimer.current = window.setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setPosition(computePosition(rect, 320));
      }
      setOpen(true);
      loadIfNeeded();
    }, OPEN_DELAY_MS);
  }, [clearTimers, loadIfNeeded, hasId]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearTimers]);

  // Recompute position once the card has measured itself — the initial
  // estimate (320 px) is usually wrong by ~100 px.
  useEffect(() => {
    if (!open || !cardRef.current || !triggerRef.current) return;
    const actualHeight = cardRef.current.offsetHeight;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition(computePosition(rect, actualHeight));
  }, [open, data, loading, error]);

  // Dismiss on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearTimers();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, clearTimers]);

  // Cleanup timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  return (
    <>
      <span
        ref={triggerRef}
        className={hasId ? "cursor-help" : undefined}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
        aria-describedby={open ? tooltipId : undefined}
        tabIndex={hasId ? 0 : undefined}
      >
        {children}
      </span>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={cardRef}
              id={tooltipId}
              role="tooltip"
              onMouseEnter={clearTimers}
              onMouseLeave={scheduleClose}
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                width: TOOLTIP_WIDTH,
                zIndex: 1000,
              }}
              className="rounded-xl border border-slate-800 bg-slate-950/98 shadow-2xl shadow-black/60 ring-1 ring-slate-900/80 animate-in fade-in slide-in-from-top-1 duration-150"
            >
              {loading && !data && (
                <div className="flex items-center gap-3 px-4 py-6 text-xs text-slate-400">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
                  Looking up {name}…
                </div>
              )}
              {error && !data && (
                <div className="px-4 py-4 text-xs">
                  <div className="font-semibold text-red-300">Lookup failed</div>
                  <div className="mt-1 break-words text-slate-400">{error}</div>
                </div>
              )}
              {data && <EncyclopediaCard data={data} />}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
