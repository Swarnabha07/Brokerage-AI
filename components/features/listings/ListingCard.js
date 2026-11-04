import Link from "next/link";
import { ArrowUpRight, Store } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";

export function ListingCard({ listing, delay = 0, footnote }) {
  return (
    <GlassCard delay={delay}>
      <Link
        href={`/listings/${listing.id}`}
        className="group flex h-full flex-col rounded-2xl p-5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-mid/60"
      >
        <div className="mb-4 flex items-start justify-between">
          <Badge>Sample listing</Badge>
          <ArrowUpRight
            className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        </div>
        <h2 className="mb-2 font-display text-base font-semibold leading-snug">
          {listing.title}
        </h2>
        <p className="mb-4 line-clamp-3 text-sm text-muted-foreground">
          {listing.description}
        </p>
        <div className="mt-auto flex items-end justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Store className="h-3.5 w-3.5" aria-hidden="true" />{" "}
            {listing.sellerName}
          </span>
          <span className="font-display font-tabular text-xl font-semibold">
            {formatCurrency(listing.price)}
          </span>
        </div>
        {footnote && (
          <p className="mt-3 text-xs text-muted-foreground">{footnote}</p>
        )}
      </Link>
    </GlassCard>
  );
}
