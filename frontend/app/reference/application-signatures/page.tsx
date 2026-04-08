import ReferenceExplorer from "@/components/ReferenceExplorer";

export default function ApplicationSignaturesPage() {
  return (
    <ReferenceExplorer
      kind="application-signatures"
      title="Application Signatures"
      description="Full FortiManager application signature catalog from the documented global application endpoint. Use global search and per-column filters to find IDs, names, categories, vendors, protocols, and other signature metadata."
    />
  );
}
