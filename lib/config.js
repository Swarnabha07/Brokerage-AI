
export const APP_NAME = "Brokerage AI";

/**
 * Provisional demo fee model (3%): buyer pays price + fee; seller receives the full agreed price.
 * e.g. $285.00 -> fee $8.55 -> buyer pays $293.55 -> seller receives $285.00.
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
  { href: "/buyer/dashboard", label: "Buyer" },
  { href: "/seller/dashboard", label: "Seller" },
  { href: "/#how-it-works", label: "How it works" },
];
