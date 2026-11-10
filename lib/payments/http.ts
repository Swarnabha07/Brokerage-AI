import 'server-only';
import { NextResponse } from 'next/server';
import { AuthError, requireUser, type AuthedUser } from '@/lib/auth/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** One response shape for every payment route: safe message, stable code, never provider/DB internals. */
export function apiError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof HttpError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  console.error('[payments]', err instanceof Error ? err.message : 'unknown error');
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/**
 * CSRF defence for cookie-authenticated, state-changing routes: browsers always send Origin on POST,
 * so a missing or foreign Origin is rejected. (Cron and webhook routes authenticate differently and skip this.)
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  let ok = false;
  try {
    ok = !!origin && !!host && new URL(origin).host === host;
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(403, 'bad_origin', 'Cross-site request rejected');
}

export function limit(key: string, max: number, windowMs: number) {
  const r = checkRateLimit(key, max, windowMs);
  if (!r.allowed) throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${r.retryAfterSeconds}s.`);
}

/** Admin = users.is_admin, set manually in SQL. There is no API that can grant it. */
export async function requireAdmin(): Promise<AuthedUser> {
  const user = await requireUser();
  const { data, error } = await supabaseAdmin.from('users').select('*').eq('id', user.id).maybeSingle();
  if (error) throw new HttpError(500, 'db_error', 'Internal server error');
  if (!(data as { is_admin?: boolean } | null)?.is_admin) throw new AuthError(403, 'Admin access required');
  return user;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
