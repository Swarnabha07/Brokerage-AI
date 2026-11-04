import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Deal ID is required' }, { status: 400 });
    }

    // 1. Fetch current deal to read existing terms_json
    const { data: existingDeal, error: fetchErr } = await supabaseAdmin
      .from('deals')
      .select('id, terms_json, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existingDeal) {
      return NextResponse.json(
        { error: `Deal not found: ${fetchErr?.message || 'Invalid ID'}` },
        { status: 404 }
      );
    }

    const currentTerms =
      typeof existingDeal.terms_json === 'object' && existingDeal.terms_json !== null
        ? (existingDeal.terms_json as Record<string, unknown>)
        : {};

    const updatedTerms = {
      ...currentTerms,
      return_window_started_at: new Date().toISOString(),
    };

    // 2. Transition deal status to return_window with timestamp recorded in terms_json
    const { data: updatedDeal, error: updateErr } = await supabaseAdmin
      .from('deals')
      .update({
        status: 'return_window',
        terms_json: updatedTerms,
      })
      .eq('id', id)
      .select(`
        *,
        listing:listings (
          id,
          seller_id,
          title,
          description,
          price,
          floor_price
        ),
        buyer:users!buyer_id (
          id,
          email,
          role
        ),
        seller:users!seller_id (
          id,
          email,
          role
        )
      `)
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: `Failed to confirm receipt: ${updateErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedDeal, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

