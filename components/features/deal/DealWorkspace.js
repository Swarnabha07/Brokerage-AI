"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, CheckCircle2, Circle, RotateCcw } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DealStepper } from "@/components/features/deal/DealStepper";
import { StagePanel } from "@/components/features/deal/DealPanels";
import { DEAL_STATUS_ORDER } from "@/lib/constants/deal-status";
import {
  updateDealStage,
  confirmReceived,
  checkRelease,
  isLiveDealId,
} from "@/lib/api/payments";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

const WORKFLOW_STAGES = [
  { from: 0, text: "Negotiation" },
  { from: 1, text: "Terms concluded" },
  { from: 2, text: "Invoice created" },
  { from: 3, text: "Payment stage" },
  { from: 4, text: "Shipment stage" },
  { from: 5, text: "Inspection window" },
  { from: 6, text: "Application ledger released" },
];

export function DealWorkspace({
  deal,
  returnWindowSeconds = 60,
  feeLabel = "3%",
}) {
  const router = useRouter();
  const isLive = isLiveDealId(deal?.id);

  // Server data is the source of truth. Re-sync during render when the server sends a new deal
  // (after router.refresh()); no effect needed.
  const [prevDeal, setPrevDeal] = useState(deal);
  const [currentDeal, setCurrentDeal] = useState(deal);
  if (deal !== prevDeal) {
    setPrevDeal(deal);
    setCurrentDeal(deal);
  }

  // Live deals: role is whatever the server verified for this user. Sample deals: demo toggle.
  const [demoRole, setDemoRole] = useState("buyer");
  const role = isLive ? (currentDeal.viewerRole ?? null) : demoRole;
  const [accepted, setAccepted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  const status = currentDeal.status;
  const index = DEAL_STATUS_ORDER.indexOf(status);

  // Realtime is only a "something changed" signal; the server re-renders the authoritative state.
  useEffect(() => {
    if (!isLive) return;
    const refresh = () => router.refresh();
    const channel = supabase
      .channel(`deal-room-${deal.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deals",
          filter: `id=eq.${deal.id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `deal_id=eq.${deal.id}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [deal.id, isLive, router]);

  // No optimistic updates for live deals: UI changes only after the server confirms.
  async function advance(next, extraPayload = {}) {
    setError("");
    setIsPending(true);
    try {
      if (!isLive) {
        setCurrentDeal((d) => ({
          ...d,
          status: next,
          terms:
            next === "return_window"
              ? {
                  ...d.terms,
                  return_window_started_at: new Date().toISOString(),
                }
              : d.terms,
        }));
        setAccepted(false);
        return;
      }
      if (next === "return_window") await confirmReceived(deal.id);
      else await updateDealStage(deal.id, next, extraPayload);
      setAccepted(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setIsPending(false);
    }
  }

  // Countdown end: ask the server to re-check; it decides using its own clock.
  async function onWindowEnd() {
    if (!isLive) {
      setCurrentDeal((d) => ({ ...d, status: "released" }));
      return;
    }
    try {
      await checkRelease(deal.id);
    } catch {
      // ignore; next refresh/poll re-checks
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Link
        href="/listings"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to listings
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs text-muted-foreground">
              {currentDeal.id}
            </p>
            {isLive ? (
              <Badge variant="success">Live Deal</Badge>
            ) : (
              <Badge variant="outline">Demo Record</Badge>
            )}
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            {currentDeal.title}
          </h1>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <GlassCard hover={false} className="p-6">
            <DealStepper status={status} />
          </GlassCard>
          <GlassCard hover={false} className="p-6 md:p-8">
            <StagePanel
              status={status}
              role={role}
              deal={currentDeal}
              accepted={accepted}
              onAccept={setAccepted}
              onAdvance={advance}
              onWindowEnd={onWindowEnd}
              returnWindowSeconds={returnWindowSeconds}
              isLive={isLive}
              isPending={isPending}
            />
          </GlassCard>
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <aside className="space-y-6" aria-label="Deal details">
          <GlassCard hover={false} className="p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Parties
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Buyer</dt>
                <dd className="font-medium">
                  {currentDeal.buyer?.name || (isLive ? "Buyer" : "Demo Buyer")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Seller</dt>
                <dd className="font-medium">
                  {currentDeal.seller?.name ||
                    (isLive ? "Seller" : "Demo Seller")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Negotiation mode
                </dt>
                <dd className="font-medium">
                  {currentDeal.negotiationMode === "ai_negotiate"
                    ? "AI negotiate"
                    : "Self chat"}
                </dd>
              </div>
            </dl>
          </GlassCard>

          <GlassCard hover={false} className="p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Amounts
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Agreed price</dt>
                <dd className="font-tabular">
                  {formatCurrency(currentDeal.amounts.price)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Platform fee ({feeLabel}, buyer-paid)
                </dt>
                <dd className="font-tabular text-muted-foreground">
                  +{formatCurrency(currentDeal.amounts.fee)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <dt>Buyer pays</dt>
                <dd className="font-tabular">
                  {formatCurrency(currentDeal.amounts.buyerTotal)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Seller receives</dt>
                <dd className="font-tabular font-medium text-foreground">
                  {formatCurrency(currentDeal.amounts.sellerAmount)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Provisional demo fee model: the buyer pays the fee on top; the
              seller receives the full agreed price.
            </p>
          </GlassCard>

          <GlassCard hover={false} className="p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Workflow progress
            </h2>
            <ol className="space-y-3 text-sm">
              {WORKFLOW_STAGES.map((step, i) => {
                const reached = i <= index;
                const current = i === index;
                return (
                  <li
                    key={step.text}
                    className={cn(
                      "flex items-start gap-2.5",
                      reached ? "text-foreground" : "text-muted-foreground/60",
                    )}
                  >
                    {reached ? (
                      <CheckCircle2
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          current ? "text-brand-mid" : "text-success",
                        )}
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 h-4 w-4 shrink-0 text-border"
                        aria-hidden="true"
                      />
                    )}
                    <span className={cn(current && "font-semibold")}>
                      {step.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          </GlassCard>

          {!isLive && (
            <GlassCard hover={false} className="p-6">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Demo perspective
              </h2>
              <fieldset>
                <legend className="sr-only">Switch perspective</legend>
                <div className="grid grid-cols-2 gap-2">
                  {["buyer", "seller"].map((r) => (
                    <label
                      key={r}
                      className={cn(
                        "cursor-pointer rounded-lg border px-3 py-2 text-center text-sm capitalize transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-mid/60",
                        demoRole === r
                          ? "border-brand-mid bg-brand-mid/10"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name="demo-role"
                        value={r}
                        checked={demoRole === r}
                        onChange={() => setDemoRole(r)}
                        className="sr-only"
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full"
                onClick={() => {
                  setCurrentDeal(deal);
                  setAccepted(false);
                  setError("");
                }}
                disabled={isPending}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
                simulation
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Simulated state lives in this page only and resets on reload.
              </p>
            </GlassCard>
          )}
        </aside>
      </div>
    </div>
  );
}
