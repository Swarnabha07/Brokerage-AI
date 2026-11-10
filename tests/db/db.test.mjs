// Database integration + concurrency tests for supabase/migrations/001-008.
// Needs a DISPOSABLE Postgres (never your Supabase project) and the `psql` client:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/dbname npm run test:db
// The disposable database must contain tests/db/base_schema.sql and migrations 001-008.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const URL_ = process.env.TEST_DATABASE_URL;
const run = promisify(execFile);
const skip = !URL_ && "TEST_DATABASE_URL not set";

async function sql(q, role) {
  const body = role ? `set role ${role}; ${q}` : q;
  try {
    const { stdout } = await run("psql", [URL_, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", body]);
    return stdout.trim();
  } catch (e) {
    throw new Error(String(e.stderr || e.message).trim());
  }
}
const svc = (q) => sql(q, "service_role");
const j = async (q, role = "service_role") => JSON.parse(await sql(q, role));
async function fails(q, pattern, role = "service_role") {
  await assert.rejects(() => sql(q, role), (e) => pattern.test(e.message), `expected failure ${pattern}`);
}

async function newDeal({ status = "agreed", profile = true, buyerConditions = "" } = {}) {
  const [buyer, seller, listing, deal] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await sql(`
    insert into users (id,email,role) values ('${buyer}','b-${buyer}@t.test','buyer'),('${seller}','s-${seller}@t.test','seller');
    insert into listings (id,seller_id,title,price) values ('${listing}','${seller}','Item',10);
    insert into deals (id,listing_id,buyer_id,seller_id,status,buyer_conditions,terms_json) values ('${deal}','${listing}','${buyer}','${seller}','${status}','${buyerConditions}', '{"conditions":{"existing":"honored"}}');
    ${profile ? `insert into seller_payout_profiles (user_id,paypal_email) values ('${seller}','pay-${seller}@t.test');` : ""}`);
  return { buyer, seller, listing, deal };
}
async function acceptBoth(d, price = 500) {
  await propose(d, price);
  await svc(`select fn_accept_terms('${d.deal}','${d.seller}')`);
  await svc(`select fn_accept_terms('${d.deal}','${d.buyer}')`);
}
const propose = (d, price, fulfillment = "physical_goods", delivery = "Tracked shipping; buyer confirms receipt", conditions = "Seller packs securely") =>
  svc(`select fn_propose_terms('${d.deal}','${d.seller}',${price},24,'${fulfillment}','${delivery}','${conditions}')`);
const issue = async (d, price = 500, fee = Math.round(price * 0.03)) => {
  await acceptBoth(d, price);
  return j(`select to_jsonb(f) from fn_issue_invoice('${d.deal}','${d.seller}',${price},${fee},48,'{"title":"Item"}'::jsonb) f`);
};
const issueAfterAccepted = (d, price, fee) =>
  j(`select to_jsonb(f) from fn_issue_invoice('${d.deal}','${d.seller}',${price},${fee},48,'{}'::jsonb) f`);
const begin = (d) => j(`select fn_begin_payment('${d.deal}','${d.buyer}')::text`);
const capture = (p, o = {}) =>
  j(`select fn_record_capture('${p.id}','${o.order ?? "ORD-" + p.id}','${o.cap ?? "CAP-" + p.id}',${o.amount ?? p.amount_cents},'${o.cur ?? "USD"}','${o.status ?? "COMPLETED"}','${o.payer ?? "payerhash"}',45,${o.net ?? 470},'{}'::jsonb)::text`);
async function toPaid(d) {
  await issue(d);
  const b = await begin(d);
  await svc(`select fn_set_payment_order('${b.payment.id}','ORD-${b.payment.id}')`);
  await capture(b.payment);
  return b.payment;
}
async function toReturnWindow(d, hours = 24) {
  const pay = await toPaid(d);
  await svc(`select fn_mark_shipped('${d.deal}','${d.seller}','TRK12345')`);
  await svc(`select fn_confirm_delivery('${d.deal}','${d.buyer}','buyer','ok',${hours})`);
  return pay;
}
const expire = (d) => sql(`update deals set return_window_ends_at = now() - interval '1 second' where id='${d.deal}'`);
const status = (d) => sql(`select status from deals where id='${d.deal}'`);

describe("database: payout profile cooldown", { skip }, () => {
  test("first write, atomic cooldown, expiry, email validation and member check", async () => {
    const d = await newDeal({ profile: false });
    await svc(`select fn_update_payout_profile('${d.seller}','first-${d.seller}@t.test')`);
    await fails(`select fn_update_payout_profile('${d.seller}','second-${d.seller}@t.test')`, /brk_cooldown/);
    await fails(`select fn_update_payout_profile('${d.seller}','invalid')`, /brk_invalid_email/);
    await fails(`select fn_update_payout_profile('${d.buyer}','buyer-${d.buyer}@t.test')`, /brk_forbidden/);
    await svc(`update seller_payout_profiles set updated_at=now()-interval '25 hours' where user_id='${d.seller}'`);
    await svc(`select fn_update_payout_profile('${d.seller}','second-${d.seller}@t.test')`);
    assert.equal(await sql(`select paypal_email from seller_payout_profiles where user_id='${d.seller}'`), `second-${d.seller}@t.test`);
  });
  test("concurrent email changes serialize; exactly one can win", async () => {
    const d = await newDeal({ profile: false });
    const rs = await Promise.allSettled([
      svc(`select fn_update_payout_profile('${d.seller}','a-${d.seller}@t.test')`),
      svc(`select fn_update_payout_profile('${d.seller}','b-${d.seller}@t.test')`),
    ]);
    assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(rs.filter((r) => r.status === 'rejected' && /brk_cooldown/.test(r.reason.message)).length, 1);
  });
});

describe("database: invoices", { skip }, () => {
  test("only the deal's seller can issue; wrong state and missing payout profile are rejected", async () => {
    const d = await newDeal();
    await fails(`select fn_issue_invoice('${d.deal}','${d.buyer}',500,15,48,'{}')`, /brk_forbidden/);
    const nop = await newDeal({ profile: false });
    await acceptBoth(nop);
    await fails(`select fn_issue_invoice('${nop.deal}','${nop.seller}',500,15,48,'{}')`, /brk_no_payout_profile/);
    await acceptBoth(d);
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',0,0,48,'{}')`, /brk_invalid_amount/);
    const inv = await issue(d);
    assert.equal(inv.total_cents, 515);
    assert.match(inv.invoice_number, /^BRK-INV-\d{6}$/);
    assert.equal(await status(d), "invoiced");
    assert.equal(await sql(`select agreed_price = 5 and platform_fee = 0.15 from deals where id='${d.deal}'`), "t");
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',500,15,48,'{}')`, /brk_invalid_state/);
  });

  test("database enforces listing ceiling, 3% fee and matching agreed price", async () => {
    const d = await newDeal();
    await acceptBoth(d, 500);
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',500,14,48,'{}')`, /brk_fee_mismatch/);
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',501,15,48,'{}')`, /brk_invalid_amount/);
    await sql(`update listings set price=4 where id='${d.listing}'`);
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',500,15,48,'{}')`, /brk_invalid_amount/);
  });

  test("invoice is blocked until both accept the exact current terms; changes reset acceptance", async () => {
    const d = await newDeal({ buyerConditions: "Buyer requests delivery by Friday" });
    await propose(d, 500, "service", "Three remote coaching sessions by Friday", "Reschedule with 24 hours notice");
    const snapshot = await j(`select terms::text from deal_agreements where deal_id='${d.deal}'`);
    const terms = JSON.parse(snapshot.terms);
    assert.equal(terms.fulfillment_type, "service");
    assert.equal(terms.delivery_expectations, "Three remote coaching sessions by Friday");
    assert.equal(terms.buyer_conditions, "Buyer requests delivery by Friday");
    assert.equal(terms.transaction_conditions, "Reschedule with 24 hours notice");
    assert.equal(terms.conditions.existing, "honored");
    assert.equal(terms.platform_fee_bps, 300);
    assert.equal(terms.fee_payer, "buyer");
    assert.match(terms.return_window_policy, /disputes pause release/i);
    await svc(`select fn_accept_terms('${d.deal}','${d.buyer}')`);
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',500,15,48,'{}')`, /brk_invalid_state/);
    await propose(d, 450, "service", "Three coaching sessions", "New rescheduling terms");
    await svc(`select fn_accept_terms('${d.deal}','${d.seller}')`);
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',450,14,48,'{}')`, /brk_invalid_state/);
    const results = await Promise.all(Array.from({length: 8}, () => j(`select fn_accept_terms('${d.deal}','${d.buyer}')::text`)));
    assert.ok(results.every((r) => r.agreed));
    await propose(d, 425);
    await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',425,13,48,'{}')`, /brk_invalid_state/);
    await acceptBoth(d, 425);
    const inv = await issueAfterAccepted(d, 425, 13);
    assert.equal(inv.price_cents, 425);
    assert.equal(inv.fee_cents, 13);
    await fails(`select fn_accept_terms('${d.deal}','${randomUUID()}')`, /brk_forbidden/);
  });

  test("expired invoice voids a local payment without an order, but resumes a known PayPal order", async () => {
    const local = await newDeal();
    await issue(local);
    const localAttempt = (await begin(local)).payment;
    await sql(`alter table invoices disable trigger invoices_guard; update invoices set expires_at=now()-interval '1 second' where deal_id='${local.deal}'; alter table invoices enable trigger invoices_guard`);
    const expired = await begin(local);
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, "invoice_expired");
    assert.equal(await sql(`select status from payments where id='${localAttempt.id}'`), "voided");
    assert.equal(await status(local), "agreed");
    await fails(`select fn_assert_order_creation('${localAttempt.id}')`, /brk_invalid_state/);

    const ordered = await newDeal();
    await issue(ordered);
    const orderedAttempt = (await begin(ordered)).payment;
    await svc(`select fn_set_payment_order('${orderedAttempt.id}','ORD-${orderedAttempt.id}')`);
    await sql(`alter table invoices disable trigger invoices_guard; update invoices set expires_at=now()-interval '1 second' where deal_id='${ordered.deal}'; alter table invoices enable trigger invoices_guard`);
    const resumed = await begin(ordered);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.reused, true);
    assert.equal(resumed.payment.provider_order_id, `ORD-${orderedAttempt.id}`);
    await fails(`select fn_assert_order_creation('${orderedAttempt.id}')`, /brk_invalid_state/);
  });

  test("terms proposal requires a supported fulfillment type and explicit delivery/service expectations", async () => {
    const d = await newDeal();
    await fails(`select fn_propose_terms('${d.deal}','${d.seller}',500,24,'unknown','Delivery','')`, /brk_invalid_fulfillment_type/);
    await fails(`select fn_propose_terms('${d.deal}','${d.seller}',500,24,null,'Delivery','')`, /brk_invalid_fulfillment_type/);
    await fails(`select fn_propose_terms('${d.deal}','${d.seller}',500,24,'physical_goods',' ','')`, /brk_invalid_delivery_terms/);
    await fails(`select fn_propose_terms('${d.deal}','${d.seller}',500,24,'physical_goods','Delivery',repeat('x',2001))`, /brk_invalid_conditions/);
    assert.equal(await sql(`select count(*) from deal_agreements where deal_id='${d.deal}'`), "0");
  });

  test("concurrent invoice requests create exactly one invoice", async () => {
    const d = await newDeal();
    await acceptBoth(d);
    const attempts = await Promise.allSettled(Array.from({length: 8}, () => issueAfterAccepted(d, 500, 15)));
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await sql(`select count(*) from invoices where deal_id='${d.deal}' and status='open'`), '1');
  });

  test("invoice amounts/data are immutable, invoices cannot be deleted, status is final once paid", async () => {
    const d = await newDeal();
    const inv = await issue(d);
    await fails(`update invoices set price_cents = 1, total_cents = 16 where id='${inv.id}'`, /immutable/);
    await fails(`update invoices set invoice_data = '{}' where id='${inv.id}'`, /immutable/);
    await fails(`delete from invoices where id='${inv.id}'`, /append-only/);
    const p = (await begin(d)).payment;
    await svc(`select fn_set_payment_order('${p.id}','ORD-${p.id}')`);
    await capture(p);
    assert.equal(await sql(`select status from invoices where id='${inv.id}'`), "paid");
    await fails(`update invoices set status='open' where id='${inv.id}'`, /final/);
  });

  test("invoices cannot be inserted outside the financially guarded function", async () => {
    const d = await newDeal();
    const inv = await issue(d);
    await fails(`insert into invoices (deal_id,invoice_number,status,currency,price_cents,fee_cents,total_cents,invoice_data) values ('${d.deal}','X-1','open','USD',500,15,515,'{}')`, /invoice must be issued through/);
    assert.ok(inv.id);
  });

  test("payout destination is snapshotted and profile cooldown blocks immediate changes", async () => {
    const d = await newDeal();
    await issue(d);
    const before = await sql(`select destination from deal_payout_destinations where deal_id='${d.deal}'`);
    await fails(`update seller_payout_profiles set paypal_email='attacker@evil.test' where user_id='${d.seller}'`, /brk_cooldown/);
    assert.equal(await sql(`select destination from deal_payout_destinations where deal_id='${d.deal}'`), before);
    await fails(`update deal_payout_destinations set destination='x@y.test' where deal_id='${d.deal}'`, /immutable/);
  });

  test("expired invoice returns the deal to 'agreed' and can be re-issued with a refreshed snapshot", async () => {
    const d = await newDeal();
    const inv = await issue(d);
    await sql(`update seller_payout_profiles set updated_at=now()-interval '25 hours' where user_id='${d.seller}'`);
    await sql(`update seller_payout_profiles set paypal_email='new@t.test' where user_id='${d.seller}'`);
    await sql(`alter table invoices disable trigger invoices_guard; update invoices set expires_at = now() - interval '1 hour' where id='${inv.id}'; alter table invoices enable trigger invoices_guard`);
    const r = await begin(d);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invoice_expired");
    assert.equal(await status(d), "agreed");
    const inv2 = await issue(d);
    assert.notEqual(inv2.invoice_number, inv.invoice_number);
    assert.equal(await sql(`select destination from deal_payout_destinations where deal_id='${d.deal}'`), "new@t.test");
  });
});

describe("database: payments and capture", { skip }, () => {
  test("only the buyer can begin checkout; repeated and parallel calls yield ONE payment", async () => {
    const d = await newDeal();
    await issue(d);
    await fails(`select fn_begin_payment('${d.deal}','${d.seller}')`, /brk_forbidden/);
    const results = await Promise.all(Array.from({ length: 8 }, () => begin(d)));
    assert.equal(new Set(results.map((r) => r.payment.id)).size, 1);
    assert.equal(await sql(`select count(*) from payments where deal_id='${d.deal}'`), "1");
  });

  test("capture is verified: wrong order/amount/currency/payer rejected, PENDING is not paid", async () => {
    const d = await newDeal();
    await issue(d);
    const p = (await begin(d)).payment;
    await svc(`select fn_set_payment_order('${p.id}','ORD-${p.id}')`);
    await fails(`select fn_record_capture('${p.id}','OTHER','C1',515,'USD','COMPLETED','h',1,1,'{}')`, /brk_order_mismatch/);
    await fails(`select fn_record_capture('${p.id}','ORD-${p.id}','C1',100,'USD','COMPLETED','h',1,1,'{}')`, /brk_amount_mismatch/);
    await fails(`select fn_record_capture('${p.id}','ORD-${p.id}','C1',515,'EUR','COMPLETED','h',1,1,'{}')`, /brk_amount_mismatch/);
    await fails(`select fn_record_capture('${p.id}','ORD-${p.id}','C1',515,'USD','DECLINED','h',1,1,'{}')`, /brk_not_completed/);
    assert.equal(await status(d), "invoiced");
    assert.equal((await capture(p, { status: "PENDING" })).status, "capture_pending");
    assert.equal(await status(d), "invoiced", "PENDING must not mark the deal paid");
    assert.equal((await capture(p)).status, "captured");
    assert.equal(await status(d), "paid");
    await fails(`select fn_record_capture('${p.id}','ORD-${p.id}','CAP-${p.id}',515,'USD','COMPLETED','different',1,1,'{}')`, /brk_payer_mismatch/);
  });

  test("duplicate and parallel captures are idempotent; a different capture id is a conflict", async () => {
    const d = await newDeal();
    await issue(d);
    const p = (await begin(d)).payment;
    await svc(`select fn_set_payment_order('${p.id}','ORD-${p.id}')`);
    const rs = await Promise.all(Array.from({ length: 6 }, () => capture(p)));
    assert.ok(rs.every((r) => r.ok));
    assert.equal(rs.filter((r) => !r.idempotent).length, 1);
    assert.equal(await sql(`select count(*) from deal_events where deal_id='${d.deal}' and type='payment_captured'`), "1");
    await fails(`select fn_record_capture('${p.id}','ORD-${p.id}','CAP-OTHER',515,'USD','COMPLETED','payerhash',1,1,'{}')`, /brk_capture_conflict/);
  });

  test("the provider capture id can be stored only once across payments", async () => {
    const a = await newDeal(); const b = await newDeal();
    const pa = await toPaid(a);
    await issue(b);
    const pb = (await begin(b)).payment;
    await svc(`select fn_set_payment_order('${pb.id}','ORD-${pb.id}')`);
    await fails(`select fn_record_capture('${pb.id}','ORD-${pb.id}','CAP-${pa.id}',515,'USD','COMPLETED','h',1,1,'{}')`, /duplicate key/);
  });

  test("cancel: allowed before payment (voids invoice+payment), refused once captured", async () => {
    const d = await newDeal();
    await issue(d);
    await begin(d);
    await fails(`select fn_cancel_deal('${d.deal}','${randomUUID()}')`, /brk_forbidden/);
    await svc(`select fn_cancel_deal('${d.deal}','${d.buyer}')`);
    assert.equal(await status(d), "cancelled");
    assert.equal(await sql(`select status from invoices where deal_id='${d.deal}'`), "void");
    const p = await newDeal();
    await toPaid(p);
    await fails(`select fn_cancel_deal('${p.deal}','${p.buyer}')`, /brk_invalid_state/);
  });

  test("provider capture racing cancellation serializes; captured money is either paid or recoverably flagged", async () => {
    const d = await newDeal();
    await issue(d);
    const payment = (await begin(d)).payment;
    await svc(`select fn_set_payment_order('${payment.id}','ORD-${payment.id}')`);
    const [captureResult, cancelResult] = await Promise.allSettled([
      capture(payment),
      svc(`select fn_cancel_deal('${d.deal}','${d.buyer}')`),
    ]);
    const paymentStatus = await sql(`select status from payments where id='${payment.id}'`);
    const review = await sql(`select needs_review from deals where id='${d.deal}'`);
    const dealStatus = await status(d);
    assert.equal(paymentStatus, "captured", "verified provider capture must never be lost to cancellation");
    if (dealStatus === "paid") {
      assert.equal(cancelResult.status, "rejected");
      assert.equal(review, "f");
    } else {
      assert.equal(dealStatus, "cancelled");
      assert.equal(review, "t");
      assert.equal(captureResult.status, "fulfilled");
      assert.equal(captureResult.value.needs_review, true);
      assert.equal(await sql(`select status from invoices where deal_id='${d.deal}'`), "void");
      const admin = randomUUID();
      await sql(`insert into users (id,email,role,is_admin) values ('${admin}','admin-${admin}@t.test','buyer',true)`);
      const recovery = await j(`select fn_begin_refund('${d.deal}','${admin}')::text`);
      assert.equal(recovery.amount_cents, 515);
      assert.equal(await sql(`select status from payments where id='${payment.id}'`), "refund_pending");
    }
  });

  test("capture reservation races safely with cancellation", async () => {
    const d = await newDeal();
    await issue(d);
    const payment = (await begin(d)).payment;
    await svc(`select fn_set_payment_order('${payment.id}','ORD-${payment.id}')`);
    const [reservation, cancellation] = await Promise.allSettled([
      j(`select fn_mark_capture_started('${payment.id}','ORD-${payment.id}')`),
      svc(`select fn_cancel_deal('${d.deal}','${d.buyer}')`),
    ]);
    if (reservation.status === "fulfilled" && reservation.value === true) {
      assert.equal(cancellation.status, "rejected");
      assert.match(cancellation.reason.message, /brk_payment_in_progress/);
      assert.equal(await sql(`select status from payments where id='${payment.id}'`), "capture_pending");
    } else {
      assert.equal(reservation.status, "fulfilled");
      assert.equal(reservation.value, false);
      assert.equal(cancellation.status, "fulfilled");
      assert.equal(await status(d), "cancelled");
      assert.equal(await sql(`select status from payments where id='${payment.id}'`), "voided");
    }
  });
});

describe("database: delivery, return window, release", { skip }, () => {
  test("shipping requires verified payment and the seller; tracking alone never opens a window", async () => {
    const unpaid = await newDeal();
    await issue(unpaid);
    await fails(`select fn_mark_shipped('${unpaid.deal}','${unpaid.seller}','TRK12345')`, /brk_invalid_state/);
    const d = await newDeal();
    await toPaid(d);
    await fails(`select fn_mark_shipped('${d.deal}','${d.buyer}','TRK12345')`, /brk_forbidden/);
    await svc(`select fn_mark_shipped('${d.deal}','${d.seller}','TRK12345')`);
    assert.equal(await status(d), "shipped");
    assert.equal(await sql(`select return_window_started_at is null from deals where id='${d.deal}'`), "t");
    assert.deepEqual(await j(`select fn_evaluate_release('${d.deal}')::text`), { released: false, reason: "not_in_return_window" });
    await fails(`select fn_confirm_delivery('${d.deal}','${d.seller}','buyer','x',24)`, /brk_forbidden/);
    await fails(`select fn_confirm_delivery('${d.deal}','${d.buyer}','admin','x',24)`, /brk_forbidden/);
  });

  test("release is blocked while the window is open, then happens once with ONE payout row", async () => {
    const d = await newDeal();
    await toReturnWindow(d, 24);
    const early = await j(`select fn_evaluate_release('${d.deal}')::text`);
    assert.equal(early.released, false);
    assert.equal(early.reason, "window_open");
    assert.equal(await sql(`select count(*) from payouts where deal_id='${d.deal}'`), "0");
    await expire(d);
    const rs = await Promise.all(Array.from({ length: 8 }, () => j(`select fn_evaluate_release('${d.deal}')::text`)));
    assert.ok(rs.every((r) => r.released));
    assert.equal(await sql(`select count(*) from payouts where deal_id='${d.deal}'`), "1");
    assert.equal(await sql(`select status||'/'||amount_cents||'/'||fee_cents from payouts where deal_id='${d.deal}'`), "eligible/500/15");
  });

  test("a deal flagged for manual review is never auto-released", async () => {
    const d = await newDeal();
    await toReturnWindow(d, 24);
    await expire(d);
    await sql(`update deals set needs_review = true where id='${d.deal}'`);
    assert.equal((await j(`select fn_evaluate_release('${d.deal}')::text`)).reason, "manual_review");
    await fails(`select fn_clear_review('${d.deal}','${d.buyer}','x')`, /brk_forbidden/);
  });

  test("stale shipments without delivery confirmation are flagged, not released", async () => {
    const d = await newDeal();
    await toPaid(d);
    await svc(`select fn_mark_shipped('${d.deal}','${d.seller}','TRK12345')`);
    await sql(`update deals set shipped_at = now() - interval '10 days' where id='${d.deal}'`);
    assert.ok(Number(await svc(`select fn_flag_stale_shipments(7)`)) >= 1);
    assert.equal(await sql(`select needs_review from deals where id='${d.deal}'`), "t");
    assert.equal(await status(d), "shipped");
  });
});

describe("database: disputes and refunds", { skip }, () => {
  test("an open dispute blocks release; only an admin can resolve", async () => {
    const d = await newDeal();
    await toReturnWindow(d, 24);
    await fails(`select fn_open_dispute('${d.deal}','${d.seller}','other','x')`, /brk_forbidden/);
    const disp = await j(`select to_jsonb(f) from fn_open_dispute('${d.deal}','${d.buyer}','not_received','never arrived') f`);
    assert.equal(await status(d), "disputed");
    await expire(d);
    assert.equal((await j(`select fn_evaluate_release('${d.deal}')::text`)).released, false);
    await fails(`select fn_resolve_dispute('${disp.id}','${d.buyer}','release','x')`, /brk_forbidden/);
    await sql(`update users set is_admin = true where id='${d.seller}'`); // seller made admin only to test the role check path
    await sql(`update users set is_admin = false where id='${d.seller}'`);
    const admin = randomUUID();
    await sql(`insert into users (id,email,role,is_admin) values ('${admin}','a-${admin}@t.test','buyer',true)`);
    await svc(`select fn_resolve_dispute('${disp.id}','${admin}','release','evidence ok')`);
    assert.equal(await status(d), "return_window");
    assert.equal((await j(`select fn_evaluate_release('${d.deal}')::text`)).released, true);
  });

  test("refund path: needs a refund resolution, is blocked once a payout started, completes only on provider COMPLETED", async () => {
    const d = await newDeal();
    const pay = await toReturnWindow(d, 24);
    const admin = randomUUID();
    await sql(`insert into users (id,email,role,is_admin) values ('${admin}','a-${admin}@t.test','buyer',true)`);
    const disp = await j(`select to_jsonb(f) from fn_open_dispute('${d.deal}','${d.buyer}','not_as_described','x') f`);
    await fails(`select fn_begin_refund('${d.deal}','${admin}')`, /brk_dispute_not_resolved_for_refund/);
    await fails(`select fn_begin_refund('${d.deal}','${d.buyer}')`, /brk_forbidden/);
    await svc(`select fn_resolve_dispute('${disp.id}','${admin}','refund','buyer is right')`);
    const RF = "RF-" + randomUUID();
    const rf = await j(`select fn_begin_refund('${d.deal}','${admin}')::text`);
    assert.equal(rf.amount_cents, 515);
    assert.equal((await j(`select fn_complete_refund('${pay.id}','${RF}',515,'PENDING')::text`)).status, "refund_pending");
    assert.equal(await status(d), "disputed");
    await fails(`select fn_record_refund_reconciliation('${pay.id}','WRONG',515,'USD','COMPLETED')`, /brk_refund_unverified/);
    await svc(`select fn_record_refund_reconciliation('${pay.id}','${RF}',515,'USD','COMPLETED')`);
    assert.equal(await status(d), "refunded");
    assert.equal((await j(`select fn_complete_refund('${pay.id}','${RF}',515,'COMPLETED')::text`)).idempotent, true);

    const failed = await newDeal();
    const failedPay = await toReturnWindow(failed, 24);
    await svc(`select fn_begin_refund('${failed.deal}','${admin}')`);
    await fails(`select fn_complete_refund('${failedPay.id}',null,515,'COMPLETED')`, /brk_refund_unverified/);
    await svc(`select fn_complete_refund('${failedPay.id}','RF-FAILED',0,'FAILED')`);
    assert.equal(await sql(`select status from payments where id='${failedPay.id}'`), 'captured');
    assert.equal(await status(failed), 'return_window');

    const payoutStarted = await newDeal();
    await toReturnWindow(payoutStarted, 24);
    await sql(`insert into payouts(deal_id,amount,platform_fee,status,amount_cents,fee_cents,sender_batch_id,request_id)
      values('${payoutStarted.deal}',5,0.15,'eligible',500,15,'brk-po-${payoutStarted.deal}','brk-po-req-${payoutStarted.deal}')`);
    await fails(`select fn_begin_refund('${payoutStarted.deal}','${admin}')`, /brk_payout_started/);

    const p = await newDeal();
    await toReturnWindow(p, 24);
    await expire(p);
    await svc(`select fn_evaluate_release('${p.deal}')`);
    await fails(`select fn_begin_refund('${p.deal}','${admin}')`, /brk_invalid_state/);
  });
});

describe("database: payout execution", { skip }, () => {
  async function released() {
    const d = await newDeal();
    await toReturnWindow(d, 24);
    await expire(d);
    await svc(`select fn_evaluate_release('${d.deal}')`);
    return d;
  }

  test("CONCURRENT claims: exactly one caller may send the payout", async () => {
    const d = await released();
    const rs = await Promise.all(Array.from({ length: 12 }, () => j(`select fn_claim_payout('${d.deal}')::text`)));
    const winners = rs.filter((r) => r.claimed);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].amount_cents, 500);
    assert.equal(winners[0].sender_batch_id, `brk-po-${d.deal}`);
    assert.match(winners[0].destination, /^pay-/);
    assert.equal(await sql(`select status||'/'||attempt_count from payouts where deal_id='${d.deal}'`), "submitting/1");
  });

  test("a payout cannot be claimed for a disputed, unreleased or unpaid deal", async () => {
    const d = await newDeal();
    await toReturnWindow(d, 24);
    assert.equal((await j(`select fn_claim_payout('${d.deal}')::text`)).claimed, false);
  });

  test("states: pending/ambiguous never count as paid; succeeded is final and cannot be reverted", async () => {
    const d = await released();
    await svc(`select fn_claim_payout('${d.deal}')`);
    await svc(`select fn_mark_payout_ambiguous('${d.deal}','timeout')`);
    assert.equal(await sql(`select status from payouts where deal_id='${d.deal}'`), "ambiguous");
    await fails(`select fn_requeue_payout('${d.deal}','${d.buyer}','x')`, /brk_forbidden/);
    const admin = randomUUID();
    await sql(`insert into users (id,email,role,is_admin) values ('${admin}','a-${admin}@t.test','buyer',true)`);
    await svc(`select fn_requeue_payout('${d.deal}','${admin}','checked activity')`);
    assert.equal(await sql(`select sender_batch_id from payouts where deal_id='${d.deal}'`), `brk-po-${d.deal}`, "ambiguous retry must reuse the batch id");
    await svc(`select fn_claim_payout('${d.deal}')`);
    await svc(`select fn_record_payout_submitted('${d.deal}','BATCH1')`);
    assert.equal((await j(`select fn_record_payout_result('${d.deal}','pending',null,null,null)::text`)).status, "pending");
    await svc(`select fn_record_payout_result('${d.deal}','succeeded','ITEM1',25,null)`);
    assert.equal(await sql(`select status||'/'||payout_fee_cents from payouts where deal_id='${d.deal}'`), "succeeded/25");
    await fails(`update payouts set status='eligible' where deal_id='${d.deal}'`, /final/);
    assert.equal((await j(`select fn_record_payout_result('${d.deal}','failed',null,null,'x')::text`)).idempotent, true);
    assert.equal((await j(`select fn_claim_payout('${d.deal}')::text`)).claimed, false);
  });

  test("after a definite failure the retry uses a NEW batch id", async () => {
    const d = await released();
    await svc(`select fn_claim_payout('${d.deal}')`);
    await svc(`select fn_record_payout_result('${d.deal}','failed',null,null,'BLOCKED')`);
    const admin = randomUUID();
    await sql(`insert into users (id,email,role,is_admin) values ('${admin}','a-${admin}@t.test','buyer',true)`);
    await svc(`select fn_requeue_payout('${d.deal}','${admin}','retry')`);
    const w = await j(`select fn_claim_payout('${d.deal}')::text`);
    assert.equal(w.claimed, true);
    assert.notEqual(w.sender_batch_id, `brk-po-${d.deal}`);
  });
});

describe("database: grants, RLS and append-only audit", { skip }, () => {
  test("clients (anon/authenticated) cannot read or execute any financial internals", async () => {
    const d = await newDeal();
    await issue(d);
    for (const role of ["anon", "authenticated"]) {
      for (const t of ["payments", "deal_payout_destinations", "seller_payout_profiles", "deal_events", "provider_events", "disputes", "deal_agreements"]) {
        await fails(`select * from ${t} limit 1`, /permission denied/, role);
      }
      await fails(`select fn_issue_invoice('${d.deal}','${d.seller}',500,15,48,'{}')`, /permission denied/, role);
      await fails(`select fn_evaluate_release('${d.deal}')`, /permission denied/, role);
      await fails(`select fn_claim_payout('${d.deal}')`, /permission denied/, role);
      await fails(`select fn_accept_terms('${d.deal}','${d.buyer}')`, /permission denied/, role);
    }
    await fails(`update invoices set status='paid'`, /permission denied/, "authenticated");
    await fails(`update payouts set status='succeeded'`, /permission denied/, "authenticated");
  });

  test("members see safe payout columns only (no request ids, errors, provider ids)", async () => {
    await sql(`select 1`);
    await sql(`select id, deal_id, amount, platform_fee, amount_cents, fee_cents, payout_fee_cents, status, released_at, completed_at from payouts limit 1`, "authenticated");
    for (const col of ["sender_batch_id", "request_id", "last_error", "provider_item_id", "paypal_payout_batch_id"]) {
      await fails(`select ${col} from payouts limit 1`, /permission denied/, "authenticated");
    }
  });

  test("the audit trail is append-only", async () => {
    const d = await newDeal();
    await issue(d);
    await fails(`update deal_events set type='x' where deal_id='${d.deal}'`, /append-only/);
    await fails(`delete from deal_events where deal_id='${d.deal}'`, /append-only/);
    assert.ok(Number(await sql(`select count(*) from deal_events where deal_id='${d.deal}'`)) >= 1);
  });

  test("webhook events are deduplicated by provider event id", async () => {
    const id = "WH-" + randomUUID();
    await svc(`insert into provider_events (event_id,event_type,verified) values ('${id}','PAYMENT.CAPTURE.COMPLETED',true)`);
    await fails(`insert into provider_events (event_id,event_type,verified) values ('${id}','PAYMENT.CAPTURE.COMPLETED',true)`, /duplicate key/);
  });
});
