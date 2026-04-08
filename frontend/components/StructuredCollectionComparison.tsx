"use client";

interface Props {
  collectionKey: string;
  profileNames: string[];
  rawProfiles: Record<string, Record<string, unknown>>;
}

type CollectionEntry = Record<string, unknown>;
type ResolvedValue = {
  raw: unknown;
  display: string;
};

const HIDDEN_ENTRY_KEYS = new Set(["oid", "obj seq", "last-modified"]);
const ENTRY_KEY_PRIORITY = [
  "action",
  "status",
  "severity",
  "location",
  "protocol",
  "application",
  "rule",
  "cve",
  "default-action",
  "default-status",
  "log",
  "log-attack-context",
  "log-packet",
  "quarantine",
  "quarantine-expiry",
  "rate-mode",
  "rate-count",
  "rate-duration",
];

function humanizeKey(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isResolvedValue(value: unknown): value is ResolvedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "raw" in value &&
    "display" in value
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (isResolvedValue(value)) return value.display;
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((item) => formatValue(item)).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !HIDDEN_ENTRY_KEYS.has(key)
    );
    if (entries.length === 0) return "—";
    return entries
      .map(([key, item]) => `${humanizeKey(key)}: ${formatValue(item)}`)
      .join(" | ");
  }
  return String(value);
}

function isObjectCollection(value: unknown): value is CollectionEntry[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "object" && item !== null)
  );
}

function getCollectionEntries(
  rawProfiles: Record<string, Record<string, unknown>>,
  profileName: string,
  collectionKey: string
): CollectionEntry[] {
  const value = rawProfiles[profileName]?.[collectionKey];
  return isObjectCollection(value) ? value : [];
}

function summarizeEntry(entry: CollectionEntry, index: number): string {
  const id = typeof entry.id === "number" || typeof entry.id === "string"
    ? `Entry ${entry.id}`
    : `Entry ${index + 1}`;

  const tokens: string[] = [];
  const append = (label: string, value: unknown) => {
    const text = formatValue(value);
    if (text !== "—" && text !== "all") {
      tokens.push(`${label} ${text}`);
    }
  };

  append("Rule", entry.rule);
  append("CVE", entry.cve);
  append("Severity", entry.severity);
  append("Location", entry.location);
  append("Protocol", entry.protocol);
  append("App", entry.application);

  return tokens.length > 0 ? `${id} · ${tokens.slice(0, 2).join(" · ")}` : id;
}

function sortEntryKeys(keys: string[]): string[] {
  return [...keys].sort((left, right) => {
    const leftIndex = ENTRY_KEY_PRIORITY.indexOf(left);
    const rightIndex = ENTRY_KEY_PRIORITY.indexOf(right);

    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }

    return left.localeCompare(right);
  });
}

function EntryCard({
  entry,
  index,
}: {
  entry: CollectionEntry;
  index: number;
}) {
  const keys = sortEntryKeys(
    Object.keys(entry).filter((key) => !HIDDEN_ENTRY_KEYS.has(key))
  );

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950/80 shadow-sm shadow-black/20">
      <header className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-slate-100">
              {summarizeEntry(entry, index)}
            </h4>
            <p className="mt-1 text-[11px] text-slate-500">
              {typeof entry.id === "number" || typeof entry.id === "string"
                ? `FMG entry ID ${entry.id}`
                : `Position ${index + 1}`}
            </p>
          </div>
          {typeof entry.status === "string" && (
            <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-300">
              {String(entry.status)}
            </span>
          )}
        </div>
      </header>

      <div className="divide-y divide-slate-900">
        {keys.map((key) => (
          <div key={key} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-4 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {humanizeKey(key)}
            </div>
            <div className="text-sm text-slate-200 break-words">
              {formatValue(entry[key])}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function StructuredCollectionComparison({
  collectionKey,
  profileNames,
  rawProfiles,
}: Props) {
  const label = humanizeKey(collectionKey);
  const totalEntries = profileNames.reduce(
    (count, name) => count + getCollectionEntries(rawProfiles, name, collectionKey).length,
    0
  );

  if (totalEntries === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-white">{label}</h3>
          <p className="text-sm text-slate-500">
            Compare each profile&apos;s {collectionKey} collection side by side using the
            verbose FMG payload.
          </p>
        </div>
      </div>

      <div className="pb-1">
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${profileNames.length}, minmax(0, 1fr))`,
          }}
        >
          {profileNames.map((name) => {
            const entries = getCollectionEntries(rawProfiles, name, collectionKey);

            return (
              <div
                key={name}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
              >
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="min-w-0">
                    <h4 className="truncate font-mono text-sm text-slate-100" title={name}>
                      {name}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {entries.length} {collectionKey}
                    </p>
                  </div>
                </div>

                {entries.length > 0 ? (
                  <div className="space-y-3">
                    {entries.map((entry, index) => (
                      <EntryCard
                        key={`${name}-${collectionKey}-${index}`}
                        entry={entry}
                        index={index}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 px-4 py-6 text-center text-sm text-slate-500">
                    No {collectionKey} found for this profile.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
