/**
 * Central MOCK dataset. Everything the UI shows comes from here through
 * lib/api/*. Replace those API functions with Supabase queries later; no
 * component should import this file directly.
 * All values are sample data — nothing here is a real user, deal or payment.
 */

export const USERS = {
  alex: { id: "u_alex", name: "Alex T.", role: "buyer" },
  jordan: { id: "u_jordan", name: "Jordan M.", role: "buyer" },
  marcus: { id: "u_marcus", name: "Marcus R.", role: "seller" },
  priya: { id: "u_priya", name: "Priya K.", role: "seller" },
};

export const DEMO_BUYER = USERS.alex;
export const DEMO_SELLER = USERS.marcus;

export const LISTINGS = [
  {
    id: "iphone-12",
    title: "iPhone 12 — 128GB, Unlocked",
    description:
      "Unlocked iPhone 12 in good condition with a minor scuff on the frame. Battery health is strong and a charging cable is included.",
    price: 300,
    sellerId: "u_marcus",
    active: true,
    sampleDealId: "BRK-2026-0147",
  },
  {
    id: "trek-marlin-7",
    title: "Mountain Bike — Trek Marlin 7",
    description:
      "Medium-frame hardtail, lightly used and recently serviced. Local pickup or tracked shipping by arrangement.",
    price: 550,
    sellerId: "u_marcus",
    active: true,
    sampleDealId: "BRK-2026-0149",
  },
  {
    id: "keychron-keyboard",
    title: "Mechanical Keyboard — Keychron K2",
    description:
      "Wireless 75% mechanical keyboard with brown switches. Keycaps are clean and the box is included.",
    price: 150,
    sellerId: "u_marcus",
    active: true,
    sampleDealId: "BRK-2026-0153",
  },
  {
    id: "logo-brand-kit",
    title: "Logo Design — Full Brand Kit",
    description:
      "Logo, colour palette and typography guide delivered as vector files, with two rounds of revisions.",
    price: 480,
    sellerId: "u_priya",
    active: true,
    sampleDealId: "BRK-2026-0148",
  },
  {
    id: "copywriting-4-pages",
    title: "Freelance Copywriting — 4 pages",
    description:
      "Website copy for up to four pages, delivered in a shared document with one round of edits.",
    price: 275,
    sellerId: "u_priya",
    active: true,
    sampleDealId: "BRK-2026-0151",
  },
  {
    id: "canon-ae-1",
    title: "Vintage Camera — Canon AE-1",
    description: "Film SLR with a 50mm lens. Sold in this sample dataset.",
    price: 190,
    sellerId: "u_marcus",
    active: false,
    sampleDealId: "BRK-2026-0150",
  },
  {
    id: "standing-desk-converter",
    title: "Standing Desk Converter",
    description:
      "Height-adjustable desktop riser. Sold in this sample dataset.",
    price: 100,
    sellerId: "u_marcus",
    active: false,
    sampleDealId: "BRK-2026-0152",
  },
];

export const DEALS = [
  {
    id: "BRK-2026-0147",
    listingId: "iphone-12",
    buyerId: "u_alex",
    sellerId: "u_marcus",
    status: "return_window",
    price: 285,
    negotiationMode: "ai_negotiate",
    date: "2026-11-02",
    terms: {
      delivery: "Tracked shipping; buyer confirms receipt",
      returnPolicy: "48 hours — functional issues covered",
    },
    messages: [
      {
        id: "m1",
        sender: "buyer_agent",
        text: "Hi — my buyer is interested in the iPhone 12 at $260, citing a minor scuff on the frame.",
      },
      {
        id: "m2",
        sender: "seller_agent",
        text: "The device is in excellent condition overall. I can offer $285, including a 48-hour return window.",
      },
      {
        id: "m3",
        sender: "buyer_agent",
        text: "$285 works if the return window covers functional issues, not just cosmetic ones.",
      },
      {
        id: "m4",
        sender: "seller_agent",
        text: "Agreed — functional issues are covered. Finalizing at $285 with a 48-hour window.",
      },
    ],
  },
  {
    id: "BRK-2026-0148",
    listingId: "logo-brand-kit",
    buyerId: "u_alex",
    sellerId: "u_priya",
    status: "negotiating",
    price: 450,
    negotiationMode: "ai_negotiate",
    date: "2026-11-03",
    terms: {
      delivery: "Digital delivery of vector files",
      returnPolicy: "Two revision rounds within 48 hours",
    },
    messages: [
      {
        id: "m1",
        sender: "buyer_agent",
        text: "My buyer would like the full brand kit at $420 with two revision rounds.",
      },
      {
        id: "m2",
        sender: "seller_agent",
        text: "I can do $450 with two revision rounds and all source files included.",
      },
    ],
  },
  {
    id: "BRK-2026-0149",
    listingId: "trek-marlin-7",
    buyerId: "u_alex",
    sellerId: "u_marcus",
    status: "agreed",
    price: 520,
    negotiationMode: "self_chat",
    date: "2026-11-01",
    terms: {
      delivery: "Tracked shipping; buyer confirms receipt",
      returnPolicy: "48 hours — frame and drivetrain issues covered",
    },
    messages: [
      {
        id: "m1",
        sender: "buyer",
        text: "Would you take $500 for the Marlin 7 if I cover shipping?",
      },
      {
        id: "m2",
        sender: "seller_agent",
        text: "I can meet at $520 with tracked shipping and a 48-hour return window.",
      },
    ],
  },
  {
    id: "BRK-2026-0150",
    listingId: "canon-ae-1",
    buyerId: "u_alex",
    sellerId: "u_marcus",
    status: "released",
    price: 180,
    negotiationMode: "ai_negotiate",
    date: "2026-10-24",
    terms: {
      delivery: "Tracked shipping; buyer confirms receipt",
      returnPolicy: "48 hours — functional issues covered",
    },
    messages: [
      {
        id: "m1",
        sender: "buyer_agent",
        text: "My buyer offers $170 for the Canon AE-1 as listed.",
      },
      {
        id: "m2",
        sender: "seller_agent",
        text: "I can settle at $180 with a 48-hour return window.",
      },
    ],
  },
  {
    id: "BRK-2026-0152",
    listingId: "standing-desk-converter",
    buyerId: "u_jordan",
    sellerId: "u_marcus",
    status: "released",
    price: 95,
    negotiationMode: "self_chat",
    date: "2026-10-11",
    terms: {
      delivery: "Tracked shipping; buyer confirms receipt",
      returnPolicy: "48 hours — functional issues covered",
    },
    messages: [
      {
        id: "m1",
        sender: "buyer",
        text: "Could you do $90 for the desk converter?",
      },
      {
        id: "m2",
        sender: "seller_agent",
        text: "I can agree to $95 with the standard 48-hour return window.",
      },
    ],
  },
  {
    id: "BRK-2026-0151",
    listingId: "copywriting-4-pages",
    buyerId: "u_alex",
    sellerId: "u_priya",
    status: "released",
    price: 260,
    negotiationMode: "ai_negotiate",
    date: "2026-09-28",
    terms: {
      delivery: "Digital delivery in a shared document",
      returnPolicy: "One round of edits within 48 hours",
    },
    messages: [
      {
        id: "m1",
        sender: "buyer_agent",
        text: "My buyer proposes $240 for four pages with one round of edits.",
      },
      {
        id: "m2",
        sender: "seller_agent",
        text: "I can do $260 with one round of edits included.",
      },
    ],
  },
  {
    id: "BRK-2026-0153",
    listingId: "keychron-keyboard",
    buyerId: "u_jordan",
    sellerId: "u_marcus",
    status: "invoiced",
    price: 140,
    negotiationMode: "self_chat",
    date: "2026-10-30",
    terms: {
      delivery: "Tracked shipping; buyer confirms receipt",
      returnPolicy: "48 hours — functional issues covered",
    },
    messages: [
      {
        id: "m1",
        sender: "buyer",
        text: "Is $130 possible for the Keychron K2?",
      },
      {
        id: "m2",
        sender: "seller_agent",
        text: "I can offer $140 with a 48-hour return window.",
      },
    ],
  },
];
