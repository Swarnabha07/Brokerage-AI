import { NextResponse } from 'next/server';
import { handlePaypalWebhook } from '@/lib/payments/webhooks';
import { apiError } from '@/lib/payments/http';

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 200_000) return NextResponse.json({ error: 'Too large' }, { status: 413 });
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const r = await handlePaypalWebhook(raw, headers);
    return NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    return apiError(err);
  }
}
