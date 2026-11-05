import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { loadDealForMember } from "@/lib/deals/access";
import {
  findClientTransition,
  DEMO_PAYMENT_SIMULATION_ENABLED,
} from "@/lib/deals/transitions";
import { releaseIfDue } from "@/lib/deals/release";
import { getDealAmounts } from "@/lib/fees";

// Strict allow-list: clients cannot set price, fee, terms, released/return_window.
const patchSchema = z
  .object({
    status: z.enum(["agreed", "invoiced", "paid", "shipped"]),
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
    await loadDealForMember(id, user);
    await releaseIfDue(id);

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

    const [
      { data: messages, error: messagesError },
      { data: invoices, error: invoicesError },
      { data: payouts, error: payoutsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("messages")
        .select("*")
        .eq("deal_id", id)
        .order("created_at", { ascending: true }),

      supabaseAdmin
        .from("invoices")
        .select("*")
        .eq("deal_id", id)
        .order("created_at", { ascending: false })
        .limit(1),

      supabaseAdmin.from("payouts").select("*").eq("deal_id", id).limit(1),
    ]);

    if (messagesError || invoicesError || payoutsError) {
      console.error("[deals] GET related data lookup failed:", {
        messages: messagesError?.message,
        invoices: invoicesError?.message,
        payouts: payoutsError?.message,
      });

      return NextResponse.json(
        { error: "Failed to load deal details" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      deal,
      listing: deal.listing ?? null,
      messages: messages ?? [],
      invoice: invoices?.[0] ?? null,
      payout: payouts?.[0] ?? null,
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

    if (to === "paid") {
      // Real capture arrives in Stage 3. Until then only a dev-only, buyer-only simulation exists.
      if (!DEMO_PAYMENT_SIMULATION_ENABLED) {
        return NextResponse.json(
          {
            error:
              "Payment can only be confirmed by verified PayPal capture (not yet implemented)",
          },
          { status: 403 },
        );
      }
      if (side !== 'buyer' || deal.status !== 'invoiced') {
        return NextResponse.json(
          { error: "Transition invoiced -> paid is not allowed" },
          { status: 409 },
        );
      }
    } else {
      const t = findClientTransition(deal.status, to, side);
      if (!t.ok)
        return NextResponse.json({ error: t.error }, { status: t.code });
    }

    if (to === "agreed" || to === "invoiced") {
      // Price/fee come from trusted DB values only.
      const price = Number(deal.agreed_price ?? deal.listing?.price ?? 0);
      if (!(price > 0))
        return NextResponse.json(
          { error: "No valid price on this deal" },
          { status: 409 },
        );
      updates.agreed_price = price;
      updates.platform_fee = getDealAmounts(price).fee;
    }
    if (to === "shipped") {
      if (!tracking_number)
        return NextResponse.json(
          { error: "tracking_number is required" },
          { status: 400 },
        );
      updates.tracking_number = tracking_number;
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
    return errorResponse(err);
  }
}
