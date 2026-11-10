import 'server-only';
import { db, rpc, type Row } from './db';
import { getPaypal } from './paypal';
import { classifyPayoutBatch } from './verify.mjs';
import { safeProviderError } from './paypal-core.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const looksDuplicate = (r: { status: number; json: unknown }) =>
  r.status === 409 || /DUPLICATE|ALREADY/.test(JSON.stringify(r.json ?? {}).toUpperCase());

export type PayoutOutcome = { state: string };

/**
 * The single eligibility gate. Used by the scheduled job AND the member "Check release" action:
 * nothing here can be bypassed by the caller, and it is safe to call repeatedly.
 */
export async function evaluateRelease(dealId: string) {
  return rpc<{ released: boolean; reason?: string; already?: boolean; seconds_left?: number }>('fn_evaluate_release', { p_deal_id: dealId });
}

/** Sends the payout for a released deal. At most one caller can ever claim it (atomic in the database). */
export async function executePayout(dealId: string): Promise<PayoutOutcome> {
  const claim = await rpc<{ claimed: boolean; amount_cents?: number; sender_batch_id?: string; request_id?: string; destination?: string }>('fn_claim_payout', { p_deal_id: dealId });
  if (!claim.claimed) return { state: 'not_claimed' };
  const r = await getPaypal().createPayout({
    senderBatchId: String(claim.sender_batch_id),
    requestId: String(claim.request_id),
    receiver: String(claim.destination),
    amountCents: Number(claim.amount_cents),
    currency: 'USD',
  });
  if (r.ok) {
    const batchId = (r.json as { batch_header?: { payout_batch_id?: string } } | null)?.batch_header?.payout_batch_id;
    if (!batchId) {
      await rpc('fn_mark_payout_ambiguous', { p_deal_id: dealId, p_error: 'accepted_without_batch_id' });
      return { state: 'ambiguous' };
    }
    await rpc('fn_record_payout_submitted', { p_deal_id: dealId, p_batch_id: batchId });
    return reconcilePayout(dealId, 3);
  }
  if (r.kind === 'rejected') {
    // A duplicate-looking rejection can mean an earlier ambiguous attempt DID go out: never call that a failure.
    const state = looksDuplicate(r) ? 'manual_review' : 'failed';
    await rpc('fn_record_payout_result', { p_deal_id: dealId, p_status: state, p_item_id: null, p_fee_cents: null, p_error: safeProviderError(r) });
    return { state };
  }
  await rpc('fn_mark_payout_ambiguous', { p_deal_id: dealId, p_error: safeProviderError(r) });
  return { state: 'ambiguous' }; // never retried automatically
}

/** Reads the payout ITEM from PayPal and records only what PayPal reports. */
export async function reconcilePayout(dealId: string, tries = 1): Promise<PayoutOutcome> {
  const { data } = await db.from('payouts').select('status,paypal_payout_batch_id,sender_batch_id,amount_cents').eq('deal_id', dealId).maybeSingle();
  const po = data as Row | null;
  if (!po || po.status !== 'pending' || !po.paypal_payout_batch_id) return { state: String(po?.status ?? 'none') };
  const { data: dest } = await db.from('deal_payout_destinations').select('destination').eq('deal_id', dealId).maybeSingle();
  const exp = { senderBatchId: String(po.sender_batch_id), senderItemId: `${String(po.sender_batch_id)}-1`, providerBatchId: String(po.paypal_payout_batch_id), amountCents: Number(po.amount_cents), currency: 'USD', destination: String((dest as Row | null)?.destination ?? '') };
  for (let i = 0; i < tries; i++) {
    const g = await getPaypal().getPayoutBatch(String(po.paypal_payout_batch_id));
    if (!g.ok) return { state: 'pending' }; // provider unavailable: stay pending, retry later
    const c = classifyPayoutBatch(g.json, exp);
    if (c.state === 'pending' || c.state === 'unknown') {
      if (i < tries - 1) await sleep(1500);
      continue;
    }
    await rpc('fn_record_payout_result', { p_deal_id: dealId, p_status: c.state, p_item_id: c.itemId, p_fee_cents: c.feeCents, p_error: c.error });
    return { state: c.state };
  }
  return { state: 'pending' };
}

/** Member-facing and scheduled: evaluate, then pay if (and only if) the server says it is eligible. */
export async function checkReleaseAndPay(dealId: string) {
  const ev = await evaluateRelease(dealId);
  let payout: PayoutOutcome | null = null;
  if (ev.released) {
    payout = await executePayout(dealId);
    if (payout.state === 'not_claimed') payout = await reconcilePayout(dealId, 1);
  }
  return { released: !!ev.released, reason: ev.reason ?? null, secondsLeft: ev.seconds_left ?? null, payout: payout?.state ?? null };
}
