import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { loadDealForMember } from "@/lib/deals/access";
import { findClientTransition } from "@/lib/deals/transitions";
import { assertSameOrigin, apiError } from "@/lib/payments/http";
import { db, rpc } from "@/lib/payments/db";
import { loadPaymentContext } from "@/lib/payments/dealview";

// Strict allow-list: clients cannot set price, fee, terms, or financial lifecycle states.
// (invoiced = POST /invoice, paid = verified capture, return_window = confirm-receipt/admin, released = server rules.)
const patchSchema = z
  .object({
    status: z.literal("shipped"),
    tracking_number: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{3,64}$/, "Invalid tracking number")
      .optional(),
  })
  .strict();

const SAFE_SELECT = `
  *,
  listing:listings(id, seller_id, title, description, price, created_at),
  buyer:users!buyer_id(id, email, role),
  seller:users!seller_id(id, email, role)`;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { side } = await loadDealForMember(id, user);
    // READ-ONLY: GET never changes state or moves money (release happens via POST/scheduler).

    const { data: deal, error: dealError } = await supabaseAdmin
      .from("deals")
      .select(SAFE_SELECT)
      .eq("id", id)
      .single();

    if (dealError || !deal) {
      console.error("[deals] GET deal lookup failed:", dealError?.message);
      return NextResponse.json(
        { error: "Failed to load deal" },
        { status: 500 },
      );
    }

    const [{ data: messages, error: messagesError }, payment] = await Promise.all([
      supabaseAdmin.from("messages").select("*").eq("deal_id", id).order("created_at", { ascending: true }),
      loadPaymentContext(id, side),
    ]);
    if (messagesError) {
      console.error("[deals] GET messages lookup failed:", messagesError.message);
      return NextResponse.json({ error: "Failed to load deal details" }, { status: 500 });
    }
    const { data: agreement } = await db.from("deal_agreements").select("version,terms_hash,terms,buyer_accepted_at,seller_accepted_at,buyer_accepted_hash,seller_accepted_hash").eq("deal_id", id).maybeSingle();

    // Internal review flags are not for clients.
    const { needs_review: _nr, review_reason: _rr, ...safeDeal } = deal as Record<string, unknown>;
    void _nr; void _rr;
    return NextResponse.json({
      deal: safeDeal,
      listing: deal.listing ?? null,
      messages: messages ?? [],
      invoice: payment.invoice,
      payout: payment.payout,
      financials: payment.financials,
      events: payment.events,
      dispute: payment.dispute,
      agreement: agreement ? {
        version: agreement.version,
        termsHash: agreement.terms_hash,
        terms: agreement.terms,
        buyerAccepted: agreement.buyer_accepted_hash === agreement.terms_hash,
        sellerAccepted: agreement.seller_accepted_hash === agreement.terms_hash,
      } : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid update payload" },
        { status: 400 },
      );
    }
    const { status: to, tracking_number } = parsed.data;
    const { deal, side } = await loadDealForMember(id, user);
    type DealUpdate = Database["public"]["Tables"]["deals"]["Update"];
    const updates: DealUpdate = { status: to };

    const t = findClientTransition(deal.status, to, side);
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });

    if (to === "shipped") {
      if (!tracking_number) return NextResponse.json({ error: "tracking_number is required" }, { status: 400 });
      // Atomic + server clock; also requires a verified captured payment. Shipping alone never starts the return window.
      await rpc("fn_mark_shipped", { p_deal_id: id, p_seller_id: user.id, p_tracking: tracking_number });
      const { data: shipped } = await supabaseAdmin.from("deals").select(SAFE_SELECT).eq("id", id).single();
      return NextResponse.json(shipped);
    }

    // Conditional update = optimistic concurrency; a stale/double request affects 0 rows.
    const { data: rows, error } = await supabaseAdmin
      .from("deals")
      .update(updates)
      .eq("id", id)
      .eq("status", deal.status as NonNullable<DealUpdate["status"]>)
      .select(SAFE_SELECT);
    if (error)
      return NextResponse.json(
        { error: "Failed to update deal" },
        { status: 500 },
      );
    if (!rows || rows.length === 0)
      return NextResponse.json(
        { error: "Deal state changed; refresh and retry" },
        { status: 409 },
      );
    return NextResponse.json(rows[0]);
  } catch (err) {
    return apiError(err);
  }
}
