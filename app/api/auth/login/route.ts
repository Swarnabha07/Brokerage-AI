import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase, supabaseAdmin } from '@/lib/supabase';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid input data' },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    // 1. Sign in with password via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 401 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 2. Query public.users for the verified database role
    let role = (authData.user.user_metadata?.role as 'buyer' | 'seller') || 'buyer';

    const { data: dbUser, error: dbError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (!dbError && dbUser?.role) {
      role = dbUser.role;
    }

    const response = NextResponse.json(
      {
        session: authData.session,
        user: authData.user,
        role,
      },
      { status: 200 }
    );

    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      path: '/',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
      secure: isProduction,
      httpOnly: true,
    };

    response.cookies.set('escrowmate_user_id', authData.user.id, cookieOptions);
    response.cookies.set('escrowmate_user_role', role, cookieOptions);

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error during login';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

