import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { assertSameOrigin, apiError, limit } from '@/lib/payments/http';
import { captureCheckout } from '@/lib/payments/service';

/**
 * Buyer completes/refreshes the payment. The PayPal order id is read from OUR database (never the client);
 * the deal becomes paid only after the order is re-read from PayPal and verified. Safe to call repeatedly.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser('buyer');
    const { id } = await params;
    limit(`capture:${user.id}`, 10, 60_000);
    return NextResponse.json(await captureCheckout(user, id));
  } catch (err) {
    return apiError(err);
  }
}
