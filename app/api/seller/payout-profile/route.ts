import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { assertSameOrigin, apiError, limit, readJson, HttpError } from '@/lib/payments/http';
import { db, rpc, type Row } from '@/lib/payments/db';

const schema = z.object({ paypal_email: z.string().trim().toLowerCase().email().max(254) }).strict();

export async function GET() {
  try {
    const user = await requireUser('seller');
    const { data } = await db.from('seller_payout_profiles').select('paypal_email,updated_at').eq('user_id', user.id).maybeSingle();
    return NextResponse.json({ configured: !!data, paypal_email: (data as Row | null)?.paypal_email ?? null });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * Seller sets the PayPal account that receives payouts. Existing deals keep the destination snapshotted at
 * invoice time, so editing this cannot redirect a payout already in flight. Changes have a 24h cooldown.
 * PayPal cannot prove the seller owns this address; that limit is documented in docs/PAYMENTS.md.
 */
export async function PUT(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser('seller');
    limit(`payout-profile:${user.id}`, 5, 60_000);
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'invalid_email', 'Enter a valid PayPal email address');
    await rpc('fn_update_payout_profile', { p_seller_id: user.id, p_email: parsed.data.paypal_email });
    return NextResponse.json({ configured: true, paypal_email: parsed.data.paypal_email });
  } catch (err) {
    return apiError(err);
  }
}
