"use client";

import { useMemo } from "react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { studioTheme } from "ag-studio";
import { AlertTriangle, CheckCircle2, CircleDollarSign, ShieldCheck } from "lucide-react";
import { formatCurrency } from "@/lib/format";

function DealHealthWidget({ context }) {
  const health = context?.health ?? { active: 0, attention: [] };
  return (
    <section className="h-full overflow-auto rounded-xl border border-border/70 bg-surface p-5 text-foreground" aria-label="Deal health overview">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Transaction monitoring</p>
          <h2 className="mt-1 font-display text-lg font-semibold">Deal health overview</h2>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand-mid"><ShieldCheck size={19} aria-hidden="true" /></span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/70 bg-background/70 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CircleDollarSign size={14} aria-hidden="true" /> Active deals</div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{health.active}</p>
        </div>
        <div className={`rounded-lg border p-3 ${health.attention.length ? "border-warning/40 bg-warning-soft" : "border-success/30 bg-success-soft"}`}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">{health.attention.length ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} Needs attention</div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{health.attention.length}</p>
        </div>
        <div className="col-span-2 rounded-lg border border-border/70 bg-background/70 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CircleDollarSign size={14} aria-hidden="true" /> {health.fundsLabel}</div>
          <p className="mt-2 text-xl font-semibold tabular-nums">{formatCurrency(health.fundsAwaiting)}</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Follow up</p>
        {health.attention.length ? (
          <ul className="space-y-2">
            {health.attention.slice(0, 5).map((item, index) => (
              <li key={`${item.title}-${index}`} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{item.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.reason}</span></span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{item.status.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-4 text-sm text-muted-foreground">No deals currently require follow up.</p>}
      </div>
    </section>
  );
}

function initialState(role) {
  const widgets = {};
  if (role === "buyer") {
    widgets["1"] = { type: "line-chart", dataMapping: { categoryKey: [{ id: "activity.month" }], valueKey: [{ id: "activity.amount", aggregation: "sum" }] } };
    widgets["2"] = { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "lifecycle.status" }], valueKey: [{ id: "lifecycle.transactionCount", aggregation: "sum" }] } };
    widgets["3"] = { type: "grid", dataMapping: { cols: [{ id: "transactions.title" }, { id: "transactions.status" }, { id: "transactions.date" }, { id: "transactions.purchaseAmount" }] } };
  } else {
    widgets["1"] = { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "lifecycle.status" }], valueKey: [{ id: "lifecycle.transactionCount", aggregation: "sum" }] } };
    widgets["2"] = { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "payouts.payoutStatus" }], valueKey: [{ id: "payouts.payoutAmount", aggregation: "sum" }] } };
    widgets["3"] = { type: "grid", dataMapping: { cols: [{ id: "listings.listingTitle" }, { id: "listings.listingPrice" }, { id: "listings.dealCount" }, { id: "listings.completedSales" }, { id: "listings.sellerPayable" }] } };
  }
  widgets["4"] = { type: "deal-health", dataMapping: {} };
  const ids = Object.keys(widgets);
  return {
    pages: [{
      id: "transaction-intelligence",
      widgets,
      widgetLayout: Object.fromEntries(ids.map((id, index) => ({
        [id]: { xTrack: index % 2 ? 12 : 0, yTrack: Math.floor(index / 2) * 16, xSpan: 12, ySpan: 16 },
      })).flatMap(Object.entries)),
    }],
    selectedPageId: "transaction-intelligence",
    panels: { filters: { collapsed: true }, data: { collapsed: true } },
  };
}

export function AgAnalyticsStudio({ analytics }) {
  const state = useMemo(() => {
    const next = initialState(analytics.role);
    const widgets = next.pages[0].widgets;
    if (analytics.role === "buyer") {
      if (!analytics.activity.length) delete widgets["1"];
      if (!analytics.lifecycle.length) delete widgets["2"];
      if (!analytics.transactions.length) delete widgets["3"];
    } else {
      if (!analytics.lifecycle.length) delete widgets["1"];
      if (!analytics.payoutRows.length) delete widgets["2"];
      if (!analytics.listingPerformance.length) delete widgets["3"];
    }
    const ids = Object.keys(widgets);
    next.pages[0].widgetLayout = Object.fromEntries(ids.map((id, index) => [id, {
      xTrack: index % 2 ? 12 : 0,
      yTrack: Math.floor(index / 2) * 16,
      xSpan: 12,
      ySpan: 16,
    }]));
    return next;
  }, [analytics]);
  const data = useMemo(() => ({
    sources: [
      { id: "transactions", data: analytics.transactions },
      { id: "activity", data: analytics.activity },
      { id: "lifecycle", data: analytics.lifecycle },
      { id: "payouts", data: analytics.payoutRows },
      { id: "listings", data: analytics.listingPerformance },
    ],
  }), [analytics]);
  const widgets = useMemo(() => (config) => createWidgets({
    additionalTypes: [{
      id: "deal-health",
      label: "Deal health overview",
      comp: DealHealthWidget,
      form: ({ createDefaults }) => createDefaults({}),
      defaultSize: { width: 12, height: 16 },
      minSize: { width: 8, height: 10 },
    }],
    menu: [...config.menu, { label: "Brokerage AI", widgetIds: ["deal-health"] }],
  }), []);
  const theme = useMemo(() => studioTheme.withParams({
    backgroundColor: "#10101a",
    foregroundColor: "#f5f5f5",
    browserColorScheme: "dark",
  }, "brokerage-ai-dark"), []);
  const licenseKey = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;
  const health = {
    active: analytics.kpis.activeTransactions,
    attention: analytics.attention,
    fundsAwaiting: analytics.role === "buyer" ? analytics.kpis.returnWindowFunds : analytics.kpis.pendingPayout,
    fundsLabel: analytics.role === "buyer" ? "Funds in return window" : "Seller funds awaiting payout",
  };

  return (
    <AgStudioProvider licenseKey={licenseKey}>
      <div className="h-[760px] min-h-[600px] w-full overflow-hidden rounded-2xl border border-border bg-[#10101a] sm:h-[820px] xl:h-[900px]">
        <AgStudio data={data} initialState={state} mode="edit" theme={theme} widgets={widgets} context={{ health }} />
      </div>
    </AgStudioProvider>
  );
}
