import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';
import { assertSameOrigin, apiError, limit, readJson, HttpError } from '@/lib/payments/http';
import { rpc } from '@/lib/payments/db';

const schema = z.object({
  reason: z.enum(['not_received', 'not_as_described', 'damaged', 'other']),
  details: z.string().trim().max(2000).optional(),
}).strict();

/** Buyer opens a dispute while the deal is shipped or in the return window. An open dispute blocks release. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser('buyer');
    const { id } = await params;
    limit(`dispute:${user.id}`, 5, 60_000);
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'invalid_body', 'Choose a reason (details up to 2000 characters)');
    await loadDealForMember(id, user);
    const d = await rpc<{ id: string; status: string }>('fn_open_dispute', { p_deal_id: id, p_buyer_id: user.id, p_reason: parsed.data.reason, p_details: parsed.data.details ?? null });
    return NextResponse.json({ id: d.id, status: d.status });
  } catch (err) {
    return apiError(err);
  }
}
