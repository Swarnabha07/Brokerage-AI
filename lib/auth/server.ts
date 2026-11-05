import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type Role = 'buyer' | 'seller';
export type AuthedUser = { id: string; email: string; role: Role };

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/**
 * Verified identity: asks Supabase Auth to validate the session cookie's JWT (getUser),
 * then reads the ROLE from public.users. user_metadata is user-editable and never trusted.
 * Returns null when unauthenticated or no profile row exists.
 */
export async function getVerifiedUser(): Promise<AuthedUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: row } = await supabaseAdmin
    .from('users')
    .select('id, email, role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!row?.role) return null;

  return { id: row.id, email: row.email || data.user.email || '', role: row.role as Role };
}

/** Throws AuthError(401) if unauthenticated, AuthError(403) if role does not match. */
export async function requireUser(role?: Role): Promise<AuthedUser> {
  const user = await getVerifiedUser();
  if (!user) throw new AuthError(401, 'Authentication required');
  if (role && user.role !== role) throw new AuthError(403, `This action requires the ${role} role`);
  return user;
}

/** Maps thrown errors to JSON responses in route handlers. */
export function errorResponse(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error('[api]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/** How long after Supabase created the auth account the chosen role may still be applied. */
const FIRST_REGISTRATION_WINDOW_MS = 10 * 60 * 1000;

type ProfileAuthUser = {
  id: string;
  email?: string | null;
  created_at?: string;
  user_metadata?: Record<string, unknown>;
};

/**
 * True only for a brand-new account (age taken from the VERIFIED auth user, not the request)
 * that has not created any listing or deal yet. This is what makes the buyer/seller choice a
 * one-time, first-registration decision rather than something any later request can repeat.
 */
async function isFirstRegistration(authUser: ProfileAuthUser): Promise<boolean> {
  const created = authUser.created_at ? Date.parse(authUser.created_at) : NaN;
  if (Number.isNaN(created) || Date.now() - created > FIRST_REGISTRATION_WINDOW_MS) return false;
  const [deals, listings] = await Promise.all([
    supabaseAdmin
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .or(`buyer_id.eq.${authUser.id},seller_id.eq.${authUser.id}`),
    supabaseAdmin.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', authUser.id),
  ]);
  if (deals.error || listings.error) return false; // fail closed
  return (deals.count ?? 1) === 0 && (listings.count ?? 1) === 0;
}

async function ensureBuyerProfile(authUser: ProfileAuthUser) {
  const meta = authUser.user_metadata || {};
  const name = String(meta.full_name || meta.name || authUser.email?.split('@')[0] || 'Buyer');
  const { error } = await supabaseAdmin
    .from('buyer_profiles')
    .upsert({ id: authUser.id, name, email: authUser.email ?? null }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) console.error('[auth] buyer_profiles upsert failed', error.message);
}

/**
 * Makes sure public.users (the ONLY authorization source for role) has a row for a verified
 * auth user, and returns its role.
 *
 * Role rules:
 *  - `requestedRole` is a registration choice, honoured at most ONCE per account: when the
 *    account is brand new (see isFirstRegistration). The signup trigger may already have
 *    inserted a default 'buyer' row; in that window the row is corrected with a conditional
 *    UPDATE (... WHERE role = <the value we read>), so concurrent calls cannot clobber each other.
 *  - After that window, or once the user has any listing/deal, the stored role is final:
 *    login, /api/auth/sync and OAuth callbacks can never change it.
 *  - Missing/invalid `requestedRole` never changes an existing role.
 */
export async function ensureUserProfile(authUser: ProfileAuthUser, requestedRole: unknown): Promise<Role> {
  const requested: Role | null = requestedRole === 'seller' || requestedRole === 'buyer' ? requestedRole : null;

  const { data: existing } = await supabaseAdmin.from('users').select('role').eq('id', authUser.id).maybeSingle();
  let role: Role;

  if (existing?.role) {
    role = existing.role as Role;
    if (requested && requested !== role && (await isFirstRegistration(authUser))) {
      const { data: updated } = await supabaseAdmin
        .from('users')
        .update({ role: requested })
        .eq('id', authUser.id)
        .eq('role', role)
        .select('role');
      if (updated?.length) role = requested;
    }
  } else {
    role = requested ?? 'buyer';
    const { error } = await supabaseAdmin.from('users').insert({ id: authUser.id, email: authUser.email ?? null, role });
    if (error) {
      // Lost a race with the signup trigger or a concurrent request: re-read, never overwrite.
      const { data: again } = await supabaseAdmin.from('users').select('role').eq('id', authUser.id).maybeSingle();
      if (!again?.role) throw error;
      role = again.role as Role;
    }
  }

  if (role === 'buyer') await ensureBuyerProfile(authUser);
  return role;
}
