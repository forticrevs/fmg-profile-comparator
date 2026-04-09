import ReferenceExplorer from "@/components/ReferenceExplorer";

export default function DlpSensorsPage() {
  return (
    <ReferenceExplorer
      kind="dlp-sensors"
      title="DLP Sensors"
      description="FortiGuard DLP sensor catalog. Each sensor groups multiple dictionaries to form a detection policy. Use search and column filters to explore sensor definitions and their associated dictionary entries."
    />
  );
}
