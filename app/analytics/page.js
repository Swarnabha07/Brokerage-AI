import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, BarChart3, CircleDollarSign, Clock3, PackageCheck, Wallet } from "lucide-react";
import { getVerifiedUser } from "@/lib/auth/server";
import { getAnalyticsForUser } from "@/lib/analytics/data";
import { formatCurrency } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AgAnalyticsStudio } from "@/components/features/analytics/AgAnalyticsStudio";

export const metadata = { title: "Transaction intelligence" };

function Metric({ label, value, icon: Icon, detail }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-surface/75 p-5 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand-mid"><Icon size={18} aria-hidden="true" /></span>
      </div>
    </div>
  );
}

export default async function AnalyticsPage() {
  await connection();
  const user = await getVerifiedUser();
  if (!user) redirect("/login");

  let analytics;
  try {
    analytics = await getAnalyticsForUser(user);
  } catch {
    return <div className="mx-auto max-w-7xl px-6 py-10"><ErrorState title="Analytics unavailable" description="Transaction intelligence could not load. Your dashboard and transactions are still available." /></div>;
  }

  const isBuyer = analytics.role === "buyer";
  const noRecords = analytics.transactions.length === 0 && analytics.listingPerformance.length === 0;
  const dashboardHref = isBuyer ? "/buyer/dashboard" : "/seller/dashboard";
  const kpis = isBuyer ? [
    { label: "Completed purchase value", value: formatCurrency(analytics.kpis.completedPurchaseValue), detail: "Verified captured payments", icon: CircleDollarSign },
    { label: "Active transactions", value: analytics.kpis.activeTransactions, detail: "Excludes released, cancelled and refunded", icon: BarChart3 },
    { label: "Return window funds", value: formatCurrency(analytics.kpis.returnWindowFunds), detail: "Captured buyer totals in return window", icon: Clock3 },
  ] : [
    { label: "Your listings", value: analytics.kpis.listingCount, detail: "Listings have no active/inactive flag", icon: PackageCheck },
    { label: "Open deals", value: analytics.kpis.openDeals, detail: "Current non-terminal deal states", icon: BarChart3 },
    { label: "Pending seller payout", value: formatCurrency(analytics.kpis.pendingPayout), detail: "Held payable plus recorded pending payouts", icon: Wallet },
    { label: "Successfully paid out", value: formatCurrency(analytics.kpis.successfulPayout), detail: "Successful payout records only", icon: CircleDollarSign },
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Link href={dashboardHref} className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft size={15} aria-hidden="true" /> Back to {isBuyer ? "buyer" : "seller"} dashboard</Link>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand-mid">Brokerage AI · {isBuyer ? "Buyer" : "Seller"} workspace</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Transaction intelligence</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Explore verified transaction activity, deal health and financial outcomes. Drag, resize and configure the reports to fit your workflow.</p>
        </div>
        <Link href={dashboardHref} className={buttonVariants({ variant: "outline", size: "sm" })}>Return to dashboard</Link>
      </div>

      <div className={`mb-6 grid gap-4 ${isBuyer ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
        {kpis.map((metric) => <Metric key={metric.label} {...metric} />)}
      </div>

      {noRecords ? (
        <div className="rounded-2xl border border-border/70 bg-surface/50">
          <EmptyState title="Your analytics will appear here" description={isBuyer ? "Once you have a transaction, this workspace will show verified payment activity and lifecycle insights." : "Create a listing or receive a deal to start seeing your listing performance and payout insights."} />
        </div>
      ) : <AgAnalyticsStudio analytics={analytics} />}
      <p className="mt-4 text-xs text-muted-foreground">Amounts use stored invoice and payment records. Only verified captured payments and recorded payouts contribute to completed financial totals.{analytics.limitReached ? " Results are limited to the latest 500 records; totals reflect the records shown." : ""}</p>
    </div>
  );
}
