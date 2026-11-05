import "server-only";
import { DEALS, LISTINGS, USERS } from "@/lib/mock/data";
import { getDealAmounts } from "@/lib/fees";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { releaseIfDue } from "@/lib/deals/release";
import { AuthError } from "@/lib/auth/server";

/**
 * Server-only data layer. Every function that touches real data takes the VERIFIED
 * user (from requireUser/getVerifiedUser) and scopes the query to that user.
 * floor_price is never selected for deal/dashboard payloads (buyer-facing).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

const DEAL_SELECT = `
  *,
  listing:listings (id, seller_id, title, description, price),
  buyer:users!buyer_id (id, email, role),
  seller:users!seller_id (id, email, role)`;

const nameOf = (u, fallback) => (u?.email ? u.email.split("@")[0] : fallback);

function mapSupabaseDeal(d, viewerId, messages = []) {
  const price = Number(d.agreed_price ?? d.listing?.price ?? 0);
  const terms =
    typeof d.terms_json === "object" && d.terms_json !== null
      ? d.terms_json
      : {};

  return {
    id: d.id,
    listingId: d.listing_id,
    buyerId: d.buyer_id,
    sellerId: d.seller_id,
    viewerRole:
      d.buyer_id === viewerId
        ? "buyer"
        : d.seller_id === viewerId
          ? "seller"
          : null,
    status: d.status || "negotiating",
    price,
    negotiationMode: d.negotiation_mode || "ai_negotiate",
    tracking_number: d.tracking_number ?? null,
    date: d.created_at ? d.created_at.split("T")[0] : "",
    title: d.listing?.title || "Deal item",
    buyer: {
      id: d.buyer_id,
      name: nameOf(d.buyer, "Buyer"),
      role: "buyer",
    },
    seller: {
      id: d.seller_id,
      name: nameOf(d.seller, "Seller"),
      role: "seller",
    },
    amounts: getDealAmounts(price),
    terms: {
      delivery: d.tracking_number
        ? `Tracked shipping (${d.tracking_number})`
        : "Tracked shipping, signature required",
      returnPolicy: "Inspection window after delivery confirmation",
      ...terms,
    },
    terms_json: terms,
    messages: messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      isAiGenerated: m.is_ai_generated ?? false,
      timestamp: m.created_at || "",
    })),
  };
}

const byNewest = (a, b) => (a.date < b.date ? 1 : -1);
const sum = (items, pick) =>
  Math.round(items.reduce((t, i) => t + pick(i), 0) * 100) / 100;

/* ---------- sample (mock) deals: public, read-only demo records ---------- */

const userById = (id) => Object.values(USERS).find((u) => u.id === id);

function toMockDeal(deal) {
  const listing = LISTINGS.find((l) => l.id === deal.listingId);

  return {
    ...deal,
    title: listing?.title ?? "Untitled deal",
    buyer: userById(deal.buyerId) ?? {
      id: deal.buyerId,
      name: "Buyer",
      role: "buyer",
    },
    seller: userById(deal.sellerId) ?? {
      id: deal.sellerId,
      name: "Seller",
      role: "seller",
    },
    amounts: getDealAmounts(deal.price),
  };
}

/**
 * Real deals (UUID ids) require a verified member `user`.
 * Non-UUID ids resolve to public sample deals only.
 */
export async function getDealById(id, user) {
  if (!isUuid(id)) {
    const mock = DEALS.find((d) => d.id === id);
    return mock ? toMockDeal(mock) : null;
  }

  if (!user) {
    throw new AuthError(401, "Authentication required");
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("deals")
    .select("id, buyer_id, seller_id")
    .eq("id", id)
    .maybeSingle();

  if (membershipError) {
    console.error("[deals] membership lookup failed:", membershipError.message);
    throw new Error("Failed to verify deal access");
  }

  if (
    !membership ||
    (membership.buyer_id !== user.id && membership.seller_id !== user.id)
  ) {
    return null;
  }

  await releaseIfDue(id);

  const { data: deal, error: dealError } = await supabaseAdmin
    .from("deals")
    .select(DEAL_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (dealError) {
    console.error("[deals] deal lookup failed:", dealError.message);
    throw new Error("Failed to load deal");
  }

  if (!deal) {
    return null;
  }

  const { data: messages, error: messagesError } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("deal_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    console.error("[deals] message lookup failed:", messagesError.message);
    throw new Error("Failed to load deal messages");
  }

  return mapSupabaseDeal(deal, user.id, messages || []);
}

/**
 * Fetches deals for one verified user.
 *
 * A return-window deal is checked for release once. If any release succeeds,
 * the list is refreshed once so the dashboard receives the latest status.
 * It never recursively fetches indefinitely.
 */
async function fetchDealsFor(column, userId) {
  const fetchDeals = async () => {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select(DEAL_SELECT)
      .eq(column, userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[deals] dashboard query failed:", error.message);
      throw new Error("Failed to load deals");
    }

    return data || [];
  };

  const deals = await fetchDeals();

  const returnWindowDeals = deals.filter(
    (deal) => deal.status === "return_window",
  );

  if (returnWindowDeals.length === 0) {
    return deals;
  }

  const releaseResults = await Promise.all(
    returnWindowDeals.map((deal) => releaseIfDue(deal.id)),
  );

  const releasedAny = releaseResults.some((result) => result.released);

  // Refresh only when at least one deal actually changed to released.
  return releasedAny ? fetchDeals() : deals;
}

export async function getBuyerDashboard(user) {
  if (!user || user.role !== "buyer") {
    throw new AuthError(403, "Buyer role required");
  }

  const deals = (await fetchDealsFor("buyer_id", user.id))
    .map((d) => mapSupabaseDeal(d, user.id))
    .sort(byNewest);

  const active = deals.filter((d) => d.status !== "released");
  const completed = deals.filter((d) => d.status === "released");
  const inReturnWindow = deals.filter((d) => d.status === "return_window");

  return {
    viewer: {
      id: user.id,
      name: user.email.split("@")[0] || "Buyer",
      role: "buyer",
    },
    stats: {
      activeDeals: active.length,
      inReturnWindowTotal: sum(inReturnWindow, (d) => d.amounts.buyerTotal),
      completedSpend: sum(completed, (d) => d.amounts.buyerTotal),
    },
    activeDeals: active,
    history: completed,
  };
}

export async function getSellerDashboard(user) {
  if (!user || user.role !== "seller") {
    throw new AuthError(403, "Seller role required");
  }

  const deals = (await fetchDealsFor("seller_id", user.id))
    .map((d) => mapSupabaseDeal(d, user.id))
    .sort(byNewest);

  // Owner-only: the seller may see their own floor_price on their own listings.
  const { data: dbListings, error } = await supabaseAdmin
    .from("listings")
    .select("id, seller_id, title, description, price, floor_price, created_at")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[deals] seller listing query failed:", error.message);
    throw new Error("Failed to load listings");
  }

  const viewerName = user.email.split("@")[0] || "Seller";
  const active = deals.filter((d) => d.status !== "released");
  const held = ["paid", "shipped", "return_window"];

  const payouts = deals
    .filter((d) => held.includes(d.status) || d.status === "released")
    .map((d) => ({
      ...d,
      payoutStatus: d.status === "released" ? "released" : "pending",
    }));

  const listings = (dbListings || []).map((l) => ({
    ...l,
    price: Number(l.price),
    sellerId: user.id,
    sellerName: viewerName,
    active: true,
    amounts: getDealAmounts(Number(l.price)),
    openDeals: active.filter((d) => d.listingId === l.id).length,
  }));

  return {
    viewer: { id: user.id, name: viewerName, role: "seller" },
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
