import 'server-only';
import { HttpError } from './http';

export type PaymentsConfig = {
  clientId: string;
  secret: string;
  platformMerchantId: string;
  platformEmail: string;
  webhookId: string;
  appBaseUrl: string;
  returnWindowHours: number;
  reviewAfterDays: number;
  invoiceExpiryHours: number;
  minDealCents: number;
  cronSecret: string;
};

const num = (name: string, fallback: number, min: number, max: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(503, 'payments_misconfigured', `${name} is invalid`);
  return n;
};

/**
 * SANDBOX ONLY. Live is refused outright: the PayPal client has no Live host, and this guard fails closed
 * unless PAYPAL_ENVIRONMENT is exactly "SANDBOX". Going Live is a deliberate future change that needs
 * confirmed PayPal eligibility and legal review (see docs/PAYMENTS.md).
 */
export function getPaymentsConfig(): PaymentsConfig {
  const e = process.env;
  if (e.PAYPAL_ENVIRONMENT !== 'SANDBOX') throw new HttpError(503, 'payments_disabled', 'Payments are available in PayPal Sandbox mode only');
  const clientId = (e.PAYPAL_CLIENT_ID || '').trim();
  const secret = (e.PAYPAL_SECRET || '').trim();
  if (!clientId || !secret || /^your-/i.test(clientId)) throw new HttpError(503, 'payments_misconfigured', 'PayPal Sandbox credentials are not configured');
  const platformMerchantId = (e.PAYPAL_PLATFORM_MERCHANT_ID || '').trim();
  const platformEmail = (e.PAYPAL_PLATFORM_BUSINESS_EMAIL || '').trim().toLowerCase();
  if (!platformMerchantId && !platformEmail) throw new HttpError(503, 'payments_misconfigured', 'Platform payee identity is not configured');
  let appBaseUrl = (e.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  try {
    const u = new URL(appBaseUrl);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (!(u.protocol === 'https:' || (local && u.protocol === 'http:'))) throw new Error('scheme');
    appBaseUrl = u.origin;
  } catch {
    throw new HttpError(503, 'payments_misconfigured', 'APP_BASE_URL must be an https URL (or http://localhost)');
  }
  return {
    clientId,
    secret,
    platformMerchantId,
    platformEmail,
    webhookId: (e.PAYPAL_WEBHOOK_ID || '').trim(),
    appBaseUrl,
    returnWindowHours: num('RETURN_WINDOW_HOURS', 24, 0.001, 24 * 60),
    reviewAfterDays: num('REVIEW_UNCONFIRMED_AFTER_DAYS', 7, 1, 365),
    invoiceExpiryHours: num('INVOICE_EXPIRY_HOURS', 48, 1, 24 * 30),
    minDealCents: num('MIN_DEAL_CENTS', 100, 1, 100_000_000),
    cronSecret: (e.CRON_SECRET || '').trim(),
  };
}
