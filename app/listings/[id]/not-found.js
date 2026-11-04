import { NotFoundView } from "@/components/shared/NotFoundView";

export default function NotFound() {
  return (
    <NotFoundView
      title="Listing not found"
      href="/listings"
      linkLabel="Back to listings"
    />
  );
}
