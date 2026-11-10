// Role-aware financial view built ONLY from stored server rows. Never returns payout destinations,
// request ids, or the platform's net earnings (admins only, via adminFinancials).
const dollars = (c) => (Number.isInteger(c) ? c / 100 : null);

export function buildFinancials({ invoice, payment, payout }, viewerRole) {
  if (!invoice) return null;
  const f = {
    currency: invoice.currency,
    invoiceNumber: invoice.invoice_number,
    price: dollars(invoice.price_cents),
    platformFee: dollars(invoice.fee_cents),
    buyerTotal: dollars(invoice.total_cents),
    sellerAmount: dollars(invoice.price_cents),
    paymentStatus: payment?.status ?? "unpaid",
    paypalProcessingFee: dollars(payment?.paypal_fee_cents),
    payoutStatus: payout?.status ?? null,
    payoutFee: dollars(payout?.payout_fee_cents),
    feeNote: "Provider fees are paid by Brokerage AI out of its own balance; they do not reduce what the seller receives.",
  };
  if (viewerRole === "buyer" && payment?.provider_capture_id) f.paypalCaptureRef = payment.provider_capture_id;
  if (viewerRole === "seller" && payout?.provider_item_id) f.paypalPayoutRef = payout.provider_item_id;
  return f;
}

/** Platform economics. ADMIN-ONLY: callers must have verified users.is_admin. */
export function adminFinancials({ invoice, payment, payout }) {
  if (!invoice) return null;
  const known = Number.isInteger(payment?.paypal_fee_cents) && Number.isInteger(payout?.payout_fee_cents);
  return {
    platformFee: dollars(invoice.fee_cents),
    paypalProcessingFee: dollars(payment?.paypal_fee_cents),
    payoutFee: dollars(payout?.payout_fee_cents),
    platformNet: known ? dollars(invoice.fee_cents - payment.paypal_fee_cents - payout.payout_fee_cents) : null,
    complete: known,
  };
}
