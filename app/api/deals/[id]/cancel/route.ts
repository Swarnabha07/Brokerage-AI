import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';
import { assertSameOrigin, apiError, limit } from '@/lib/payments/http';
import { rpc } from '@/lib/payments/db';

/** Either party may cancel BEFORE any payment exists (negotiating/agreed/invoiced). Paid deals use disputes/refunds. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    limit(`cancel:${user.id}`, 10, 60_000);
    await loadDealForMember(id, user);
    await rpc('fn_cancel_deal', { p_deal_id: id, p_actor_id: user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
