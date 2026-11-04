"use client";

import { useState } from "react";
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
import { updateDealStage } from "@/lib/api/payments";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTIVITY = [
  { from: 0, text: "Negotiation started" },
  { from: 1, text: "Terms agreed by both sides" },
  { from: 2, text: "Seller approved terms; invoice created" },
  { from: 3, text: "Payment captured & held in escrow" },
  { from: 4, text: "Marked as shipped with tracking" },
  { from: 5, text: "Receipt confirmed; return window active" },
  { from: 6, text: "Funds released to seller" },
];

export function DealWorkspace({ deal, returnWindowSeconds, feeLabel }) {
  const router = useRouter();
  const [status, setStatus] = useState(deal.status);
  const [role, setRole] = useState("buyer");
  const [accepted, setAccepted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const index = DEAL_STATUS_ORDER.indexOf(status);

  const isUuid =
    deal?.id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deal.id);

  async function advance(next, extraPayload = {}) {
    setStatus(next);
    setAccepted(false);
    setIsPending(true);

    try {
      if (deal?.id) {
        await updateDealStage(deal.id, next, extraPayload);
        router.refresh();
      }
    } catch (e) {
      console.warn("Could not persist deal stage to server, remaining in local state:", e);
    } finally {
      setIsPending(false);
    }
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
            <p className="font-mono text-xs text-muted-foreground">{deal.id}</p>
            {isUuid ? (
              <Badge variant="success">Live Deal</Badge>
            ) : (
              <Badge variant="outline">Demo Record</Badge>
            )}
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            {deal.title}
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
              deal={deal}
              accepted={accepted}
              onAccept={setAccepted}
              onAdvance={advance}
              returnWindowSeconds={returnWindowSeconds}
              isLive={isUuid}
              isPending={isPending}
            />
          </GlassCard>
        </div>

        <aside className="space-y-6" aria-label="Deal details">
          <GlassCard hover={false} className="p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Parties
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Buyer</dt>
                <dd className="font-medium">{deal.buyer?.name || "Demo Buyer"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Seller</dt>
                <dd className="font-medium">{deal.seller?.name || "Demo Seller"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Negotiation mode</dt>
                <dd className="font-medium">
                  {deal.negotiationMode === "ai_negotiate"
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
                  {formatCurrency(deal.amounts.price)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Platform fee ({feeLabel})
                </dt>
                <dd className="font-tabular text-muted-foreground">
                  -{formatCurrency(deal.amounts.fee)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <dt>Buyer pays</dt>
                <dd className="font-tabular">
                  {formatCurrency(deal.amounts.buyerTotal)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Seller receives</dt>
                <dd className="font-tabular font-medium text-foreground">
                  {formatCurrency(deal.amounts.sellerAmount)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Standard 3% platform fee deducted upon payout release.
            </p>
          </GlassCard>

          <GlassCard hover={false} className="p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Timeline
            </h2>
            <ol className="space-y-3 text-sm">
              {ACTIVITY.map((step, i) => {
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
                      role === r
                        ? "border-brand-mid bg-brand-mid/10"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="demo-role"
                      value={r}
                      checked={role === r}
                      onChange={() => setRole(r)}
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
              onClick={() => advance(deal.status)}
              disabled={isPending}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
              simulation
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              {isUuid
                ? "Changes to live deals persist to Supabase."
                : "Simulated state lives in this page only and resets on reload."}
            </p>
          </GlassCard>
        </aside>
      </div>
    </div>
  );
}
