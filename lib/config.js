export const APP_NAME = "Brokerage AI";

/**
 * Provisional demo fee model (3%):
 * buyer pays price + fee; seller receives the full agreed price.
 */
export const PLATFORM_FEE_RATE = 0.03;

/** Return window duration in seconds (60 seconds for demo purposes). */
export const DEMO_RETURN_WINDOW_SECONDS = 60;

/** Deal opened by the landing-page call to action. */
export const DEMO_DEAL_ID = "BRK-2026-0147";

/** No global demo notice is displayed. */
export const DEMO_NOTICE = "";

/** Every entry must point at a real route. */
export const NAV_LINKS = [
  { href: "/listings", label: "Listings" },
  { href: "/buyer/dashboard", label: "Buyer" },
  { href: "/seller/dashboard", label: "Seller" },
  { href: "/#how-it-works", label: "How it works" },
];
