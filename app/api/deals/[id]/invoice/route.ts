import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { assertSameOrigin, apiError, limit, readJson, HttpError } from '@/lib/payments/http';
import { issueInvoice } from '@/lib/payments/service';

const schema = z.object({ price: z.union([z.string(), z.number()]) }).strict();

/** Seller approves the terms with a FINAL price. The server freezes it (and the 3% fee) into an immutable invoice. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser('seller');
    const { id } = await params;
    limit(`invoice:${user.id}`, 10, 60_000);
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'invalid_body', 'Provide the final price');
    const invoice = await issueInvoice(user, id, parsed.data.price);
    return NextResponse.json({ invoice_number: invoice.invoice_number, total_cents: invoice.total_cents, status: invoice.status });
  } catch (err) {
    return apiError(err);
  }
}
