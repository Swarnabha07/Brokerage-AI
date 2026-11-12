import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { assertSameOrigin, apiError } from "@/lib/payments/http";
import { rpc } from "@/lib/payments/db";
// buyer_id/seller_id are never accepted from the client.
const createDealSchema = z
  .object({
    listing_id: z.string().uuid("Valid listing_id is required"),
    negotiation_mode: z
      .enum(["self_chat", "ai_negotiate"])
      .default("ai_negotiate"),
    buyer_conditions: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser("buyer");
    const parsed = createDealSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid deal parameters" },
        { status: 400 },
      );
    }
    const { listing_id, negotiation_mode, buyer_conditions } =
      parsed.data;

    if (process.env.AI_NEGOTIATION_ENABLED === "true") {
      const requestId = z.string().uuid().safeParse(request.headers.get("idempotency-key"));
      if (!requestId.success) return NextResponse.json({ error: "A valid Idempotency-Key is required" }, { status: 400 });
      const data = await rpc<Record<string, unknown>>("fn_create_negotiated_deal", {
        p_buyer_id: user.id,
        p_listing_id: listing_id,
        p_mode: negotiation_mode,
        p_buyer_conditions: buyer_conditions ?? "",
        p_request_id: requestId.data,
        p_ai_enabled: true,
      });
      if (!data) {
        return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
      }
      return NextResponse.json({
        id: data.id, listing_id: data.listing_id, buyer_id: data.buyer_id,
        seller_id: data.seller_id, status: data.status,
        negotiation_mode: data.negotiation_mode, created_at: data.created_at,
      }, { status: 201 });
    }

    // floor_price is deliberately NOT selected.
    const { data: listing, error: listingError } = await supabaseAdmin
      .from("listings")
      .select("id, seller_id")
      .eq("id", listing_id)
      .maybeSingle();

    if (listingError) {
      console.error("[deals] listing lookup failed:", listingError.message);
      return NextResponse.json(
        { error: "Failed to verify listing" },
        { status: 500 },
      );
    }

    if (!listing || !listing.seller_id) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    if (listing.seller_id === user.id)
      return NextResponse.json(
        { error: "You cannot buy your own listing" },
        { status: 403 },
      );

    const { data: deal, error } = await supabaseAdmin
      .from("deals")
      .insert({
        listing_id,
        buyer_id: user.id,
        seller_id: listing.seller_id,
        negotiation_mode,
        buyer_budget: null,
        buyer_conditions: buyer_conditions ?? null,
        status: "negotiating",
      })
      .select(
        "id, listing_id, buyer_id, seller_id, status, negotiation_mode, created_at",
      )
      .single();
    if (error)
      return NextResponse.json(
        { error: "Failed to create deal" },
        { status: 500 },
      );
    return NextResponse.json(deal, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
