import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';
import { assertSameOrigin, apiError, limit } from '@/lib/payments/http';
import { getPaymentsConfig } from '@/lib/payments/config';
import { rpc } from '@/lib/payments/db';

/**
 * Buyer-only: shipped -> return_window. The buyer's confirmation is the delivery evidence. The server
 * stamps start and end (database clock) and the client supplies nothing but an optional short note.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser('buyer');
    const { id } = await params;
    limit(`confirm:${user.id}`, 10, 60_000);
    await loadDealForMember(id, user);
    const note = ((await req.json().catch(() => null)) as { note?: unknown } | null)?.note;
    const deal = await rpc<{ id: string; status: string; return_window_ends_at: string }>('fn_confirm_delivery', {
      p_deal_id: id,
      p_actor_id: user.id,
      p_actor: 'buyer',
      p_note: typeof note === 'string' ? note.slice(0, 500) : null,
      p_window_hours: getPaymentsConfig().returnWindowHours,
    });
    return NextResponse.json({ id: deal.id, status: deal.status, return_window_ends_at: deal.return_window_ends_at });
  } catch (err) {
    return apiError(err);
  }
}
