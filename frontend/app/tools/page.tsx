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
            Vendor config converters, parsers, and migration utilities.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-300">
            Palo Alto → Fortinet
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/tools/pan-xml"
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 hover:border-cyan-500/40 hover:bg-cyan-500/5 transition group"
            >
              <h3 className="text-sm font-semibold text-slate-200 group-hover:text-cyan-300">
                PAN XML Extraction
              </h3>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                Upload a Palo Alto <code>running-config.xml</code> and run the
                extractors you need: security rules, profile groups,
                application groups, custom URL categories, URL filter
                profiles, SSL decryption rules, and wildcard address objects
                converted to FortiGate CLI.
              </p>
              <span className="mt-3 inline-block text-[10px] uppercase tracking-wide text-cyan-500">
                Open tool →
              </span>
            </Link>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-300">Coming soon</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PlaceholderCard
              title="PAN config diff"
              description="Compare two extracted PAN configs side-by-side — highlight rule, profile, and app-group changes across a snapshot window."
            />
            <PlaceholderCard
              title="More vendors"
              description="Cisco ASA / FTD, Check Point, and other vendor parsers will live here as the tooling is ported in."
            />
          </div>
        </section>
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
