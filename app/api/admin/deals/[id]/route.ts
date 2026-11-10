import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, apiError, limit, readJson, requireAdmin, HttpError } from '@/lib/payments/http';
import { adminClearReview, adminDealFinancials, adminRefund, adminReconcileRefund, adminRequeuePayout, adminResolveDispute, adminVerifyDelivery } from '@/lib/payments/admin';

const note = z.string().trim().min(3).max(500);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify_delivery'), note }).strict(),
  z.object({ action: z.literal('resolve_dispute'), disputeId: z.string().uuid(), resolution: z.enum(['release', 'refund']), note }).strict(),
  z.object({ action: z.literal('refund') }).strict(),
  z.object({ action: z.literal('reconcile_refund') }).strict(),
  z.object({ action: z.literal('requeue_payout'), note }).strict(),
  z.object({ action: z.literal('clear_review'), note }).strict(),
]);

/** Admin-only (users.is_admin). Every mutation is also re-checked inside the SQL function. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await params;
    limit(`admin:${admin.id}`, 30, 60_000);
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'invalid_body', 'Invalid admin action');
    const a = parsed.data;
    switch (a.action) {
      case 'verify_delivery': await adminVerifyDelivery(admin, id, a.note); break;
      case 'resolve_dispute': await adminResolveDispute(admin, a.disputeId, a.resolution, a.note); break;
      case 'refund': return NextResponse.json(await adminRefund(admin, id));
      case 'reconcile_refund': return NextResponse.json(await adminReconcileRefund(id));
      case 'requeue_payout': await adminRequeuePayout(admin, id, a.note); break;
      case 'clear_review': await adminClearReview(admin, id, a.note); break;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

/** Read-only: the platform's actual net for this deal. Never exposed to buyers or sellers. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    return NextResponse.json({ financials: await adminDealFinancials(id) });
  } catch (err) {
    return apiError(err);
  }
}
