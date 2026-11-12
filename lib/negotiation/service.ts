import "server-only";
import { db } from "@/lib/payments/db";
import { HttpError } from "@/lib/payments/http";
import { parsePriceToCents } from "@/lib/payments/money.mjs";
import {
  buyerOfferCents,
  sellerCounterCents,
  parseOfferCents,
  redactPrivateAmounts,
} from "./policy.mjs";
import { generateAgentText, interpretSelfChat } from "./gemini";
import { safeFallback, safePublicText } from "./guards";
function bounded(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
const config = () => ({
  daily: bounded(process.env.NEG_USER_DAILY_GEMINI_LIMIT, 50, 1, 1000),
  session: bounded(process.env.NEG_SESSION_GEMINI_LIMIT, 12, 1, 100),
  lease: bounded(process.env.NEG_TURN_LEASE_SECONDS, 30, 5, 60),
});
const errors: Record<string, [number, string]> = {
  brk_neg_quota: [429, "Negotiation AI quota reached. Try later."],
  brk_neg_turn_busy: [409, "A turn is in progress."],
  brk_neg_not_ready: [409, "Five rounds must finish before closing."],
  brk_neg_approval_required: [409, "Seller approval is required first."],
  brk_neg_acceptance_required: [
    409,
    "Current seller approval and buyer acceptance are required.",
  ],
  brk_neg_not_started: [409, "Start negotiation first."],
  brk_neg_not_startable: [409, "Negotiation cannot be started for this deal."],
  brk_neg_already_started: [409, "Negotiation already started."],
  brk_neg_not_active: [409, "Negotiation is no longer active."],
  brk_neg_lease_lost: [409, "Turn expired. Refresh and retry."],
  brk_neg_out_of_turn: [409, "It is not this agent's turn."],
  brk_neg_invalid_output: [
    502,
    "The AI response could not be safely saved. Retry the turn.",
  ],
  brk_neg_invalid_offer: [400, "Offer outside permitted range."],
  brk_neg_invalid_limit: [400, "Maximum is outside the allowed range."],
  brk_neg_invalid_floor: [
    409,
    "Listing cannot be negotiated at the configured minimum.",
  ],
  brk_neg_config: [500, "Negotiation configuration is invalid."],
  brk_forbidden: [403, "You cannot perform this action."],
};
export async function negotiationRpc<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name as never, args as never);
  if (error) {
    const code = error.message.match(/brk_[a-z_]+/)?.[0];
    if (code) {
      const [status, message] = errors[code] ?? [500, "Negotiation failed."];
      throw new HttpError(status, code, message);
    }
    throw new HttpError(500, "negotiation_error", "Negotiation failed.");
  }
  return data as T;
}
type PublicNegotiationState = Record<string, unknown> & {
  mode: "self_chat" | "ai_negotiate";
  round: number;
  status: string;
};

export async function publicSession(
  id: string,
  userId: string,
): Promise<PublicNegotiationState | null> {
  return negotiationRpc<PublicNegotiationState | null>("fn_neg_public_state", {
    p_deal_id: id,
    p_user_id: userId,
  });
}
async function transcript(id: string, privateValues: number[]) {
  const { data, error } = await db
    .from("messages")
    .select("sender,text")
    .eq("deal_id", id)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error)
    throw new HttpError(500, "negotiation_error", "Could not load transcript.");
  return (data ?? [])
    .reverse()
    .map((m) => `${m.sender}: ${redactPrivateAmounts(m.text, privateValues)}`)
    .join("\n");
}
function providerError(e: unknown) {
  console.error(
    "[negotiation] provider failure",
    e instanceof Error ? e.name : "unknown",
  );
  return new HttpError(
    503,
    "ai_temporarily_unavailable",
    "AI unavailable. This turn was not saved; retry shortly.",
  );
}
export async function takeTurn(a: {
  deal: Record<string, unknown>;
  dealId: string;
  userId: string;
  requestId: string;
  buyerText?: string;
}) {
  const c = config(),
    claim = await negotiationRpc<Record<string, unknown>>("fn_neg_claim_turn", {
      p_deal_id: a.dealId,
      p_user_id: a.userId,
      p_request_id: a.requestId,
      p_lease_seconds: c.lease,
      p_daily_limit: c.daily,
      p_session_limit: c.session,
    });
  if (claim.kind === "replay") return claim.result;
  if (claim.kind === "closing")
    return negotiationRpc("fn_neg_finish", {
      p_deal_id: a.dealId,
      p_user_id: a.userId,
    });
  if (claim.kind === "expired") return { ok: true, status: "expired" };
  const lease = String(claim.lease),
    mode = String(claim.mode),
    actor = String(claim.actor) as "buyer_agent" | "seller_agent";
  const max = Number(claim.buyer_max_cents),
    floor = Number(claim.seller_floor_cents),
    listing = Number(claim.listing_cents),
    ask = Number(claim.seller_offer_cents ?? listing),
    priorBuyer = Number(claim.buyer_offer_cents ?? 0);
  const privateValues = [max, floor],
    listingData = a.deal.listing as Record<string, unknown> | null;
  let publicTranscript = "";
  let buyerText: string | null = null,
    buyerOffer: number | null = null,
    sellerOffer: number | null = null,
    agentText: string;
  try {
    publicTranscript = await transcript(a.dealId, privateValues);
    if (mode === "self_chat") {
      buyerText = redactPrivateAmounts(
        String(a.buyerText ?? ""),
        privateValues,
      );
      const r = await interpretSelfChat({
        text: buyerText,
        title: redactPrivateAmounts(
          String(listingData?.title ?? ""),
          privateValues,
        ),
        description: redactPrivateAmounts(
          String(listingData?.description ?? ""),
          privateValues,
        ),
        transcript: publicTranscript,
      });
      // The model may phrase a reply, but only deterministic parsing of buyer-authored text can
      // create an offer. Model classification/extraction never sets an authoritative price.
      const parsedOffer = parseOfferCents(String(a.buyerText ?? ""));
      const candidate =
        parsedOffer !== null && parsedOffer <= max && parsedOffer <= listing
          ? parsedOffer
          : null;
      if (candidate !== null) {
        buyerOffer = candidate;
        sellerOffer = sellerCounterCents(candidate, ask, floor);
      } else sellerOffer = ask;
      agentText =
        safePublicText(r.reply, privateValues) ??
        safeFallback("seller_agent", sellerOffer ?? listing);
    } else {
      const cents =
        actor === "buyer_agent"
          ? buyerOfferCents(ask, max)
          : sellerCounterCents(priorBuyer, ask, floor);
      if (cents === null)
        throw new HttpError(
          409,
          "no_price_overlap",
          "No permitted offer is available.",
        );
      buyerOffer = actor === "buyer_agent" ? cents : null;
      sellerOffer = actor === "seller_agent" ? cents : null;
      const r = await generateAgentText({
        role: actor,
        title: redactPrivateAmounts(
          String(listingData?.title ?? ""),
          privateValues,
        ),
        description: redactPrivateAmounts(
          String(listingData?.description ?? ""),
          privateValues,
        ),
        transcript: publicTranscript,
      });
      agentText =
        safePublicText(r.message, privateValues) ?? safeFallback(actor, cents);
    }
  } catch (e) {
    await negotiationRpc("fn_neg_release_turn", {
      p_deal_id: a.dealId,
      p_lease: lease,
    }).catch(() => undefined);
    if (e instanceof HttpError) throw e;
    throw providerError(e);
  }
  return negotiationRpc("fn_neg_commit_turn", {
    p_deal_id: a.dealId,
    p_user_id: a.userId,
    p_request_id: a.requestId,
    p_lease: lease,
    p_buyer_text: buyerText,
    p_buyer_offer_cents: buyerOffer,
    p_agent_sender: mode === "self_chat" ? "seller_agent" : actor,
    p_agent_text: agentText,
    p_server_offer_cents: sellerOffer ?? buyerOffer ?? ask,
  });
}
export function centsFromInput(v: unknown) {
  const n = parsePriceToCents(v);
  if (n === null || n <= 0)
    throw new HttpError(
      400,
      "invalid_budget",
      "Enter a positive maximum with up to two decimals.",
    );
  return n;
}
