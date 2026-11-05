import "server-only";
import { LISTINGS, USERS } from "@/lib/mock/data";
import { getDealAmounts } from "@/lib/fees";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** PUBLIC listing reads. floor_price is private seller data and is never selected here. */
const PUBLIC_COLUMNS =
  "id, seller_id, title, description, price, created_at, seller:users!seller_id(id, email)";

const sellerNameFromMock = (sellerId) =>
  Object.values(USERS).find((u) => u.id === sellerId)?.name ?? "Unknown seller";

const toMockListing = (l) => ({
  ...l,
  sellerName: sellerNameFromMock(l.sellerId),
  amounts: getDealAmounts(l.price),
});

const toPublicListing = (l) => ({
  id: l.id,
  sellerId: l.seller_id,
  title: l.title,
  description: l.description,
  price: Number(l.price),
  active: true,
  sellerName: l.seller?.email
    ? l.seller.email.split("@")[0]
    : "Verified Seller",
  amounts: getDealAmounts(Number(l.price)),
  sampleDealId: null,
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Real marketplace listings only.
 *
 * A failed query throws so callers can show an error state.
 * An empty table returns [] so callers can show an empty state.
 * Sample data is never substituted for real marketplace data.
 */
export async function getActiveListings() {
  const { data, error } = await supabaseAdmin
    .from("listings")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listings] getActiveListings failed:", error.message);
    throw new Error("Failed to load listings");
  }

  return (data || []).map(toPublicListing);
}

export async function getListingById(id) {
  // Non-UUID IDs are reserved for the existing read-only demo listings.
  if (!UUID_RE.test(String(id))) {
    const sample = LISTINGS.find((l) => l.id === id);
    return sample ? toMockListing(sample) : null;
  }

  const { data: listing, error } = await supabaseAdmin
    .from("listings")
    .select(PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[listings] getListingById failed:", error.message);
    throw new Error("Failed to load listing");
  }

  return listing ? toPublicListing(listing) : null;
}

/**
 * Returns only real database listing IDs.
 * Demo listing IDs are not mixed into live marketplace static parameters.
 */
export async function getAllListingIds() {
  const { data, error } = await supabaseAdmin.from("listings").select("id");

  if (error) {
    console.error("[listings] getAllListingIds failed:", error.message);
    throw new Error("Failed to load listing IDs");
  }

  return (data || []).map((listing) => listing.id);
}
