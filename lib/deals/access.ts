import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AuthError, type AuthedUser } from "@/lib/auth/server";

/**
 * Loads a deal and verifies the caller is its buyer or seller.
 * Unauthorized callers receive the same response as a missing deal.
 */
export async function loadDealForMember(dealId: string, user: AuthedUser) {
  const { data: deal, error } = await supabaseAdmin
    .from("deals")
    .select("id,listing_id,buyer_id,seller_id,status,agreed_price,platform_fee,buyer_conditions,negotiation_mode,terms_json,tracking_number,created_at,shipped_at,return_window_started_at,return_window_ends_at,delivery_confirmed_at,delivery_confirmed_by,needs_review,review_reason,listing:listings(id,seller_id,title,description,price)")
    .eq("id", dealId)
    .maybeSingle();

  // A database failure is not the same as a missing or inaccessible deal.
  if (error) {
    console.error("[deal-access] deal lookup failed:", error.message);
    throw new Error("Failed to verify deal access");
  }

  if (!deal) {
    throw new AuthError(403, "Deal not found or access denied");
  }

  const side =
    deal.buyer_id === user.id
      ? "buyer"
      : deal.seller_id === user.id
        ? "seller"
        : null;

  if (!side) {
    throw new AuthError(403, "Deal not found or access denied");
  }

  return { deal, side: side as "buyer" | "seller" };
}
