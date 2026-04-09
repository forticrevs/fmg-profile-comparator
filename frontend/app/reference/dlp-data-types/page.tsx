import ReferenceExplorer from "@/components/ReferenceExplorer";

export default function DlpDataTypesPage() {
  return (
    <ReferenceExplorer
      kind="dlp-data-types"
      title="DLP Data Types"
      description="FortiGuard DLP data-type catalog. Data types define regex patterns and proximity rules for detecting structured sensitive data like social insurance numbers, IBANs, and other regulated identifiers."
    />
  );
}
