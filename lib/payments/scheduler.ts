import 'server-only';
import { db, rpc, type Row } from './db';
import { getPaymentsConfig } from './config';
import { checkReleaseAndPay, executePayout, reconcilePayout } from './payouts';
import { settlePayment } from './service';

/** Scheduled eligibility pass. Same rules as the member action; it never invents eligibility. POST-only. */
export async function runScheduled() {
  const cfg = getPaymentsConfig();
  const nowIso = new Date().toISOString();
  const out = { flagged: 0, released: 0, paid: 0, reconciled: 0, paymentsChecked: 0, stale: 0, errors: 0 };
  const guard = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { out.errors++; console.error('[scheduler]', e instanceof Error ? e.message : 'error'); }
  };

  await guard(async () => { out.flagged = Number(await rpc<number>('fn_flag_stale_shipments', { p_days: Math.ceil(cfg.reviewAfterDays) })); });

  await guard(async () => {
    const { data } = await db.from('deals').select('id').eq('status', 'return_window').eq('needs_review', false).lte('return_window_ends_at', nowIso).limit(50);
    for (const d of (data as Row[] | null) ?? []) await guard(async () => {
      const r = await checkReleaseAndPay(String(d.id));
      if (r.released) out.released++;
      if (r.payout && ['succeeded', 'pending'].includes(r.payout)) out.paid++;
    });
  });

  await guard(async () => {
    const { data } = await db.from('payouts').select('deal_id').eq('status', 'eligible').limit(20);
    for (const p of (data as Row[] | null) ?? []) await guard(async () => { await executePayout(String(p.deal_id)); out.paid++; });
  });

  await guard(async () => {
    const { data } = await db.from('payouts').select('deal_id').eq('status', 'pending').limit(50);
    for (const p of (data as Row[] | null) ?? []) await guard(async () => { await reconcilePayout(String(p.deal_id), 1); out.reconciled++; });
  });

  // A claim that never produced a provider answer (crash between claim and call): do NOT resend; hand to a human.
  await guard(async () => {
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data } = await db.from('payouts').update({ status: 'ambiguous', last_error: 'stale_submitting' }).eq('status', 'submitting').lt('submitted_at', cutoff).select('deal_id');
    out.stale = (data as Row[] | null)?.length ?? 0;
  });

  await guard(async () => {
    const { data } = await db.from('payments').select('*').eq('status', 'capture_pending').limit(20);
    for (const p of (data as Row[] | null) ?? []) await guard(async () => { await settlePayment(p, { capture: false }); out.paymentsChecked++; });
  });
  return out;
}
