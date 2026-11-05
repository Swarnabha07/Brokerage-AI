import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureUserProfile } from '@/lib/auth/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Server-side OAuth (PKCE) callback: exchanges the code for a session stored in
 * httpOnly-capable Supabase cookies, then creates the profile row from the VERIFIED user.
 * `role` is honoured only when the profile is first created; existing roles are never changed.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const fail = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin));

  if (url.searchParams.get('error')) return fail('oauth_failed');
  if (!code) return fail('oauth_failed');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail('oauth_failed');

  const { data, error: userErr } = await supabase.auth.getUser(); // verified with Supabase Auth
  if (userErr || !data.user) return fail('oauth_failed');

  const role = await ensureUserProfile(data.user, url.searchParams.get('role'));
  if (role === 'buyer') {
    const meta = data.user.user_metadata || {};
    await supabaseAdmin
      .from('buyer_profiles')
      .upsert(
        { id: data.user.id, name: String(meta.full_name || meta.name || data.user.email?.split('@')[0] || 'Buyer'), email: data.user.email ?? null },
        { onConflict: 'id', ignoreDuplicates: true }
      );
  }
  // Fixed internal destinations only (no open redirect).
  return NextResponse.redirect(new URL(role === 'seller' ? '/seller/dashboard' : '/buyer/dashboard', url.origin));
}
