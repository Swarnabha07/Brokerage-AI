import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/auth/server';
import { getAnalyticsForUser } from '@/lib/analytics/data';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getAnalyticsForUser(user), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
