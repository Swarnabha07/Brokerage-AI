import 'server-only';
import type { AuthedUser } from '@/lib/auth/server';
import { db, rpc, type Row } from './db';
import { HttpError } from './http';
import { getPaypal } from './paypal';
import { adminFinancials } from './financials.mjs';
import { safeProviderError } from './paypal-core.mjs';
import { verifyRefund } from './verify.mjs';

export async function adminVerifyDelivery(admin: AuthedUser, dealId: string, note: string) {
  const { getPaymentsConfig } = await import('./config');
  return rpc('fn_confirm_delivery', { p_deal_id: dealId, p_actor_id: admin.id, p_actor: 'admin', p_note: note, p_window_hours: getPaymentsConfig().returnWindowHours });
}

export const adminResolveDispute = (admin: AuthedUser, disputeId: string, resolution: 'release' | 'refund', note: string) =>
  rpc('fn_resolve_dispute', { p_dispute_id: disputeId, p_admin_id: admin.id, p_resolution: resolution, p_note: note });

export const adminRequeuePayout = (admin: AuthedUser, dealId: string, note: string) =>
  rpc('fn_requeue_payout', { p_deal_id: dealId, p_admin_id: admin.id, p_note: note });

export const adminClearReview = (admin: AuthedUser, dealId: string, note: string) =>
  rpc('fn_clear_review', { p_deal_id: dealId, p_admin_id: admin.id, p_note: note });

/** Refund the buyer's capture. Blocked in SQL once a payout has started; 'refunded' only when PayPal says COMPLETED. */
export async function adminRefund(admin: AuthedUser, dealId: string) {
  const begin = await rpc<{ payment_id: string; capture_id: string; amount_cents: number; currency: string; request_id: string }>('fn_begin_refund', { p_deal_id: dealId, p_admin_id: admin.id });
  const r = await getPaypal().refundCapture({ captureId: begin.capture_id, requestId: begin.request_id, amountCents: begin.amount_cents, currency: begin.currency });
  if (r.ok) {
    const j = r.json as { id?: string; status?: string };
    const verified = verifyRefund(j, { refundId: String(j.id ?? ''), amountCents: begin.amount_cents, currency: begin.currency });
    if (!verified.ok) {
      await db.from('deals').update({ needs_review: true, review_reason: 'refund_verification_failed' }).eq('id', dealId);
      return { status: 'manual_review' };
    }
    return rpc('fn_complete_refund', { p_payment_id: begin.payment_id, p_refund_id: j.id, p_refunded_cents: verified.status === 'COMPLETED' ? begin.amount_cents : null, p_status: verified.status });
  }
  if (r.kind === 'rejected') {
    await rpc('fn_complete_refund', { p_payment_id: begin.payment_id, p_refund_id: null, p_refunded_cents: 0, p_status: 'FAILED' });
    throw new HttpError(502, 'refund_rejected', `PayPal rejected the refund (${safeProviderError(r)})`);
  }
  throw new HttpError(503, 'refund_unknown', 'PayPal did not respond clearly. The refund is pending; retry safely (same request id).');
}

/** Re-fetch a pending refund from PayPal before the database can mark it refunded. */
export async function adminReconcileRefund(dealId: string) {
  const { data } = await db.from('payments').select('id,provider_refund_id,amount_cents,currency,status').eq('deal_id', dealId).eq('status', 'refund_pending').maybeSingle();
  const pay = data as Row | null;
  if (!pay?.provider_refund_id) return { status: 'manual_review' };
  const response = await getPaypal().getRefund(String(pay.provider_refund_id));
  if (!response.ok) return { status: 'pending' };
  const verified = verifyRefund(response.json, { refundId: String(pay.provider_refund_id), amountCents: Number(pay.amount_cents), currency: String(pay.currency) });
  if (!verified.ok || verified.status === 'UNVERIFIED') return { status: 'manual_review' };
  return rpc('fn_record_refund_reconciliation', {
    p_payment_id: pay.id, p_refund_id: pay.provider_refund_id, p_amount_cents: Number(pay.amount_cents),
    p_currency: String(pay.currency), p_status: verified.status,
  });
}

/** Platform net earnings: admin-only. */
export async function adminDealFinancials(dealId: string) {
  const [inv, pay, po] = await Promise.all([
    db.from('invoices').select('*').eq('deal_id', dealId).in('status', ['paid', 'void', 'expired']).order('created_at', { ascending: false }).limit(1),
    db.from('payments').select('*').eq('deal_id', dealId).in('status', ['captured', 'refund_pending', 'refunded']).maybeSingle(),
    db.from('payouts').select('*').eq('deal_id', dealId).maybeSingle(),
  ]);
  return adminFinancials({ invoice: inv.data as Row | null, payment: pay.data as Row | null, payout: po.data as Row | null });
}
