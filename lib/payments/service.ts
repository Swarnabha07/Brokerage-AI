import 'server-only';
import type { AuthedUser } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';
import { PLATFORM_FEE_RATE } from '@/lib/config';
import { db, rpc, type Row } from './db';
import { HttpError } from './http';
import { getPaymentsConfig } from './config';
import { getPaypal } from './paypal';
import { feeCentsFor, parsePriceToCents } from './money.mjs';
import { verifyAfterCapture, verifyBeforeCapture } from './verify.mjs';
import { approvalUrlOf, safeProviderError } from './paypal-core.mjs';

const localPart = (email: unknown) => String(email ?? '').split('@')[0].slice(0, 40) || 'user';
const issuesOf = (json: unknown): string[] =>
  ((json as { details?: { issue?: string }[] } | null)?.details ?? []).map((d) => d.issue ?? '').filter(Boolean);

export async function proposeTerms(user: AuthedUser, dealId: string, priceInput: unknown, terms: { fulfillmentType: string; deliveryExpectations: string; transactionConditions: string }) {
  const cfg = getPaymentsConfig();
  const { deal, side } = await loadDealForMember(dealId, user);
  if (side !== 'seller') throw new HttpError(403, 'forbidden', 'Only the seller can propose final terms');
  const priceCents = parsePriceToCents(priceInput);
  if (priceCents === null || priceCents < cfg.minDealCents) throw new HttpError(400, 'invalid_price', 'Enter a valid final price');
  if (!deal.listing) throw new HttpError(409, 'listing_unavailable', 'The listing is unavailable');
  const args = {
    p_deal_id: dealId,
    p_seller_id: user.id,
    p_price_cents: priceCents,
    p_return_window_hours: cfg.returnWindowHours,
    p_fulfillment_type: terms.fulfillmentType,
    p_delivery_expectations: terms.deliveryExpectations,
    p_transaction_conditions: terms.transactionConditions,
  };
  const session = await rpc<Record<string, unknown> | null>('fn_neg_public_state', { p_deal_id: dealId, p_user_id: user.id });
  // AI sessions use a single explicit seller proposal/approval bridge. The existing public
  // fn_propose_terms rejects direct AI-session calls; manual legacy deals keep that path.
  return session
    ? rpc('fn_neg_seller_propose', args)
    : rpc('fn_propose_terms', args);
}

export async function acceptTerms(user: AuthedUser, dealId: string) {
  await loadDealForMember(dealId, user);
  return rpc('fn_accept_terms', { p_deal_id: dealId, p_user_id: user.id });
}

/** Seller approves terms with a final price; the server freezes it into an immutable invoice. */
export async function issueInvoice(user: AuthedUser, dealId: string, priceInput: unknown) {
  const cfg = getPaymentsConfig();
  const { deal, side } = await loadDealForMember(dealId, user);
  if (side !== 'seller') throw new HttpError(403, 'forbidden', 'Only the seller can approve the terms and issue the invoice');
  const priceCents = parsePriceToCents(priceInput);
  if (priceCents === null || priceCents < cfg.minDealCents) {
    throw new HttpError(400, 'invalid_price', `Enter a final price of at least ${(cfg.minDealCents / 100).toFixed(2)} with at most 2 decimals`);
  }
  const listingCents = Math.round(Number(deal.listing?.price ?? 0) * 100);
  if (priceCents > listingCents) throw new HttpError(400, 'price_above_listing', 'The final price cannot exceed the listing price');
  const { data: people } = await db.from('users').select('id,email').in('id', [deal.buyer_id, deal.seller_id]);
  const nameOf = (id: string) => localPart((people as Row[] | null)?.find((p) => p.id === id)?.email);
  return rpc('fn_issue_invoice', {
    p_deal_id: dealId,
    p_seller_id: user.id,
    p_price_cents: priceCents,
    p_fee_cents: feeCentsFor(priceCents, PLATFORM_FEE_RATE),
    p_expiry_hours: Math.ceil(cfg.invoiceExpiryHours),
    p_invoice_data: {
      title: String(deal.listing?.title ?? '').slice(0, 200),
      description: String(deal.listing?.description ?? '').slice(0, 1000),
      buyer: { id: deal.buyer_id, name: nameOf(String(deal.buyer_id)) },
      seller: { id: deal.seller_id, name: nameOf(String(deal.seller_id)) },
      note: 'Payments are held by Brokerage AI (application-managed) until release conditions are met. Not a PayPal-native escrow.',
    },
  });
}

type StartResult = { status: 'redirect'; approvalUrl: string } | { status: 'approved' | 'captured' };

/** Buyer starts or resumes checkout. Amounts come from the frozen invoice in OUR database, never the browser. */
export async function startCheckout(user: AuthedUser, dealId: string, attempt = 0): Promise<StartResult> {
  const cfg = getPaymentsConfig();
  const paypal = getPaypal();
  await loadDealForMember(dealId, user); // membership check (uniform 403)
  const begun = await rpc<{ ok: boolean; reason?: string; payment: Row; invoice: Row }>('fn_begin_payment', { p_deal_id: dealId, p_buyer_id: user.id });
  if (!begun.ok) throw new HttpError(409, 'invoice_expired', 'This invoice has expired. Ask the seller to issue a new one.');
  const { payment, invoice } = begun;
  const paymentId = String(payment.id);

  if (payment.provider_order_id) {
    const g = await paypal.getOrder(String(payment.provider_order_id));
    if (!g.ok) throw new HttpError(503, 'provider_unavailable', 'PayPal is temporarily unavailable. Please try again.');
    const st = (g.json as { status?: string }).status;
    if (st === 'APPROVED' || st === 'COMPLETED') return { status: st === 'COMPLETED' ? 'captured' : 'approved' };
    if (st === 'VOIDED' && attempt === 0) {
      await rpc('fn_fail_payment', { p_payment_id: paymentId, p_reason: 'order_voided' });
      return startCheckout(user, dealId, 1);
    }
    const url = approvalUrlOf(g.json);
    if (!url) throw new HttpError(502, 'provider_error', 'Could not resume the PayPal checkout');
    return { status: 'redirect', approvalUrl: url };
  }

  const canCreateOrder = await rpc<boolean>('fn_assert_order_creation', { p_payment_id: paymentId });
  if (!canCreateOrder) throw new HttpError(409, 'invoice_expired', 'This invoice has expired. Ask the seller to issue a new one.');

  const r = await paypal.createOrder({
    requestId: String(payment.request_id), // deterministic per payment: a retry returns the SAME order
    paymentId,
    invoiceNumber: String(invoice.invoice_number),
    priceCents: Number(invoice.price_cents),
    feeCents: Number(invoice.fee_cents),
    currency: String(invoice.currency),
    returnUrl: `${cfg.appBaseUrl}/deal/${dealId}?payment=return`,
    cancelUrl: `${cfg.appBaseUrl}/deal/${dealId}?payment=cancelled`,
  });
  if (!r.ok) {
    if (r.kind === 'rejected') {
      await rpc('fn_fail_payment', { p_payment_id: paymentId, p_reason: safeProviderError(r) });
      throw new HttpError(502, 'provider_rejected', 'PayPal rejected the checkout request');
    }
    // Ambiguous: the order may exist. Leave the payment as-is; a retry reuses the same PayPal-Request-Id.
    throw new HttpError(503, 'provider_unavailable', 'PayPal did not respond clearly. Please try again.');
  }
  const orderId = (r.json as { id?: string }).id;
  const url = approvalUrlOf(r.json);
  if (!orderId || !url) throw new HttpError(502, 'provider_error', 'PayPal returned an unexpected response');
  await rpc('fn_set_payment_order', { p_payment_id: paymentId, p_order_id: orderId });
  return { status: 'redirect', approvalUrl: url };
}

export type SettleStatus = 'captured' | 'pending' | 'needs_review' | 'not_approved' | 'approved_waiting' | 'declined' | 'cancelled' | 'unknown' | 'failed';

/**
 * Brings one payment to the provider's TRUE state. The deal only becomes 'paid' inside fn_record_capture,
 * after the order was re-read from PayPal and verified. With capture=false it never moves money.
 */
export async function settlePayment(payment: Row, opts: { capture: boolean }): Promise<{ status: SettleStatus }> {
  const cfg = getPaymentsConfig();
  const paypal = getPaypal();
  const paymentId = String(payment.id);
  const orderId = String(payment.provider_order_id ?? '');
  if (!orderId) return { status: 'not_approved' };
  const exp = {
    orderId,
    paymentId,
    amountCents: Number(payment.amount_cents),
    currency: String(payment.currency),
    payee: { merchantId: cfg.platformMerchantId, email: cfg.platformEmail },
  };

  const record = async (order: unknown): Promise<{ status: SettleStatus }> => {
    const v = verifyAfterCapture(order, exp);
    if (!v.ok) {
      // Money may have moved but the facts do not match the invoice: never mark paid; flag for an admin.
      console.error('[payments] capture verification failed', paymentId, v.failures.join(','));
      await db.from('deals').update({ needs_review: true, review_reason: 'capture_verification_failed' }).eq('id', payment.deal_id);
      throw new HttpError(409, 'verification_failed', 'The payment could not be verified. Support has been alerted.');
    }
    const recorded = await rpc<{ status?: string; needs_review?: boolean }>('fn_record_capture', {
      p_payment_id: paymentId,
      p_order_id: orderId,
      p_capture_id: v.captureId,
      p_amount_cents: exp.amountCents,
      p_currency: exp.currency,
      p_provider_status: v.captureStatus,
      p_payer_hash: v.payerRefHash,
      p_paypal_fee_cents: v.paypalFeeCents,
      p_net_cents: v.netCents,
      p_summary: { payee: v.payee, capture_status: v.captureStatus },
    });
    return { status: recorded.needs_review ? 'needs_review' : v.pending ? 'pending' : 'captured' };
  };

  const g = await paypal.getOrder(orderId);
  if (!g.ok) {
    if (g.status === 404) return { status: 'failed' };
    throw new HttpError(503, 'provider_unavailable', 'PayPal is temporarily unavailable. Please try again.');
  }
  const order = g.json as { status?: string };
  if (order.status === 'VOIDED') {
    await rpc('fn_fail_payment', { p_payment_id: paymentId, p_reason: 'order_voided' });
    return { status: 'failed' };
  }
  if (order.status === 'COMPLETED') return record(order);
  if (order.status !== 'APPROVED') return { status: 'not_approved' };
  if (!opts.capture && payment.status === 'voided') return { status: 'cancelled' };
  if (!opts.capture) return { status: 'approved_waiting' };

  const pre = verifyBeforeCapture(order, exp);
  if (!pre.ok) {
    console.error('[payments] pre-capture verification failed', paymentId, pre.failures.join(','));
    await db.from('deals').update({ needs_review: true, review_reason: pre.payee === 'MATCH' ? 'pre_capture_verification_failed' : 'pre_capture_payee_unverified' }).eq('id', payment.deal_id);
    throw new HttpError(409, 'verification_failed', 'The PayPal order does not match the invoice. Nothing was charged.');
  }
  const captureStarted = await rpc<boolean>('fn_mark_capture_started', { p_payment_id: paymentId, p_order_id: orderId });
  if (!captureStarted) return { status: 'cancelled' };
  const c = await paypal.captureOrder(orderId, `brk-cap-${paymentId}`);
  if (!c.ok) {
    const issues = issuesOf(c.json);
    if (!issues.includes('ORDER_ALREADY_CAPTURED') && c.kind === 'rejected') {
      if (issues.includes('INSTRUMENT_DECLINED') || issues.includes('PAYER_ACTION_REQUIRED')) {
        await rpc('fn_fail_payment', { p_payment_id: paymentId, p_reason: 'instrument_declined' });
        return { status: 'declined' };
      }
      console.error('[payments] capture rejected', paymentId, safeProviderError(c));
      await rpc('fn_fail_payment', { p_payment_id: paymentId, p_reason: safeProviderError(c) });
      return { status: 'failed' };
    }
    // Already captured, or ambiguous (timeout/5xx): never assume. Re-read the real state below.
  }
  const g2 = await paypal.getOrder(orderId);
  if (!g2.ok) return { status: 'unknown' };
  const o2 = g2.json as { status?: string };
  if (o2.status !== 'COMPLETED') return { status: 'unknown' };
  return record(g2.json);
}

/** Buyer-triggered after returning from PayPal (or on "refresh"). The redirect itself proves nothing. */
export async function captureCheckout(user: AuthedUser, dealId: string): Promise<{ status: SettleStatus }> {
  const { deal } = await loadDealForMember(dealId, user);
  if (deal.buyer_id !== user.id) throw new HttpError(403, 'forbidden', 'Only the buyer can complete this payment');
  const { data } = await db.from('payments').select('*').eq('deal_id', dealId)
    .in('status', ['order_created', 'capture_pending', 'captured', 'refund_pending', 'voided'])
    .order('created_at', { ascending: false }).limit(1);
  const payment = (data as Row[] | null)?.[0];
  const dealStatus = String(deal.status);
  const dealNeedsReview = Boolean((deal as typeof deal & { needs_review?: boolean }).needs_review);
  if (!payment) {
    if (deal.status === 'paid') return { status: 'captured' };
    throw new HttpError(409, 'no_active_payment', 'There is no payment in progress for this deal');
  }
  if (payment.status === 'captured' || payment.status === 'refund_pending') {
    if (payment.status === 'captured' && (dealStatus === 'cancelled' || dealNeedsReview)) return { status: 'needs_review' };
    return { status: 'captured' };
  }
  return settlePayment(payment, { capture: payment.status !== 'voided' });
}
