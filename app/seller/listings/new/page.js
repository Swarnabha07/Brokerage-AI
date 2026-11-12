import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { CreateListingForm } from "@/components/features/listings/CreateListingForm";
import { getVerifiedUser } from "@/lib/auth/server";

export const metadata = { title: "New listing" };

function LoadingFallback() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="h-4 w-80 rounded bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
      </div>
    </div>
  );
}

export default function NewListingPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SellerListingContent />
    </Suspense>
  );
}

async function SellerListingContent() {
  await connection();

  const user = await getVerifiedUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "seller") {
    redirect("/buyer/dashboard");
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/seller/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to seller dashboard
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
