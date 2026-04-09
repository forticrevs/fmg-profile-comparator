"use client";

/**
 * Shared action-value colour coding used by every comparison & reference view.
 * Palette per spec:
 *   red    — block / blocked / deny / denied / drop / dropped / reject / rejected
 *   green  — allow / allowed / permit / permitted / accept / accepted / pass
 *   blue   — monitor / monitored / log / observe
 *   orange — warn / warning / alert / notify
 *   grey   — exempt / exempted / skip / skipped / ignore / ignored / bypass / bypassed
 *
 * Text colour uses the lightest tailwind shade in each palette so contrast
 * against the dark translucent background stays high and the value is easy
 * to read at a glance.
 */
const RED = { bg: "bg-red-900/70", text: "text-red-100", border: "border-red-700/70" };
const GREEN = { bg: "bg-emerald-900/70", text: "text-emerald-100", border: "border-emerald-700/70" };
const BLUE = { bg: "bg-blue-900/70", text: "text-blue-100", border: "border-blue-700/70" };
const ORANGE = { bg: "bg-orange-900/70", text: "text-orange-100", border: "border-orange-700/70" };
const GREY = { bg: "bg-slate-700/70", text: "text-slate-100", border: "border-slate-500/70" };
const DEFAULT = { bg: "bg-amber-950/50", text: "text-amber-100", border: "border-amber-700/60" };

export const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  block: RED, blocked: RED,
  deny: RED, denied: RED,
  drop: RED, dropped: RED,
  reject: RED, rejected: RED,
  allow: GREEN, allowed: GREEN,
  permit: GREEN, permitted: GREEN,
  pass: GREEN, accept: GREEN, accepted: GREEN,
  monitor: BLUE, monitored: BLUE, log: BLUE, observe: BLUE,
  warn: ORANGE, warning: ORANGE, alert: ORANGE, notify: ORANGE,
  exempt: GREY, exempted: GREY,
  skip: GREY, skipped: GREY,
  ignore: GREY, ignored: GREY,
  bypass: GREY, bypassed: GREY,
};

export function getActionStyle(val: string) {
  return ACTION_COLORS[val.toLowerCase().trim()] ?? DEFAULT;
}

/** Field-key matcher: every FMG field whose leaf name semantically denotes
 * an action verdict gets colour-coded. Covers ips/dlp/webfilter/appctl etc. */
export function isActionKey(key: string): boolean {
  // Take just the leaf, stripping any [N] indices.
  const leaf = key.split(".").pop()?.split("[")[0]?.toLowerCase() ?? "";
  if (leaf === "action") return true;
  // Common variants observed in FMG profile responses.
  if (leaf === "default-action") return true;
  if (leaf === "block-action") return true;
  if (leaf === "antiphish-action") return true;
  if (leaf === "rate-mode") return false; // not an action verdict
  if (leaf.endsWith("-action")) return true;
  return false;
}

export default function ActionBadge({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  if (!value || value === "—" || value === "null") {
    return <span className="text-slate-600">{value || "—"}</span>;
  }
  const style = getActionStyle(value);
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      {value}
    </span>
  );
}
