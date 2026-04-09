import ReferenceExplorer from "@/components/ReferenceExplorer";

export default function DlpDictionariesPage() {
  return (
    <ReferenceExplorer
      kind="dlp-dictionaries"
      title="DLP Dictionaries"
      description="FortiGuard DLP dictionary catalog. Each dictionary contains keyword and regex pattern entries used by DLP sensors to detect sensitive data. Browse patterns, match types, and comments."
    />
  );
}
