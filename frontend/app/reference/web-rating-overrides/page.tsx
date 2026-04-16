import ReferenceExplorer from "@/components/ReferenceExplorer";

export default function WebRatingOverridesPage() {
  return (
    <ReferenceExplorer
      kind="web-rating-overrides"
      title="Web Rating Overrides"
      description="URL-to-category rating overrides for the active ADOM. Each entry pins a URL to one or more FortiGuard or local categories; `rating_display` shows the resolved names, `rating` keeps the raw IDs."
    />
  );
}
