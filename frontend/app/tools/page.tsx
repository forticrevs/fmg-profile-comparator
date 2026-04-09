"use client";

import Link from "next/link";

export default function ToolsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div>
          <Link
            href="/"
            className="text-xs text-slate-500 hover:text-cyan-400 transition"
          >
            ← Back to dashboard
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-white">Tools</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Vendor config converters, parsers, and migration utilities. This is
            a placeholder section — existing scripts will be ported in here over
            time.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-300">
            Coming soon
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PlaceholderCard
              title="Palo Alto → CSV"
              description="Parse a Palo Alto firewall config (XML / set commands) into per-object CSV files: rules, addresses, services, profiles."
            />
            <PlaceholderCard
              title="Palo Alto → Excel"
              description="Same parser, multi-sheet Excel workbook output with one tab per object class for easier review and triage."
            />
            <PlaceholderCard
              title="Palo Alto → SQLite"
              description="Normalize a PAN config into a queryable SQLite database so you can join across rules, address groups, and zones."
            />
            <PlaceholderCard
              title="More vendors"
              description="Cisco ASA / FTD, Check Point, and other vendor parsers will live here as the tooling is ported in."
            />
          </div>
        </section>

        <p className="text-[11px] text-slate-700">
          Nothing wired up yet — drop a tool spec or paste an existing script to
          get it added.
        </p>
      </div>
    </main>
  );
}

function PlaceholderCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      <p className="mt-2 text-xs text-slate-500 leading-relaxed">
        {description}
      </p>
      <span className="mt-3 inline-block text-[10px] uppercase tracking-wide text-slate-700">
        Placeholder
      </span>
    </div>
  );
}
