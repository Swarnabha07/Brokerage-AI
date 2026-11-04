import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateListingForm } from "@/components/features/listings/CreateListingForm";

export const metadata = { title: "New listing" };

export default function NewListingPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/seller/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to seller
        dashboard
      </Link>
      <h1 className="mb-1 font-display text-3xl font-semibold tracking-tight">
        Create a listing
      </h1>
      <p className="mb-8 text-muted-foreground">
        Demo only: you can preview a listing, but it is not saved or published.
      </p>
      <CreateListingForm />
    </div>
  );
}
