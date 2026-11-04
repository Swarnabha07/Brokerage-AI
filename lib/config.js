export const APP_NAME = "Brokerage AI";

/**
 * PROVISIONAL DEMO ASSUMPTION — not a finalized business or legal policy.
 * A single buyer-facing platform fee, shown as a separate line item. The
 * seller's displayed amount equals the agreed item price (no seller-side fee).
 * `documentation.md` currently describes a seller-side deduction instead, so
 * the team must confirm before any real payment integration. No fee is
 * actually collected anywhere in this frontend.
 */
export const PLATFORM_FEE_RATE = 0.03;

/** Shortened on purpose so the simulated return window can be watched live. */
export const DEMO_RETURN_WINDOW_SECONDS = 12;

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
