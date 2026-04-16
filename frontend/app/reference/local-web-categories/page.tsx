import ReferenceExplorer from "@/components/ReferenceExplorer";

export default function LocalWebCategoriesPage() {
  return (
    <ReferenceExplorer
      kind="local-web-categories"
      title="Local Web Categories"
      description="Operator-defined custom webfilter categories for the active ADOM. These are the category buckets Web Rating Overrides pin individual URLs into, on top of FortiGuard's built-in category set."
    />
  );
}
