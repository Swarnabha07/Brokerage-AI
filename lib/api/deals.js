import "server-only";
import { DEALS, LISTINGS, USERS } from "@/lib/mock/data";
import { getDealAmounts } from "@/lib/fees";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { db } from "@/lib/payments/db";
import { loadPaymentContext, hasPayoutProfile } from "@/lib/payments/dealview";
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
  id, listing_id, buyer_id, seller_id, status, agreed_price, platform_fee, buyer_conditions,
  negotiation_mode, terms_json, tracking_number, created_at, shipped_at,
  return_window_started_at, return_window_ends_at, delivery_confirmed_at, delivery_confirmed_by, needs_review,
  listing:listings (id, seller_id, title, description, price),
  buyer:users!buyer_id (id, email, role),
  seller:users!seller_id (id, email, role)`;

const nameOf = (u, fallback) => (u?.email ? u.email.split("@")[0] : fallback);

function mapSupabaseDeal(d, viewerId, messages = [], extra = null) {
  const price = Number(d.agreed_price ?? d.listing?.price ?? 0);
  const invoice = extra?.invoice ?? null;
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
    listingPrice: Number(d.listing?.price ?? 0),
    negotiationMode: d.negotiation_mode || "ai_negotiate",
    aiNegotiationEnabled: Boolean(extra?.aiNegotiationEnabled),
    aiNegotiationState: extra?.aiNegotiationState ?? null,
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
    // Once an invoice exists the amounts are the FROZEN server values, never recomputed from the listing.
    amounts: invoice
      ? { price: invoice.price, fee: invoice.platformFee, buyerTotal: invoice.total, sellerAmount: invoice.price }
      : getDealAmounts(price),
    shippedAt: d.shipped_at ?? null,
    returnWindowStartedAt: d.return_window_started_at ?? null,
    returnWindowEndsAt: d.return_window_ends_at ?? null,
    deliveryConfirmedAt: d.delivery_confirmed_at ?? null,
    deliveryConfirmedBy: d.delivery_confirmed_by ?? null,
    needsReview: d.needs_review ?? false,
    invoice,
    paymentStatus: extra?.paymentStatus ?? null,
    payout: extra?.payout ?? null,
    dispute: extra?.dispute ?? null,
    financials: extra?.financials ?? null,
    events: extra?.events ?? [],
    hasPayoutProfile: extra?.hasPayoutProfile ?? null,
    agreement: extra?.agreement ?? null,
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

  // READ-ONLY: rendering this page never changes state or moves money.
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

  const viewerRole = deal.buyer_id === user.id ? "buyer" : "seller";
  const ctx = await loadPaymentContext(id, viewerRole);
  const profile = viewerRole === "seller" ? await hasPayoutProfile(user.id) : null;
  const { data: a } = await supabaseAdmin.from("deal_agreements").select("version,terms_hash,terms,buyer_accepted_hash,seller_accepted_hash").eq("deal_id", id).maybeSingle();
  const agreement = a ? { version: a.version, termsHash: a.terms_hash, terms: a.terms, buyerAccepted: a.buyer_accepted_hash === a.terms_hash, sellerAccepted: a.seller_accepted_hash === a.terms_hash } : null;
  const { data: negotiation } = await db.rpc("fn_neg_public_state", { p_deal_id: id, p_user_id: user.id });
  return mapSupabaseDeal(deal, user.id, messages || [], { ...ctx, hasPayoutProfile: profile, agreement, aiNegotiationEnabled: Boolean(negotiation), aiNegotiationState: negotiation?.status ?? null });
}

/** Fetches deals for one verified user. Read-only: dashboards never trigger release or any money movement. */
async function fetchDealsFor(column, userId) {
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
}

const CLOSED = ["released", "cancelled", "refunded"];

export async function getBuyerDashboard(user) {
  if (!user || user.role !== "buyer") {
    throw new AuthError(403, "Buyer role required");
  }

  const deals = (await fetchDealsFor("buyer_id", user.id))
    .map((d) => mapSupabaseDeal(d, user.id))
    .sort(byNewest);

  const active = deals.filter((d) => !CLOSED.includes(d.status));
  const completed = deals.filter((d) => CLOSED.includes(d.status));
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
      completedSpend: sum(
        completed.filter((d) => d.status === "released"),
        (d) => d.amounts.buyerTotal,
      ),
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
  const active = deals.filter((d) => !CLOSED.includes(d.status));
  const held = ["paid", "shipped", "return_window", "disputed"];

  // Real payout state from the payouts table (never inferred from the deal status).
  const releasedIds = deals.filter((d) => d.status === "released").map((d) => d.id);
  const payoutRows = new Map();
  if (releasedIds.length) {
    const { data: rows, error: poError } = await supabaseAdmin
      .from("payouts")
      .select("deal_id, status")
      .in("deal_id", releasedIds);
    if (poError) {
      console.error("[deals] payout lookup failed:", poError.message);
      throw new Error("Failed to load payouts");
    }
    for (const r of rows || []) payoutRows.set(r.deal_id, r.status);
  }

  // payoutStatus: held (funds held by Brokerage AI) | processing | paid | failed | review
  const payoutStatusOf = (d) => {
    if (d.status !== "released") return "held";
    const st = payoutRows.get(d.id);
    if (st === "succeeded") return "paid";
    if (st === "failed") return "failed";
    if (st === "manual_review" || st === "ambiguous") return "review";
    return "processing";
  };

  const payouts = deals
    .filter((d) => held.includes(d.status) || d.status === "released")
    .map((d) => ({ ...d, payoutStatus: payoutStatusOf(d) }));

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
        payouts.filter((p) => p.payoutStatus !== "paid"),
        (p) => p.amounts.sellerAmount,
      ),
    },
    listings,
    activeDeals: active,
    payouts,
  };
}
