import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { PLATFORM_FEE_RATE } from '@/lib/config';

const DEMO_SELLER_ID = '11111111-1111-1111-1111-111111111111';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sellerId = searchParams.get('sellerId') || DEMO_SELLER_ID;

    // 1. Fetch seller's listings
    const { data: listings, error: listingsError } = await supabaseAdmin
      .from('listings')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (listingsError) {
      console.error('Error fetching seller listings:', listingsError);
      return NextResponse.json(
        { error: `Failed to fetch listings: ${listingsError.message}` },
        { status: 500 }
      );
    }

    // 2. Fetch seller's active deals (with joined listings, invoices, and buyer info)
    const { data: allSellerDeals, error: dealsError } = await supabaseAdmin
      .from('deals')
      .select(`
        *,
        listings (
          id,
          title,
          price
        ),
        invoices (
          id,
          status,
          paypal_invoice_id,
          created_at
        ),
        buyer:users!buyer_id (
          id,
          email
        )
      `)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (dealsError) {
      console.error('Error fetching seller deals:', dealsError);
      return NextResponse.json(
        { error: `Failed to fetch deals: ${dealsError.message}` },
        { status: 500 }
      );
    }

    // Active deals are deals that are not yet released
    const activeDeals = allSellerDeals?.filter((d) => d.status !== 'released') || [];

    // 3. Fetch released payouts from the payouts table for this seller's deals
    const sellerDealIds = (allSellerDeals || []).map((d) => d.id);
    let dbPayouts: Array<{
      id: string;
      deal_id: string | null;
      amount: number;
      platform_fee: number;
      status: string | null;
      paypal_payout_batch_id: string | null;
      released_at: string | null;
    }> = [];

    if (sellerDealIds.length > 0) {
      const { data: payoutsData, error: payoutsError } = await supabaseAdmin
        .from('payouts')
        .select('*')
        .in('deal_id', sellerDealIds)
        .order('released_at', { ascending: false, nullsFirst: false });

      if (payoutsError) {
        console.warn('Warning fetching payouts:', payoutsError.message);
      } else if (payoutsData) {
        dbPayouts = payoutsData;
      }
    }

    // Filter released payouts from payouts table
    const releasedPayouts = dbPayouts.filter(
      (p) => p.status === 'released' || p.released_at !== null
    );

    // Deals that are currently in escrow awaiting completion: 'paid', 'shipped', 'return_window'
    const pendingDeals = (allSellerDeals || []).filter((d) =>
      ['paid', 'shipped', 'return_window'].includes(d.status || '')
    );

    // Generate pending payout objects for deals in escrow (or match with existing pending payout rows)
    const pendingPayouts = pendingDeals.map((deal) => {
      const existingDbPayout = dbPayouts.find(
        (p) => p.deal_id === deal.id && p.status === 'pending'
      );
      const agreedPrice = deal.agreed_price || deal.listings?.price || 0;
      const platformFee = deal.platform_fee || Number((agreedPrice * PLATFORM_FEE_RATE).toFixed(2));
      // In accordance with spec: seller receives agreedPrice - platformFee upon payout release.
      const netPayout = existingDbPayout?.amount || Math.round((agreedPrice - platformFee) * 100) / 100;

      return {
        id: existingDbPayout?.id || `pending-${deal.id}`,
        deal_id: deal.id,
        amount: netPayout,
        platform_fee: existingDbPayout?.platform_fee || platformFee,
        status: 'pending',
        paypal_payout_batch_id: existingDbPayout?.paypal_payout_batch_id || null,
        released_at: null,
        deal_status: deal.status,
        deal_title: deal.listings?.title || 'Listing',
        agreed_price: agreedPrice,
      };
    });

    const payouts = {
      pending: pendingPayouts,
      released: releasedPayouts,
      all: [...pendingPayouts, ...releasedPayouts],
      totalPendingAmount: pendingPayouts.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      totalReleasedAmount: releasedPayouts.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    };

    return NextResponse.json({
      sellerId,
      listings: listings || [],
      activeDeals,
      payouts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
