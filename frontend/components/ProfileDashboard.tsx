"use client";

import Link from "next/link";

import { ProfileType } from "@/lib/api";

interface Props {
  types: ProfileType[];
  onSelectType: (type: ProfileType) => void;
}

const TYPE_META: Record<
  string,
  { icon: string; color: string; description: string; gradient: string }
> = {
  application: {
    icon: "🛡",
    color: "cyan",
    description:
      "Category-based application blocking and monitoring with per-app overrides and protocol enforcement.",
    gradient: "from-cyan-600/20 to-cyan-900/10",
  },
  webfilter: {
    icon: "🌐",
    color: "blue",
    description:
      "URL filtering, FortiGuard category enforcement, Safe Search, and web content inspection policies.",
    gradient: "from-blue-600/20 to-blue-900/10",
  },
  ips: {
    icon: "🔍",
    color: "amber",
    description:
      "Signature and filter-based intrusion prevention with CVE targeting, quarantine, and packet logging.",
    gradient: "from-amber-600/20 to-amber-900/10",
  },
  sdwan: {
    icon: "🔀",
    color: "emerald",
    description:
      "SD-WAN template comparison: zones, interfaces, routing rules, SLA health checks, and performance targets.",
    gradient: "from-emerald-600/20 to-emerald-900/10",
  },
  dlp: {
    icon: "🔒",
    color: "purple",
    description:
      "Data leak prevention profile comparison: sensors, filters, dictionaries, and fingerprint settings.",
    gradient: "from-purple-600/20 to-purple-900/10",
  },
};

const colorMap: Record<string, string> = {
  cyan: "border-cyan-800 hover:border-cyan-600 hover:shadow-cyan-900/20",
  blue: "border-blue-800 hover:border-blue-600 hover:shadow-blue-900/20",
  amber: "border-amber-800 hover:border-amber-600 hover:shadow-amber-900/20",
  emerald:
    "border-emerald-800 hover:border-emerald-600 hover:shadow-emerald-900/20",
  purple:
    "border-purple-800 hover:border-purple-600 hover:shadow-purple-900/20",
};

const iconBg: Record<string, string> = {
  cyan: "bg-cyan-900/50",
  blue: "bg-blue-900/50",
  amber: "bg-amber-900/50",
  emerald: "bg-emerald-900/50",
  purple: "bg-purple-900/50",
};

export default function ProfileDashboard({ types, onSelectType }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">
          Configuration Drift Analysis
        </h2>
        <p className="text-slate-500 text-sm max-w-2xl">
          Select a profile type to compare configurations across cloned
          profiles. Identify fields that have diverged and pin the ones that
          must stay consistent.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {types.map((type) => {
          const meta = TYPE_META[type.id] || {
            icon: "📄",
            color: "slate",
            description: "",
            gradient: "from-slate-600/20 to-slate-900/10",
          };
          return (
            <button
              key={type.id}
              onClick={() => onSelectType(type)}
              className={`group text-left bg-gradient-to-br ${meta.gradient} border ${
                colorMap[meta.color] || ""
              } rounded-xl p-5 transition-all duration-200 hover:shadow-lg`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-12 h-12 rounded-lg ${
                    iconBg[meta.color] || "bg-slate-800"
                  } flex items-center justify-center text-2xl shrink-0`}
                >
                  {meta.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-white group-hover:text-cyan-300 transition">
                    {type.label}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {meta.description}
                  </p>
                  <span className="inline-block mt-3 text-xs text-slate-600 group-hover:text-slate-400 transition">
                    Select profiles to compare →
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Reference Catalogs</h3>
          <p className="text-sm text-slate-500">
            Search the application, IPS, DLP, internet-service, and ADOM reference data that drive profile entries.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/reference/application-signatures"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-cyan-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">Application Signatures</h4>
            <p className="mt-2 text-sm text-slate-500">
              Browse every application signature returned by FMG, with global search and column filters.
            </p>
          </Link>

          <Link
            href="/reference/ips-signatures"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-cyan-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">IPS Signatures</h4>
            <p className="mt-2 text-sm text-slate-500">
              Inspect the FortiManager IPS rule catalog and use it as a reference during comparison work.
            </p>
          </Link>

          <Link
            href="/reference/dlp-sensors"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-purple-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">DLP Sensors</h4>
            <p className="mt-2 text-sm text-slate-500">
              Browse every DLP sensor configured in FMG, including filter rules and actions.
            </p>
          </Link>

          <Link
            href="/reference/dlp-dictionaries"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-purple-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">DLP Dictionaries</h4>
            <p className="mt-2 text-sm text-slate-500">
              Inspect DLP dictionary definitions and their pattern entries used by sensor rules.
            </p>
          </Link>

          <Link
            href="/reference/dlp-data-types"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-purple-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">DLP Data Types</h4>
            <p className="mt-2 text-sm text-slate-500">
              Reference the predefined DLP data types FortiManager exposes for sensor matching.
            </p>
          </Link>

          <Link
            href="/reference/internet-services"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-emerald-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">Internet Services</h4>
            <p className="mt-2 text-sm text-slate-500">
              Browse FortiGuard&apos;s ISDB catalog of SaaS FQDN groups.
              Lookups proxy through a managed FortiGate of your choice.
            </p>
          </Link>

          <Link
            href="/reference/metadata-variables"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-emerald-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">Metadata Variables</h4>
            <p className="mt-2 text-sm text-slate-500">
              Review FortiManager device metadata values as a searchable
              device-by-variable matrix for the active ADOM.
            </p>
          </Link>

          <Link
            href="/reference/local-web-categories"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-cyan-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">Local Web Categories</h4>
            <p className="mt-2 text-sm text-slate-500">
              Operator-defined custom webfilter category buckets on top
              of FortiGuard&apos;s built-in set, with audit trail.
            </p>
          </Link>

          <Link
            href="/reference/web-rating-overrides"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-cyan-700 hover:bg-slate-900"
          >
            <h4 className="text-base font-semibold text-white">Web Rating Overrides</h4>
            <p className="mt-2 text-sm text-slate-500">
              URL-to-category rating overrides for the active ADOM.
              Rating IDs auto-resolved to human-readable names.
            </p>
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Tools</h3>
          <p className="text-sm text-slate-500">
            Vendor config converters, parsers, and migration utilities — Palo Alto and others to be added here.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/tools"
            className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5 transition-all duration-200 hover:border-slate-600 hover:bg-slate-900/60"
          >
            <h4 className="text-base font-semibold text-slate-300">All Tools →</h4>
            <p className="mt-2 text-sm text-slate-500">
              Placeholder for upcoming tooling — Palo Alto config → CSV / Excel / SQLite parsers and other vendor migration helpers will land here.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
