import Link from "next/link";
import { Clock, Search, ShoppingBag, Wallet } from "lucide-react";
import { PageHeader } from "@/components/features/dashboard/PageHeader";
import { StatCard } from "@/components/features/dashboard/StatCard";
import { DealCard } from "@/components/features/dashboard/DealCard";
import { TransactionsTable } from "@/components/features/dashboard/TransactionsTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { GlassCard } from "@/components/shared/GlassCard";
import { buttonVariants } from "@/components/ui/button";
import { getBuyerDashboard } from "@/lib/api/deals";
import { formatCurrency, formatDate } from "@/lib/format";
import { FEE_RATE_LABEL } from "@/lib/fees";

export const metadata = { title: "Buyer dashboard" };

export default async function BuyerDashboardPage() {
  const { viewer, stats, activeDeals, history } = await getBuyerDashboard();

  const columns = [
    { key: "title", header: "Item" },
    { key: "date", header: "Date", render: (r) => formatDate(r.date) },
    {
      key: "fee",
      header: `Platform fee (${FEE_RATE_LABEL}, demo)`,
      align: "right",
      render: (r) => formatCurrency(r.amounts.fee),
    },
    {
      key: "total",
      header: "Amount paid",
      align: "right",
      render: (r) => formatCurrency(r.amounts.buyerTotal),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        title="Buyer dashboard"
        description={
          <>
            Sample data for {viewer.name}.{" "}
            <Link
              href="/seller/dashboard"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Switch to the seller view
            </Link>
          </>
        }
        action={
          <Link href="/listings" className={buttonVariants({})}>
            <Search className="h-4 w-4" aria-hidden="true" /> Browse listings
          </Link>
        }
      />

      <div className="mb-10 grid gap-5 sm:grid-cols-3">
        <StatCard
          icon={ShoppingBag}
          label="Active deals"
          value={stats.activeDeals}
          currency={false}
        />
        <StatCard
          icon={Clock}
          label="In return window"
          value={stats.inReturnWindowTotal}
          delay={0.08}
        />
        <StatCard
          icon={Wallet}
          label="Spent on completed deals"
          value={stats.completedSpend}
          delay={0.16}
        />
      </div>

      <section aria-labelledby="active-deals" className="mb-10">
        <h2
          id="active-deals"
          className="mb-5 font-display text-lg font-semibold"
        >
          Active deals
        </h2>
        {activeDeals.length === 0 ? (
          <GlassCard hover={false}>
            <EmptyState
              title="No active deals"
              description="Browse listings to start a sample deal."
            />
          </GlassCard>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {activeDeals.map((deal, i) => (
              <DealCard
                key={deal.id}
                deal={deal}
                perspective="buyer"
                delay={i * 0.06}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="history">
        <h2 id="history" className="mb-5 font-display text-lg font-semibold">
          Order history
        </h2>
        <TransactionsTable
          caption="Completed sample orders"
          columns={columns}
          rows={history}
          emptyTitle="No completed orders yet"
        />
      </section>
    </div>
  );
}
