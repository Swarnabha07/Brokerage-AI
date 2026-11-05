import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import { NegotiationModePicker } from "@/components/features/listings/NegotiationModePicker";
import { GlassCard } from "@/components/shared/GlassCard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getAllListingIds, getListingById } from "@/lib/api/listings";
import { formatCurrency } from "@/lib/format";
import { FEE_RATE_LABEL } from "@/lib/fees";

export const metadata = { title: "Listing" };

export async function generateStaticParams() {
  const ids = await getAllListingIds();
  return ids.map((id) => ({ id }));
}

export default async function ListingDetailPage({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) notFound();

  const { amounts } = listing;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/listings"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to listings
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <GlassCard hover={false} className="space-y-5 p-8">
          <div className="flex flex-wrap gap-2">
            <Badge>{listing.sampleDealId ? "Sample listing" : "Live listing"}</Badge>
            {!listing.active && (
              <Badge variant="warning">Sold in sample data</Badge>
            )}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {listing.title}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Store className="h-4 w-4" aria-hidden="true" /> Sold by{" "}
            {listing.sellerName}
          </p>
          <p className="leading-relaxed text-muted-foreground">
            {listing.description}
          </p>

          <div className="border-t border-border pt-6">
            {listing.active ? (
              <NegotiationModePicker listingId={listing.id} dealId={listing.sampleDealId} />
            ) : (
              <Link
                href={`/deal/${listing.sampleDealId}`}
                className={buttonVariants({ variant: "outline" })}
              >
                View the completed sample deal
              </Link>
            )}
          </div>
        </GlassCard>

        <GlassCard hover={false} className="h-fit p-6">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            If agreed at the asking price
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Asking price</dt>
              <dd className="font-tabular">{formatCurrency(amounts.price)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Platform fee ({FEE_RATE_LABEL})
              </dt>
              <dd className="font-tabular">+{formatCurrency(amounts.fee)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-medium">
              <dt>Buyer pays</dt>
              <dd className="font-tabular">
                {formatCurrency(amounts.buyerTotal)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Seller receives</dt>
              <dd className="font-tabular">
                {formatCurrency(amounts.sellerAmount)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            The fee is a provisional demo assumption, not final policy.
            Negotiated prices may differ.
          </p>
        </GlassCard>
      </div>
    </div>
  );
}
