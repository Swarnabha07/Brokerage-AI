import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';
import { assertSameOrigin, apiError, limit } from '@/lib/payments/http';
import { checkReleaseAndPay } from '@/lib/payments/payouts';

/**
 * "Check release": a member can ask the server to evaluate this deal. It applies the SAME rules as the
 * scheduled job (delivery evidence, server-clock window, no dispute/review flag, verified payment) and pays
 * only when ALL hold. The caller cannot force, skip or choose anything; repeat calls are harmless.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    limit(`release:${user.id}:${id}`, 10, 60_000);
    await loadDealForMember(id, user);
    return NextResponse.json(await checkReleaseAndPay(id));
  } catch (err) {
    return apiError(err);
  }
}
