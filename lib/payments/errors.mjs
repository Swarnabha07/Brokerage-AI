// Maps database 'brk_*' exceptions (raised by the SQL functions) to safe HTTP responses.
const TABLE = [
  [/brk_forbidden/, 403, "forbidden", "Deal not found or access denied"],
  [/brk_not_found/, 404, "not_found", "Not found"],
  [/brk_invalid_state/, 409, "invalid_state", "This action is not allowed in the deal's current state"],
  [/brk_no_payout_profile/, 409, "no_payout_profile", "Add your PayPal payout email in your seller dashboard first"],
  [/brk_invalid_amount/, 400, "invalid_amount", "Invalid amount"],
  [/brk_invalid_fulfillment_type|brk_invalid_delivery_terms|brk_invalid_conditions/, 400, "invalid_terms", "Enter complete delivery or service terms"],
  [/brk_invoice_expired/, 409, "invoice_expired", "This invoice has expired. Ask the seller to issue a new one."],
  [/brk_capture_id_missing/, 409, "capture_unverified", "The PayPal capture could not be verified"],
  [/brk_no_open_invoice/, 409, "no_open_invoice", "There is no open invoice for this deal"],
  [/brk_no_verified_payment/, 409, "no_verified_payment", "No verified payment exists for this deal"],
  [/brk_payment_in_progress/, 409, "payment_in_progress", "A payment is already in progress or completed"],
  [/brk_payout_started/, 409, "payout_started", "A payout has already started for this deal"],
  [/brk_dispute_not_resolved_for_refund/, 409, "dispute_not_resolved", "The dispute must be resolved as a refund first"],
  [/brk_cooldown/, 409, "cooldown", "The payout email can be changed once every 24 hours"],
  [/brk_invalid_email/, 400, "invalid_email", "Enter a valid PayPal email address"],
  [/brk_terms_not_mutually_accepted|brk_no_terms/, 409, "terms_not_accepted", "Both parties must accept the current transaction terms"],
  [/brk_fee_mismatch/, 409, "fee_mismatch", "The invoice fee does not match the platform fee rule"],
  [/brk_invoice_financial_mismatch/, 409, "invoice_invalid", "The invoice does not match the accepted transaction terms"],
  [/brk_price_above_listing/, 409, "price_above_listing", "The final price exceeds the listing price"],
  [/brk_payout_in_progress/, 409, "payout_in_progress", "A payout has started and this refund cannot proceed"],
  [/brk_(order|amount|payer)_mismatch/, 409, "verification_failed", "The payment did not match the invoice"],
  [/brk_capture_conflict/, 409, "capture_conflict", "A different capture is already recorded for this payment"],
  [/brk_not_completed/, 409, "not_completed", "The payment is not completed at PayPal"],
];

/** Returns { status, code, message } or null when the message is not one of ours. */
export function mapDbError(message) {
  const text = String(message ?? "");
  for (const [re, status, code, msg] of TABLE) if (re.test(text)) return { status, code, message: msg };
  return null;
}
