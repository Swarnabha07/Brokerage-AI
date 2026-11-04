import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase, supabaseAdmin } from '@/lib/supabase';

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['buyer', 'seller'], {
    errorMap: () => ({ message: "Role must be either 'buyer' or 'seller'" }),
  }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid input data' },
        { status: 400 }
      );
    }

    const { email, password, role } = parsed.data;

    // 1. Sign up user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role },
      },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Signup succeeded but no user returned' },
        { status: 500 }
      );
    }

    // 2. Upsert into public.users to ensure role and profile are recorded immediately
    const { error: upsertError } = await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: authData.user.id,
          email: authData.user.email || email,
          role,
        },
        { onConflict: 'id' }
      );

    if (upsertError) {
      console.warn('Warning: Failed to upsert public.users row:', upsertError.message);
    }

    return NextResponse.json(
      {
        user: authData.user,
        session: authData.session,
        role,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error during signup';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

