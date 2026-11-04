import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const DEMO_BUYER_ID = '22222222-2222-2222-2222-222222222222';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const buyerId = searchParams.get('buyerId') || DEMO_BUYER_ID;

    // 1. Fetch buyer's deals with joined listings(title, price) and invoices(status, paypal_invoice_id)
    const { data: deals, error: dealsError } = await supabaseAdmin
      .from('deals')
      .select(`
        *,
        listings (
          id,
          title,
          price,
          description
        ),
        invoices (
          id,
          status,
          paypal_invoice_id,
          created_at
        )
      `)
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false });

    if (dealsError) {
      console.error('Error fetching buyer deals:', dealsError);
      return NextResponse.json(
        { error: `Failed to fetch deals: ${dealsError.message}` },
        { status: 500 }
      );
    }

    // Categorize deals:
    // activeDeals: negotiating, agreed, invoiced, paid, shipped, return_window, disputed
    // orderHistory: released (funds released, transaction complete)
    const activeDeals = deals?.filter((d) => d.status !== 'released') || [];
    const orderHistory = deals?.filter((d) => d.status === 'released') || [];

    // 2. Fetch available listings for browsing
    const { data: availableListings, error: listingsError } = await supabaseAdmin
      .from('listings')
      .select(`
        *,
        seller:users!seller_id (
          id,
          email
        )
      `)
      .order('created_at', { ascending: false });

    if (listingsError) {
      console.error('Error fetching available listings:', listingsError);
      return NextResponse.json(
        { error: `Failed to fetch listings: ${listingsError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      buyerId,
      activeDeals,
      orderHistory,
      availableListings: availableListings || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

