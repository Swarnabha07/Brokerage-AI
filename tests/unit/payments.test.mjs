import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parsePriceToCents, valueFromCents, feeCentsFor, centsFromValue } from "../../lib/payments/money.mjs";
import { verifyBeforeCapture, verifyAfterCapture, classifyPayoutBatch, payeeStatus, verifyRefund } from "../../lib/payments/verify.mjs";
import { createPaypalClient, PAYPAL_SANDBOX_BASE, approvalUrlOf, safeProviderError } from "../../lib/payments/paypal-core.mjs";
import { mapDbError } from "../../lib/payments/errors.mjs";
import { buildFinancials, adminFinancials } from "../../lib/payments/financials.mjs";

describe("money", () => {
  test("price parsing is strict and integer-based", () => {
    assert.equal(parsePriceToCents("5"), 500);
    assert.equal(parsePriceToCents("5.15"), 515);
    assert.equal(parsePriceToCents("5.1"), 510);
    assert.equal(parsePriceToCents(5.15), 515);
    for (const bad of ["", "-1", "1e3", "5.155", "abc", "5,00", " ", null, undefined, NaN, Infinity, "1234567890", "21474836.48", {}]) assert.equal(parsePriceToCents(bad), null, String(bad));
    assert.equal(parsePriceToCents("21474836.47"), 2147483647);
  });
  test("fee model: $5.00 -> fee $0.15 -> buyer $5.15 -> seller $5.00", () => {
    const fee = feeCentsFor(500, 0.03);
    assert.equal(fee, 15);
    assert.equal(valueFromCents(500 + fee), "5.15");
    assert.equal(centsFromValue("5.15"), 515);
    assert.equal(feeCentsFor(285_00, 0.03), 855);
    assert.equal(feeCentsFor(50, 0.03), 2, "half-cent fee rounds half up like PostgreSQL numeric round");
  });
});

const exp = { orderId: "O1", paymentId: "P1", amountCents: 515, currency: "USD", payee: { merchantId: "MERCH1", email: "platform@x.test" } };
const order = (over = {}) => ({
  id: "O1", status: "APPROVED", intent: "CAPTURE",
  payer: { payer_id: "PAYER1" },
  purchase_units: [{ custom_id: "P1", amount: { currency_code: "USD", value: "5.15" }, payee: { merchant_id: "MERCH1", email_address: "PLATFORM@x.test" }, ...over }],
});
const completed = (cap = {}) => {
  const o = order();
  o.status = "COMPLETED";
  o.purchase_units[0].payments = { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "5.15" }, seller_receivable_breakdown: { paypal_fee: { value: "0.45" }, net_amount: { value: "4.70" } }, ...cap }] };
  return o;
};

describe("provider verification (never trusts the browser)", () => {
  test("pre-capture accepts only an approved, unpaid, matching order", () => {
    assert.equal(verifyBeforeCapture(order(), exp).ok, true);
    assert.deepEqual(verifyBeforeCapture({ ...order(), status: "CREATED" }, exp).failures, ["status"]);
    assert.ok(verifyBeforeCapture(order({ custom_id: "OTHER" }), exp).failures.includes("custom_id"));
    assert.ok(verifyBeforeCapture(order({ amount: { currency_code: "USD", value: "1.00" } }), exp).failures.includes("order_amount"));
    assert.ok(verifyBeforeCapture(order({ amount: { currency_code: "EUR", value: "5.15" } }), exp).failures.includes("order_amount"));
    assert.ok(verifyBeforeCapture(order({ payee: { merchant_id: "ATTACKER", email_address: "a@evil.test" } }), exp).failures.includes("payee"));
    assert.ok(verifyBeforeCapture({ ...order(), id: "O2" }, exp).failures.includes("order_id"));
    const already = order(); already.purchase_units[0].payments = { captures: [{ id: "C" }] };
    assert.ok(verifyBeforeCapture(already, exp).failures.includes("already_captured"));
  });
  test("payee identity is fail-closed before capture and after capture", () => {
    assert.equal(payeeStatus({ payee: {} }, exp.payee), "UNAVAILABLE");
    assert.equal(payeeStatus({ payee: { merchant_id: "MERCH1" } }, exp.payee), "MATCH");
    assert.equal(payeeStatus({ payee: { email_address: "other@x.test" } }, exp.payee), "MISMATCH");
    assert.equal(verifyBeforeCapture(order({ payee: {} }), exp).ok, false);
    assert.equal(verifyBeforeCapture(order(), { ...exp, payee: {} }).ok, false);
    assert.ok(verifyBeforeCapture(order({ payee: {} }), exp).failures.includes("payee_unavailable"));
    assert.equal(verifyBeforeCapture({ id: "O1", status: "APPROVED" }, exp).ok, false);
    const unavailableCapture = completed(); unavailableCapture.purchase_units[0].payee = {};
    assert.equal(verifyAfterCapture(unavailableCapture, exp).ok, false);
    assert.ok(verifyBeforeCapture(order({ payee: { merchant_id: "ATTACKER" } }), exp).failures.includes("payee"));
  });
  test("post-capture: exactly one COMPLETED capture of the right amount; fees read from PayPal", () => {
    const v = verifyAfterCapture(completed(), exp);
    assert.equal(v.ok, true);
    assert.equal(v.captureId, "CAP1");
    assert.equal(v.paypalFeeCents, 45);
    assert.equal(v.netCents, 470);
    assert.match(v.payerRefHash, /^[0-9a-f]{24}$/);
    assert.ok(!JSON.stringify(v).includes("PAYER1"), "raw payer id must not leave the verifier");
    assert.equal(verifyAfterCapture(completed({ status: "PENDING" }), exp).pending, true);
    assert.ok(verifyAfterCapture(completed({ amount: { currency_code: "USD", value: "5.00" } }), exp).failures.includes("capture_amount"));
    assert.ok(verifyAfterCapture(completed({ status: "DECLINED" }), exp).failures.includes("capture_status"));
    const two = completed(); two.purchase_units[0].payments.captures.push({ id: "CAP2", status: "COMPLETED", amount: { currency_code: "USD", value: "5.15" } });
    assert.ok(verifyAfterCapture(two, exp).failures.includes("capture_count"));
  });
});

describe("payout classification: only the ITEM proves the money moved", () => {
  const e = { senderBatchId: "brk-po-1", senderItemId: "brk-po-1-1", providerBatchId: "PB1", amountCents: 500, currency: "USD", destination: "Seller@T.test" };
  const batch = (item, bs = "SUCCESS") => ({ batch_header: { payout_batch_id: "PB1", batch_status: bs, sender_batch_header: { sender_batch_id: "brk-po-1" } }, items: item ? [{ payout_batch_id: "PB1", payout_item_id: "IT1", payout_item_fee: { value: "0.25" }, payout_item: { sender_item_id: "brk-po-1-1", amount: { value: "5.00", currency: "USD" }, receiver: "seller@t.test" }, ...item }] : [] });
  test("batch SUCCESS without an item is NOT success", () => {
    assert.equal(classifyPayoutBatch(batch(null, "SUCCESS"), e).state, "manual_review");
    assert.equal(classifyPayoutBatch(batch(null, "PENDING"), e).state, "manual_review");
    assert.equal(classifyPayoutBatch({ ...batch({ transaction_status: "SUCCESS" }), batch_header: { sender_batch_header: { sender_batch_id: e.senderBatchId }, batch_status: "SUCCESS" } }, e).state, "manual_review");
  });
  test("item states map correctly", () => {
    const r = classifyPayoutBatch(batch({ transaction_status: "SUCCESS" }), e);
    assert.equal(r.state, "succeeded"); assert.equal(r.feeCents, 25); assert.equal(r.itemId, "IT1");
    assert.equal(classifyPayoutBatch(batch({ transaction_status: "PENDING" }, "PENDING"), e).state, "pending");
    assert.equal(classifyPayoutBatch(batch({ transaction_status: "ONHOLD" }), e).state, "pending");
    assert.equal(classifyPayoutBatch(batch({ transaction_status: "UNCLAIMED" }), e).state, "manual_review");
    for (const s of ["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED"]) assert.equal(classifyPayoutBatch(batch({ transaction_status: s }), e).state, "failed", s);
    assert.equal(classifyPayoutBatch(batch(null, "DENIED"), e).state, "manual_review");
  });
  test("wrong amount, receiver or batch id goes to manual review even if SUCCESS", () => {
    const wrongAmt = batch({ transaction_status: "SUCCESS", payout_item: { sender_item_id: "brk-po-1-1", amount: { value: "9.00", currency: "USD" }, receiver: "seller@t.test" } });
    assert.equal(classifyPayoutBatch(wrongAmt, e).error, "payout_amount_mismatch");
    const wrongRcv = batch({ transaction_status: "SUCCESS", payout_item: { sender_item_id: "brk-po-1-1", amount: { value: "5.00", currency: "USD" }, receiver: "attacker@t.test" } });
    assert.equal(classifyPayoutBatch(wrongRcv, e).error, "payout_receiver_mismatch");
    assert.equal(classifyPayoutBatch(batch({ transaction_status: "SUCCESS" }), { ...e, senderBatchId: "other" }).error, "batch_id_mismatch");
    const noAmount = batch({ transaction_status: "SUCCESS", payout_item: { receiver: "seller@t.test" } });
    assert.equal(classifyPayoutBatch(noAmount, e).state, "manual_review");
    const noReceiver = batch({ transaction_status: "SUCCESS", payout_item: { amount: { value: "5.00", currency: "USD" } } });
    assert.equal(classifyPayoutBatch(noReceiver, e).state, "manual_review");
    assert.equal(classifyPayoutBatch(batch({ transaction_status: "SUCCESS" }), { ...e, destination: "" }).state, "manual_review");
    assert.equal(classifyPayoutBatch(batch({ transaction_status: "SUCCESS" }, "PENDING"), e).state, "manual_review");
    const noCurrency = batch({ transaction_status: "SUCCESS", payout_item: { sender_item_id: e.senderItemId, amount: { value: "5.00" }, receiver: "seller@t.test" } });
    assert.equal(classifyPayoutBatch(noCurrency, e).state, "manual_review");
    const noItemStatus = batch({ payout_item: { sender_item_id: e.senderItemId, amount: { value: "5.00", currency: "USD" }, receiver: "seller@t.test" } });
    assert.equal(classifyPayoutBatch(noItemStatus, e).state, "manual_review");
  });
});

describe("refund verification", () => {
  const expected = { refundId: "RF1", amountCents: 515, currency: "USD" };
  test("only exact PayPal refund id, amount, currency and known status verify", () => {
    assert.deepEqual(verifyRefund({ id: "RF1", status: "COMPLETED", amount: { value: "5.15", currency_code: "USD" } }, expected), { ok: true, status: "COMPLETED" });
    assert.equal(verifyRefund({ id: "RF1", status: "PENDING", amount: { value: "5.15", currency_code: "USD" } }, expected).status, "PENDING");
    assert.equal(verifyRefund({ id: "RF1", status: "FAILED", amount: { value: "5.15", currency_code: "USD" } }, expected).status, "FAILED");
    assert.equal(verifyRefund({ id: "RF1", status: "COMPLETED", amount: { value: "5.15", currency_code: "EUR" } }, expected).ok, false);
    assert.equal(verifyRefund({ id: "OTHER", status: "COMPLETED", amount: { value: "5.15", currency_code: "USD" } }, expected).ok, false);
    assert.equal(verifyRefund({ id: "RF1", status: "COMPLETED" }, expected).status, "UNVERIFIED");
  });
});

describe("PayPal client is Sandbox-only and idempotent", () => {
  function mockClient() {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const u = String(url);
      const res = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
      if (u.endsWith("/v1/oauth2/token")) return res(200, { access_token: "TOK", expires_in: 3000 });
      return res(201, { id: "X" });
    };
    return { calls, client: createPaypalClient({ clientId: "cid", secret: "sec", fetchImpl }) };
  }
  test("only the sandbox host is ever called", async () => {
    assert.equal(PAYPAL_SANDBOX_BASE, "https://api-m.sandbox.paypal.com");
    const { calls, client } = mockClient();
    await client.createOrder({ requestId: "R1", paymentId: "P1", invoiceNumber: "BRK-INV-000001", priceCents: 500, feeCents: 15, currency: "USD", returnUrl: "https://app.test/r", cancelUrl: "https://app.test/c" });
    await client.getOrder("O1"); await client.captureOrder("O1", "R2");
    await client.createPayout({ senderBatchId: "B", requestId: "R3", receiver: "s@t.test", amountCents: 500, currency: "USD" });
    await client.getPayoutBatch("B1"); await client.refundCapture({ captureId: "C", requestId: "R4", amountCents: 515, currency: "USD" });
    assert.ok(calls.length >= 7);
    assert.ok(calls.every((c) => String(c.url).startsWith("https://api-m.sandbox.paypal.com/")));
    const src = readFileSync("lib/payments/paypal-core.mjs", "utf8");
    assert.ok(!/https:\/\/api-m\.paypal\.com|https:\/\/api\.paypal\.com/.test(src), "no Live host in the client");
  });
  test("order body: server amounts only, deterministic request id, valid enum, no PII", async () => {
    const { calls, client } = mockClient();
    await client.createOrder({ requestId: "brk-pay-1", paymentId: "P1", invoiceNumber: "BRK-INV-000001", priceCents: 500, feeCents: 15, currency: "USD", returnUrl: "https://app.test/r", cancelUrl: "https://app.test/c" });
    const c = calls.find((x) => String(x.url).endsWith("/v2/checkout/orders"));
    assert.equal(c.init.headers["PayPal-Request-Id"], "brk-pay-1");
    const b = JSON.parse(c.init.body);
    assert.equal(b.intent, "CAPTURE");
    assert.equal(b.purchase_units[0].amount.value, "5.15");
    assert.equal(b.purchase_units[0].custom_id, "P1");
    assert.equal(b.payment_source.paypal.experience_context.payment_method_preference, "IMMEDIATE_PAYMENT_REQUIRED");
    assert.equal(b.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
    assert.equal(b.purchase_units[0].items.reduce((t, i) => t + Number(i.unit_amount.value), 0).toFixed(2), "5.15");
    assert.ok(b.purchase_units[0].items.every((i) => !i.category), "do not misclassify physical goods or services as digital goods");
    assert.ok(!/@/.test(c.init.body), "no emails in the order");
  });
  test("physical goods and services are not mislabeled as digital goods; PayPal address collection is explicitly disabled", async () => {
    const { calls, client } = mockClient();
    await client.createOrder({ requestId: "brk-pay-2", paymentId: "P2", invoiceNumber: "BRK-INV-000002", priceCents: 2500, feeCents: 75, currency: "USD", returnUrl: "https://app.test/r", cancelUrl: "https://app.test/c" });
    const b = JSON.parse(calls.find((x) => String(x.url).endsWith("/v2/checkout/orders")).init.body);
    assert.equal(b.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
    assert.ok(b.purchase_units[0].items.every((item) => !item.category));
  });
  test("capture and payout carry idempotency headers; token is cached", async () => {
    const { calls, client } = mockClient();
    await client.captureOrder("O1", "brk-cap-1");
    await client.createPayout({ senderBatchId: "brk-po-1", requestId: "brk-po-req-1", receiver: "s@t.test", amountCents: 500, currency: "USD" });
    assert.equal(calls.filter((c) => String(c.url).endsWith("/oauth2/token")).length, 1);
    assert.equal(calls.find((c) => /capture$/.test(String(c.url))).init.headers["PayPal-Request-Id"], "brk-cap-1");
    const po = calls.find((c) => /payouts$/.test(String(c.url)));
    assert.equal(po.init.headers["PayPal-Request-Id"], "brk-po-req-1");
    assert.equal(JSON.parse(po.init.body).sender_batch_header.sender_batch_id, "brk-po-1");
  });
  test("network failures are 'inconclusive' (never treated as a definite rejection)", async () => {
    const c = createPaypalClient({ clientId: "a", secret: "b", fetchImpl: async (u) => { if (String(u).includes("oauth")) return { status: 200, ok: true, text: async () => '{"access_token":"t"}' }; throw new Error("boom"); } });
    const r = await c.captureOrder("O1", "R");
    assert.equal(r.kind, "inconclusive");
    const s = await createPaypalClient({ clientId: "a", secret: "b", fetchImpl: async () => ({ status: 503, ok: false, text: async () => "{}" }) }).getOrder("O");
    assert.equal(s.kind, "inconclusive");
  });
  test("approval URL must be https PayPal; anything else is refused", () => {
    assert.ok(approvalUrlOf({ links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=O1" }] }));
    assert.equal(approvalUrlOf({ links: [{ rel: "payer-action", href: "https://evil.example.com/paypal.com" }] }), null);
    assert.equal(approvalUrlOf({ links: [{ rel: "payer-action", href: "http://www.sandbox.paypal.com/x" }] }), null);
    assert.equal(approvalUrlOf({ links: [{ rel: "payer-action", href: "javascript:alert(1)" }] }), null);
  });
  test("provider error summaries are bounded and contain no emails", () => {
    const t = safeProviderError({ status: 422, json: { name: "UNPROCESSABLE", message: "bad s@t.test", details: [{ issue: "INSTRUMENT_DECLINED" }] } });
    assert.match(t, /INSTRUMENT_DECLINED/); assert.ok(!t.includes("@"));
  });
});

describe("error mapping and financial views", () => {
  test("database exceptions map to safe statuses", () => {
    assert.equal(mapDbError("ERROR: brk_forbidden").status, 403);
    assert.equal(mapDbError("brk_invalid_state:paid").status, 409);
    assert.equal(mapDbError("brk_amount_mismatch").code, "verification_failed");
    assert.equal(mapDbError("relation foo does not exist"), null);
  });
  const rows = {
    invoice: { currency: "USD", invoice_number: "BRK-INV-000001", price_cents: 500, fee_cents: 15, total_cents: 515 },
    payment: { status: "captured", paypal_fee_cents: 45, provider_capture_id: "CAP1", request_id: "SECRET-REQ" },
    payout: { status: "succeeded", payout_fee_cents: 25, provider_item_id: "IT1", request_id: "SECRET-REQ2", sender_batch_id: "SB", last_error: "x" },
  };
  test("buyer/seller views never expose destinations, request ids, or the platform's net", () => {
    for (const role of ["buyer", "seller"]) {
      const f = buildFinancials(rows, role);
      const text = JSON.stringify(f);
      assert.ok(!/SECRET|sender_batch|last_error|platformNet|destination/i.test(text), role);
      assert.equal(f.buyerTotal, 5.15); assert.equal(f.sellerAmount, 5); assert.equal(f.paypalProcessingFee, 0.45); assert.equal(f.payoutFee, 0.25);
    }
    assert.equal(buildFinancials(rows, "buyer").paypalCaptureRef, "CAP1");
    assert.equal(buildFinancials(rows, "buyer").paypalPayoutRef, undefined);
    assert.equal(buildFinancials(rows, "seller").paypalPayoutRef, "IT1");
  });
  test("platform net is admin-only, computed from provider-reported fees, and can be negative", () => {
    const a = adminFinancials(rows);
    assert.equal(a.platformNet, -0.55); // 0.15 fee - 0.45 PayPal fee - 0.25 payout fee
    assert.equal(adminFinancials({ ...rows, payout: { status: "pending" } }).platformNet, null);
  });
});

describe("static guarantees", () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const MONEY = /fn_(issue|begin|set|record|fail|mark|confirm|open|evaluate|claim|requeue|resolve|cancel|complete|flag|clear)|executePayout|checkReleaseAndPay|settlePayment|startCheckout|captureCheckout|createOrder|captureOrder|createPayout|refundCapture|runScheduled/;

  test("GET handlers never call financial or state-changing operations", () => {
    for (const f of walk("app/api").filter((p) => p.endsWith("route.ts"))) {
      const src = readFileSync(f, "utf8");
      const m = src.match(/export async function GET[\s\S]*?(?=\nexport async function |$)/);
      if (m) assert.ok(!MONEY.test(m[0]), `${f} GET must stay read-only`);
    }
  });
  test("page rendering and dashboards never import money-moving code", () => {
    for (const f of [...walk("app").filter((p) => /page\.js$|layout\.js$/.test(p)), "lib/api/deals.js"]) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/payments\/(service|payouts|scheduler|admin|webhooks)/.test(src), `${f} imports money-moving modules`);
      assert.ok(!/releaseIfDue/.test(src), `${f} must not auto-release`);
    }
  });
  test("a voided checkout can only reconcile provider truth and capture requires a database reservation", () => {
    const service = readFileSync("lib/payments/service.ts", "utf8");
    assert.match(service, /'refund_pending',\s*'voided'/);
    assert.match(service, /capture:\s*payment\.status\s*!==\s*'voided'/);
    assert.match(service, /fn_mark_capture_started/);
    assert.ok(service.indexOf("fn_mark_capture_started") < service.indexOf("paypal.captureOrder"));
    assert.match(service, /dealStatus === 'cancelled' \|\| dealNeedsReview/);
  });
  test("capture and cancellation SQL use deal, invoice, payment lock order", () => {
    const sql = readFileSync("supabase/migrations/008_capture_expiry_terms_safety.sql", "utf8");
    for (const fn of ["fn_record_capture", "fn_cancel_deal", "fn_mark_capture_started"]) {
      const start = sql.indexOf(`function public.${fn}`);
      const end = sql.indexOf("end $$;", start);
      const body = sql.slice(start, end);
      const dealLock = body.indexOf("from public.deals where id=");
      const invoiceLock = body.indexOf("from public.invoices where", dealLock);
      const paymentLock = body.indexOf("from public.payments where", invoiceLock);
      assert.ok(dealLock >= 0 && invoiceLock > dealLock && paymentLock > invoiceLock, `${fn} locks deal -> invoice -> payment`);
    }
  });
  test("every financial POST route enforces same-origin, except cron (bearer) and webhooks (signature)", () => {
    const exempt = ["internal/payouts/run", "webhooks/paypal"];
    for (const f of walk("app/api").filter((p) => p.endsWith("route.ts"))) {
      const src = readFileSync(f, "utf8");
      const unixPath = f.replaceAll("\\", "/");
      if (!/export async function (POST|PUT|PATCH)/.test(src) || exempt.some((e) => unixPath.includes(e))) continue;
      if (/api\/auth\//.test(unixPath) || /api\/(listings|buyer|seed)\b/.test(unixPath) || /messages/.test(unixPath) || unixPath.endsWith("app/api/deals/route.ts")) continue; // pre-existing, non-financial (deal creation); see docs/PAYMENTS.md
      assert.ok(/assertSameOrigin/.test(src), `${f} missing assertSameOrigin`);
    }
  });
  test("the demo payment simulation is gone and nothing reads DEMO_SIMULATE_PAYMENT", () => {
    for (const f of [...walk("app"), ...walk("lib"), ...walk("components")].filter((p) => /\.(js|ts|tsx)$/.test(p))) {
      assert.ok(!/DEMO_SIMULATE_PAYMENT|DEMO_PAYMENT_SIMULATION_ENABLED/.test(readFileSync(f, "utf8")), f);
    }
  });
  test("no secrets are referenced by client components", () => {
    for (const f of walk("components").filter((p) => /\.js$/.test(p))) {
      assert.ok(!/PAYPAL_SECRET|SERVICE_ROLE|CRON_SECRET/.test(readFileSync(f, "utf8")), f);
    }
  });
});
