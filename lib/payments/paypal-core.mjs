// Minimal PayPal REST client (native fetch, no dependencies), SANDBOX ONLY: there is no Live host in this
// file, so Live calls are impossible by construction. Fetch is injected so tests never touch the network.
import { valueFromCents } from "./money.mjs";

export const PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
const kindOf = (s) => (s >= 200 && s < 300 ? "ok" : s === 408 || s === 429 || s >= 500 ? "inconclusive" : "rejected");

export function createPaypalClient({ clientId, secret, fetchImpl = globalThis.fetch, timeoutMs = 20000, now = Date.now }) {
  let token = null;
  let tokenExp = 0;

  async function raw(method, path, { headers = {}, body, form } = {}) {
    if (!path.startsWith("/")) throw new Error("path must start with /");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const h = { Accept: "application/json", ...headers };
      let payload;
      if (form !== undefined) { h["Content-Type"] = "application/x-www-form-urlencoded"; payload = form; }
      else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
      const res = await fetchImpl(PAYPAL_SANDBOX_BASE + path, { method, headers: h, body: payload, signal: ctl.signal });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
      return { status: res.status, ok: res.ok, json, kind: kindOf(res.status) };
    } catch (e) {
      return { status: 0, ok: false, json: null, kind: "inconclusive", network: e?.name === "AbortError" ? "timeout" : "network" };
    } finally { clearTimeout(timer); }
  }

  async function getToken(force = false) {
    if (!force && token && now() < tokenExp - 60_000) return token;
    const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
    const r = await raw("POST", "/v1/oauth2/token", { headers: { Authorization: `Basic ${basic}` }, form: "grant_type=client_credentials" });
    if (!r.ok || !r.json?.access_token) return null;
    token = r.json.access_token;
    tokenExp = now() + (Number(r.json.expires_in) || 300) * 1000;
    return token;
  }

  async function call(method, path, opts = {}) {
    const t = await getToken();
    if (!t) return { status: 0, ok: false, json: null, kind: "inconclusive", network: "auth" };
    let r = await raw(method, path, { ...opts, headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${t}` } });
    if (r.status === 401) {
      const t2 = await getToken(true);
      if (!t2) return r;
      r = await raw(method, path, { ...opts, headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${t2}` } });
    }
    return r;
  }

  const enc = encodeURIComponent;
  return {
    call,
    /** Amounts are integer cents read from OUR database; the browser never supplies any of this. */
    createOrder: ({ requestId, paymentId, invoiceNumber, priceCents, feeCents, currency, returnUrl, cancelUrl }) =>
      call("POST", "/v2/checkout/orders", {
        headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
        body: {
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: invoiceNumber,
            custom_id: paymentId,
            description: `Brokerage AI deal ${invoiceNumber}`,
            amount: {
              currency_code: currency,
              value: valueFromCents(priceCents + feeCents),
              breakdown: { item_total: { currency_code: currency, value: valueFromCents(priceCents + feeCents) } },
            },
            items: [
              { name: `Brokerage AI transaction ${invoiceNumber}`, quantity: "1", unit_amount: { currency_code: currency, value: valueFromCents(priceCents) } },
              { name: "Brokerage AI platform fee", quantity: "1", unit_amount: { currency_code: currency, value: valueFromCents(feeCents) } },
            ],
          }],
          payment_source: { paypal: { experience_context: {
            brand_name: "Brokerage AI",
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          } } },
        },
      }),
    getOrder: (id) => call("GET", `/v2/checkout/orders/${enc(id)}`),
    captureOrder: (id, requestId) =>
      call("POST", `/v2/checkout/orders/${enc(id)}/capture`, { headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" }, body: {} }),
    createPayout: ({ senderBatchId, requestId, receiver, amountCents, currency }) =>
      call("POST", "/v1/payments/payouts", {
        headers: { "PayPal-Request-Id": requestId },
        body: {
          sender_batch_header: { sender_batch_id: senderBatchId, email_subject: "Your Brokerage AI payout (Sandbox)", email_message: "Payout for a completed Brokerage AI deal.", recipient_type: "EMAIL" },
          items: [{ recipient_type: "EMAIL", receiver, amount: { currency, value: valueFromCents(amountCents) }, note: "Brokerage AI deal payout", sender_item_id: `${senderBatchId}-1`, recipient_wallet: "PAYPAL" }],
        },
      }),
    getPayoutBatch: (id) => call("GET", `/v1/payments/payouts/${enc(id)}`),
    refundCapture: ({ captureId, requestId, amountCents, currency }) =>
      call("POST", `/v2/payments/captures/${enc(captureId)}/refund`, {
        headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" },
        body: { amount: { value: valueFromCents(amountCents), currency_code: currency }, note_to_payer: "Refund from Brokerage AI" },
      }),
    getRefund: (refundId) => call("GET", `/v2/payments/refunds/${enc(refundId)}`),
    verifyWebhook: ({ headers, event, webhookId }) =>
      call("POST", "/v1/notifications/verify-webhook-signature", { body: {
        auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: webhookId, webhook_event: event,
      } }),
  };
}

/** Safe, bounded text from a PayPal error body for logs/DB (no tokens, no emails). */
export function safeProviderError(r) {
  if (r?.network) return `network:${r.network}`;
  const j = r?.json ?? {};
  const issues = (Array.isArray(j.details) ? j.details : []).slice(0, 3).map((d) => d.issue).filter(Boolean).join(",");
  return `http_${r?.status}${j.name ? `:${j.name}` : ""}${issues ? `:${issues}` : ""}`.slice(0, 200);
}

/** The approval URL must be an https PayPal URL; never redirect a user anywhere else. */
export function approvalUrlOf(order) {
  const href = (order?.links ?? []).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  try {
    const u = new URL(href);
    return u.protocol === "https:" && /(^|\.)paypal\.com$/.test(u.hostname) ? u.toString() : null;
  } catch { return null; }
}
