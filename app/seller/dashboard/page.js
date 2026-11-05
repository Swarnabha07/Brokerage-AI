import Link from "next/link";
import { Package, Plus, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/features/dashboard/PageHeader";
import { StatCard } from "@/components/features/dashboard/StatCard";
import { DealCard } from "@/components/features/dashboard/DealCard";
import { TransactionsTable } from "@/components/features/dashboard/TransactionsTable";
import { ListingCard } from "@/components/features/listings/ListingCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { GlassCard } from "@/components/shared/GlassCard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSellerDashboard } from "@/lib/api/deals";
import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/auth/server";
import { formatCurrency, formatDate } from "@/lib/format";

export const metadata = { title: "Seller dashboard" };

export default async function SellerDashboardPage() {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");
  if (user.role !== "seller") redirect("/buyer/dashboard");
  const { viewer, stats, listings, activeDeals, payouts } =
    await getSellerDashboard(user);

  const columns = [
    { key: "title", header: "Item" },
    {
      key: "date",
      header: "Date",
      render: (r) => (r.payoutStatus === "released" ? formatDate(r.date) : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.payoutStatus === "released" ? (
          <Badge variant="success">Released (app ledger)</Badge>
        ) : (
          <Badge variant="warning">Pending</Badge>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => formatCurrency(r.amounts.sellerAmount),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        title="Seller dashboard"
        description={
          <>
            {`Signed in as ${viewer.name}. `}

          </>
        }
        action={
          <Link href="/seller/listings/new" className={buttonVariants({})}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New listing
          </Link>
        }
      />

      <div className="mb-10 grid gap-5 sm:grid-cols-3">
        <StatCard
          icon={Package}
          label="Active listings"
          value={stats.activeListings}
          currency={false}
        />
        <StatCard
          icon={Users}
          label="Open deals"
          value={stats.openDeals}
          currency={false}
          delay={0.08}
        />
        <StatCard
          icon={Wallet}
          label="Pending payout"
          value={stats.pendingPayout}
          delay={0.16}
          note="App-ledger amount; no PayPal payout yet"
        />
      </div>

      <section aria-labelledby="your-listings" className="mb-10">
        <h2
          id="your-listings"
          className="mb-5 font-display text-lg font-semibold"
        >
          Your listings
        </h2>
        {listings.length === 0 ? (
          <GlassCard hover={false}>
            <EmptyState
              title="No active listings"
              description="Create a listing to see it here."
            />
          </GlassCard>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {listings.map((l, i) => (
              <ListingCard
                key={l.id}
                listing={{ ...l, sellerName: viewer.name }}
                delay={i * 0.06}
                footnote={`${l.openDeals} open deal${l.openDeals === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="open-deals" className="mb-10">
        <h2 id="open-deals" className="mb-5 font-display text-lg font-semibold">
          Open deals
        </h2>
        {activeDeals.length === 0 ? (
          <GlassCard hover={false}>
            <EmptyState title="No open deals" />
          </GlassCard>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {activeDeals.map((deal, i) => (
              <DealCard
                key={deal.id}
                deal={deal}
                perspective="seller"
                delay={i * 0.06}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="payouts">
        <h2 id="payouts" className="mb-5 font-display text-lg font-semibold">
          Payouts
        </h2>
        <TransactionsTable
          caption="Payouts"
          columns={columns}
          rows={payouts}
          emptyTitle="No payouts yet"
        />
      </section>
    </div>
  );
}
