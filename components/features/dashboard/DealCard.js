import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatCurrency } from "@/lib/format";

/**
 * Clickable deal summary. `perspective` decides who the counterparty is and
 * which amount is highlighted (buyer sees what they pay, seller sees their amount).
 */
export function DealCard({ deal, perspective, delay = 0 }) {
  const counterparty = perspective === "buyer" ? deal.seller : deal.buyer;
  const amount =
    perspective === "buyer" ? deal.amounts.buyerTotal : deal.amounts.sellerAmount;

  let hint = "View deal →";
  if (perspective === "seller" && deal.status === "agreed") hint = "Review & approve terms →";
  if (perspective === "seller" && deal.status === "invoiced") hint = "Awaiting buyer payment";
  if (perspective === "buyer" && deal.status === "agreed") hint = "Awaiting seller approval";
  if (perspective === "buyer" && deal.status === "invoiced") hint = "Review invoice →";

  return (
    <GlassCard delay={delay}>
      <Link
        href={`/deal/${deal.id}`}
        className="group block rounded-2xl p-5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-mid/60"
      >
        <div className="mb-4 flex items-start justify-between">
          <StatusBadge status={deal.status} />
          <ArrowUpRight
            className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        </div>
        <h3 className="mb-1 font-display text-sm font-semibold leading-snug">{deal.title}</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          {perspective === "buyer" ? "Seller" : "Buyer"} · {counterparty.name}
        </p>
        <div className="flex items-end justify-between">
          <span className="font-display font-tabular text-xl font-semibold">
            {formatCurrency(amount)}
          </span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
      </Link>
    </GlassCard>
  );
}