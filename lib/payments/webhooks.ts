import 'server-only';
import { db, type Row } from './db';
import { getPaymentsConfig } from './config';
import { getPaypal } from './paypal';
import { reconcilePayout } from './payouts';
import { settlePayment } from './service';
import { adminReconcileRefund } from './admin';

type PaypalEvent = { id?: string; event_type?: string; resource?: Record<string, unknown> };

const flag = (dealId: unknown, reason: string) => db.from('deals').update({ needs_review: true, review_reason: reason }).eq('id', dealId);

/** Webhooks are only a HINT: every handler re-reads the resource from PayPal (or settles from verified state). */
async function handleEvent(event: PaypalEvent): Promise<string> {
  const type = event.event_type ?? '';
  const res = event.resource ?? {};
  if (type.startsWith('PAYMENT.CAPTURE.')) {
    const orderId = (res.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id;
    const lookup = type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED'
      ? db.from('payments').select('*').eq('provider_capture_id', String(res.id ?? ''))
      : db.from('payments').select('*').eq('provider_order_id', orderId ?? '');
    const { data } = await lookup.maybeSingle();
    const payment = data as Row | null;
    if (!payment) return 'ignored_unknown_order';
    if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
      if (type === 'PAYMENT.CAPTURE.REFUNDED' && payment.status === 'refund_pending') {
        const result = await adminReconcileRefund(String(payment.deal_id));
        return `refund_${String((result as { status?: string }).status ?? 'pending')}`;
      }
      if (payment.status !== 'refund_pending' && payment.status !== 'refunded') { await flag(payment.deal_id, 'provider_refund_or_reversal'); return 'flagged'; }
      return 'expected_refund';
    }
    return `payment_${(await settlePayment(payment, { capture: false })).status}`;
  }
  if (type.startsWith('PAYMENT.PAYOUTS-ITEM.') || type.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    const batchId = (res.payout_batch_id as string | undefined) ?? (res.batch_header as { payout_batch_id?: string } | undefined)?.payout_batch_id;
    const { data } = await db.from('payouts').select('deal_id').eq('paypal_payout_batch_id', batchId ?? '').maybeSingle();
    if (!data) return 'ignored_unknown_batch';
    return `payout_${(await reconcilePayout(String((data as Row).deal_id), 1)).state}`;
  }
  if (type === 'CUSTOMER.DISPUTE.CREATED') {
    const caps = ((res.disputed_transactions as { seller_transaction_id?: string }[] | undefined) ?? []).map((t) => t.seller_transaction_id).filter(Boolean);
    const { data } = await db.from('payments').select('deal_id').in('provider_capture_id', caps as string[]);
    for (const p of (data as Row[] | null) ?? []) await flag(p.deal_id, 'paypal_dispute');
    return caps.length ? 'flagged' : 'ignored';
  }
  return 'ignored';
}

/**
 * Returns an HTTP status. Unverified events are rejected and NOT stored. Verified events are deduplicated by
 * PayPal event id; a replay of a processed event does nothing, a failed one is retried by PayPal.
 */
export async function handlePaypalWebhook(rawBody: string, headers: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const { webhookId } = getPaymentsConfig();
  if (!webhookId) return { status: 503, body: { error: 'Webhooks are not configured' } };
  let event: PaypalEvent;
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'Invalid body' } }; }
  if (!event.id || !event.event_type) return { status: 400, body: { error: 'Invalid event' } };

  const v = await getPaypal().verifyWebhook({ headers, event, webhookId });
  if (!v.ok || (v.json as { verification_status?: string } | null)?.verification_status !== 'SUCCESS') {
    return { status: 401, body: { error: 'Signature verification failed' } };
  }

  const ins = await db.from('provider_events').insert({ event_id: event.id, event_type: event.event_type, resource_id: String(event.resource?.id ?? ''), verified: true }).select('id').maybeSingle();
  if (ins.error) {
    if (!/duplicate key/i.test(ins.error.message)) return { status: 500, body: { error: 'Internal error' } };
    const { data: existing } = await db.from('provider_events').select('processed_at').eq('provider', 'paypal').eq('event_id', event.id).maybeSingle();
    if ((existing as Row | null)?.processed_at) return { status: 200, body: { duplicate: true } };
  }
  try {
    const outcome = await handleEvent(event);
    await db.from('provider_events').update({ outcome, processed_at: new Date().toISOString() }).eq('provider', 'paypal').eq('event_id', event.id);
    return { status: 200, body: { outcome } };
  } catch (e) {
    console.error('[webhook] processing failed', e instanceof Error ? e.message : 'error');
    return { status: 500, body: { error: 'Processing failed' } }; // not marked processed: PayPal will retry
  }
}
