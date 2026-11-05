import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';

/** Buyer-only: shipped -> return_window. The server stamps the window start; the client supplies nothing. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser('buyer');
    const { id } = await params;
    const { deal } = await loadDealForMember(id, user);
    if (deal.buyer_id !== user.id) return NextResponse.json({ error: 'Only the buyer can confirm receipt' }, { status: 403 });
    if (deal.status !== 'shipped') return NextResponse.json({ error: 'Deal is not in the shipped state' }, { status: 409 });

    const terms = (deal.terms_json && typeof deal.terms_json === 'object' ? deal.terms_json : {}) as Record<string, unknown>;
    const { data: rows, error } = await supabaseAdmin
      .from('deals')
      .update({ status: 'return_window', terms_json: { ...terms, return_window_started_at: new Date().toISOString() } })
      .eq('id', id)
      .eq('status', 'shipped')
      .select('id, status, terms_json');
    if (error) return NextResponse.json({ error: 'Failed to confirm receipt' }, { status: 500 });
    if (!rows?.length) return NextResponse.json({ error: 'Deal state changed; refresh and retry' }, { status: 409 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    return errorResponse(err);
  }
}
