import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { apiError, HttpError } from '@/lib/payments/http';
import { getPaymentsConfig } from '@/lib/payments/config';
import { runScheduled } from '@/lib/payments/scheduler';

/**
 * Scheduled eligibility + payout pass. POST only (financial work never runs on GET). Authenticated by
 * `Authorization: Bearer $CRON_SECRET`; use any scheduler that can send a POST (see docs/PAYMENTS.md).
 */
export async function POST(req: Request) {
  try {
    const { cronSecret } = getPaymentsConfig();
    if (!cronSecret) throw new HttpError(503, 'cron_disabled', 'Scheduled runs are not configured');
    const got = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(cronSecret);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, 'unauthorized', 'Unauthorized');
    return NextResponse.json(await runScheduled());
  } catch (err) {
    return apiError(err);
  }
}
