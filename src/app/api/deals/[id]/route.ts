import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';
import { PLATFORM_FEE_RATE } from '@/lib/config';

const updateDealSchema = z.object({
  status: z
    .enum([
      'negotiating',
      'agreed',
      'invoiced',
      'paid',
      'shipped',
      'return_window',
      'released',
      'disputed',
    ])
    .optional(),
  agreed_price: z.number().positive().optional().nullable(),
  platform_fee: z.number().nonnegative().optional().nullable(),
  tracking_number: z.string().optional().nullable(),
  terms_json: z.any().optional().nullable(),
  buyer_budget: z.number().positive().optional().nullable(),
  buyer_conditions: z.string().optional().nullable(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Deal ID is required' }, { status: 400 });
    }

    // 1. Fetch deal with joined listing, buyer, and seller
    const { data: deal, error: dealError } = await supabaseAdmin
      .from('deals')
      .select(`
        *,
        listing:listings (
          id,
          seller_id,
          title,
          description,
          price,
          floor_price,
          created_at
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
      .eq('id', id)
      .maybeSingle();

    if (dealError || !deal) {
      return NextResponse.json(
        { error: `Deal not found: ${dealError?.message || 'Invalid ID'}` },
        { status: 404 }
      );
    }

    // 2. Fetch ordered messages for the deal
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: true });

    if (messagesError) {
      console.warn('Warning fetching deal messages:', messagesError.message);
    }

    // 3. Fetch latest invoice for the deal
    const { data: invoices, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (invoiceError) {
      console.warn('Warning fetching deal invoice:', invoiceError.message);
    }

    const latestInvoice = invoices && invoices.length > 0 ? invoices[0] : null;

    // 4. Fetch latest payout for the deal
    const { data: payouts, error: payoutError } = await supabaseAdmin
      .from('payouts')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (payoutError) {
      console.warn('Warning fetching deal payout:', payoutError.message);
    }

    const latestPayout = payouts && payouts.length > 0 ? payouts[0] : null;

    // Return the full deal room payload
    return NextResponse.json({
      deal,
      listing: deal.listing,
      messages: messages || [],
      invoice: latestInvoice,
      payout: latestPayout,
      buyer: deal.buyer,
      seller: deal.seller,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Deal ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = updateDealSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid update payload' },
        { status: 400 }
      );
    }

    const updates = parsed.data;

    // Calculate platform fee using PLATFORM_FEE_RATE (3%) if agreed_price is updated but fee is not provided
    if (updates.agreed_price && updates.platform_fee === undefined) {
      updates.platform_fee = Number((updates.agreed_price * PLATFORM_FEE_RATE).toFixed(2));
    }

    const { data: updatedDeal, error } = await supabaseAdmin
      .from('deals')
      .update(updates)
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

    if (error) {
      return NextResponse.json(
        { error: `Failed to update deal: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedDeal, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
