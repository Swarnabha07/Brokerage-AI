import {
  DEALS,
  LISTINGS,
  USERS,
  DEMO_BUYER,
  DEMO_SELLER,
} from "@/lib/mock/data";
import { getDealAmounts } from "@/lib/fees";

// Replaceable data boundary: swap these mock reads for Supabase queries later.
// Deal status must always come from the server record, never from a button.

const userById = (id) => Object.values(USERS).find((u) => u.id === id);

function toDeal(deal) {
  const listing = LISTINGS.find((l) => l.id === deal.listingId);
  return {
    ...deal,
    title: listing?.title ?? "Untitled deal",
    buyer: userById(deal.buyerId),
    seller: userById(deal.sellerId),
    amounts: getDealAmounts(deal.price),
  };
}

const byNewest = (a, b) => (a.date < b.date ? 1 : -1);
const sum = (items, pick) =>
  Math.round(items.reduce((total, item) => total + pick(item), 0) * 100) / 100;

export async function getAllDealIds() {
  return DEALS.map((d) => d.id);
}

export async function getDealById(id) {
  const deal = DEALS.find((d) => d.id === id);
  return deal ? toDeal(deal) : null;
}

export async function getBuyerDashboard() {
  const deals = DEALS.filter((d) => d.buyerId === DEMO_BUYER.id)
    .map(toDeal)
    .sort(byNewest);
  const active = deals.filter((d) => d.status !== "released");
  const completed = deals.filter((d) => d.status === "released");
  const inReturnWindow = deals.filter((d) => d.status === "return_window");

  return {
    viewer: DEMO_BUYER,
    stats: {
      activeDeals: active.length,
      inReturnWindowTotal: sum(inReturnWindow, (d) => d.amounts.buyerTotal),
      completedSpend: sum(completed, (d) => d.amounts.buyerTotal),
    },
    activeDeals: active,
    history: completed,
  };
}

export async function getSellerDashboard() {
  const deals = DEALS.filter((d) => d.sellerId === DEMO_SELLER.id)
    .map(toDeal)
    .sort(byNewest);
  const active = deals.filter((d) => d.status !== "released");
  const heldStatuses = ["paid", "shipped", "return_window"];
  const payouts = deals
    .filter((d) => heldStatuses.includes(d.status) || d.status === "released")
    .map((d) => ({
      ...d,
      payoutStatus: d.status === "released" ? "released" : "pending",
    }));

  const listings = LISTINGS.filter(
    (l) => l.sellerId === DEMO_SELLER.id && l.active,
  ).map((l) => ({
    ...l,
    amounts: getDealAmounts(l.price),
    openDeals: active.filter((d) => d.listingId === l.id).length,
  }));

  return {
    viewer: DEMO_SELLER,
    stats: {
      activeListings: listings.length,
      openDeals: active.length,
      pendingPayout: sum(
        payouts.filter((p) => p.payoutStatus === "pending"),
        (p) => p.amounts.sellerAmount,
      ),
    },
    listings,
    activeDeals: active,
    payouts,
  };
}
