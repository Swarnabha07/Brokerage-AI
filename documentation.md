# Brokerage AI

Peer-to-peer transactions with PayPal Sandbox Checkout and application-managed release tracking.

Built for the PayPal AI Hackathon (2026).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Problem Statement](#2-problem-statement)
3. [How It Works](#3-how-it-works)
4. [Features](#4-features)
5. [Architecture](#5-architecture)
6. [PayPal Integration](#6-paypal-integration)
7. [AI Agent Design](#7-ai-agent-design)
8. [Database Schema](#8-database-schema)
9. [Tech Stack](#9-tech-stack)
10. [Project Structure](#10-project-structure)
11. [Setup & Installation](#11-setup--installation)
12. [Running a Test Deal](#12-running-a-test-deal)
13. [Scope & Limitations](#13-scope--limitations)
14. [What Was Built During the Hackathon](#14-what-was-built-during-the-hackathon)
15. [Hackathon Category Alignment](#15-hackathon-category-alignment)
16. [License](#16-license)

---

## 1. Overview

Brokerage AI is a prototype marketplace where a buyer and seller can agree to versioned transaction terms, pay through PayPal Checkout, and follow delivery and payout status. Both parties must accept the same terms before an internal Brokerage AI invoice can be issued. AI negotiation is planned separately and is not implemented in this transaction flow.

This is a hackathon prototype, not a production financial product. PayPal integration is Sandbox-only. Production eligibility, payout availability, and legal approval for an application-managed hold have not been established.

---

## 2. Problem Statement

Peer-to-peer transactions between people who don't know each other — a local marketplace sale, a freelance gig, an informal service agreement — typically rely on one of two flawed options: full upfront trust (pay first, hope the other side delivers) or slow, manual negotiation with no structural protection if something goes wrong.

Formal escrow services exist, but they are built for high-value transactions (real estate, business sales) and are too heavy, slow, and expensive for everyday deals. There is no lightweight, automated way for two strangers to negotiate fair terms and have those terms actually enforced by where the money sits.

Brokerage AI explores a structured transaction flow with mutual terms acceptance, server-side payment verification, delivery confirmation, and release conditions. The application-managed hold is not PayPal-native escrow.

---

## 3. How It Works

1. A seller lists an item or service.
2. A buyer starts a deal on that listing.
3. The seller proposes versioned final terms, including the price and delivery conditions.
4. The buyer and seller each accept the same immutable terms version.
5. The seller issues an internal Brokerage AI invoice reflecting the accepted price and platform fee.
6. The buyer approves and pays through PayPal Checkout.
7. PayPal Checkout is verified server-side; the capture is not considered paid until the provider response passes verification.
8. The seller marks the item as shipped and provides tracking information.
9. The buyer confirms delivery (or an administrator verifies it); seller tracking alone does not start the return window.
10. The configured return window starts (24 hours by default).
11. After it ends without a dispute or review hold, the server evaluates eligibility and initiates PayPal Payouts.
12. The deal is complete only after PayPal confirms the individual payout item succeeded.

For physical goods, PayPal Checkout does not collect or verify shipping addresses or delivery. The seller records delivery expectations in terms accepted by both parties; tracking references are not carrier-verified. Services use the same flow with a service deliverable and due date in the accepted terms.

---

## 4. Features

| Feature | Description |
|---|---|
| Role-based accounts | Users sign up as either a buyer or a seller and are routed to a dashboard built for that role. |
| Seeded listings | A small set of demo listings exist so the negotiation and transaction flow can be demonstrated without building a full marketplace/search experience. |
| AI negotiation | Planned; not implemented in this transaction flow. |
| Mutual terms acceptance | Buyer and seller accept the same versioned terms snapshot; changes clear prior acceptances. |
| Internal invoice | Brokerage AI stores its own invoice; it does not use the PayPal Invoice API. |
| PayPal Checkout | The buyer approves a PayPal Sandbox order; the server verifies the order and capture. |
| Held funds, conditional release | Captured funds are not forwarded to the seller immediately. Release is deferred until delivery is confirmed and a return window passes. |
| Automated payout with platform fee | The buyer pays the 3% fee with the agreed price; after release conditions, the server initiates and verifies a PayPal Payouts item. Provider fees are recorded separately. |
| Server-side financial controls | Routes and database functions authorize state changes; no AI agent has PayPal money-moving tools. |

---

## 5. Architecture
### 5.1 System Layers

<img width="900" height="550" alt="Neon AI Marketplace Architecture Flow" src="https://github.com/user-attachments/assets/81736510-b2ec-4540-8640-39a16c256017" />

### 5.2 Layer Responsibilities

**Frontend (Next.js, App Router)**
Renders the buyer and seller dashboards, the deal detail/negotiation page, the invoice and checkout UI, and the status tracker. Never calls PayPal or the AI model directly — every external call goes through the backend.

**Backend (Next.js API routes)**
Owns the deal state machine (`negotiating → agreed → invoiced → paid → shipped → return_window → released`). It uses server-side PayPal REST calls and database functions; payment credentials remain server-only.

**AI layer (planned)**
Gemini dependencies exist, but the transaction implementation does not run buyer/seller negotiation agents or AI terms extraction.

**PayPal layer (Sandbox)**
Uses native server-side REST calls for Orders, capture, refunds, Payouts, and webhook verification. The Agent Toolkit is installed but not used for this flow.

**Database (Supabase / Postgres)**
Stores users, listings, deals, messages, invoice records, and payout records. This is the single source of truth that both dashboards read from.

---

## 6. PayPal Integration

This project uses PayPal Sandbox and native server-side REST calls:

| API | Used For |
|---|---|
| Orders API | Creating and capturing the buyer's payment through the platform's own checkout UI. |
| Brokerage AI internal invoice | Records the agreed terms and amounts in the application database. The PayPal Invoicing API is not used. |
| Payouts API | Releasing held funds to the seller, net of the platform fee, once the return window closes. |

The application-managed hold is not PayPal-native escrow or delayed disbursement. The buyer pays through PayPal Checkout, the application tracks transaction state, and Brokerage AI later initiates a seller payout through PayPal Payouts after release conditions are met. This flow is Sandbox-only and does not establish production eligibility or legal approval.

The platform fee is 3%, calculated in integer cents. Provider processing and payout fees are recorded separately; they may exceed the platform fee. No PayPal fee-splitting feature is used.

---

## 7. AI Agent Design

AI negotiation is planned but not implemented in this transaction flow. The Gemini and Agent Toolkit dependencies are not used by the payment operations.

No AI agent can create orders, capture payments, issue refunds, or trigger payouts. Server routes authorize these actions and verify provider responses.

---

## 8. Database Schema

| Table | Key Fields |
|---|---|
| `users` | `id`, `email`, `role` (`buyer` \| `seller`) |
| `listings` | `id`, `seller_id`, `title`, `description`, `price` |
| `deals` | `id`, `listing_id`, `buyer_id`, `seller_id`, `status`, `agreed_price`, `platform_fee`, `negotiation_mode` |
| `messages` | `id`, `deal_id`, `sender` (`buyer` \| `seller` \| `buyer_agent` \| `seller_agent`), `text`, `is_ai_generated` |
| `deal_agreements` | Versioned immutable terms, hash, and buyer/seller acceptance records |
| `invoices` | Internal invoice amount, status, expiry, and accepted-terms snapshot |
| `payouts` | `id`, `deal_id`, `amount`, `platform_fee`, `status`, `released_at` |

`deals.status` moves through: `negotiating → agreed → invoiced → paid → shipped → return_window → released` (or `disputed`, where implemented).

---

## 9. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js (App Router), React, Tailwind CSS | Fast to build, deploys cleanly to Vercel for a hosted demo. |
| Backend | Next.js API routes | Keeps frontend and backend in one deployable project for a hackathon timeline. |
| Auth & Database | Supabase | Managed auth and Postgres without building custom auth from scratch. |
| AI model | Google Gemini packages are present; AI negotiation is not implemented in this transaction flow. |
| Payments | PayPal Sandbox native REST calls | Server-side Orders, capture, refund, Payouts, and webhook verification; Agent Toolkit is not used. |
| Deployment | Vercel or Render | Free-tier hosting suitable for a judge-accessible demo URL. |

---

## 10. Project Structure

```
Brokerage-AI/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/route.ts
│   │   │   └── signup/route.ts
│   │   ├── buyer/dashboard/route.ts
│   │   ├── deals/
│   │   │   ├── route.ts
│   │   │   └── [id]/
│   │   │       ├── route.ts
│   │   │       └── messages/route.ts
│   │   ├── listings/route.ts
│   │   ├── seed/route.ts
│   │   └── seller/dashboard/route.ts
│   ├── buyer/dashboard/
│   ├── seller/
│   │   ├── dashboard/
│   │   └── listings/new/
│   ├── deal/[id]/
│   ├── listings/
│   │   └── [id]/
│   ├── login/
│   ├── signup/
│   ├── globals.css
│   ├── layout.js
│   └── page.js
├── components/
│   ├── features/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── deal/
│   │   ├── landing/
│   │   └── listings/
│   ├── shared/
│   └── ui/
├── lib/
│   ├── api/
│   │   ├── deals.js
│   │   └── listings.js
│   ├── constants/
│   ├── mock/
│   ├── config.js
│   ├── fees.js
│   ├── format.js
│   ├── supabase.ts
│   └── utils.js
├── types/
│   └── database.types.ts
├── .env.example
├── .env.local
├── LICENSE
├── package.json
├── tsconfig.json
└── README.md
```

---

## 11. Setup & Installation

### Prerequisites

- Node.js 18 or later
- A free PayPal Developer account with a Sandbox app (Client ID and Secret)
- A free Google AI Studio API key (Gemini)
- A free Supabase project

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/Brokerage-AI.git
cd Brokerage-AI

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
```

Fill in `.env.local`:

```env
PAYPAL_CLIENT_ID=
PAYPAL_SECRET=
PAYPAL_ENVIRONMENT=SANDBOX

GOOGLE_GENERATIVE_AI_API_KEY=

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

```bash
# 4. Apply the database migrations manually to a staging Supabase project.
#    Follow SUPABASE_SETUP.md; this repository has no db:migrate command.

# 5. Start the app
npm run dev
```

The app will be available at `http://localhost:3000`.

---

## 12. Running a Test Deal

1. Create two accounts — one as a seller, one as a buyer — using two separate browser sessions (or one normal, one incognito).
2. As the seller, create a listing.
3. As the buyer, open that listing and start a deal. Discuss terms manually; AI negotiation is not implemented.
4. As the seller, propose the final price and transaction terms.
5. Buyer and seller each explicitly accept the same terms version. A changed proposal clears prior acceptances.
6. The seller issues the internal invoice, then the buyer approves PayPal Checkout using a [PayPal Sandbox buyer test account](https://developer.paypal.com/dashboard/accounts).
7. As the seller, mark the deal as shipped.
8. As the buyer, confirm the item was received.
9. Wait for the return-window countdown to finish.
10. Confirm the deal status moves to complete on both dashboards, and that the payout appears in the seller's payout tracker.

---

## 13. Scope & Limitations

This section is included deliberately, because a hackathon judge evaluating "genuine effort and a working, non-trivial implementation" should know exactly what is real and what is simulated.

- **Marketplace browsing is intentionally minimal.** Listings are seeded demo data. There is no search, filtering, image upload, or category system. The project's focus is the negotiation and payment engine, not a general marketplace.
- **Application-managed hold.** Funds are collected by the platform account in Sandbox; this is not PayPal-native escrow or delayed disbursement and production operation has not been approved.
- **Return window.** The default is 24 hours after buyer-confirmed or admin-verified delivery. Seller tracking alone never starts the window; unconfirmed delivery is flagged for admin review after seven days.
- **AI negotiation.** Planned separately and not implemented in the transaction flow.
- **Disputes and refunds.** Admin-controlled application workflows; provider responses are verified before a refund is considered complete.

---

## 14. What Was Built During the Hackathon

This project was created new for the PayPal AI Hackathon submission period. [If based on prior work, state explicitly here what existed before the hackathon and what was added during the submission period, per the hackathon's "New & Existing" rule. Replace this bracketed note before submitting.]

---

## 15. Hackathon Category Alignment

This project explores **Agentic Commerce**. The current transaction flow is server-driven; AI negotiation and agent-scoped PayPal actions are not implemented.

Production eligibility, payment model availability, and applicable legal requirements remain to be confirmed before any Live processing.

---

## 16. License

This project is licensed under the [MIT License](LICENSE).
