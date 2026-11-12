
import Link from "next/link";
import { Plus } from "lucide-react";
import { connection } from "next/server";

import { PageHeader } from "@/components/features/dashboard/PageHeader";
import { ListingCard } from "@/components/features/listings/ListingCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { GlassCard } from "@/components/shared/GlassCard";
import { buttonVariants } from "@/components/ui/button";

import { getActiveListings } from "@/lib/api/listings";
import { getVerifiedUser } from "@/lib/auth/server";

export const metadata = { title: "Listings" };

export default async function ListingsPage() {
  await connection();

  const [listings, user] = await Promise.all([
    getActiveListings(),
    getVerifiedUser(),
  ]);

  // Only sellers can create listings.
  const canCreateListing = user?.role === "seller";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        title="Sample listings"
        description="Seeded demo listings. Opening one lets you explore a sample deal; nothing here is a real offer."
        action={
          canCreateListing ? (
            <Link
              href="/seller/listings/new"
              className={buttonVariants({ variant: "outline" })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create a listing
            </Link>
          ) : null
        }
      />

      {listings.length === 0 ? (
        <GlassCard hover={false}>
          <EmptyState
            title="No listings yet"
            description={
              canCreateListing
                ? "Create a listing to see it here."
                : "There are currently no available listings. Please check back later."
            }
          />
        </GlassCard>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing, i) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              delay={i * 0.05}
            />
          ))}
        </div>
      )}
    </div>
  );
}
