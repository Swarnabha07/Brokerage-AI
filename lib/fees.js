import { PLATFORM_FEE_RATE } from "@/lib/config";

/** Display label such as "3%". */
export const FEE_RATE_LABEL = `${Math.round(PLATFORM_FEE_RATE * 100)}%`;

/** Buyer-facing platform fee for an item price (demo assumption, see lib/config.js). */
export function calculateBuyerFee(price) {
  return Math.round(price * 100 * PLATFORM_FEE_RATE) / 100;
}

/** Single source of truth for every amount shown in the UI. */
export function getDealAmounts(price) {
  const fee = calculateBuyerFee(price);
  return {
    price,
    fee,
    buyerTotal: Math.round((price + fee) * 100) / 100,
    sellerAmount: price,
  };
}
