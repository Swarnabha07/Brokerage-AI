export const APP_NAME = "Brokerage AI";

/**
 * Standard platform fee rate (3%).
 * In accordance with the project specification:
 * - Buyer pays the agreed item price at checkout.
 * - The platform calculates and deducts the 3% platform fee before payout.
 * - Seller receives the net payout: (agreed_price - platform_fee).
 */
export const PLATFORM_FEE_RATE = 0.03;

/** Return window duration in seconds (60 seconds for demo purposes, simulating real return period). */
export const DEMO_RETURN_WINDOW_SECONDS = 60;

/** Deal opened by the landing-page call to action. */
export const DEMO_DEAL_ID = "BRK-2026-0147";

export const DEMO_NOTICE =
  "Demo mode — sample data only. No real payment is processed, no PayPal order, invoice, email or shipment is created, and nothing is saved.";

/** Every entry must point at a real route. */
export const NAV_LINKS = [
  { href: "/listings", label: "Listings" },
  { href: "/buyer/dashboard", label: "Buyer demo" },
  { href: "/seller/dashboard", label: "Seller demo" },
  { href: "/#how-it-works", label: "How it works" },
];
