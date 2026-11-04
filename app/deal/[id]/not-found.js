import { NotFoundView } from "@/components/shared/NotFoundView";

export default function NotFound() {
  return (
    <NotFoundView
      title="Deal not found"
      href="/buyer/dashboard"
      linkLabel="Back to buyer dashboard"
    />
  );
}
