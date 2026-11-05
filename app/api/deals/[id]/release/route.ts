import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';
import { releaseIfDue } from '@/lib/deals/release';

/** Safe to call at any time by a deal member: releases only if the SERVER clock says the window ended. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await loadDealForMember(id, user);
    const result = await releaseIfDue(id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
