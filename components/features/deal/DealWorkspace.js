"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, CheckCircle2, Circle, RotateCcw } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DealStepper } from "@/components/features/deal/DealStepper";
import { StagePanel } from "@/components/features/deal/DealPanels";
import { DEAL_STATUS_ORDER } from "@/lib/constants/deal-status";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTIVITY = [
  { from: 0, text: "Negotiation started" },
  { from: 1, text: "Terms agreed by both sides" },
  { from: 2, text: "Seller approved terms; mock invoice created" },
  { from: 3, text: "Payment recorded (simulated)" },
  { from: 4, text: "Marked as shipped (simulated)" },
  { from: 5, text: "Receipt confirmed (simulated)" },
  { from: 6, text: "Funds released (simulated)" },
];

/**
 * Interactive deal view. The starting status comes from the server record;
 * every change after that is simulated, held only in this component, and
 * lost on reload. Nothing here can mark a real payment as made.
 */
export function DealWorkspace({ deal, returnWindowSeconds, feeLabel }) {
  const [status, setStatus] = useState(deal.status);
  const [role, setRole] = useState("buyer");
  const [accepted, setAccepted] = useState(false);
  const index = DEAL_STATUS_ORDER.indexOf(status);

  function advance(next) {
    setStatus(next);
    setAccepted(false);
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
          <p className="font-mono text-xs text-muted-foreground">{deal.id}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
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
            />
          </GlassCard>
        </div>

        <aside className="space-y-6" aria-label="Deal details">
          <GlassCard hover={false} className="p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Parties
            </h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Buyer</dt>
                <dd>{deal.buyer.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Seller</dt>
                <dd>{deal.seller.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Mode</dt>
                <dd>
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
                <dt className="text-muted-foreground">Item price</dt>
                <dd className="font-tabular">
                  {formatCurrency(deal.amounts.price)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Buyer fee ({feeLabel}, demo)
                </dt>
                <dd className="font-tabular">
                  {formatCurrency(deal.amounts.fee)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <dt>Buyer pays</dt>
                <dd className="font-tabular">
                  {formatCurrency(deal.amounts.buyerTotal)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Seller amount</dt>
                <dd className="font-tabular">
                  {formatCurrency(deal.amounts.sellerAmount)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              The fee is a provisional demo assumption, not final policy.
            </p>
          </GlassCard>

          <GlassCard hover={false} className="p-6">
            <h2 className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Bot className="h-3.5 w-3.5" aria-hidden="true" /> Activity
            </h2>
            <ol className="space-y-3 text-sm">
              {ACTIVITY.map((item) => {
                const done = index >= item.from;
                return (
                  <li
                    key={item.text}
                    className={cn(
                      "flex items-start gap-2.5",
                      !done && "text-muted-foreground/60",
                    )}
                  >
                    {done ? (
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-success"
                        aria-label="Done"
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-label="Pending"
                      />
                    )}
                    {item.text}
                  </li>
                );
              })}
            </ol>
          </GlassCard>

          <GlassCard hover={false} className="border-warning/30 p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-warning">
                Demo controls
              </h2>
              <Badge variant="warning">No real payment</Badge>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm">View as</legend>
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
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
              simulation
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Simulated state lives in this page only and resets on reload. Role
              switching replaces login while authentication is not connected.
            </p>
          </GlassCard>
        </aside>
      </div>
    </div>
  );
}
