import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_RETURN_WINDOW_SECONDS } from "@/lib/config";
import { getDealAmounts } from "@/lib/fees";

/**
 * The only code path that releases a deal in the application ledger.
 *
 * - Uses the server clock.
 * - Uses a conditional status update to prevent competing releases.
 * - Ensures a payout ledger row exists, including after a partial failure.
 *
 * IMPORTANT: This creates an application ledger record only.
 * It does not transfer money through PayPal.
 *
 * Callers must verify that the user is a member of the deal.
 */
export async function releaseIfDue(dealId: string) {
  const { data: deal, error: dealError } = await supabaseAdmin
    .from("deals")
    .select(
      "id, status, agreed_price, platform_fee, terms_json, listing:listings(price)",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (dealError) {
    console.error("[release] failed to load deal:", dealError.message);
    throw new Error("Failed to check deal release eligibility");
  }

  if (!deal) {
    return { released: false as const };
  }

  if (deal.status === "return_window") {
    const terms =
      deal.terms_json && typeof deal.terms_json === "object"
        ? (deal.terms_json as Record<string, unknown>)
        : {};

    const startedAt =
      typeof terms.return_window_started_at === "string"
        ? Date.parse(terms.return_window_started_at)
        : NaN;

    // No trusted start time means the deal must never be released.
    if (
      Number.isNaN(startedAt) ||
      Date.now() - startedAt < DEMO_RETURN_WINDOW_SECONDS * 1000
    ) {
      return { released: false as const };
    }

    const { data: flipped, error: flipError } = await supabaseAdmin
      .from("deals")
      .update({ status: "released" })
      .eq("id", dealId)
      .eq("status", "return_window")
      .select("id");

    if (flipError) {
      console.error(
        "[release] failed to update deal status:",
        flipError.message,
      );
      throw new Error("Failed to release deal");
    }

    // Another request may have completed the status transition first.
    if (!flipped || flipped.length === 0) {
      return { released: false as const };
    }
  } else if (deal.status !== "released") {
    return { released: false as const };
  }

  // The deal is released in the application workflow.
  // Ensure its application payout ledger record exists.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("payouts")
    .select("id")
    .eq("deal_id", dealId)
    .limit(1);

  if (existingError) {
    console.error(
      "[release] failed to check payout ledger:",
      existingError.message,
    );
    throw new Error("Deal released, but payout record could not be verified");
  }

  if (!existing || existing.length === 0) {
    const listing = Array.isArray(deal.listing)
      ? deal.listing[0]
      : deal.listing;

    const price = Number(deal.agreed_price ?? listing?.price ?? 0);

    if (!(price > 0)) {
      throw new Error(
        "Deal released, but no valid price was available for its payout record",
      );
    }

    const amounts = getDealAmounts(price);

    const { error: insertError } = await supabaseAdmin.from("payouts").insert({
      deal_id: dealId,
      amount: amounts.sellerAmount,
      platform_fee: amounts.fee,
      status: "released",
      released_at: new Date().toISOString(),
    });

    // A unique-constraint conflict means another request inserted the row.
    if (insertError && insertError.code !== "23505") {
      console.error("[release] payout insert failed:", insertError.message);
      throw new Error("Deal released, but payout record creation failed");
    }
  }

  return { released: true as const };
}
