import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureUserProfile } from '@/lib/auth/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// Keeps automated mass-account-creation scripts from hammering this route.
const SIGNUP_LIMIT = 10;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000; // 10 signups / hour / IP

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().max(100).optional(),
  role: z.enum(['buyer', 'seller'], { errorMap: () => ({ message: "Role must be either 'buyer' or 'seller'" }) }),
});

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const ipCheck = checkRateLimit(`signup:ip:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(ipCheck.retryAfterSeconds) } },
      );
    }

    const parsed = signupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input data' }, { status: 400 });
    }
    const { email, password, name, role } = parsed.data;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name || undefined, signup_role: role } } });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data.user) return NextResponse.json({ error: 'Signup failed' }, { status: 500 });

    // Already-registered address: Supabase returns an obfuscated user with no identities. Do not
    // touch any profile and answer exactly like a new signup (no account enumeration).
    if (!data.user.identities || data.user.identities.length === 0) {
      return NextResponse.json({ ok: true, needsConfirmation: true }, { status: 201 });
    }

    // `signup_role` metadata is read once by the DB trigger when the row is created; authorization
    // always uses public.users.role. ensureUserProfile also corrects a trigger-made default row.
    const finalRole = await ensureUserProfile(data.user, role);
    return NextResponse.json(
      { ok: true, role: finalRole, needsConfirmation: !data.session },
      { status: 201 }
    );
  } catch (err) {
    console.error('[auth/signup]', err);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
