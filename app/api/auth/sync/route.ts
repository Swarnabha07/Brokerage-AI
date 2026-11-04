import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { userId, email, role, name } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const requestedRole: 'buyer' | 'seller' = role === 'seller' ? 'seller' : 'buyer';

    // Upsert user into public.users with the chosen role
    const { error: upsertErr } = await supabaseAdmin.from('users').upsert(
      {
        id: userId,
        email: email || null,
        role: requestedRole,
      },
      { onConflict: 'id' }
    );

    if (upsertErr) {
      console.error('Error upserting user in sync:', upsertErr);
    }

    // Seed initial profile for buyer
    if (requestedRole === 'buyer') {
      await supabaseAdmin.from('buyer_profiles').upsert(
        {
          id: userId,
          name: name || 'Buyer',
          email: email || null,
        },
        { onConflict: 'id' }
      );
    }

    return NextResponse.json({ ok: true, role: requestedRole });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
