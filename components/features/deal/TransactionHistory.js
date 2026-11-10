import { formatCurrency } from "@/lib/format";

// Deterministic UTC formatting (same on server and client; no hydration drift).
export const formatUtc = (iso) => (iso ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC` : "—");

const EVENT_LABELS = {
  invoice_issued: "Invoice issued by seller",
  checkout_started: "Buyer started PayPal checkout",
  payment_captured: "Payment verified with PayPal",
  capture_pending: "Payment pending at PayPal",
  payment_captured_needs_review: "Payment verified; flagged for review",
  shipped: "Seller marked as shipped",
  delivery_confirmed: "Delivery confirmed",
  dispute_opened: "Buyer opened a dispute",
  dispute_resolved_release: "Dispute resolved: release",
  dispute_resolved_refund: "Dispute resolved: refund",
  released: "Funds released for payout",
  payout_submitted: "Payout sent to PayPal",
  payout_succeeded: "Payout verified: seller paid",
  payout_pending: "Payout pending at PayPal",
  payout_failed: "Payout failed",
  payout_ambiguous: "Payout needs manual check",
  payout_manual_review: "Payout needs manual review",
  payout_requeued: "Payout re-queued by admin",
  refund_started: "Refund started",
  refund_completed: "Refund completed",
  invoice_expired: "Invoice expired",
  deal_cancelled: "Deal cancelled",
  review_cleared: "Manual review cleared",
};

function Line({ label, value, strong, mono }) {
  return (
    <div className={`flex flex-wrap justify-between gap-x-4 gap-y-1 ${strong ? "border-t border-border pt-3 font-medium" : ""}`}>
      <dt className={strong ? "text-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd className={`font-tabular min-w-0 break-all text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

/** Server-backed money + audit trail for one live deal. Everything here comes from stored rows. */
export function TransactionHistory({ deal }) {
  const f = deal.financials;
  const events = deal.events ?? [];
  if (!f && events.length === 0) return null;
  const cur = (n) => (n === null || n === undefined ? "Not reported yet" : formatCurrency(n));
  return (
    <section aria-labelledby="txn-history" className="space-y-5">
      <h2 id="txn-history" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Transaction history
      </h2>
      {f && (
        <dl className="space-y-2 text-sm">
          <Line label="Invoice" value={f.invoiceNumber} mono />
          <Line label="Agreed price" value={cur(f.price)} />
          <Line label="Platform fee (3%)" value={cur(f.platformFee)} />
          <Line label="Buyer total" value={cur(f.buyerTotal)} strong />
          <Line label="Payment" value={f.paymentStatus} />
          <Line label="PayPal processing fee" value={cur(f.paypalProcessingFee)} />
          <Line label="Seller receives" value={cur(f.sellerAmount)} />
          <Line label="Payout" value={f.payoutStatus ?? "Not started"} />
          <Line label="PayPal payout fee" value={cur(f.payoutFee)} />
          {f.paypalCaptureRef && <Line label="PayPal payment ref" value={f.paypalCaptureRef} mono />}
          {f.paypalPayoutRef && <Line label="PayPal payout ref" value={f.paypalPayoutRef} mono />}
        </dl>
      )}
      {f && <p className="text-xs text-muted-foreground">{f.feeNote}</p>}
      {events.length > 0 && (
        <ol className="space-y-3 border-l border-border pl-4 text-sm" aria-label="Deal events">
          {events.map((e, i) => (
            <li key={`${e.type}-${i}`} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
              <p className="break-words font-medium">{EVENT_LABELS[e.type] ?? e.type.replaceAll("_", " ")}</p>
              <p className="text-xs text-muted-foreground">
                {formatUtc(e.at)} · {e.actorRole}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
