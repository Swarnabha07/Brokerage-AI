// Pure provider-response verification. Nothing here trusts the browser: callers pass amounts read
// from OUR database and the raw PayPal response. A result is "ok" only when every check passes.
import { createHash } from "node:crypto";
import { centsFromValue } from "./money.mjs";

const norm = (v) => (typeof v === "string" ? v.trim() : "");
const cmp = (seen, want, ci) => {
  const f = (v) => (ci ? norm(v).toLowerCase() : norm(v));
  const s = seen.map(f).filter(Boolean);
  const w = f(want);
  if (!s.length || !w) return "UNAVAILABLE";
  return s.every((x) => x === w) ? "MATCH" : "MISMATCH";
};
export const shortHash = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 24);

/** Payee identity: MISMATCH on any comparable field blocks; UNAVAILABLE is recorded, not trusted. */
export function payeeStatus(pu, payee) {
  const byId = cmp([pu?.payee?.merchant_id], payee?.merchantId, false);
  const byEmail = cmp([pu?.payee?.email_address], payee?.email, true);
  if (byId === "MISMATCH" || byEmail === "MISMATCH") return "MISMATCH";
  return byId === "MATCH" || byEmail === "MATCH" ? "MATCH" : "UNAVAILABLE";
}
export const payerRef = (order) => {
  const id = norm(order?.payment_source?.paypal?.account_id) || norm(order?.payer?.payer_id);
  return id ? shortHash(id) : null;
};

function commonChecks(order, exp, failures) {
  const pu = order?.purchase_units?.[0];
  if (!order || typeof order !== "object" || !Array.isArray(order.purchase_units)) failures.push("malformed_order");
  if (order?.id !== exp.orderId) failures.push("order_id");
  if (order?.intent !== "CAPTURE") failures.push("intent");
  if (order?.purchase_units?.length !== 1) failures.push("purchase_units");
  if (pu?.custom_id !== exp.paymentId) failures.push("custom_id");
  if (pu?.amount?.currency_code !== exp.currency || centsFromValue(pu?.amount?.value) !== exp.amountCents) failures.push("order_amount");
  const payee = payeeStatus(pu, exp.payee);
  if (payee === "MISMATCH") failures.push("payee");
  if (payee !== "MATCH") failures.push("payee_unavailable");
  return { pu, payee };
}

/** Before capturing: order must be APPROVED, ours, unpaid, for exactly the invoice total. */
export function verifyBeforeCapture(order, exp) {
  const failures = [];
  const { pu, payee } = commonChecks(order, exp, failures);
  if (order?.status !== "APPROVED") failures.push("status");
  if ((pu?.payments?.captures ?? []).length !== 0) failures.push("already_captured");
  return { ok: failures.length === 0, failures, payee, payerRefHash: payerRef(order) };
}

const cents = (m) => (m && typeof m.value === "string" ? centsFromValue(m.value) : null);

/** After capture: exactly one capture, right amount/currency, COMPLETED (or PENDING, reported as pending). */
export function verifyAfterCapture(order, exp) {
  const failures = [];
  const { pu, payee } = commonChecks(order, exp, failures);
  if (order?.status !== "COMPLETED") failures.push("order_status");
  const caps = pu?.payments?.captures ?? [];
  if (caps.length !== 1) failures.push("capture_count");
  const cap = caps[0];
  if (cap) {
    if (cap.amount?.currency_code !== exp.currency || centsFromValue(cap.amount?.value) !== exp.amountCents) failures.push("capture_amount");
    if (typeof cap.id !== "string" || !cap.id || cap.id.length > 64) failures.push("capture_id");
    if (!["COMPLETED", "PENDING"].includes(cap.status)) failures.push("capture_status");
  }
  const brk = cap?.seller_receivable_breakdown;
  return {
    ok: failures.length === 0,
    failures,
    payee,
    pending: cap?.status === "PENDING",
    captureId: cap?.id ?? null,
    captureStatus: cap?.status ?? null,
    payerRefHash: payerRef(order),
    paypalFeeCents: cents(brk?.paypal_fee),
    netCents: cents(brk?.net_amount),
  };
}

/**
 * Payout batch -> our state. ONLY the payout ITEM's status proves the money moved. Batch acceptance never counts.
 * succeeded | failed | pending | manual_review (money may be claimable / mismatch) | unknown
 */
export function classifyPayoutBatch(json, exp) {
  const batch = json?.batch_header;
  const items = json?.items;
  const item = Array.isArray(items) && items.length === 1 ? items[0] : null;
  const res = { state: "unknown", itemId: item?.payout_item_id ?? null, feeCents: cents(item?.payout_item_fee), error: null };
  if (!batch?.payout_batch_id || batch.payout_batch_id !== exp.providerBatchId)
    return { ...res, state: "manual_review", error: "provider_batch_id_mismatch" };
  if (!batch?.sender_batch_header?.sender_batch_id || batch.sender_batch_header.sender_batch_id !== exp.senderBatchId)
    return { ...res, state: "manual_review", error: "batch_id_mismatch" };
  if (!Array.isArray(items) || items.length !== 1 || !item?.payout_item_id)
    return { ...res, state: "manual_review", error: "payout_item_unverifiable" };
  if (item) {
    const pi = item.payout_item;
    if (item.payout_batch_id !== exp.providerBatchId || pi?.sender_item_id !== exp.senderItemId)
      return { ...res, state: "manual_review", error: "payout_item_mismatch" };
    if (!pi?.amount || typeof pi.amount.value !== "string" || !pi.amount.currency)
      return { ...res, state: "manual_review", error: "payout_amount_unavailable" };
    if (centsFromValue(pi.amount.value) !== exp.amountCents || pi.amount.currency !== exp.currency) {
      return { ...res, state: "manual_review", error: "payout_amount_mismatch" };
    }
    if (!norm(pi.receiver) || !norm(exp.destination))
      return { ...res, state: "manual_review", error: "payout_receiver_unavailable" };
    if (norm(pi.receiver).toLowerCase() !== norm(exp.destination).toLowerCase()) {
      return { ...res, state: "manual_review", error: "payout_receiver_mismatch" };
    }
    const ts = item.transaction_status;
    if (ts === "SUCCESS" && batch.batch_status === "SUCCESS") return { ...res, state: "succeeded" };
    if (ts === "SUCCESS") return { ...res, state: "manual_review", error: "batch_status_ambiguous" };
    if (!ts) return { ...res, state: "manual_review", error: "payout_item_status_unavailable" };
    if (ts === "UNCLAIMED") return { ...res, state: "manual_review", error: "unclaimed" };
    if (["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED", "DENIED"].includes(ts)) return { ...res, state: "failed", error: String(ts).toLowerCase() };
    if (["PENDING", "ONHOLD", "PROCESSING"].includes(ts)) return { ...res, state: "pending" };
    return { ...res, state: "manual_review", error: "payout_item_status_unknown" };
  }
  if (["DENIED", "CANCELED"].includes(batch?.batch_status)) return { ...res, state: "failed", error: String(batch.batch_status).toLowerCase() };
  if (["PENDING", "PROCESSING"].includes(batch?.batch_status)) return { ...res, state: "pending" };
  return res;
}

export function verifyRefund(refund, expected) {
  const amount = refund?.amount;
  const validStatus = ["COMPLETED", "PENDING", "FAILED"].includes(refund?.status);
  const amountCents = amount && typeof amount.value === "string" ? centsFromValue(amount.value) : null;
  const ok = !!refund && refund.id === expected.refundId && validStatus &&
    amountCents === expected.amountCents && amount?.currency_code === expected.currency;
  return { ok, status: validStatus && amountCents === expected.amountCents && amount?.currency_code === expected.currency ? refund.status : "UNVERIFIED" };
}
