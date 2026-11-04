/**
 * Unified Payment, Escrow, and Lifecycle API adapter.
 * Replaces client-only local state simulation by delegating deal mutations
 * to backend Next.js API routes (/api/deals/[id]).
 */

/**
 * Updates a deal's lifecycle stage and optional metadata (price, tracking, terms).
 */
export async function updateDealStage(dealId, status, extraPayload = {}) {
  const isUuid =
    dealId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId);

  // If dealId is a sample/mock deal (e.g., BRK-2026-0147), return local success
  if (!isUuid) {
    return { id: dealId, status, ...extraPayload, isSample: true };
  }

  const res = await fetch(`/api/deals/${dealId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, ...extraPayload }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to transition deal to ${status}`);
  }

  return data;
}

/**
 * Stage 2 -> 3: Seller reviews and approves negotiated terms, generating the invoice.
 */
export async function approveTerms(dealId) {
  return updateDealStage(dealId, "invoiced");
}

/**
 * Stage 3 -> 4: Buyer reviews invoice and captures payment through checkout.
 */
export async function capturePayment(dealId, paymentDetails = {}) {
  return updateDealStage(dealId, "paid", { payment_details: paymentDetails });
}

/**
 * Stage 4 -> 5: Seller marks the order as shipped with tracking info.
 */
export async function markShipped(dealId, trackingNumber = "TRK-2026-0042") {
  return updateDealStage(dealId, "shipped", { tracking_number: trackingNumber });
}

/**
 * Stage 5 -> 6: Buyer confirms item received, initiating the 60-second return window countdown.
 */
export async function confirmReceived(dealId) {
  const isUuid =
    dealId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId);

  if (!isUuid) {
    return {
      id: dealId,
      status: "return_window",
      terms: { return_window_started_at: new Date().toISOString() },
      isSample: true,
    };
  }

  const res = await fetch(`/api/deals/${dealId}/confirm-receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to confirm delivery receipt");
  }

  return data;
}

/**
 * Stage 6 -> 7: Return window closes; platform triggers payout release to seller.
 */
export async function releasePayout(dealId) {
  return updateDealStage(dealId, "released");
}

/**
 * Appends a message to the deal negotiation thread.
 */
export async function addDealMessage(dealId, { sender, text, isAiGenerated = false }) {
  const isUuid =
    dealId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId);

  if (!isUuid) {
    return { id: `mock-${Date.now()}`, deal_id: dealId, sender, text, is_ai_generated: isAiGenerated };
  }

  const res = await fetch(`/api/deals/${dealId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, text, is_ai_generated: isAiGenerated }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to post message");
  }

  return data;
}

