import { PLATFORM_FEE_RATE } from "@/lib/config";

/** Display label such as "3%". */
export const FEE_RATE_LABEL = `${Math.round(PLATFORM_FEE_RATE * 100)}%`;

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => c / 100;

/** Platform fee (provisional demo model): 3% of item price, added to the buyer's total. */
export function calculatePlatformFee(price) {
  return fromCents(Math.round(toCents(price) * PLATFORM_FEE_RATE));
}
export const calculateBuyerFee = calculatePlatformFee;

/**
 * Single source of truth for amounts (UI + server). PROVISIONAL DEMO MODEL:
 *   price 285.00 -> fee 8.55 -> buyer pays 293.55 -> seller receives 285.00
 * Server code must pass a price read from the database, never a client value.
 */
export function getDealAmounts(price) {
  const priceCents = toCents(price);
  const feeCents = Math.round(priceCents * PLATFORM_FEE_RATE);
  return {
    price: fromCents(priceCents),
    fee: fromCents(feeCents),
    buyerTotal: fromCents(priceCents + feeCents),
    sellerAmount: fromCents(priceCents),
  };
}
