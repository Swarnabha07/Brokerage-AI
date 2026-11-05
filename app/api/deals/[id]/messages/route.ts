import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/auth/server';
import { loadDealForMember } from '@/lib/deals/access';

// Clients can only speak as themselves; agent messages are server-generated (Stage 4).
const schema = z.object({ text: z.string().trim().min(1, 'Message text cannot be empty').max(2000) }).strict();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await loadDealForMember(id, user);
    const { data, error } = await supabaseAdmin.from('messages').select('*').eq('deal_id', id).order('created_at', { ascending: true });
    if (error) return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { side, deal } = await loadDealForMember(id, user);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid message' }, { status: 400 });
    if (deal.status === 'released') return NextResponse.json({ error: 'Deal is closed' }, { status: 409 });

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert({ deal_id: id, sender: side, text: parsed.data.text, is_ai_generated: false })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
