import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';

const DEMO_BUYER_ID = '22222222-2222-2222-2222-222222222222';

const createDealSchema = z.object({
  listing_id: z.string().min(1, 'Valid listing_id is required'),
  buyer_id: z.string().optional(),
  negotiation_mode: z.enum(['self_chat', 'ai_negotiate']).default('ai_negotiate'),
  buyer_budget: z.number().positive().optional().nullable(),
  buyer_conditions: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createDealSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid deal parameters' },
        { status: 400 }
      );
    }

    const { listing_id, buyer_id, negotiation_mode, buyer_budget, buyer_conditions } = parsed.data;
    const buyerId = buyer_id || DEMO_BUYER_ID;

    // 1. Look up listing to retrieve seller_id and verify existence
    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .select('id, seller_id, title, price, floor_price')
      .eq('id', listing_id)
      .single();

    if (listingError || !listing) {
      return NextResponse.json(
        { error: `Listing not found: ${listingError?.message || 'Invalid ID'}` },
        { status: 404 }
      );
    }

    // Ensure buyer user exists in public.users
    const { data: buyerUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', buyerId)
      .maybeSingle();

    if (!buyerUser) {
      await supabaseAdmin.from('users').upsert({
        id: buyerId,
        email: 'buyer@escrowmate.demo',
        role: 'buyer',
      });
    }

    // 2. Create the deal with status 'negotiating'
    const { data: newDeal, error: dealError } = await supabaseAdmin
      .from('deals')
      .insert({
        listing_id,
        buyer_id: buyerId,
        seller_id: listing.seller_id,
        negotiation_mode,
        buyer_budget: buyer_budget ?? null,
        buyer_conditions: buyer_conditions ?? null,
        status: 'negotiating',
      })
      .select(`
        *,
        listings (
          id,
          title,
          price,
          description,
          seller_id
        ),
        buyer:users!buyer_id (
          id,
          email
        ),
        seller:users!seller_id (
          id,
          email
        )
      `)
      .single();

    if (dealError) {
      console.error('Error creating deal:', dealError);
      return NextResponse.json(
        { error: `Failed to create deal: ${dealError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(newDeal, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
