/**
 * Client adapter for deal mutations. EVERY call is authorized server-side
 * (verified session + deal membership + allowed transition). Sample (non-UUID) deals are
 * local-only simulations and never touch the server.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isLiveDealId = (id) => typeof id === "string" && UUID_RE.test(id);

async function request(url, options) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Requests a lifecycle transition (server validates role, ownership and allowed transition). */
export async function updateDealStage(dealId, status, extra = {}) {
  if (!isLiveDealId(dealId)) return { id: dealId, status, ...extra, isSample: true };
  const payload = { status };
  if (extra.tracking_number) payload.tracking_number = extra.tracking_number;
  return request(`/api/deals/${dealId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export const approveTerms = (dealId) => updateDealStage(dealId, "invoiced");
export const markShipped = (dealId, trackingNumber) =>
  updateDealStage(dealId, "shipped", { tracking_number: trackingNumber });

/** Buyer confirms receipt; the server stamps the return-window start time. */
export async function confirmReceived(dealId) {
  if (!isLiveDealId(dealId)) {
    return { id: dealId, status: "return_window", isSample: true };
  }
  return request(`/api/deals/${dealId}/confirm-receipt`, { method: "POST" });
}

/**
 * Asks the SERVER whether the window has ended. The server decides using its own clock;
 * this call can never force a release.
 */
export async function checkRelease(dealId) {
  if (!isLiveDealId(dealId)) return { released: true, isSample: true };
  return request(`/api/deals/${dealId}/release`, { method: "POST" });
}

/** Posts a message as the signed-in user (sender is derived server-side). */
export async function addDealMessage(dealId, { text }) {
  return request(`/api/deals/${dealId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
}
