import {
  DEALS,
  LISTINGS,
  USERS,
  DEMO_BUYER,
  DEMO_SELLER,
} from "@/lib/mock/data";
import { getDealAmounts } from "@/lib/fees";
import { supabaseAdmin } from "@/lib/supabase";

const userById = (id) => Object.values(USERS).find((u) => u.id === id);

function toMockDeal(deal) {
  const listing = LISTINGS.find((l) => l.id === deal.listingId);
  return {
    ...deal,
    title: listing?.title ?? "Untitled deal",
    buyer: userById(deal.buyerId) ?? { id: deal.buyerId, name: "Buyer", role: "buyer" },
    seller: userById(deal.sellerId) ?? { id: deal.sellerId, name: "Seller", role: "seller" },
    amounts: getDealAmounts(deal.price),
  };
}

function mapSupabaseDeal(d, messages = []) {
  const price = Number(d.agreed_price || d.listing?.price || d.listings?.price || 0);
  const terms = typeof d.terms_json === "object" && d.terms_json !== null
    ? d.terms_json
    : {
        delivery: d.tracking_number
          ? `Tracked Shipping (${d.tracking_number})`
          : "Tracked shipping, signature required",
        returnPolicy: "48-hour inspection window upon delivery confirmation",
      };

  return {
    id: d.id,
    listingId: d.listing_id,
    buyerId: d.buyer_id,
    sellerId: d.seller_id,
    status: d.status || "negotiating",
    price,
    negotiationMode: d.negotiation_mode || "ai_negotiate",
    date: d.created_at ? d.created_at.split("T")[0] : new Date().toISOString().split("T")[0],
    title: d.listing?.title || d.listings?.title || "Deal Item",
    buyer: {
      id: d.buyer?.id || d.buyer_id || "buyer",
      name: d.buyer?.email ? d.buyer.email.split("@")[0] : "Alex Chen",
      role: "buyer",
    },
    seller: {
      id: d.seller?.id || d.seller_id || "seller",
      name: d.seller?.email ? d.seller.email.split("@")[0] : "Marcus R.",
      role: "seller",
    },
    amounts: getDealAmounts(price),
    terms: {
      delivery: terms.delivery || "Tracked shipping, signature required",
      returnPolicy: terms.returnPolicy || "48-hour inspection window upon delivery confirmation",
      ...terms,
    },
    messages: messages && messages.length > 0
      ? messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
          isAiGenerated: m.is_ai_generated ?? false,
          timestamp: m.created_at || "",
        }))
      : [
          {
            id: `msg-${d.id}-1`,
            sender: "buyer_agent",
            text: `Offer submitted for ${d.listing?.title || d.listings?.title || "item"}.`,
            isAiGenerated: true,
          },
        ],
  };
}

const byNewest = (a, b) => (a.date < b.date ? 1 : -1);
const sum = (items, pick) =>
  Math.round(items.reduce((total, item) => total + pick(item), 0) * 100) / 100;

export async function getAllDealIds() {
  try {
    const { data, error } = await supabaseAdmin.from("deals").select("id");
    if (!error && data && data.length > 0) {
      const dbIds = data.map((d) => d.id);
      const mockIds = DEALS.map((d) => d.id);
      return Array.from(new Set([...dbIds, ...mockIds]));
    }
  } catch (err) {
    console.warn("Supabase fetch failed in getAllDealIds:", err);
  }

  return DEALS.map((d) => d.id);
}

export async function getDealById(id) {
  try {
    const { data: deal, error } = await supabaseAdmin
      .from("deals")
      .select(`
        *,
        listing:listings (
          id,
          seller_id,
          title,
          description,
          price,
          floor_price
        ),
        buyer:users!buyer_id (
          id,
          email,
          role
        ),
        seller:users!seller_id (
          id,
          email,
          role
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (!error && deal) {
      // Auto-release payout if 60-second return window has passed
      if (deal.status === "return_window") {
        const terms =
          typeof deal.terms_json === "object" && deal.terms_json !== null
            ? deal.terms_json
            : {};
        const startedAtStr = terms.return_window_started_at || deal.created_at;
        const startedAt = startedAtStr ? new Date(startedAtStr).getTime() : 0;
        if (startedAt > 0 && Date.now() - startedAt >= 60 * 1000) {
          deal.status = "released";
          await supabaseAdmin
            .from("deals")
            .update({ status: "released" })
            .eq("id", id);

          const agreedPrice = Number(deal.agreed_price || deal.listing?.price || 0);
          const platformFee = Number(deal.platform_fee || (agreedPrice * 0.03).toFixed(2));
          await supabaseAdmin.from("payouts").insert({
            deal_id: id,
            amount: Math.round((agreedPrice - platformFee) * 100) / 100,
            platform_fee: platformFee,
            status: "released",
            released_at: new Date().toISOString(),
          });
        }
      }

      const { data: messages } = await supabaseAdmin
        .from("messages")
        .select("*")
        .eq("deal_id", id)
        .order("created_at", { ascending: true });

      return mapSupabaseDeal(deal, messages || []);
    }
  } catch (err) {
    console.warn("Supabase fetch failed in getDealById, using mock data:", err);
  }

  const mockDeal = DEALS.find((d) => d.id === id);
  return mockDeal ? toMockDeal(mockDeal) : null;
}

export async function getBuyerDashboard(buyerId = "22222222-2222-2222-2222-222222222222") {
  try {
    const { data: deals, error } = await supabaseAdmin
      .from("deals")
      .select(`
        *,
        listing:listings (
          id,
          title,
          price,
          description
        ),
        buyer:users!buyer_id (
          id,
          email,
          role
        ),
        seller:users!seller_id (
          id,
          email,
          role
        )
      `)
      .eq("buyer_id", buyerId)
      .order("created_at", { ascending: false });

    const { data: dbUser } = await supabaseAdmin
      .from("users")
      .select("id, email, role")
      .eq("id", buyerId)
      .maybeSingle();

    const viewerName = dbUser?.email
      ? dbUser.email.split("@")[0]
      : buyerId === "22222222-2222-2222-2222-222222222222"
      ? "Alex Chen"
      : "Buyer";

    if (!error && deals) {
      const mappedDeals = deals.map((d) => mapSupabaseDeal(d)).sort(byNewest);
      const active = mappedDeals.filter((d) => d.status !== "released");
      const completed = mappedDeals.filter((d) => d.status === "released");
      const inReturnWindow = mappedDeals.filter((d) => d.status === "return_window");

      if (buyerId !== "22222222-2222-2222-2222-222222222222" || mappedDeals.length > 0) {
        return {
          viewer: { id: buyerId, name: viewerName, role: "buyer" },
          stats: {
            activeDeals: active.length,
            inReturnWindowTotal: sum(inReturnWindow, (d) => d.amounts.buyerTotal),
            completedSpend: sum(completed, (d) => d.amounts.buyerTotal),
          },
          activeDeals: active,
          history: completed,
        };
      }
    }
  } catch (err) {
    console.warn("Supabase fetch failed in getBuyerDashboard, using mock data:", err);
  }

  // Fallback to mock data
  const mockDeals = DEALS.filter((d) => d.buyerId === DEMO_BUYER.id)
    .map(toMockDeal)
    .sort(byNewest);
  const active = mockDeals.filter((d) => d.status !== "released");
  const completed = mockDeals.filter((d) => d.status === "released");
  const inReturnWindow = mockDeals.filter((d) => d.status === "return_window");

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

export async function getSellerDashboard(sellerId = "11111111-1111-1111-1111-111111111111") {
  try {
    const { data: deals, error: dealsError } = await supabaseAdmin
      .from("deals")
      .select(`
        *,
        listing:listings (
          id,
          title,
          price,
          description
        ),
        buyer:users!buyer_id (
          id,
          email,
          role
        ),
        seller:users!seller_id (
          id,
          email,
          role
        )
      `)
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    const { data: dbListings, error: listingsError } = await supabaseAdmin
      .from("listings")
      .select("*")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    const { data: dbUser } = await supabaseAdmin
      .from("users")
      .select("id, email, role")
      .eq("id", sellerId)
      .maybeSingle();

    const viewerName = dbUser?.email
      ? dbUser.email.split("@")[0]
      : sellerId === "11111111-1111-1111-1111-111111111111"
      ? "Marcus R."
      : "Seller";

    if (!dealsError && deals) {
      const mappedDeals = deals.map((d) => mapSupabaseDeal(d)).sort(byNewest);
      const active = mappedDeals.filter((d) => d.status !== "released");
      const heldStatuses = ["paid", "shipped", "return_window"];
      const payouts = mappedDeals
        .filter((d) => heldStatuses.includes(d.status) || d.status === "released")
        .map((d) => ({
          ...d,
          payoutStatus: d.status === "released" ? "released" : "pending",
        }));

      const listings = (dbListings || []).map((l) => ({
        ...l,
        sellerId,
        sellerName: viewerName,
        active: true,
        amounts: getDealAmounts(Number(l.price)),
        openDeals: active.filter((d) => d.listingId === l.id).length,
      }));

      if (sellerId !== "11111111-1111-1111-1111-111111111111" || (mappedDeals.length > 0 || listings.length > 0)) {
        return {
          viewer: { id: sellerId, name: viewerName, role: "seller" },
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
    }
  } catch (err) {
    console.warn("Supabase fetch failed in getSellerDashboard, using mock data:", err);
  }

  // Fallback to mock data
  const deals = DEALS.filter((d) => d.sellerId === DEMO_SELLER.id)
    .map(toMockDeal)
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
