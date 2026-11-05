import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureUserProfile } from '@/lib/auth/server';

/**
 * Identity comes ONLY from the verified session cookie. Any userId/email in the body is ignored.
 * `role` is used only if the profile does not exist yet; an existing role is never overwritten.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const role = await ensureUserProfile(data.user, body?.role);
    return NextResponse.json({ ok: true, role });
  } catch (err) {
    console.error('[auth/sync]', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
