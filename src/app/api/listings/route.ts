import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';

const DEMO_SELLER_ID = '11111111-1111-1111-1111-111111111111';

const createListingSchema = z.object({
  seller_id: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  price: z.number().positive('Price must be greater than 0'),
  floor_price: z.number().nonnegative('Floor price cannot be negative').optional().nullable(),
});

export async function GET() {
  try {
    const { data: listings, error } = await supabaseAdmin
      .from('listings')
      .select(`
        *,
        seller:users!seller_id (
          id,
          email,
          role
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching listings:', error);
      return NextResponse.json(
        { error: `Failed to fetch listings: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(listings || []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createListingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid listing data' },
        { status: 400 }
      );
    }

    const { seller_id, title, description, price, floor_price } = parsed.data;

    // Use provided seller_id or default to demo seller
    const sellerId = seller_id || DEMO_SELLER_ID;

    // Verify seller exists in public.users
    const { data: sellerUser, error: sellerCheckError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', sellerId)
      .maybeSingle();

    if (!sellerUser && !sellerCheckError) {
      // Auto-insert demo seller if missing
      await supabaseAdmin.from('users').upsert({
        id: sellerId,
        email: 'seller@escrowmate.demo',
        role: 'seller',
      });
    }

    const { data: newListing, error: insertError } = await supabaseAdmin
      .from('listings')
      .insert({
        seller_id: sellerId,
        title,
        description: description || null,
        price,
        floor_price: floor_price ?? null,
      })
      .select(`
        *,
        seller:users!seller_id (
          id,
          email
        )
      `)
      .single();

    if (insertError) {
      console.error('Error creating listing:', insertError);
      return NextResponse.json(
        { error: `Failed to create listing: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(newListing, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

