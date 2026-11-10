import 'server-only';
import { db, type Row } from './db';
import { buildFinancials } from './financials.mjs';

const EVENT_KEYS = ['invoice_number', 'price_cents', 'fee_cents', 'amount_cents', 'paypal_fee_cents', 'window_hours', 'by', 'reason'];

/** Everything the deal screen needs about money, read-only, whitelisted per viewer. Never writes, never calls PayPal. */
export async function loadPaymentContext(dealId: string, viewer: 'buyer' | 'seller') {
  const [inv, pay, po, disp, ev] = await Promise.all([
    db.from('invoices').select('*').eq('deal_id', dealId).in('status', ['open', 'paid', 'void', 'expired']).order('created_at', { ascending: false }).limit(1),
    db.from('payments').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(1),
    db.from('payouts').select('*').eq('deal_id', dealId).maybeSingle(),
    db.from('disputes').select('id,reason,status,opened_at,resolved_at').eq('deal_id', dealId).order('opened_at', { ascending: false }).limit(1),
    db.from('deal_events').select('type,actor_role,from_status,to_status,data,created_at').eq('deal_id', dealId).order('id', { ascending: true }).limit(200),
  ]);
  const invoice = ((inv.data as Row[] | null) ?? [])[0] ?? null;
  const payment = ((pay.data as Row[] | null) ?? [])[0] ?? null;
  const payout = (po.data as Row | null) ?? null;
  return {
    invoice: invoice && {
      id: invoice.id, number: invoice.invoice_number, status: invoice.status, currency: invoice.currency,
      price: Number(invoice.price_cents) / 100, platformFee: Number(invoice.fee_cents) / 100, total: Number(invoice.total_cents) / 100,
      createdAt: invoice.created_at, expiresAt: invoice.expires_at, paidAt: invoice.paid_at, data: invoice.invoice_data,
    },
    paymentStatus: (payment?.status as string | undefined) ?? null,
    payout: payout && { status: payout.status, completedAt: payout.completed_at, releasedAt: payout.released_at },
    dispute: ((disp.data as Row[] | null) ?? [])[0] ?? null,
    financials: buildFinancials({ invoice, payment, payout }, viewer),
    events: ((ev.data as Row[] | null) ?? []).map((e) => ({
      type: e.type, actorRole: e.actor_role, toStatus: e.to_status, at: e.created_at,
      data: Object.fromEntries(Object.entries((e.data as Record<string, unknown>) ?? {}).filter(([k]) => EVENT_KEYS.includes(k))),
    })),
  };
}

export async function hasPayoutProfile(userId: string) {
  const { data } = await db.from('seller_payout_profiles').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}
