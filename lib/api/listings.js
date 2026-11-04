import { LISTINGS, USERS } from "@/lib/mock/data";
import { getDealAmounts } from "@/lib/fees";

// Replaceable data boundary: swap these mock reads for Supabase queries later.

const sellerName = (sellerId) =>
  Object.values(USERS).find((u) => u.id === sellerId)?.name ?? "Unknown seller";

const toListing = (l) => ({
  ...l,
  sellerName: sellerName(l.sellerId),
  amounts: getDealAmounts(l.price),
});

export async function getActiveListings() {
  return LISTINGS.filter((l) => l.active).map(toListing);
}

export async function getListingById(id) {
  const listing = LISTINGS.find((l) => l.id === id);
  return listing ? toListing(listing) : null;
}

export async function getAllListingIds() {
  return LISTINGS.map((l) => l.id);
}
