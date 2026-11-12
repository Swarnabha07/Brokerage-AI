import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics } from '../../lib/analytics/aggregate.mjs';

test('buyer analytics counts captured payments and return-window funds only', () => {
  const result = buildAnalytics({
    role: 'buyer',
    deals: [
      { id: 'd1', listing_id: 'l1', status: 'return_window', created_at: '2026-01-01T00:00:00Z', listing: { title: 'Camera' } },
      { id: 'd2', listing_id: 'l2', status: 'released', created_at: '2026-01-02T00:00:00Z', listing: { title: 'Lens' } },
      { id: 'd3', listing_id: 'l3', status: 'negotiating', created_at: '2026-01-03T00:00:00Z', listing: { title: 'Tripod' } },
    ],
    payments: [
      { deal_id: 'd1', status: 'captured', amount_cents: 10300, captured_at: '2026-02-01T00:00:00Z' },
      { deal_id: 'd2', status: 'captured', amount_cents: 5150, captured_at: '2026-02-04T00:00:00Z' },
      { deal_id: 'd3', status: 'failed', amount_cents: 70000, captured_at: null },
    ],
  });

  assert.equal(result.kpis.completedPurchaseValue, 154.5);
  assert.equal(result.kpis.activeTransactions, 2);
  assert.equal(result.kpis.returnWindowFunds, 103);
  assert.deepEqual(result.activity, [{ month: '2026-02', amount: 154.5 }]);
  assert.equal(result.transactions.find((row) => row.title === 'Tripod').purchaseAmount, 0);
});

test('seller analytics uses invoice payable and successful payout rows, and strips private fields', () => {
  const result = buildAnalytics({
    role: 'seller',
    deals: [{ id: 'd1', listing_id: 'l1', status: 'return_window', created_at: '2026-02-01T00:00:00Z', needs_review: true, listing: { title: 'Camera' }, floor_price: 1, buyer_budget: 999 }],
    payments: [{ deal_id: 'd1', status: 'captured', amount_cents: 10300, captured_at: '2026-02-01T00:00:00Z' }],
    invoices: [{ deal_id: 'd1', price_cents: 10000 }],
    payouts: [{ deal_id: 'd1', status: 'succeeded', amount_cents: 10000, completed_at: '2026-02-02T00:00:00Z', destination: 'private@example.com', provider_item_id: 'secret' }],
    listings: [{ id: 'l1', title: 'Camera', price: 120, floor_price: 1 }],
  });

  assert.equal(result.kpis.pendingPayout, 0);
  assert.equal(result.kpis.successfulPayout, 100);
  assert.equal(result.listingPerformance[0].completedSales, 1);
  assert.equal(result.attention.length, 1);
  assert.equal(JSON.stringify(result).includes('private@example.com'), false);
  assert.equal(JSON.stringify(result).includes('floor_price'), false);
  assert.equal(JSON.stringify(result).includes('provider_item_id'), false);
});

test('empty analytics contains no fabricated records or financial totals', () => {
  const result = buildAnalytics({ role: 'buyer' });
  assert.equal(result.transactions.length, 0);
  assert.equal(result.kpis.completedPurchaseValue, 0);
  assert.equal(result.kpis.returnWindowFunds, 0);
  assert.deepEqual(result.activity, []);
});
