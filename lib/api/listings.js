import { LISTINGS, USERS } from "@/lib/mock/data";
import { getDealAmounts } from "@/lib/fees";
import { supabaseAdmin } from "@/lib/supabase";

const sellerNameFromMock = (sellerId) =>
  Object.values(USERS).find((u) => u.id === sellerId)?.name ?? "Unknown seller";

const toMockListing = (l) => ({
  ...l,
  sellerName: sellerNameFromMock(l.sellerId),
  amounts: getDealAmounts(l.price),
});

export async function getActiveListings() {
  try {
    const { data, error } = await supabaseAdmin
      .from("listings")
      .select(`
        *,
        seller:users!seller_id (
          id,
          email,
          role
        )
      `)
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      return data.map((l) => ({
        id: l.id,
        sellerId: l.seller_id,
        title: l.title,
        description: l.description,
        price: Number(l.price),
        floor_price: l.floor_price ? Number(l.floor_price) : null,
        active: true,
        sellerName: l.seller?.email ? l.seller.email.split("@")[0] : "Verified Seller",
        amounts: getDealAmounts(Number(l.price)),
        sampleDealId: null,
      }));
    }
  } catch (err) {
    console.warn("Supabase fetch failed in getActiveListings, using mock data:", err);
  }

  return LISTINGS.filter((l) => l.active).map(toMockListing);
}

export async function getListingById(id) {
  try {
    const { data: l, error } = await supabaseAdmin
      .from("listings")
      .select(`
        *,
        seller:users!seller_id (
          id,
          email,
          role
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (!error && l) {
      return {
        id: l.id,
        sellerId: l.seller_id,
        title: l.title,
        description: l.description,
        price: Number(l.price),
        floor_price: l.floor_price ? Number(l.floor_price) : null,
        active: true,
        sellerName: l.seller?.email ? l.seller.email.split("@")[0] : "Verified Seller",
        amounts: getDealAmounts(Number(l.price)),
        sampleDealId: null,
      };
    }
  } catch (err) {
    console.warn("Supabase fetch failed in getListingById, using mock data:", err);
  }

  const listing = LISTINGS.find((l) => l.id === id);
  return listing ? toMockListing(listing) : null;
}

export async function getAllListingIds() {
  try {
    const { data, error } = await supabaseAdmin.from("listings").select("id");
    if (!error && data && data.length > 0) {
      const dbIds = data.map((d) => d.id);
      const mockIds = LISTINGS.map((l) => l.id);
      return Array.from(new Set([...dbIds, ...mockIds]));
    }
  } catch (err) {
    console.warn("Supabase fetch failed in getAllListingIds:", err);
  }

  return LISTINGS.map((l) => l.id);
}
