import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';

const createMessageSchema = z.object({
  sender: z.enum(['buyer', 'seller', 'buyer_agent', 'seller_agent']),
  text: z.string().min(1, 'Message text cannot be empty'),
  is_ai_generated: z.boolean().default(false),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: messages, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(messages || []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: deal_id } = await params;

    if (!deal_id) {
      return NextResponse.json({ error: 'Deal ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = createMessageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid message data' },
        { status: 400 }
      );
    }

    const { sender, text, is_ai_generated } = parsed.data;

    const { data: newMessage, error } = await supabaseAdmin
      .from('messages')
      .insert({
        deal_id,
        sender,
        text,
        is_ai_generated,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Failed to insert message: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(newMessage, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

