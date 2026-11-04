"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, MessageSquare, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEMO_DEAL_ID } from "@/lib/config";

const MODES = [
  {
    value: "ai_negotiate",
    icon: Bot,
    title: "AI negotiate",
    desc: "Your agent negotiates with the seller’s agent within a capped number of rounds.",
  },
  {
    value: "self_chat",
    icon: MessageSquare,
    title: "Self chat",
    desc: "You chat directly with the seller’s AI agent instead of delegating.",
  },
];

export function NegotiationModePicker({ listingId, dealId }) {
  const router = useRouter();
  const [mode, setMode] = useState("ai_negotiate");
  const [isStarting, setIsStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const selected = MODES.find((m) => m.value === mode);

  async function handleStartDeal() {
    setIsStarting(true);
    setErrorMsg("");

    // If listingId is a UUID, attempt to create the deal in Supabase
    const isUuid = listingId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingId);

    if (isUuid) {
      try {
        const res = await fetch("/api/deals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listing_id: listingId,
            negotiation_mode: mode,
          }),
        });

        const data = await res.json();
        if (res.ok && data?.id) {
          router.push(`/deal/${data.id}`);
          return;
        } else {
          console.warn("Could not create deal via API, falling back:", data?.error);
        }
      } catch (err) {
        console.warn("API deal creation error, falling back to sample deal:", err);
      }
    }

    // Fallback to sample/demo deal
    const targetDealId = dealId || DEMO_DEAL_ID;
    router.push(`/deal/${targetDealId}`);
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Negotiation mode</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-mid/60",
                mode === m.value
                  ? "border-brand-mid bg-brand-mid/10"
                  : "border-border hover:bg-muted"
              )}
            >
              <input
                type="radio"
                name="negotiation-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                className="sr-only"
                disabled={isStarting}
              />
              <m.icon
                className="mt-0.5 h-4 w-4 shrink-0 text-brand-mid"
                aria-hidden="true"
              />
              <span>
                <span className="block text-sm font-semibold">{m.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {m.desc}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {errorMsg && (
        <p className="text-xs text-destructive">{errorMsg}</p>
      )}

      <p className="text-xs text-muted-foreground">
        Selected: <strong className="text-foreground">{selected.title}</strong>.
        Starting creates a deal room with the configured mode.
      </p>

      <Button
        size="lg"
        onClick={handleStartDeal}
        disabled={isStarting}
        className="w-full sm:w-auto"
      >
        {isStarting ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting Deal...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            Start negotiation <ArrowRight className="h-4 w-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
