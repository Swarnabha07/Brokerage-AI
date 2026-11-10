"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, CreditCard, Info, Loader2, PackageCheck, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";
import { CountdownRing } from "@/components/features/deal/CountdownRing";
import { formatUtc } from "@/components/features/deal/TransactionHistory";
import { formatCurrency } from "@/lib/format";
import { FEE_RATE_LABEL, getDealAmounts } from "@/lib/fees";
import {
  approveTerms, markShipped, confirmReceived, checkRelease,
  startCheckout, capturePayment, openDispute, cancelDeal,
} from "@/lib/api/payments";

/**
 * Panels for LIVE deals (everything here is rendered from server-stored state).
 * Sample/demo deals keep using StagePanel. A timer or a redirect never authorizes money movement:
 * every button asks the server, and the server decides.
 */

const HOLD_NOTICE =
  "Funds are held by Brokerage AI in an application-managed workflow until release conditions are met. This is not PayPal escrow and not a regulated escrow service.";

function Title({ children }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-lg font-semibold">{children}</h2>
      <Badge variant="success">Live Deal</Badge>
    </div>
  );
}

function Note({ icon: Icon = Clock, children, tone = "muted" }) {
  const cls = tone === "warn" ? "border-warning/40 bg-warning/10" : "border-border bg-muted/40";
  return (
    <p role="status" className={`flex gap-2 rounded-xl border p-4 text-sm text-muted-foreground ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={`flex flex-wrap justify-between gap-x-4 ${strong ? "border-t border-border pt-3 font-medium" : ""}`}>
      <dt className={strong ? "text-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd className="font-tabular min-w-0 break-words text-right">{value}</dd>
    </div>
  );
}

function Busy({ busy, children }) {
  return (
    <>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </>
  );
}

const REASONS = {
  window_open: "The return window is still open.",
  dispute_open: "A dispute is open, so funds cannot be released.",
  manual_review: "This deal is under manual review by Brokerage AI.",
  no_delivery_confirmation: "Delivery has not been confirmed yet.",
  not_in_return_window: "This deal is not in its return window.",
  no_verified_payment: "No verified payment was found.",
  no_destination: "No payout destination is on file.",
};

export function LiveStagePanel({ deal, role, onChanged, onWindowEnd }) {
  const { status, amounts, invoice, payout, dispute } = deal;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [price, setPrice] = useState(String(deal.price ?? ""));
  const [tracking, setTracking] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState("not_received");
  const [details, setDetails] = useState("");

  const isBuyer = role === "buyer";
  const isSeller = role === "seller";

  async function act(key, fn, { refresh = true, ok } = {}) {
    setError("");
    setInfo("");
    setBusy(key);
    try {
      const r = await fn();
      if (ok) setInfo(typeof ok === "function" ? ok(r) : ok);
      if (refresh) onChanged();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  const feedback = (
    <>
      {error && <p role="alert" className="mt-4 break-words rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {info && <p role="status" className="mt-4 break-words rounded-xl border border-border bg-muted/40 p-3 text-sm">{info}</p>}
    </>
  );

  const cancelButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={!!busy}
      onClick={() => window.confirm("Cancel this deal? This cannot be undone.") && act("cancel", () => cancelDeal(deal.id))}
    >
      <Busy busy={busy === "cancel"}>Cancel deal</Busy>
    </Button>
  );

  const disputeForm = showDispute && (
    <div className="mt-4 space-y-3 rounded-xl border border-border p-4">
      <Field label="What went wrong?" htmlFor="dispute-reason">
        <select id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm">
          <option value="not_received">I did not receive the item/service</option>
          <option value="not_as_described">Not as described</option>
          <option value="damaged">Damaged</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Details (optional)" htmlFor="dispute-details">
        <Textarea id="dispute-details" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={() => act("dispute", () => openDispute(deal.id, reason, details), { ok: "Dispute opened. Release is paused while Brokerage AI reviews it." })}>
          <Busy busy={busy === "dispute"}>Open dispute</Busy>
        </Button>
        <Button variant="ghost" onClick={() => setShowDispute(false)}>Close</Button>
      </div>
    </div>
  );

  /* ------------------------------------------------------------- agreed */
  if (status === "agreed") {
    const cents = Math.round(Number(price) * 100);
    const valid = /^\d{1,9}(\.\d{1,2})?$/.test(price.trim()) && cents >= 1;
    const preview = valid ? getDealAmounts(Number(price)) : null;
    return (
      <>
        <Title>Terms agreed</Title>
        {deal.agreement?.terms && (
          <div className="mb-5 space-y-2 rounded-xl border border-border p-4 text-sm">
            <p className="font-medium">Accepted agreement version {deal.agreement.version}</p>
            <p>Price: {formatCurrency((deal.agreement.terms.price_cents ?? 0) / 100)} plus buyer-paid {FEE_RATE_LABEL} platform fee; the seller receives the agreed price before provider fees.</p>
            <p>Fulfillment: {deal.agreement.terms.fulfillment_type?.replaceAll("_", " ")}</p>
            <p>Delivery / service: {deal.agreement.terms.delivery_expectations}</p>
            {deal.agreement.terms.buyer_conditions && <p>Buyer conditions: {deal.agreement.terms.buyer_conditions}</p>}
            {deal.agreement.terms.transaction_conditions && <p>Other conditions: {deal.agreement.terms.transaction_conditions}</p>}
            <p>Return window: {deal.agreement.terms.return_window_hours} hours</p>
            <p className="text-xs text-muted-foreground">PayPal does not collect or verify shipping details or delivery.</p>
          </div>
        )}
        {isSeller ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Confirm the final price. It is frozen into an invoice and cannot be changed afterwards. The buyer pays the
              price plus the {FEE_RATE_LABEL} platform fee; you receive the full price.
            </p>
            {deal.hasPayoutProfile === false && (
              <Note icon={AlertTriangle} tone="warn">
                Add your payout PayPal email on your <Link className="underline" href="/seller/dashboard">seller dashboard</Link> before issuing an invoice.
              </Note>
            )}
            <Field label="Final price (USD)" htmlFor="final-price" hint={`Cannot exceed the listing price of ${formatCurrency(deal.listingPrice ?? deal.price)}.`}>
              <Input id="final-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            {preview && (
              <dl className="space-y-2 text-sm">
                <Row label="Platform fee" value={formatCurrency(preview.fee)} />
                <Row label="Buyer will pay" value={formatCurrency(preview.buyerTotal)} strong />
              </dl>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!valid || !!busy || deal.hasPayoutProfile === false} onClick={() => act("invoice", () => approveTerms(deal.id, price.trim()))}>
                <Busy busy={busy === "invoice"}>Approve &amp; issue invoice</Busy>
              </Button>
              {cancelButton}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Note>Waiting for the seller to confirm the final price and issue the invoice.</Note>
            {cancelButton}
          </div>
        )}
        {feedback}
      </>
    );
  }

  /* ---------------------------------------------------------- invoiced */
  if (status === "invoiced") {
    const pending = deal.paymentStatus === "order_created" || deal.paymentStatus === "capture_pending" || deal.paymentStatus === "created";
    return (
      <>
        <Title>Invoice</Title>
        {invoice ? (
          <div className="mb-5 rounded-xl border border-border p-4 text-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="break-all font-mono text-xs">{invoice.number}</p>
              <Badge variant="warning">{invoice.status === "open" ? "Awaiting payment" : invoice.status}</Badge>
            </div>
            <p className="mb-3 break-words font-medium">{invoice.data?.title ?? deal.title}</p>
            {invoice.data?.description && <p className="mb-3 break-words text-muted-foreground">{invoice.data.description}</p>}
            {invoice.data?.accepted_terms && (
              <div className="mb-4 space-y-1 border-y border-border py-3 text-xs text-muted-foreground">
                <p>Fulfillment: {invoice.data.accepted_terms.fulfillment_type?.replaceAll("_", " ")}</p>
                <p>Delivery / service: {invoice.data.accepted_terms.delivery_expectations}</p>
                <p>PayPal does not collect or verify shipping details or delivery.</p>
              </div>
            )}
            <dl className="space-y-2">
              <Row label="Buyer" value={invoice.data?.buyer?.name ?? deal.buyer?.name} />
              <Row label="Seller" value={invoice.data?.seller?.name ?? deal.seller?.name} />
              <Row label="Item price" value={formatCurrency(invoice.price)} />
              <Row label={`Platform fee (${FEE_RATE_LABEL})`} value={formatCurrency(invoice.platformFee)} />
              <Row label="Total payable" value={`${formatCurrency(invoice.total)} ${invoice.currency}`} strong />
              <Row label="Issued" value={formatUtc(invoice.createdAt)} />
              <Row label="Expires" value={formatUtc(invoice.expiresAt)} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Application invoice/receipt. Not a tax invoice.</p>
          </div>
        ) : (
          <Note>Loading invoice…</Note>
        )}
        {isBuyer ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={!!busy}
                onClick={() =>
                  act("pay", async () => {
                    const r = await startCheckout(deal.id);
                    if (r.status === "redirect") { window.location.assign(r.approvalUrl); return r; }
                    const c = await capturePayment(deal.id); // already approved at PayPal: let the server verify
                    return c;
                  }, { refresh: true })
                }
              >
                <Busy busy={busy === "pay"}>
                  <CreditCard className="h-4 w-4" aria-hidden="true" /> {pending ? "Continue to PayPal" : "Pay with PayPal"}
                </Busy>
              </Button>
              {pending && (
                <Button variant="outline" disabled={!!busy} onClick={() => act("verify", () => capturePayment(deal.id), { ok: (r) => `Payment status: ${r.status.replaceAll("_", " ")}` })}>
                  <Busy busy={busy === "verify"}>I already paid: refresh status</Busy>
                </Button>
              )}
              {cancelButton}
            </div>
            <Note icon={Info}>PayPal Sandbox only: no real money moves. Checkout does not collect or verify a shipping address or delivery. The parties agree fulfillment details in the transaction terms and coordinate delivery separately. {HOLD_NOTICE}</Note>
          </div>
        ) : (
          <div className="space-y-3">
            <Note>Waiting for the buyer to pay this invoice with PayPal.</Note>
            {cancelButton}
          </div>
        )}
        {feedback}
      </>
    );
  }

  /* -------------------------------------------------------------- paid */
  if (status === "paid") {
    return (
      <>
        <Title>Payment verified</Title>
        <Note icon={CheckCircle2}>The payment was verified with PayPal. {HOLD_NOTICE}</Note>
        {isSeller ? (
          <div className="mt-5 space-y-3">
            <Field label="Tracking / delivery reference" htmlFor="tracking" hint="3 to 64 letters, numbers or dashes. This is a record only; PayPal and Brokerage AI do not verify carrier tracking. The buyer confirms delivery.">
              <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </Field>
            <Button disabled={!!busy || !/^[A-Za-z0-9-]{3,64}$/.test(tracking)} onClick={() => act("ship", () => markShipped(deal.id, tracking))}>
              <Busy busy={busy === "ship"}><Truck className="h-4 w-4" aria-hidden="true" /> Mark as shipped</Busy>
            </Button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">Waiting for the seller to ship or deliver.</p>
        )}
        {feedback}
      </>
    );
  }

  /* ----------------------------------------------------------- shipped */
  if (status === "shipped") {
    return (
      <>
        <Title>Shipped</Title>
        <Note icon={Truck}>
          Reference: <span className="break-all font-mono text-xs">{deal.tracking_number}</span> (not carrier-verified). Funds stay held until you confirm delivery
          and the return window ends.
        </Note>
        {deal.needsReview && <div className="mt-3"><Note icon={AlertTriangle} tone="warn">No delivery confirmation for a while: this deal is under manual review.</Note></div>}
        {isBuyer ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <Button disabled={!!busy} onClick={() => act("confirm", () => confirmReceived(deal.id))}>
              <Busy busy={busy === "confirm"}><PackageCheck className="h-4 w-4" aria-hidden="true" /> Confirm receipt</Busy>
            </Button>
            <Button variant="outline" onClick={() => setShowDispute((v) => !v)}>Report a problem</Button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">Waiting for the buyer to confirm receipt. Tracking alone does not release funds.</p>
        )}
        {disputeForm}
        {feedback}
      </>
    );
  }

  /* ---------------------------------------------------- return window */
  if (status === "return_window") {
    const started = deal.returnWindowStartedAt;
    const ends = deal.returnWindowEndsAt;
    const total = started && ends ? Math.max(1, Math.round((Date.parse(ends) - Date.parse(started)) / 1000)) : 60;
    return (
      <>
        <Title>Return window</Title>
        <div className="mb-5 flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-6">
          {started && <CountdownRing key={started} totalSeconds={total} startedAt={started} onComplete={onWindowEnd} />}
          <div className="min-w-0 text-sm text-muted-foreground">
            <p>Delivery confirmed {formatUtc(deal.deliveryConfirmedAt)}{deal.deliveryConfirmedBy === "admin" ? " (verified by Brokerage AI)" : ""}.</p>
            <p>Window ends {formatUtc(ends)}. The server decides on release; this timer is display only.</p>
          </div>
        </div>
        {deal.needsReview && <Note icon={AlertTriangle} tone="warn">Under manual review: automatic release is paused.</Note>}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => act("check", () => checkRelease(deal.id), { ok: (r) => (r.released ? `Released. Payout: ${r.payout ?? "processing"}.` : REASONS[r.reason] ?? "Not eligible for release yet.") })}
          >
            <Busy busy={busy === "check"}>Check release</Busy>
          </Button>
          {isBuyer && <Button variant="outline" onClick={() => setShowDispute((v) => !v)}>Report a problem</Button>}
        </div>
        {disputeForm}
        {feedback}
      </>
    );
  }

  /* ---------------------------------------------------------- released */
  if (status === "released") {
    const st = payout?.status;
    const done = st === "succeeded";
    const attention = st === "failed" || st === "manual_review" || st === "ambiguous";
    return (
      <>
        <Title>{done ? "Complete" : "Released"}</Title>
        {done ? (
          <Note icon={CheckCircle2}>
            PayPal confirmed the payout item succeeded
            {isSeller ? `: ${formatCurrency(amounts.sellerAmount)} was sent to your PayPal account.` : "."}
          </Note>
        ) : attention ? (
          <Note icon={AlertTriangle} tone="warn">The payout needs attention from Brokerage AI. No further action is needed from you; it will not be sent twice.</Note>
        ) : (
          <Note>Release conditions are met. The payout is processing and is only shown as complete after PayPal confirms it.</Note>
        )}
        {!done && !attention && (
          <div className="mt-4">
            <Button variant="outline" disabled={!!busy} onClick={() => act("check", () => checkRelease(deal.id), { ok: "Status refreshed." })}>
              <Busy busy={busy === "check"}>Refresh payout status</Busy>
            </Button>
          </div>
        )}
        {feedback}
      </>
    );
  }

  /* ---------------------------------------------------------- disputed */
  if (status === "disputed") {
    return (
      <>
        <Title>Dispute under review</Title>
        <Note icon={AlertTriangle} tone="warn">
          A dispute{dispute?.reason ? ` (${dispute.reason.replaceAll("_", " ")})` : ""} was opened {formatUtc(dispute?.opened_at)}. Funds stay held and
          cannot be released until Brokerage AI resolves it. {HOLD_NOTICE}
        </Note>
      </>
    );
  }

  /* ------------------------------------------------ cancelled / refunded */
  return (
    <>
      <Title>{status === "refunded" ? "Refunded" : "Cancelled"}</Title>
      <Note icon={XCircle}>
        {status === "refunded" ? "The buyer's payment was refunded through PayPal." : "This deal was cancelled before any payment was captured."}
      </Note>
    </>
  );
}
