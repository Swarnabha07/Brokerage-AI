import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureUserProfile } from '@/lib/auth/server';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input data' }, { status: 400 });
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
