import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/features/dashboard/PageHeader";
import { ListingCard } from "@/components/features/listings/ListingCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { GlassCard } from "@/components/shared/GlassCard";
import { buttonVariants } from "@/components/ui/button";
import { getActiveListings } from "@/lib/api/listings";

export const metadata = { title: "Listings" };

export default async function ListingsPage() {
  const listings = await getActiveListings();

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        title="Sample listings"
        description="Seeded demo listings. Opening one lets you explore a sample deal; nothing here is a real offer."
        action={
          <Link
            href="/seller/listings/new"
            className={buttonVariants({ variant: "outline" })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Create a listing
          </Link>
        }
      />
      {listings.length === 0 ? (
        <GlassCard hover={false}>
          <EmptyState
            title="No listings yet"
            description="Create a listing to see it here."
          />
        </GlassCard>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing, i) => (
            <ListingCard key={listing.id} listing={listing} delay={i * 0.05} />
          ))}
        </div>
      )}
    </div>
  );
}
