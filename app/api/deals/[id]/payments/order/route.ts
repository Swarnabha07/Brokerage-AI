import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { assertSameOrigin, apiError, limit } from '@/lib/payments/http';
import { startCheckout } from '@/lib/payments/service';

/** Buyer starts/resumes PayPal Checkout. No request body is read: every amount comes from the frozen invoice. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser('buyer');
    const { id } = await params;
    limit(`checkout:${user.id}`, 10, 60_000);
    return NextResponse.json(await startCheckout(user, id));
  } catch (err) {
    return apiError(err);
  }
}
