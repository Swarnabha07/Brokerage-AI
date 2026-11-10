"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { GlassCard } from "@/components/shared/GlassCard";
import { savePayoutEmail } from "@/lib/api/payments";

/** Seller sets the PayPal account for payouts. Existing deals keep the destination fixed at invoice time. */
export function PayoutProfileCard({ initialEmail = "" }) {
  const [email, setEmail] = useState(initialEmail);
  const [saved, setSaved] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg({ type: "", text: "" });
    try {
      const r = await savePayoutEmail(email);
      setSaved(r.paypal_email);
      setMsg({ type: "ok", text: "Payout email saved. Deals already invoiced keep their original destination." });
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard hover={false} className="mb-10 p-6">
      <h2 className="mb-1 font-display text-lg font-semibold">Payout PayPal account</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Required before you can issue an invoice. Payouts are sent to this PayPal email after a deal is released.
        PayPal cannot verify that you own this address, so double-check it. It can be changed once every 24 hours.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field label="PayPal email" htmlFor="payout-email">
            <Input id="payout-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !email || email === saved}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save
        </Button>
      </form>
      {msg.text && (
        <p role="status" className={`mt-3 text-sm ${msg.type === "err" ? "text-destructive" : "text-success"}`}>{msg.text}</p>
      )}
    </GlassCard>
  );
}
