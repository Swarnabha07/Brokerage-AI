const CLOSED = new Set(['released', 'cancelled', 'refunded']);
const RETURN_WINDOW = 'return_window';
const PAYOUT_UNPAID = new Set(['eligible', 'submitting', 'pending', 'ambiguous', 'manual_review', 'failed']);
const PAYOUT_LABELS = {
  succeeded: 'Paid',
  failed: 'Failed',
  ambiguous: 'Needs review',
  manual_review: 'Needs review',
  submitting: 'Processing',
  pending: 'Processing',
  eligible: 'Awaiting payout',
  legacy_ledger: 'Legacy record',
};

const money = (cents) => (Number.isInteger(Number(cents)) ? Number(cents) / 100 : 0);
const add = (a, b) => Math.round((a + b) * 100) / 100;

/** Build the browser-safe analytics contract from already scoped database rows. */
export function buildAnalytics({ role, deals = [], payments = [], invoices = [], payouts = [], listings = [], limitReached = false }) {
  const captured = new Map(payments.filter((p) => p.status === 'captured').map((p) => [p.deal_id, p]));
  const invoiceByDeal = new Map(invoices.map((i) => [i.deal_id, i]));
  const payoutByDeal = new Map(payouts.map((p) => [p.deal_id, p]));
  const listingById = new Map(listings.map((l) => [l.id, l]));

  const transactions = deals.map((deal) => {
    const payment = captured.get(deal.id);
    const invoice = invoiceByDeal.get(deal.id);
    const payout = payoutByDeal.get(deal.id);
    const listingTitle = deal.listing?.title ?? listingById.get(deal.listing_id)?.title ?? 'Listing';
    const timestamp = role === 'buyer' ? payment?.captured_at : deal.created_at;
    const date = timestamp || deal.created_at || null;
    const needsAttention = Boolean(deal.needs_review) || deal.status === 'disputed' || ['failed', 'manual_review', 'ambiguous'].includes(payout?.status);
    const payoutStatus = payout ? (PAYOUT_LABELS[payout.status] ?? 'Payout recorded') : payment ? 'Funds held' : 'No captured payment';
    return {
      listingId: deal.listing_id ?? null,
      title: listingTitle,
      status: deal.status ?? 'unknown',
      date,
      month: date ? date.slice(0, 7) : 'Unknown date',
      transactionCount: 1,
      purchaseAmount: payment ? money(payment.amount_cents) : 0,
      sellerPayable: invoice ? money(invoice.price_cents) : 0,
      payoutAmount: payout ? money(payout.amount_cents) : 0,
      payoutStatus,
      payoutRecorded: Boolean(payout),
      listingTitle,
      listingPrice: Number(listingById.get(deal.listing_id)?.price ?? 0),
      needsAttention,
      attentionReason: needsAttention
        ? (deal.needs_review ? 'Deal flagged for review' : deal.status === 'disputed' ? 'Open dispute' : `Payout ${PAYOUT_LABELS[payout?.status]?.toLowerCase() ?? 'requires review'}`)
        : '',
      returnWindowFunds: deal.status === RETURN_WINDOW && payment ? money(payment.amount_cents) : 0,
      captured: Boolean(payment),
    };
  });

  const active = transactions.filter((t) => !CLOSED.has(t.status));
  const completedPurchaseValue = role === 'buyer'
    ? add(0, transactions.filter((t) => t.captured && t.status !== 'refunded').reduce((sum, t) => sum + t.purchaseAmount, 0))
    : 0;
  const returnWindowFunds = transactions.reduce((sum, t) => add(sum, t.returnWindowFunds), 0);
  const successfulPayouts = payouts.filter((p) => p.status === 'succeeded');
  const pendingPayout = role === 'seller'
    ? add(
        transactions.filter((t) => ['paid', 'shipped', RETURN_WINDOW, 'disputed'].includes(t.status) && t.captured && !t.payoutRecorded).reduce((sum, t) => add(sum, t.sellerPayable), 0),
        payouts.filter((p) => PAYOUT_UNPAID.has(p.status)).reduce((sum, p) => add(sum, money(p.amount_cents)), 0),
      )
    : 0;

  const activityMap = new Map();
  for (const t of transactions) {
    if (role === 'buyer' && t.captured && t.date) {
      activityMap.set(t.month, add(activityMap.get(t.month) ?? 0, t.purchaseAmount));
    }
  }
  const activity = [...activityMap].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
  const attention = transactions.filter((t) => t.needsAttention).map(({ title, status, attentionReason }) => ({ title, status, reason: attentionReason }));

  const payoutRows = role === 'seller' ? transactions.filter((t) => t.captured).map((transaction) => ({
    payoutStatus: transaction.payoutStatus,
    payoutAmount: transaction.payoutAmount || (['paid', 'shipped', RETURN_WINDOW, 'disputed'].includes(transaction.status) ? transaction.sellerPayable : 0),
    transactionCount: 1,
  })) : [];

  const listingPerformance = listings.map((listing) => {
    const related = transactions.filter((t) => t.listingId === listing.id);
    return {
      listingTitle: listing.title,
      listingPrice: Number(listing.price ?? 0),
      dealCount: related.length,
      completedSales: related.filter((t) => t.captured).length,
      sellerPayable: related.filter((t) => t.captured).reduce((sum, t) => add(sum, t.sellerPayable), 0),
    };
  });

  const safeTransactions = transactions.map(({ listingId: _listingId, ...transaction }) => transaction);
  return {
    role,
    limitReached,
    kpis: {
      completedPurchaseValue,
      activeTransactions: active.length,
      returnWindowFunds,
      listingCount: role === 'seller' ? listings.length : 0,
      openDeals: role === 'seller' ? active.length : 0,
      pendingPayout,
      successfulPayout: add(0, successfulPayouts.reduce((sum, p) => add(sum, money(p.amount_cents)), 0)),
    },
    transactions: safeTransactions,
    activity,
    payoutRows,
    listingPerformance,
    attention,
    lifecycle: [...transactions.reduce((map, t) => map.set(t.status, (map.get(t.status) ?? 0) + 1), new Map())]
      .map(([status, transactionCount]) => ({ status, transactionCount })),
  };
}
