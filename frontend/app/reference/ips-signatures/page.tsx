import ReferenceExplorer from "@/components/ReferenceExplorer";

export default function IpsSignaturesPage() {
  return (
    <ReferenceExplorer
      kind="ips-signatures"
      title="IPS Signatures"
      description="Full FortiManager IPS rule catalog for the active ADOM. Use this page as a searchable reference while comparing IPS profiles and resolving rule IDs back to human-readable signatures."
    />
  );
}
