import 'server-only';
import { AuthError, type AuthedUser } from '@/lib/auth/server';
import { db } from '@/lib/payments/db';
import { buildAnalytics } from './aggregate.mjs';

type AnalyticsInput = {
  role: 'buyer' | 'seller';
  limitReached?: boolean;
  deals: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payouts: Record<string, unknown>[];
  listings: Record<string, unknown>[];
};
type AnalyticsResult = {
  role: 'buyer' | 'seller';
  kpis: Record<string, number>;
  transactions: Record<string, unknown>[];
  activity: Record<string, unknown>[];
  payoutRows: Record<string, unknown>[];
  listingPerformance: Record<string, unknown>[];
  attention: Record<string, unknown>[];
  lifecycle: Record<string, unknown>[];
  limitReached: boolean;
};
const aggregate = buildAnalytics as unknown as (input: AnalyticsInput) => AnalyticsResult;

/** Read-only, owner-scoped analytics queries. Only the returned aggregate is sent to the browser. */
export async function getAnalyticsForUser(user: AuthedUser) {
  if (!user || (user.role !== 'buyer' && user.role !== 'seller')) {
    throw new AuthError(403, 'Buyer or seller role required');
  }

  const ownerColumn = user.role === 'buyer' ? 'buyer_id' : 'seller_id';
  const dealsResult = await db
    .from('deals')
    .select('id, listing_id, status, created_at, needs_review, listing:listings(title)')
    .eq(ownerColumn, user.id)
    .order('created_at', { ascending: false })
    .limit(500);
  if (dealsResult.error) throw new Error('Failed to load analytics transactions');

  const deals = dealsResult.data ?? [];
  const ids = deals.map((deal) => deal.id);
  const listingsResult = user.role === 'seller'
    ? await db
        .from('listings')
        .select('id, title, price')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500)
    : { data: [], error: null };
  if (listingsResult.error) throw new Error('Failed to load listing analytics');

  if (!ids.length) {
    return aggregate({
      role: user.role,
      deals: [],
      payments: [],
      invoices: [],
      payouts: [],
      listings: listingsResult.data ?? [],
      limitReached: (listingsResult.data?.length ?? 0) === 500,
    });
  }

  const [paymentResult, invoiceResult, payoutResult] = await Promise.all([
    db.from('payments').select('deal_id, status, amount_cents, captured_at').in('deal_id', ids).eq('status', 'captured'),
    db.from('invoices').select('deal_id, price_cents').in('deal_id', ids),
    user.role === 'seller'
      ? db.from('payouts').select('deal_id, status, amount_cents, completed_at').in('deal_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (paymentResult.error || invoiceResult.error || payoutResult.error) {
    throw new Error('Failed to load financial analytics');
  }

  return aggregate({
    role: user.role,
    limitReached: deals.length === 500 || (listingsResult.data?.length ?? 0) === 500,
    deals,
    payments: paymentResult.data ?? [],
    invoices: invoiceResult.data ?? [],
    payouts: payoutResult.data ?? [],
    listings: listingsResult.data ?? [],
  });
}
