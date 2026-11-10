import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { assertSameOrigin, apiError, readJson, HttpError } from '@/lib/payments/http';
import { acceptTerms, proposeTerms } from '@/lib/payments/service';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('propose'),
    price: z.union([z.string(), z.number()]),
    fulfillmentType: z.enum(['physical_goods', 'service', 'other']),
    deliveryExpectations: z.string().trim().min(3).max(2000),
    transactionConditions: z.string().trim().max(2000),
  }).strict(),
  z.object({ action: z.literal('accept') }).strict(),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'invalid_body', 'Invalid terms action');
    const result = parsed.data.action === 'propose'
      ? await proposeTerms(user, id, parsed.data.price, parsed.data)
      : await acceptTerms(user, id);
    return NextResponse.json({ agreement: result });
  } catch (err) {
    return apiError(err);
  }
}
