"use client";

import Link from "next/link";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchPolicyObjectMap,
  fetchPolicyPackages,
  fetchPolicyList,
  fetchPolicyViewerSchema,
  fetchPolicyHitcounts,
  type FirewallAddrGrp,
  type FirewallAddress,
  type FirewallService,
  type FirewallServiceGroup,
  type PolicyHitcount,
  type PolicyObjectMap,
  type PolicySchema,
  type PolicySchemaAttr,
} from "@/lib/api";
import ActionBadge, { isActionKey } from "@/components/ActionBadge";

// ---------------------------------------------------------------------------
// Enum maps — FMG returns numeric enums for several fields; we render the
// string form the operator actually recognises. Keep identical to the CSV
// exporter maps so exports and UI agree.
// ---------------------------------------------------------------------------
const ENUM_MAPS: Record<string, Record<number, string>> = {
  status: { 0: "disable", 1: "enable" },
  action: { 0: "deny", 1: "accept" },
  "inspection-mode": { 0: "flow", 1: "proxy" },
  nat: { 0: "disable", 1: "enable" },
  "utm-status": { 0: "disable", 1: "enable" },
  logtraffic: { 0: "disable", 1: "utm", 2: "all" },
  "logtraffic-start": { 0: "disable", 1: "enable" },
};

function renderEnum(field: string, value: unknown): string {
  if (value == null || value === "") return "";
  const map = ENUM_MAPS[field];
  if (map && typeof value === "number" && map[value] !== undefined) {
    return map[value];
  }
  return String(value);
}

function renderListValue(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        v && typeof v === "object" && "name" in v
          ? String((v as { name: unknown }).name ?? "")
          : String(v),
      )
      .filter(Boolean);
  }
  return [String(value)];
}

// ---------------------------------------------------------------------------
// Schema-aware value formatting — resolves numeric enums via schema.opts,
// canonicalises empty/default values, and decides whether a field is at
// its default so the detail view can dim it.
// ---------------------------------------------------------------------------

/** Stringify a value for equality checks against the schema default. */
function canonicalValueKey(value: unknown): string {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return JSON.stringify(
      value.map((v) =>
        v && typeof v === "object" && "name" in v
          ? String((v as { name: unknown }).name ?? "")
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v),
      ),
    );
  }
  return String(value);
}

/** Human-readable string for a raw policy value given its schema attr. */
function formatSchemaValue(
  value: unknown,
  attr: PolicySchemaAttr | undefined,
): string {
  if (value == null || value === "") return "—";
  // Enum — FMG sends either the numeric id or the string name; opts maps
  // the string to the numeric id, so we invert it for both lookups.
  if (attr?.opts) {
    if (typeof value === "number") {
      for (const [name, id] of Object.entries(attr.opts)) {
        if (id === value) return name;
      }
    }
    if (typeof value === "string" && value in attr.opts) return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return renderListValue(value).join(", ") || "—";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** True when a policy value equals the schema-declared default. Enum-aware. */
function isSchemaDefault(
  value: unknown,
  attr: PolicySchemaAttr | undefined,
): boolean {
  if (!attr) return false;
  if (attr.default === undefined || attr.default === null) {
    // FMG treats empty arrays and empty strings as "unset" / default for
    // list-valued fields and datasrc references, so normalize them here.
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }
  return canonicalValueKey(value) === canonicalValueKey(attr.default);
}

/** Turn "dstaddr-negate" / "internet-service6-src-name" into
 *  "Dstaddr Negate" / "Internet Service6 Src Name". */
function humanizeField(key: string): string {
  return key
    .replace(/^_/, "")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Policy detail layout — group the ~125 fields FMG returns into digestible
// sections. Fields not in any group fall into "Other" at the bottom so
// nothing silently disappears when FMG adds new fields.
// ---------------------------------------------------------------------------

interface DetailSection {
  id: string;
  label: string;
  fields: string[];
}

const DETAIL_SECTIONS: DetailSection[] = [
  {
    id: "general",
    label: "General",
    fields: [
      "policyid",
      "name",
      "uuid",
      "status",
      "action",
      "policy-behaviour-type",
      "policy-expiry",
      "policy-expiry-date",
      "inspection-mode",
      "global-label",
      "comments",
      "_label-color",
      "_global-label-color",
    ],
  },
  {
    id: "source",
    label: "Source",
    fields: [
      "srcintf",
      "srcaddr",
      "srcaddr-negate",
      "srcaddr6",
      "srcaddr6-negate",
      "groups",
      "users",
      "fsso-groups",
      "fsso-agent-for-ntlm",
      "src-vendor-mac",
      "scim",
      "scim-groups",
      "scim-users",
      "reputation-minimum",
      "reputation-minimum6",
      "ip-version-type",
    ],
  },
  {
    id: "destination",
    label: "Destination",
    fields: [
      "dstintf",
      "dstaddr",
      "dstaddr-negate",
      "dstaddr6",
      "dstaddr6-negate",
    ],
  },
  {
    id: "internet-services",
    label: "Internet Services",
    fields: [
      "internet-service",
      "internet-service-id",
      "internet-service-name",
      "internet-service-group",
      "internet-service-custom",
      "internet-service-custom-group",
      "internet-service-negate",
      "internet-service-fortiguard",
      "internet-service-src",
      "internet-service-src-id",
      "internet-service-src-name",
      "internet-service-src-group",
      "internet-service-src-custom",
      "internet-service-src-custom-group",
      "internet-service-src-negate",
      "internet-service-src-fortiguard",
      "internet-service6",
      "internet-service6-name",
      "internet-service6-group",
      "internet-service6-custom",
      "internet-service6-custom-group",
      "internet-service6-negate",
      "internet-service6-fortiguard",
      "internet-service6-src",
      "internet-service6-src-name",
      "internet-service6-src-group",
      "internet-service6-src-custom",
      "internet-service6-src-custom-group",
      "internet-service6-src-negate",
      "internet-service6-src-fortiguard",
    ],
  },
  {
    id: "service-schedule",
    label: "Service & Schedule",
    fields: [
      "service",
      "service-negate",
      "schedule",
      "schedule-timeout",
      "session-ttl",
      "sctp-filter-profile",
      "pfcp-profile",
      "gtp-profile",
      "diameter-filter-profile",
    ],
  },
  {
    id: "security-profiles",
    label: "Security Profiles (UTM)",
    fields: [
      "utm-status",
      "ssl-ssh-profile",
      "av-profile",
      "webfilter-profile",
      "dnsfilter-profile",
      "application-list",
      "ips-sensor",
      "dlp-profile",
      "file-filter-profile",
      "casb-profile",
      "emailfilter-profile",
      "videofilter-profile",
      "voip-profile",
      "icap-profile",
      "mms-profile",
      "profile-group",
      "profile-protocol-options",
      "profile-type",
      "cifs-profile",
    ],
  },
  {
    id: "nat",
    label: "NAT",
    fields: [
      "nat",
      "nat46",
      "nat64",
      "ippool",
      "poolname",
      "poolname6",
      "pcp-poolname",
      "pcp-inbound",
      "pcp-outbound",
      "natip",
      "natinbound",
      "natoutbound",
      "fixedport",
      "central-nat",
      "match-vip",
      "match-vip-only",
      "nat-source-vip",
      "port-random",
      "rtp-nat",
    ],
  },
  {
    id: "shaping",
    label: "Shaping / QoS",
    fields: [
      "traffic-shaper",
      "traffic-shaper-reverse",
      "per-ip-shaper",
      "dynamic-shaping",
      "diffserv-forward",
      "diffserv-reverse",
      "diffservcode-forward",
      "diffservcode-rev",
      "tos",
      "tos-mask",
      "tos-negate",
      "vlan-cos-fwd",
      "vlan-cos-rev",
    ],
  },
  {
    id: "logging",
    label: "Logging",
    fields: [
      "logtraffic",
      "logtraffic-start",
      "custom-log-fields",
      "log-http-transaction",
      "log-unmatched-traffic",
      "email-collect",
      "replacemsg-override-group",
    ],
  },
  {
    id: "auth",
    label: "Authentication / Identity",
    fields: [
      "disclaimer",
      "auth-cert",
      "auth-path",
      "auth-redirect-addr",
      "captive-portal-exempt",
      "radius-mac-auth-bypass",
      "radius-ip-auth-bypass",
      "learning-mode",
      "rsso",
      "saml-server",
      "permit-any-host",
    ],
  },
  {
    id: "ztna",
    label: "ZTNA / Tags",
    fields: [
      "ztna-status",
      "ztna-ems-tag",
      "ztna-ems-tag-negate",
      "ztna-geo-tag",
      "ztna-device-ownership",
      "ztna-policy-redirect",
      "ztna-tags-match-logic",
      "sgt",
      "sgt-check",
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    fields: [
      "anti-replay",
      "tcp-session-without-syn",
      "tcp-mss-sender",
      "tcp-mss-receiver",
      "fec",
      "dsri",
      "geoip-match",
      "geoip-anycast",
      "block-notification",
      "timeout-send-rst",
      "wccp",
      "wanopt",
      "wanopt-profile",
      "wanopt-passive-opt",
      "wanopt-detection",
      "wanopt-peer",
      "webcache",
      "webcache-https",
      "delay-tcp-npu-session",
      "auto-asic-offload",
      "np-acceleration",
      "cgn-eif",
      "cgn-eim",
      "cgn-log-server-grp",
      "cgn-resource-quota",
      "cgn-session-quota",
      "cgn-sw-eif-ctrl",
      "app-monitor",
      "passive-wan-health-measurement",
      "policy-offload",
      "capture-packet",
      "decrypted-traffic-mirror",
    ],
  },
  {
    id: "statistics",
    label: "Statistics",
    fields: [
      "_hitcount",
      "_pkts",
      "_byte",
      "_sesscount",
      "_first_hit",
      "_last_hit",
      "_first_session",
      "_last_session",
      "_global-vpn",
      "_policy_block",
    ],
  },
];

const SECTION_BY_FIELD: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const section of DETAIL_SECTIONS) {
    for (const f of section.fields) m.set(f, section.id);
  }
  return m;
})();

// Fields that should never surface in the expand-row detail panel — oid
// is an FMG-internal row id, "obj seq" is per-package ordering noise,
// `_id` is a frontend-injected row key.
const SUPPRESSED_DETAIL_KEYS = new Set(["oid", "obj seq", "_id"]);

/** Partition the policy's keys into {section -> [fields]}. Fields present
 *  on the policy but not in any DETAIL_SECTIONS group land in "other". */
function partitionPolicyFields(
  policy: Record<string, unknown>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const sec of DETAIL_SECTIONS) out[sec.id] = [];
  out.other = [];
  for (const key of Object.keys(policy)) {
    if (SUPPRESSED_DETAIL_KEYS.has(key)) continue;
    const sid = SECTION_BY_FIELD.get(key) ?? "other";
    (out[sid] ?? out.other).push(key);
  }
  // Sort each bucket: preserve declared order for known sections so the
  // eye can scan stable positions; alphabetical for "other".
  for (const sec of DETAIL_SECTIONS) {
    const order = new Map(sec.fields.map((f, i) => [f, i]));
    out[sec.id].sort((a, b) => {
      const ai = order.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = order.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }
  out.other.sort((a, b) => a.localeCompare(b));
  return out;
}

// ---------------------------------------------------------------------------
// Hover tooltip primitive — viewport-clamped, delayed fade in/out
// ---------------------------------------------------------------------------

interface HoverPopoverProps {
  trigger: ReactNode;
  children: ReactNode;
}

function HoverPopover({ trigger, children }: HoverPopoverProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const enterTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const clearTimers = () => {
    if (enterTimer.current != null) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const show = () => {
    clearTimers();
    enterTimer.current = window.setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pw = 320;
      const ph = 200;
      let left = rect.left;
      let top = rect.bottom + 6;
      if (left + pw > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - pw - 12);
      }
      if (top + ph > window.innerHeight - 12) {
        top = Math.max(12, rect.top - ph - 6);
      }
      setPos({ top, left });
      setVisible(true);
    }, 250);
  };

  const hide = () => {
    clearTimers();
    leaveTimer.current = window.setTimeout(() => {
      setVisible(false);
    }, 120);
  };

  useEffect(() => clearTimers, []);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2 hover:decoration-cyan-400"
      >
        {trigger}
      </span>
      {visible && pos && (
        <div
          ref={popoverRef}
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-50 w-80 rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-xl backdrop-blur transition-opacity duration-150"
        >
          {children}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Object detail renderers (tooltip bodies)
// ---------------------------------------------------------------------------

/** Normalize the address type to its string form. FMG can return the
 *  type as either the schema opts number (e.g. ipmask=0, iprange=1,
 *  fqdn=2, wildcard=3, geography=4, dynamic=15, interface-subnet=16,
 *  mac=17, route-tag=20) or the string name, depending on whether the
 *  request was verbose. Defaults to "ipmask" to match FMG's own
 *  default when the field is absent. */
const ADDRESS_TYPE_BY_NUMBER: Record<number, string> = {
  0: "ipmask",
  1: "iprange",
  2: "fqdn",
  3: "wildcard",
  4: "geography",
  15: "dynamic",
  16: "interface-subnet",
  17: "mac",
  20: "route-tag",
};

function normalizeAddressType(raw: unknown): string {
  if (typeof raw === "number") return ADDRESS_TYPE_BY_NUMBER[raw] ?? "ipmask";
  if (typeof raw === "string" && raw) return raw;
  return "ipmask";
}

function joinish(v: unknown, sep: string): string {
  if (Array.isArray(v)) return v.map(String).join(sep);
  return String(v);
}

function AddressDetail({ addr }: { addr: FirewallAddress }) {
  const type = normalizeAddressType(addr.type);
  const rows: [string, string][] = [["type", type]];

  // Type-specific fields only. FMG populates unrelated fields with
  // zero/placeholder values (e.g. ipmask addresses get "0.0.0.0" in
  // start-ip/end-ip), so showing everything leaks noise — the hover
  // popover should match what you'd actually see in the FMG UI for
  // that particular address type.
  switch (type) {
    case "ipmask":
    case "interface-subnet": {
      if (addr.subnet) rows.push(["subnet", joinish(addr.subnet, "/")]);
      if (type === "interface-subnet" && addr.interface) {
        rows.push(["interface", joinish(addr.interface, ", ")]);
      }
      break;
    }
    case "iprange": {
      if (addr["start-ip"]) rows.push(["start-ip", String(addr["start-ip"])]);
      if (addr["end-ip"]) rows.push(["end-ip", String(addr["end-ip"])]);
      break;
    }
    case "fqdn": {
      if (addr.fqdn) rows.push(["fqdn", String(addr.fqdn)]);
      break;
    }
    case "wildcard": {
      if (addr.wildcard) rows.push(["wildcard", joinish(addr.wildcard, "/")]);
      break;
    }
    case "geography": {
      if (addr.country) rows.push(["country", joinish(addr.country, ", ")]);
      break;
    }
    case "mac": {
      if (addr.macaddr) rows.push(["macaddr", joinish(addr.macaddr, ", ")]);
      break;
    }
    case "dynamic": {
      if (addr["sub-type"]) rows.push(["sub-type", String(addr["sub-type"])]);
      if (addr.sdn) rows.push(["sdn", joinish(addr.sdn, ", ")]);
      if (addr.filter) rows.push(["filter", String(addr.filter)]);
      break;
    }
    case "route-tag": {
      if (addr["route-tag"] !== undefined && addr["route-tag"] !== null) {
        rows.push(["route-tag", String(addr["route-tag"])]);
      }
      break;
    }
    default: {
      // Unknown/future type — fall back to inspecting every populated
      // field rather than silently dropping data on the floor.
      if (addr.subnet) rows.push(["subnet", joinish(addr.subnet, "/")]);
      if (addr["start-ip"]) rows.push(["start-ip", String(addr["start-ip"])]);
      if (addr["end-ip"]) rows.push(["end-ip", String(addr["end-ip"])]);
      if (addr.fqdn) rows.push(["fqdn", String(addr.fqdn)]);
      if (addr.wildcard) rows.push(["wildcard", joinish(addr.wildcard, "/")]);
      if (addr.country) rows.push(["country", joinish(addr.country, ", ")]);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-semibold text-cyan-300">{addr.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">address</span>
      </div>
      <dl className="space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-20 shrink-0 text-slate-500">{k}</dt>
            <dd className="flex-1 break-all text-slate-200">{v}</dd>
          </div>
        ))}
      </dl>
      {addr.comment && (
        <div className="mt-2 border-t border-slate-800 pt-1 text-[11px] italic text-slate-400">
          {addr.comment}
        </div>
      )}
    </div>
  );
}

function AddrGrpDetail({
  grp,
  addresses,
  addrgrps,
}: {
  grp: FirewallAddrGrp;
  addresses: Record<string, FirewallAddress>;
  addrgrps: Record<string, FirewallAddrGrp>;
}) {
  const members = renderListValue(grp.member);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-semibold text-cyan-300">{grp.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          addrgrp · {members.length}
        </span>
      </div>
      <ul className="max-h-40 space-y-0.5 overflow-auto pr-1">
        {members.map((m) => {
          const isGroup = addrgrps[m] !== undefined;
          const isAddr = addresses[m] !== undefined;
          return (
            <li key={m} className="flex items-center gap-2 text-[11px]">
              <span
                className={`inline-block w-10 text-center text-[9px] font-semibold uppercase ${
                  isGroup
                    ? "text-purple-300"
                    : isAddr
                      ? "text-cyan-300"
                      : "text-slate-500"
                }`}
              >
                {isGroup ? "grp" : isAddr ? "addr" : "?"}
              </span>
              <span className="break-all text-slate-200">{m}</span>
            </li>
          );
        })}
      </ul>
      {grp.comment && (
        <div className="mt-2 border-t border-slate-800 pt-1 text-[11px] italic text-slate-400">
          {grp.comment}
        </div>
      )}
    </div>
  );
}

function ServiceDetail({ svc }: { svc: FirewallService }) {
  const rows: [string, string][] = [];
  if (svc.protocol != null) rows.push(["protocol", String(svc.protocol)]);
  const tcp = renderListValue(svc["tcp-portrange"]).join(", ");
  const udp = renderListValue(svc["udp-portrange"]).join(", ");
  const sctp = renderListValue(svc["sctp-portrange"]).join(", ");
  if (tcp) rows.push(["tcp", tcp]);
  if (udp) rows.push(["udp", udp]);
  if (sctp) rows.push(["sctp", sctp]);
  if (svc.icmptype != null) rows.push(["icmp-type", String(svc.icmptype)]);
  if (svc.icmpcode != null) rows.push(["icmp-code", String(svc.icmpcode)]);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-semibold text-cyan-300">{svc.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">service</span>
      </div>
      <dl className="space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-20 shrink-0 text-slate-500">{k}</dt>
            <dd className="flex-1 break-all text-slate-200">{v}</dd>
          </div>
        ))}
      </dl>
      {svc.comment && (
        <div className="mt-2 border-t border-slate-800 pt-1 text-[11px] italic text-slate-400">
          {svc.comment}
        </div>
      )}
    </div>
  );
}

function ServiceGroupDetail({
  grp,
  services,
  serviceGroups,
}: {
  grp: FirewallServiceGroup;
  services: Record<string, FirewallService>;
  serviceGroups: Record<string, FirewallServiceGroup>;
}) {
  const members = renderListValue(grp.member);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-semibold text-cyan-300">{grp.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          svc-grp · {members.length}
        </span>
      </div>
      <ul className="max-h-40 space-y-0.5 overflow-auto pr-1">
        {members.map((m) => {
          const isGroup = serviceGroups[m] !== undefined;
          const isSvc = services[m] !== undefined;
          return (
            <li key={m} className="flex items-center gap-2 text-[11px]">
              <span
                className={`inline-block w-10 text-center text-[9px] font-semibold uppercase ${
                  isGroup
                    ? "text-purple-300"
                    : isSvc
                      ? "text-cyan-300"
                      : "text-slate-500"
                }`}
              >
                {isGroup ? "grp" : isSvc ? "svc" : "?"}
              </span>
              <span className="break-all text-slate-200">{m}</span>
            </li>
          );
        })}
      </ul>
      {grp.comment && (
        <div className="mt-2 border-t border-slate-800 pt-1 text-[11px] italic text-slate-400">
          {grp.comment}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface PolicyRow {
  [key: string]: unknown;
  _id: string;
}

export default function PolicyViewerPage() {
  const [adom, setAdom] = useState<string>("");
  const [packages, setPackages] = useState<string[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [objectMap, setObjectMap] = useState<PolicyObjectMap | null>(null);
  const [schema, setSchema] = useState<PolicySchema | null>(null);
  // Per-policyid runtime counters. Loaded asynchronously after the
  // policy list renders — the hitcount trigger takes 2-4 s, so we don't
  // want to block the table on it. `null` means "not yet attempted",
  // an empty object means "fetched, but nothing came back".
  const [hitcounts, setHitcounts] = useState<Record<
    string,
    PolicyHitcount
  > | null>(null);
  const [loadingHitcounts, setLoadingHitcounts] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Column configuration — ordered list of visible field keys, manual
  // pixel widths, and per-column substring filters. Widths + ordering
  // persist across reloads; per-column filters are session-only since
  // they're usually short-lived exploration state.
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    loadJson<string[]>(LS_KEY_COLUMNS, DEFAULT_COLUMN_KEYS),
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => loadJson<Record<string, number>>(LS_KEY_WIDTHS, {}),
  );
  const [columnFilters, setColumnFilters] = useState<
    Record<string, string>
  >({});

  // Layout — sidebar collapse + wide-mode (max-width: unset) are both
  // persisted. We *don't* default to wide because wall-to-wall tables
  // feel cheap on ultra-wide displays; the operator opts in when they
  // actually need the horizontal room for a wide column set.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    loadJson<boolean>(LS_KEY_SIDEBAR, false),
  );
  const [wideLayout, setWideLayout] = useState<boolean>(() =>
    loadJson<boolean>(LS_KEY_WIDE, false),
  );

  useEffect(() => {
    saveJson(LS_KEY_COLUMNS, visibleColumns);
  }, [visibleColumns]);
  useEffect(() => {
    saveJson(LS_KEY_WIDTHS, columnWidths);
  }, [columnWidths]);
  useEffect(() => {
    saveJson(LS_KEY_SIDEBAR, sidebarCollapsed);
  }, [sidebarCollapsed]);
  useEffect(() => {
    saveJson(LS_KEY_WIDE, wideLayout);
  }, [wideLayout]);

  // Initial eager load: packages + object map + policy schema. The
  // schema lives at the ADOM level so it's valid for every package in
  // this ADOM — paying the ~250 ms once on mount means clicking a
  // package never stalls on a second syntax call.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPolicyPackages(),
      fetchPolicyObjectMap(),
      fetchPolicyViewerSchema().catch(() => null),
    ])
      .then(([pkgs, objs, schemaResp]) => {
        if (cancelled) return;
        setAdom(pkgs.adom);
        setPackages(pkgs.packages);
        setObjectMap(objs);
        setSchema(schemaResp?.schema ?? null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load policies when a package is chosen
  useEffect(() => {
    if (!selectedPkg) return;
    let cancelled = false;
    setLoadingPolicies(true);
    setError(null);
    setHitcounts(null);
    fetchPolicyList(selectedPkg)
      .then((data) => {
        if (cancelled) return;
        setPolicies(
          data.policies.map((p, i) => ({
            ...p,
            _id: `${selectedPkg}-${(p as { policyid?: unknown }).policyid ?? i}`,
          })),
        );
        setFields(data.fields);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingPolicies(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPkg]);

  // Hit-counter refresh — fires once the package is chosen, in parallel
  // with the policy fetch. The three-step FMG hitcount flow takes ~2-4 s
  // so we keep it off the critical-path spinner; the table renders with
  // a "…" placeholder in the Hits column until this settles.
  useEffect(() => {
    if (!selectedPkg) return;
    let cancelled = false;
    setLoadingHitcounts(true);
    fetchPolicyHitcounts(selectedPkg)
      .then((data) => {
        if (cancelled) return;
        setHitcounts(data.hitcounts ?? {});
      })
      .catch(() => {
        // Non-fatal — hitcount is optional polish. Older FMGs don't
        // support it and we still want the table to render.
        if (!cancelled) setHitcounts({});
      })
      .finally(() => {
        if (!cancelled) setLoadingHitcounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPkg]);

  const filteredPolicies = useMemo(() => {
    // Flatten a cell value to a lowercased search haystack. Hit-count
    // and bytes columns are synthetic — their needle is the raw number
    // looked up from the hitcount map, so filters like `>1000` won't
    // work but `0` and exact numbers will. (The filter row doesn't even
    // render inputs for these columns today, but the branch is kept so
    // programmatic filters stay predictable.)
    const haystack = (p: PolicyRow, key: string): string => {
      if (key === HITS_COLUMN_KEY || key === BYTES_COLUMN_KEY) {
        const pidKey = p.policyid != null ? String(p.policyid) : null;
        const hc =
          pidKey != null && hitcounts ? hitcounts[pidKey] : undefined;
        if (!hc) return "";
        return key === HITS_COLUMN_KEY
          ? String(hc.hitcount)
          : String(hc.byte);
      }
      const v = p[key];
      if (v == null || v === "") return "";
      if (Array.isArray(v)) return renderListValue(v).join(" ").toLowerCase();
      return String(v).toLowerCase();
    };

    let result = policies;

    // Per-column substring filters — each column's needle has to match
    // at least the content of THAT column. AND semantics across columns.
    const perColumn = Object.entries(columnFilters).filter(
      ([, v]) => v && v.trim(),
    );
    if (perColumn.length > 0) {
      result = result.filter((p) => {
        for (const [key, needle] of perColumn) {
          if (!haystack(p, key).includes(needle.trim().toLowerCase())) {
            return false;
          }
        }
        return true;
      });
    }

    // Global search — scans every field FMG returned, regardless of
    // whether it's currently a visible column. Lets the operator
    // pattern-match on something they haven't added to the table yet.
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      result = result.filter((p) => {
        for (const k of fields) {
          const v = p[k];
          if (v == null || v === "") continue;
          const s = Array.isArray(v)
            ? renderListValue(v).join(" ")
            : String(v);
          if (s.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }

    return result;
  }, [policies, fields, filter, columnFilters, hitcounts]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
          <p className="text-sm text-slate-400">
            Loading policy packages and object catalog…
          </p>
        </div>
      </main>
    );
  }

  // Layout width — `max-w-[1600px]` for the default (keeps the eye from
  // trekking end to end on ultra-wide displays), `max-w-none` when the
  // operator has explicitly opted into wide mode because they've added
  // enough columns to need the room.
  const containerClass = wideLayout
    ? "mx-auto max-w-none px-6 py-8 space-y-6"
    : "mx-auto max-w-[1600px] px-6 py-8 space-y-6";
  const layoutGridClass = sidebarCollapsed
    ? "grid gap-4 lg:grid-cols-1"
    : "grid gap-6 lg:grid-cols-[260px_1fr]";

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className={containerClass}>
        <div>
          <Link
            href="/tools"
            className="text-xs text-slate-500 transition hover:text-cyan-400"
          >
            ← Back to tools
          </Link>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Policy viewer</h1>
              <p className="mt-1 text-sm text-slate-500">
                Browse firewall policies in the active ADOM. Hover any
                address or service to see its resolved definition.
              </p>
            </div>
            {objectMap && (
              <div className="text-right text-[11px] leading-4 text-slate-500">
                <div>
                  ADOM: <span className="text-slate-300">{adom}</span>
                </div>
                <div>
                  {objectMap.counts.addresses} addrs ·{" "}
                  {objectMap.counts.addrgrps} grps ·{" "}
                  {objectMap.counts.services} svcs ·{" "}
                  {objectMap.counts.service_groups} svc-grps
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className={layoutGridClass}>
          {!sidebarCollapsed && (
            <aside className="rounded-xl border border-slate-800 bg-slate-900/40">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Packages ({packages.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="text-[11px] text-slate-600 transition hover:text-cyan-300"
                  title="Hide package navigator"
                  aria-label="Hide package navigator"
                >
                  ◀
                </button>
              </div>
              <ul className="max-h-[75vh] overflow-auto py-1">
                {packages.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => setSelectedPkg(p)}
                      className={`w-full truncate px-4 py-1.5 text-left text-xs transition ${
                        selectedPkg === p
                          ? "bg-cyan-500/10 text-cyan-300"
                          : "text-slate-300 hover:bg-slate-800/40"
                      }`}
                      title={p}
                    >
                      {p}
                    </button>
                  </li>
                ))}
                {packages.length === 0 && (
                  <li className="px-4 py-3 text-xs text-slate-600">
                    No packages in this ADOM.
                  </li>
                )}
              </ul>
            </aside>
          )}

          <section className="min-w-0">
            {!selectedPkg ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/20 px-6 py-16 text-center text-sm text-slate-500">
                Select a package to view its policies.
              </div>
            ) : loadingPolicies ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-8 text-sm text-slate-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
                Loading policies…
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    {sidebarCollapsed && (
                      <button
                        type="button"
                        onClick={() => setSidebarCollapsed(false)}
                        className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-400 transition hover:border-cyan-600/60 hover:text-cyan-300"
                        title={`Show package navigator (${packages.length} packages)`}
                        aria-label="Show package navigator"
                      >
                        ▶ Packages
                      </button>
                    )}
                    <h2 className="truncate text-sm font-semibold text-slate-200">
                      {selectedPkg}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        ({filteredPolicies.length} of {policies.length})
                      </span>
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ColumnPickerMenu
                      visibleColumns={visibleColumns}
                      schema={schema}
                      onChange={setVisibleColumns}
                    />
                    <button
                      type="button"
                      onClick={() => setWideLayout((v) => !v)}
                      className={`rounded-md border px-2.5 py-1.5 text-[11px] transition ${
                        wideLayout
                          ? "border-cyan-700/60 bg-cyan-950/40 text-cyan-300"
                          : "border-slate-800 bg-slate-950 text-slate-500 hover:border-cyan-600/60 hover:text-cyan-300"
                      }`}
                      title={
                        wideLayout
                          ? "Shrink to centred 1600 px layout"
                          : "Stretch to full viewport width"
                      }
                      aria-pressed={wideLayout}
                    >
                      {wideLayout ? "Wide ✓" : "Wide"}
                    </button>
                    <input
                      type="text"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Global search…"
                      className="w-56 rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/60 focus:outline-none"
                    />
                  </div>
                </div>
                <PolicyTable
                  rows={filteredPolicies}
                  objectMap={objectMap}
                  schema={schema}
                  hitcounts={hitcounts}
                  loadingHitcounts={loadingHitcounts}
                  visibleColumnKeys={visibleColumns}
                  columnWidths={columnWidths}
                  onColumnWidthsChange={setColumnWidths}
                  columnFilters={columnFilters}
                  onColumnFiltersChange={setColumnFilters}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Table with hover-enabled object cells
// ---------------------------------------------------------------------------

/**
 * Column system — defaults, builtins, and resolution.
 *
 * The compact table renders `[expand chevron, ...visibleColumns]`. The
 * expand chevron is fixed. Everything else is data-driven by
 * `visibleColumns: string[]` (per-key ordering, persisted in
 * localStorage). Any of the ~208 schema fields can be added as a
 * column; eight built-in ones get specialised renderers (object-ref
 * chips, action badges, hits cell) and explicit default widths, while
 * unknown keys fall through to a generic formatter with a `1fr` track.
 *
 * Manual resize overrides the default track with a fixed pixel value;
 * absent override → the default fr/minmax track is used, so the grid
 * still auto-fits the container when the user hasn't dragged anything.
 */
interface ColumnSpec {
  key: string;
  label: string;
  /** Default CSS grid track (used when no manual width override). */
  defaultTrack: string;
  /** Manual-resize floor (px). */
  minPx: number;
  /** Non-filterable columns (hits is synthetic, expand is decorative). */
  filterable: boolean;
}

/** Synthetic column — hits is populated from the hitcount refresh, not
 *  the raw policy object. Kept as a regular column key so it can be
 *  toggled / resized / filtered like anything else. */
const HITS_COLUMN_KEY = "hits";
const BYTES_COLUMN_KEY = "bytes";

const BUILTIN_COLUMNS: Record<string, Omit<ColumnSpec, "key">> = {
  policyid: {
    label: "ID",
    defaultTrack: "3rem",
    minPx: 40,
    filterable: true,
  },
  name: {
    label: "Name",
    defaultTrack: "minmax(7rem, 2fr)",
    minPx: 80,
    filterable: true,
  },
  srcaddr: {
    label: "Source",
    defaultTrack: "minmax(5.5rem, 1.3fr)",
    minPx: 70,
    filterable: true,
  },
  dstaddr: {
    label: "Destination",
    defaultTrack: "minmax(5.5rem, 1.3fr)",
    minPx: 70,
    filterable: true,
  },
  service: {
    label: "Service",
    defaultTrack: "minmax(4.5rem, 1fr)",
    minPx: 60,
    filterable: true,
  },
  [HITS_COLUMN_KEY]: {
    label: "Hits",
    defaultTrack: "5rem",
    minPx: 48,
    filterable: false,
  },
  [BYTES_COLUMN_KEY]: {
    label: "Bytes",
    defaultTrack: "5.5rem",
    minPx: 56,
    filterable: false,
  },
  action: {
    label: "Action",
    defaultTrack: "4.5rem",
    minPx: 54,
    filterable: true,
  },
  status: {
    label: "Status",
    defaultTrack: "4.5rem",
    minPx: 54,
    filterable: true,
  },
};

const DEFAULT_COLUMN_KEYS: string[] = [
  "policyid",
  "name",
  "srcaddr",
  "dstaddr",
  "service",
  HITS_COLUMN_KEY,
  BYTES_COLUMN_KEY,
  "action",
  "status",
];

/** Produce a ColumnSpec for any key — uses the builtin spec when we
 *  have one, otherwise a generic 1fr track + humanised label. */
function resolveColumnSpec(key: string): ColumnSpec {
  const b = BUILTIN_COLUMNS[key];
  if (b) return { key, ...b };
  return {
    key,
    label: humanizeField(key),
    defaultTrack: "minmax(6rem, 1fr)",
    minPx: 60,
    filterable: true,
  };
}

// localStorage keys — scoped to this page so they don't collide with
// the profile-comparison `fieldvis:*` family.
const LS_KEY_COLUMNS = "policyviewer:columns";
const LS_KEY_WIDTHS = "policyviewer:widths";
const LS_KEY_SIDEBAR = "policyviewer:sidebar-collapsed";
const LS_KEY_WIDE = "policyviewer:wide";

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private browsing — ignore */
  }
}

/** Format large hit counts compactly (1.8M / 113K / 40) so the column
 * stays narrow enough to fit without horizontal scroll. Full value goes
 * into the tooltip. */
function formatHitCount(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format bytes with a binary-SI suffix for the detail view. */
function formatBytes(n: number): string {
  if (!n) return "0";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/** Turn a Unix epoch (seconds) into a local ISO string. 0 → "never". */
function formatEpoch(sec: number): string {
  if (!sec) return "never";
  try {
    return new Date(sec * 1000).toLocaleString();
  } catch {
    return String(sec);
  }
}

// ---------------------------------------------------------------------------
// Relative-scale colour ramp for hit counts + bytes.
//
// A fixed-threshold palette (e.g. "≥1M hits is hot") lies to the operator
// whenever the package's traffic profile doesn't match the threshold —
// a tiny ADOM where the busiest policy has 500 hits would paint every
// row cold. Instead we bucket values relative to the max seen in *this
// package's* hitcount response, on a log scale so order-of-magnitude
// spreads (0 → 83M hits on a typical SD-WAN package) bucket meaningfully.
// ---------------------------------------------------------------------------

const HEAT_BUCKET_COUNT = 5;
const HEAT_COLOR_CLASSES: readonly string[] = [
  "text-slate-700", // 0 — cold / zero
  "text-slate-500", // 1
  "text-slate-300", // 2 — middle-of-the-pack
  "text-cyan-300", // 3
  "text-amber-300", // 4 — hottest in this package
];

interface HeatScale {
  /** Max hitcount across every row in the current package's hitcount map. */
  maxHits: number;
  /** Max byte count across every row in the current package's hitcount map. */
  maxBytes: number;
  /** Relative bucket [0..HEAT_BUCKET_COUNT-1] for a hit value. 0 when
   *  value is 0 or no hitcount data has been loaded yet. */
  hitsBucket: (value: number) => number;
  /** Same idea, for bytes. */
  bytesBucket: (value: number) => number;
  /** Tailwind text-colour class for a given bucket. */
  colorFor: (bucket: number) => string;
}

function buildHeatScale(
  hitcounts: Record<string, PolicyHitcount> | null,
): HeatScale {
  let maxHits = 0;
  let maxBytes = 0;
  if (hitcounts) {
    for (const hc of Object.values(hitcounts)) {
      if (hc.hitcount > maxHits) maxHits = hc.hitcount;
      if (hc.byte > maxBytes) maxBytes = hc.byte;
    }
  }

  // Log-normalised bucket. log(x+1) gently maps 0 → 0 and handles the
  // 0 → millions spread without collapsing everything below the top
  // decile into "cold".
  const bucketFor = (value: number, max: number): number => {
    if (max <= 0 || value <= 0) return 0;
    const denom = Math.log(max + 1);
    if (denom <= 0) return 0;
    const normalized = Math.log(value + 1) / denom;
    const bucket = Math.floor(normalized * HEAT_BUCKET_COUNT);
    return Math.min(HEAT_BUCKET_COUNT - 1, Math.max(0, bucket));
  };

  return {
    maxHits,
    maxBytes,
    hitsBucket: (v) => bucketFor(v, maxHits),
    bytesBucket: (v) => bucketFor(v, maxBytes),
    colorFor: (bucket) =>
      HEAT_COLOR_CLASSES[
        Math.min(HEAT_BUCKET_COUNT - 1, Math.max(0, bucket))
      ],
  };
}

function PolicyTable({
  rows,
  objectMap,
  schema,
  hitcounts,
  loadingHitcounts,
  visibleColumnKeys,
  columnWidths,
  onColumnWidthsChange,
  columnFilters,
  onColumnFiltersChange,
}: {
  rows: PolicyRow[];
  objectMap: PolicyObjectMap | null;
  schema: PolicySchema | null;
  hitcounts: Record<string, PolicyHitcount> | null;
  loadingHitcounts: boolean;
  visibleColumnKeys: string[];
  columnWidths: Record<string, number>;
  onColumnWidthsChange: (
    updater: (prev: Record<string, number>) => Record<string, number>,
  ) => void;
  columnFilters: Record<string, string>;
  onColumnFiltersChange: (
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
}) {
  const columns = useMemo(
    () => visibleColumnKeys.map((k) => resolveColumnSpec(k)),
    [visibleColumnKeys],
  );

  // Relative-scale "heat" for Hits + Bytes columns. Recomputed whenever
  // the hitcount map changes so a package with a 500-hit peak and an
  // 80M-hit peak both surface their hottest policies with the warm
  // colour, and their coldest with slate-700.
  const heatScale = useMemo(() => buildHeatScale(hitcounts), [hitcounts]);

  // `1.5rem` is the fixed-width chevron column; every user column
  // follows. When a manual width exists for a key, it overrides the
  // default track (including any fr weight) with a pixel value.
  const gridTemplate = useMemo(() => {
    const parts = ["1.5rem"];
    for (const col of columns) {
      const override = columnWidths[col.key];
      parts.push(override != null ? `${override}px` : col.defaultTrack);
    }
    return parts.join(" ");
  }, [columns, columnWidths]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const headerCellRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(rows.map((r) => r._id)));
  const collapseAll = () => setExpanded(new Set());

  // Pointer-driven column resize. Pointer capture stays on `window` so
  // the drag survives leaving the handle's bounding box. Measuring the
  // header cell's current rendered width at pointer-down lets us drag
  // equally from a fr-track or a fixed-track column without coordinate
  // juggling.
  const handleResizeStart = (
    e: React.PointerEvent<HTMLSpanElement>,
    key: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const el = headerCellRefs.current[key];
    if (!el) return;
    const startPx = el.getBoundingClientRect().width;
    const startX = e.clientX;
    const spec = resolveColumnSpec(key);
    setDraggingKey(key);

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.max(spec.minPx, Math.round(startPx + delta));
      onColumnWidthsChange((prev) => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      setDraggingKey(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Double-click resets a column back to its auto track.
  const resetWidth = (key: string) => {
    onColumnWidthsChange((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setColumnFilter = (key: string, value: string) => {
    onColumnFiltersChange((prev) => {
      if (!value) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  return (
    <div
      className={`overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40 ${
        draggingKey ? "select-none" : ""
      }`}
      style={{ ["--pv-cols" as string]: gridTemplate } as React.CSSProperties}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10 grid gap-2 border-b border-slate-800 bg-slate-950/95 text-[10px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur"
        style={{ gridTemplateColumns: "var(--pv-cols)" }}
      >
        <div className="px-3 py-2" />
        {columns.map((col) => {
          const hasOverride = columnWidths[col.key] != null;
          return (
            <div
              key={col.key}
              ref={(el) => {
                headerCellRefs.current[col.key] = el;
              }}
              className="relative min-w-0 truncate px-3 py-2"
              title={col.label}
            >
              {col.label}
              {hasOverride && (
                <span
                  className="ml-1 text-[8px] text-cyan-500/80"
                  title="Manual width — double-click the handle to reset"
                >
                  ●
                </span>
              )}
              <span
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${col.label} column`}
                onPointerDown={(e) => handleResizeStart(e, col.key)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  resetWidth(col.key);
                }}
                className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none transition ${
                  draggingKey === col.key
                    ? "bg-cyan-500/60"
                    : "bg-transparent hover:bg-cyan-500/30"
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Per-column filter row */}
      <div
        className="grid gap-2 border-b border-slate-900/80 bg-slate-950/60"
        style={{ gridTemplateColumns: "var(--pv-cols)" }}
      >
        <div className="px-2 py-1" />
        {columns.map((col) => (
          <div key={col.key} className="min-w-0 px-2 py-1">
            {col.filterable ? (
              <input
                type="text"
                value={columnFilters[col.key] ?? ""}
                onChange={(e) => setColumnFilter(col.key, e.target.value)}
                placeholder="filter…"
                aria-label={`Filter by ${col.label}`}
                className="w-full min-w-0 rounded border border-slate-800 bg-slate-950/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 placeholder:text-slate-700 focus:border-cyan-600/60 focus:outline-none"
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* Toolbar inside the card — bulk expand helpers + hitcount status */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3 border-b border-slate-900/80 bg-slate-950/60 px-3 py-1.5 text-[10px] text-slate-600">
          <span>
            {expanded.size > 0
              ? `${expanded.size} expanded`
              : "Click a row to see every field"}
          </span>
          {loadingHitcounts && (
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-500/70" />
              refreshing hit counts…
            </span>
          )}
          {!loadingHitcounts && hitcounts != null && (
            <span className="text-slate-600">
              hit counts: {Object.keys(hitcounts).length} policies
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="transition hover:text-cyan-300"
            >
              Expand all
            </button>
            <span className="text-slate-800">|</span>
            <button
              type="button"
              onClick={collapseAll}
              className="transition hover:text-cyan-300"
            >
              Collapse all
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="max-h-[72vh] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            No policies.
          </div>
        ) : (
          rows.map((row) => {
            const isOpen = expanded.has(row._id);
            const pidKey =
              row.policyid != null ? String(row.policyid) : null;
            const hc =
              pidKey != null && hitcounts ? hitcounts[pidKey] : undefined;
            return (
              <Fragment key={row._id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(row._id)}
                  onDoubleClick={() => toggle(row._id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(row._id);
                    }
                  }}
                  className={`grid cursor-pointer gap-2 border-b border-slate-900 py-2 text-xs transition hover:bg-slate-800/30 ${
                    isOpen ? "bg-slate-900/40" : ""
                  }`}
                  style={{ gridTemplateColumns: "var(--pv-cols)" }}
                >
                  <div className="flex min-w-0 items-center justify-center text-[10px] leading-none text-slate-600">
                    {isOpen ? "▼" : "▶"}
                  </div>
                  {columns.map((col) => {
                    // Hits + Bytes are synthetic — their "value" is
                    // looked up in the hitcount map by policyid, not
                    // sourced from the raw policy object.
                    const cellValue =
                      col.key === HITS_COLUMN_KEY ||
                      col.key === BYTES_COLUMN_KEY
                        ? hc
                        : row[col.key];
                    return (
                      <div key={col.key} className="min-w-0 px-3">
                        <PolicyCell
                          field={col.key}
                          value={cellValue}
                          objectMap={objectMap}
                          schema={schema}
                          loadingHitcounts={loadingHitcounts}
                          hitcountsReady={hitcounts != null}
                          heatScale={heatScale}
                        />
                      </div>
                    );
                  })}
                </div>
                {isOpen && (
                  <PolicyDetailPanel
                    policy={row}
                    schema={schema}
                    objectMap={objectMap}
                    hitcount={hc}
                  />
                )}
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

function PolicyCell({
  field,
  value,
  objectMap,
  schema,
  loadingHitcounts,
  hitcountsReady,
  heatScale,
}: {
  field: string;
  value: unknown;
  objectMap: PolicyObjectMap | null;
  schema: PolicySchema | null;
  loadingHitcounts: boolean;
  hitcountsReady: boolean;
  heatScale: HeatScale;
}) {
  // Synthetic hits column — `value` here is the PolicyHitcount record
  // the caller looked up by policyid, not a real field on the policy.
  if (field === HITS_COLUMN_KEY) {
    return (
      <HitsCell
        hc={value as PolicyHitcount | undefined}
        loading={loadingHitcounts && !hitcountsReady}
        heatScale={heatScale}
      />
    );
  }
  if (field === BYTES_COLUMN_KEY) {
    return (
      <BytesCell
        hc={value as PolicyHitcount | undefined}
        loading={loadingHitcounts && !hitcountsReady}
        heatScale={heatScale}
      />
    );
  }

  // Enum-rendered scalars — status/action/nat/utm-status get colour
  // badges, inspection-mode stays plain text.
  if (
    field === "status" ||
    field === "action" ||
    field === "inspection-mode" ||
    field === "nat" ||
    field === "utm-status"
  ) {
    const text = renderEnum(field, value);
    if (
      field === "action" ||
      field === "status" ||
      field === "nat" ||
      field === "utm-status"
    ) {
      return (
        <div className="min-w-0">
          <ActionBadge value={text} />
        </div>
      );
    }
    return <div className="min-w-0 truncate text-slate-300">{text || "—"}</div>;
  }

  // Name column — tighter, single-line with ellipsis + tooltip
  if (field === "name") {
    const text = value == null || value === "" ? "—" : String(value);
    return (
      <div
        className="min-w-0 truncate font-medium text-slate-100"
        title={text}
      >
        {text}
      </div>
    );
  }

  // Object-ref lists with hover tooltips (truncate + peek on hover)
  if (field === "srcaddr" || field === "dstaddr" || field === "service") {
    const items = renderListValue(value);
    if (items.length === 0) {
      return <div className="min-w-0 text-slate-600">—</div>;
    }
    return (
      <div className="min-w-0 space-y-0.5 break-words leading-tight">
        {items.map((name) => (
          <div key={name} className="truncate">
            <ObjectRef field={field} name={name} objectMap={objectMap} />
          </div>
        ))}
      </div>
    );
  }

  if (field === "policyid") {
    return (
      <div className="min-w-0 text-right font-mono tabular-nums text-slate-500">
        {value == null ? "—" : String(value)}
      </div>
    );
  }

  // Generic fallback for any schema field the user has added as a
  // column. Uses the schema attr so numeric enums show as the string
  // opt name and *-action leaves render as coloured badges.
  const attr = schema?.attr?.[field];

  if (value == null || value === "") {
    return <div className="min-w-0 text-slate-600">—</div>;
  }

  if (isActionKey(field)) {
    return (
      <div className="min-w-0">
        <ActionBadge value={formatSchemaValue(value, attr)} />
      </div>
    );
  }

  if (Array.isArray(value)) {
    const items = renderListValue(value);
    const joined = items.join(", ") || "—";
    return (
      <div className="min-w-0 truncate text-slate-300" title={joined}>
        {joined}
      </div>
    );
  }

  const text = formatSchemaValue(value, attr);
  return (
    <div className="min-w-0 truncate text-slate-300" title={text}>
      {text}
    </div>
  );
}

/** Compact "Hits" cell — shows the SI-abbreviated count during normal
 *  operation, a pulse dot while the hitcount refresh is still in flight,
 *  and an em-dash when the refresh has landed but this particular
 *  policyid had no associated record. Full numeric + last-hit goes into
 *  the tooltip so the operator can mouse-over for detail. */
/** Shared tooltip text for both the Hits and Bytes cells — traffic
 *  summary plus the last-hit timestamp. */
function hitTooltip(hc: PolicyHitcount): string {
  return (
    `${hc.hitcount.toLocaleString()} hits · ` +
    `${hc.pkts.toLocaleString()} pkts · ` +
    `${formatBytes(hc.byte)}\n` +
    `last hit: ${formatEpoch(hc.last_hit)}`
  );
}

function HitsCell({
  hc,
  loading,
  heatScale,
}: {
  hc: PolicyHitcount | undefined;
  loading: boolean;
  heatScale: HeatScale;
}) {
  if (loading) {
    return (
      <div className="min-w-0 text-right font-mono text-slate-700">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-600 align-middle" />
      </div>
    );
  }
  if (!hc) {
    return (
      <div className="min-w-0 text-right font-mono text-slate-700">—</div>
    );
  }
  const color = heatScale.colorFor(heatScale.hitsBucket(hc.hitcount));
  return (
    <div
      className={`min-w-0 text-right font-mono tabular-nums ${color}`}
      title={hitTooltip(hc)}
    >
      {formatHitCount(hc.hitcount)}
    </div>
  );
}

/** Bytes cell — sibling of HitsCell. Same relative-heat ramp but
 *  bucketed against max bytes in the package, so a package whose
 *  busiest policy moves a few GiB shows that policy as hot without
 *  waiting for the FMG lab's 7 TiB peaks to apply. */
function BytesCell({
  hc,
  loading,
  heatScale,
}: {
  hc: PolicyHitcount | undefined;
  loading: boolean;
  heatScale: HeatScale;
}) {
  if (loading) {
    return (
      <div className="min-w-0 text-right font-mono text-slate-700">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-600 align-middle" />
      </div>
    );
  }
  if (!hc) {
    return (
      <div className="min-w-0 text-right font-mono text-slate-700">—</div>
    );
  }
  const color = heatScale.colorFor(heatScale.bytesBucket(hc.byte));
  return (
    <div
      className={`min-w-0 text-right font-mono tabular-nums ${color}`}
      title={hitTooltip(hc)}
    >
      {formatBytes(hc.byte)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column picker menu — dropdown with every schema field grouped into the
// same DETAIL_SECTIONS the detail panel uses, plus a search box so the
// operator can add any of FMG's ~208 policy fields as a column on the
// compact table.
// ---------------------------------------------------------------------------

function ColumnPickerMenu({
  visibleColumns,
  schema,
  onChange,
}: {
  visibleColumns: string[];
  schema: PolicySchema | null;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);

  // Every key the picker can offer: schema fields + the synthetic
  // `hits` / `bytes` columns + any builtin that's not already in the
  // schema (defensive — FMG schema should cover all of them).
  const availableKeys = useMemo(() => {
    const set = new Set<string>();
    if (schema?.attr) {
      for (const k of Object.keys(schema.attr)) set.add(k);
    }
    set.add(HITS_COLUMN_KEY);
    set.add(BYTES_COLUMN_KEY);
    for (const k of Object.keys(BUILTIN_COLUMNS)) set.add(k);
    return set;
  }, [schema]);

  // Group fields by the detail panel's sections so the picker mirrors
  // the expand-row layout. Anything in the schema that's NOT in any
  // declared section lands in a synthetic "Other" bucket.
  const sections = useMemo(() => {
    const result: { id: string; label: string; keys: string[] }[] = [];
    const classified = new Set<string>();
    for (const sec of DETAIL_SECTIONS) {
      const keys = sec.fields.filter((f) => availableKeys.has(f));
      keys.forEach((k) => classified.add(k));
      if (keys.length) result.push({ id: sec.id, label: sec.label, keys });
    }
    // Stuff the synthetic Hits / Bytes pseudo-columns into Statistics
    // (or a fresh bucket if Statistics isn't declared) so they show up
    // near `_hitcount` / `_byte` in the picker.
    const ensureStats = (): { id: string; label: string; keys: string[] } => {
      let stats = result.find((s) => s.id === "statistics");
      if (!stats) {
        stats = { id: "statistics", label: "Statistics", keys: [] };
        result.push(stats);
      }
      return stats;
    };
    for (const synth of [BYTES_COLUMN_KEY, HITS_COLUMN_KEY]) {
      if (availableKeys.has(synth) && !classified.has(synth)) {
        ensureStats().keys.unshift(synth);
        classified.add(synth);
      }
    }
    const other: string[] = [];
    for (const k of availableKeys) {
      if (!classified.has(k) && !SUPPRESSED_DETAIL_KEYS.has(k)) other.push(k);
    }
    other.sort();
    if (other.length) {
      result.push({ id: "other", label: "Other", keys: other });
    }
    return result;
  }, [availableKeys]);

  const toggle = (key: string) => {
    if (visibleSet.has(key)) {
      onChange(visibleColumns.filter((k) => k !== key));
    } else {
      onChange([...visibleColumns, key]);
    }
  };

  const resetDefaults = () => onChange([...DEFAULT_COLUMN_KEYS]);

  const q = search.trim().toLowerCase();

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-600/60 hover:text-cyan-300"
      >
        <span>Columns</span>
        <span className="rounded bg-slate-800 px-1.5 py-px font-mono text-[10px] text-slate-400">
          {visibleColumns.length}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-96 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/70 px-3 py-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields…"
              className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-600/60 focus:outline-none"
              autoFocus
            />
            <button
              type="button"
              onClick={resetDefaults}
              className="text-[10px] uppercase tracking-wide text-slate-500 transition hover:text-cyan-300"
              title="Reset to default column set"
            >
              Reset
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {sections.map((sec) => {
              const shown = q
                ? sec.keys.filter(
                    (k) =>
                      humanizeField(k).toLowerCase().includes(q) ||
                      k.toLowerCase().includes(q),
                  )
                : sec.keys;
              if (shown.length === 0) return null;
              return (
                <div key={sec.id}>
                  <div className="sticky top-0 border-b border-slate-800/80 bg-slate-950/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 backdrop-blur">
                    {sec.label}
                  </div>
                  {shown.map((key) => {
                    const checked = visibleSet.has(key);
                    const help = schema?.attr?.[key]?.help;
                    return (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1 text-[11px] transition hover:bg-slate-800/40"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(key)}
                          className="h-3 w-3 shrink-0 rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                        />
                        <span
                          className={`min-w-0 truncate ${
                            checked ? "text-slate-200" : "text-slate-500"
                          }`}
                        >
                          {humanizeField(key)}
                        </span>
                        {help && (
                          <span
                            className="ml-auto min-w-0 truncate text-[10px] italic text-slate-700"
                            title={help}
                          >
                            {help}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/70 px-3 py-1.5 text-[10px] text-slate-600">
            <span>{visibleColumns.length} visible</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="transition hover:text-cyan-300"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expand-row detail panel — renders every FMG field grouped into
// DETAIL_SECTIONS, tooltipped with schema.help, with toggles for default
// / empty fields so the operator can drop noise.
// ---------------------------------------------------------------------------

function PolicyDetailPanel({
  policy,
  schema,
  objectMap,
  hitcount,
}: {
  policy: PolicyRow;
  schema: PolicySchema | null;
  objectMap: PolicyObjectMap | null;
  hitcount: PolicyHitcount | undefined;
}) {
  // Default to showing everything — the whole point of the expand-row
  // is "see all fields". Operators who want to hide the 50+ fields at
  // default values can uncheck the toggle.
  const [showDefaults, setShowDefaults] = useState(true);
  const [search, setSearch] = useState("");

  // Overlay live hitcount data onto the underscore statistic keys so
  // the existing "Statistics" section renders real counters instead of
  // the zeros FMG reports in the raw policy payload. Epoch / byte
  // rendering is handled by PolicyFieldRow below.
  const mergedPolicy = useMemo<PolicyRow>(() => {
    if (!hitcount) return policy;
    return {
      ...policy,
      _hitcount: hitcount.hitcount,
      _pkts: hitcount.pkts,
      _byte: hitcount.byte,
      _sesscount: hitcount.sesscount,
      _first_hit: hitcount.first_hit || null,
      _last_hit: hitcount.last_hit || null,
      _first_session: hitcount.first_session || null,
      _last_session: hitcount.last_session || null,
    };
  }, [policy, hitcount]);

  const partitioned = useMemo(
    () => partitionPolicyFields(mergedPolicy),
    [mergedPolicy],
  );

  const q = search.trim().toLowerCase();

  // Count of fields that are at their schema default — useful UI badge
  // so the operator knows how much they're hiding.
  const defaultCount = useMemo(() => {
    if (!schema?.attr) return 0;
    let n = 0;
    for (const key of Object.keys(mergedPolicy)) {
      if (SUPPRESSED_DETAIL_KEYS.has(key)) continue;
      if (isSchemaDefault(mergedPolicy[key], schema.attr[key])) n++;
    }
    return n;
  }, [mergedPolicy, schema]);

  return (
    <div className="border-b border-slate-800 bg-slate-950/80 px-4 pb-4 pt-3">
      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter fields…"
          className="w-48 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/60 focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-1.5 select-none">
          <input
            type="checkbox"
            checked={showDefaults}
            onChange={(e) => setShowDefaults(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0 focus:ring-offset-0"
          />
          Show default values
          {defaultCount > 0 && (
            <span className="font-mono text-slate-600">
              ({defaultCount})
            </span>
          )}
        </label>
        {!schema && (
          <span className="text-amber-400/80">
            schema unavailable — values shown verbatim
          </span>
        )}
        <span className="ml-auto font-mono tabular-nums text-slate-600">
          {
            Object.keys(mergedPolicy).filter(
              (k) => !SUPPRESSED_DETAIL_KEYS.has(k),
            ).length
          }{" "}
          total fields
        </span>
      </div>

      {/* Sections — two-column masonry. Individual sections can opt into
          a full-width row via `lg:col-span-2`; General takes the first
          row to itself so Source and Destination land adjacent to each
          other in row 2 (operators pattern-match source → destination
          naturally, so keeping them on the same row matters). */}
      <div className="grid gap-4 lg:grid-cols-2">
        {DETAIL_SECTIONS.concat([
          { id: "other", label: "Other", fields: [] },
        ]).map((section) => {
          const keys = partitioned[section.id] ?? [];
          if (keys.length === 0) return null;
          const filteredKeys = keys.filter((k) => {
            const attr = schema?.attr?.[k];
            if (!showDefaults && isSchemaDefault(mergedPolicy[k], attr)) {
              return false;
            }
            if (q) {
              const label = humanizeField(k).toLowerCase();
              const val = formatSchemaValue(
                mergedPolicy[k],
                attr,
              ).toLowerCase();
              if (!label.includes(q) && !val.includes(q)) return false;
            }
            return true;
          });
          if (filteredKeys.length === 0) return null;
          const fullWidth =
            section.id === "general" || section.id === "statistics";
          return (
            <section
              key={section.id}
              className={`rounded-lg border border-slate-800/80 bg-slate-900/40 ${
                fullWidth ? "lg:col-span-2" : ""
              }`}
            >
              <header className="border-b border-slate-800/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {section.label}
                <span className="ml-2 font-mono text-slate-700">
                  {filteredKeys.length}
                </span>
              </header>
              <dl className="divide-y divide-slate-900/60">
                {filteredKeys.map((k) => (
                  <PolicyFieldRow
                    key={k}
                    fieldKey={k}
                    value={mergedPolicy[k]}
                    attr={schema?.attr?.[k]}
                    objectMap={objectMap}
                  />
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// Stats fields whose raw epoch / byte integers need humanising before
// display. These live in the "Statistics" DETAIL_SECTION and are
// populated from the live hitcount response.
const EPOCH_STAT_KEYS = new Set([
  "_first_hit",
  "_last_hit",
  "_first_session",
  "_last_session",
]);

function PolicyFieldRow({
  fieldKey,
  value,
  attr,
  objectMap,
}: {
  fieldKey: string;
  value: unknown;
  attr: PolicySchemaAttr | undefined;
  objectMap: PolicyObjectMap | null;
}) {
  const label = humanizeField(fieldKey);
  const isDefault = isSchemaDefault(value, attr);
  const refObjectField =
    fieldKey === "srcaddr" ||
    fieldKey === "dstaddr" ||
    fieldKey === "service";

  // Datasrc (reference) fields that map to the object map get hover
  // popovers for the first few items; the rest are inlined as text.
  let valueNode: ReactNode;
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    valueNode = <span className="text-slate-700">—</span>;
  } else if (refObjectField) {
    const items = renderListValue(value);
    valueNode = (
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {items.map((n) => (
          <span key={n}>
            <ObjectRef field={fieldKey} name={n} objectMap={objectMap} />
          </span>
        ))}
      </div>
    );
  } else if (fieldKey === "_byte" && typeof value === "number") {
    valueNode = (
      <span
        className="break-words font-mono tabular-nums text-slate-200"
        title={`${value.toLocaleString()} bytes`}
      >
        {formatBytes(value)}
      </span>
    );
  } else if (
    EPOCH_STAT_KEYS.has(fieldKey) &&
    (typeof value === "number" || value == null)
  ) {
    const sec = typeof value === "number" ? value : 0;
    valueNode = (
      <span
        className="break-words font-mono tabular-nums text-slate-200"
        title={sec ? String(sec) : "never hit"}
      >
        {formatEpoch(sec)}
      </span>
    );
  } else if (
    (fieldKey === "_hitcount" ||
      fieldKey === "_pkts" ||
      fieldKey === "_sesscount") &&
    typeof value === "number"
  ) {
    valueNode = (
      <span className="break-words font-mono tabular-nums text-slate-200">
        {value.toLocaleString()}
      </span>
    );
  } else if (Array.isArray(value)) {
    const items = renderListValue(value);
    valueNode = (
      <span className="break-words text-slate-300">
        {items.join(", ") || "—"}
      </span>
    );
  } else {
    const text = formatSchemaValue(value, attr);
    valueNode = <span className="break-words text-slate-200">{text}</span>;
  }

  return (
    <div
      className={`grid items-start gap-2 px-3 py-1.5 text-[11px] ${
        isDefault ? "opacity-60" : ""
      }`}
      style={{ gridTemplateColumns: "minmax(7rem, 11rem) 1fr" }}
    >
      <dt
        className="min-w-0 truncate font-mono text-slate-500"
        title={attr?.help || fieldKey}
      >
        {label}
        {isDefault && (
          <span className="ml-1 text-[9px] uppercase tracking-wide text-slate-700">
            default
          </span>
        )}
      </dt>
      <dd className="min-w-0">{valueNode}</dd>
    </div>
  );
}

function ObjectRef({
  field,
  name,
  objectMap,
}: {
  field: string;
  name: string;
  objectMap: PolicyObjectMap | null;
}) {
  if (!objectMap) return <span>{name}</span>;

  if (field === "srcaddr" || field === "dstaddr") {
    const addr = objectMap.addresses[name];
    const grp = objectMap.addrgrps[name];
    if (addr) {
      return (
        <HoverPopover trigger={name}>
          <AddressDetail addr={addr} />
        </HoverPopover>
      );
    }
    if (grp) {
      return (
        <HoverPopover trigger={name}>
          <AddrGrpDetail
            grp={grp}
            addresses={objectMap.addresses}
            addrgrps={objectMap.addrgrps}
          />
        </HoverPopover>
      );
    }
  }

  if (field === "service") {
    const svc = objectMap.services[name];
    const grp = objectMap.service_groups[name];
    if (svc) {
      return (
        <HoverPopover trigger={name}>
          <ServiceDetail svc={svc} />
        </HoverPopover>
      );
    }
    if (grp) {
      return (
        <HoverPopover trigger={name}>
          <ServiceGroupDetail
            grp={grp}
            services={objectMap.services}
            serviceGroups={objectMap.service_groups}
          />
        </HoverPopover>
      );
    }
  }

  return <span className="text-slate-400">{name}</span>;
}
