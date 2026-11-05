import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureUserProfile } from '@/lib/auth/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Brute-force / credential-stuffing guard: cap attempts per IP and per IP+email.
const IP_LIMIT = 20;
const IP_WINDOW_MS = 10 * 60 * 1000; // 20 attempts / 10 min / IP
const EMAIL_LIMIT = 6;
const EMAIL_WINDOW_MS = 10 * 60 * 1000; // 6 attempts / 10 min / IP+email pair

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const ipCheck = checkRateLimit(`login:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(ipCheck.retryAfterSeconds) } },
      );
    }

    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input data' }, { status: 400 });
    }

    const emailCheck = checkRateLimit(
      `login:email:${ip}:${parsed.data.email.toLowerCase()}`,
      EMAIL_LIMIT,
      EMAIL_WINDOW_MS,
    );
    if (!emailCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts for this account. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(emailCheck.retryAfterSeconds) } },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

    // Role comes from public.users (never user_metadata); first-ever login defaults to buyer.
    const role = await ensureUserProfile(data.user, undefined);
    return NextResponse.json({ ok: true, role }); // session lives in Supabase cookies, not the body
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
