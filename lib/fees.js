import { PLATFORM_FEE_RATE } from "@/lib/config";

/** Display label such as "3%". */
export const FEE_RATE_LABEL = `${Math.round(PLATFORM_FEE_RATE * 100)}%`;

/** Platform fee calculated from agreed item price. */
export function calculatePlatformFee(price) {
  return Math.round(price * 100 * PLATFORM_FEE_RATE) / 100;
}

export const calculateBuyerFee = calculatePlatformFee;

/**
 * Single source of truth for every amount shown in the UI and calculated by the backend.
 *
 * Spec alignment:
 * - The buyer pays the agreed item price ($285.00).
 * - The platform fee (3% = $8.55) is deducted from the transaction.
 * - The seller receives the net payout: agreedPrice - platformFee ($276.45).
 */
export function getDealAmounts(price) {
  const numPrice = Number(price) || 0;
  const fee = calculatePlatformFee(numPrice);
  return {
    price: numPrice,
    fee,
    buyerTotal: numPrice,
    sellerAmount: Math.round((numPrice - fee) * 100) / 100,
  };
}
