"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, MessageSquare } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

export function NegotiationModePicker({ dealId }) {
  const [mode, setMode] = useState("ai_negotiate");
  const selected = MODES.find((m) => m.value === mode);

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
                  : "border-border hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="negotiation-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                className="sr-only"
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

      <p className="text-xs text-muted-foreground">
        Selected: <strong className="text-foreground">{selected.title}</strong>.
        Starting a real deal needs the backend, which is not connected yet, so
        the button below opens a sample deal instead.
      </p>

      <Link href={`/deal/${dealId}`} className={buttonVariants({ size: "lg" })}>
        Open sample deal (demo)
      </Link>
    </div>
  );
}
