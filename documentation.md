# Brokerage AI

AI-negotiated, PayPal-settled escrow for peer-to-peer transactions.

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

Brokerage AI is a prototype marketplace where two parties — a buyer and a seller — can negotiate and settle a transaction without needing to trust each other directly. Each party can optionally delegate the negotiation to an AI agent acting on their behalf. Once terms are agreed, the platform handles invoicing, payment, and a delayed, conditional payout through PayPal's Sandbox APIs, so funds are only released to the seller after delivery is confirmed and a return window has passed.

This is a hackathon prototype, not a production financial product. It runs entirely against PayPal's Sandbox environment, using test accounts and simulated money. No real transactions occur anywhere in this project.

---

## 2. Problem Statement

Peer-to-peer transactions between people who don't know each other — a local marketplace sale, a freelance gig, an informal service agreement — typically rely on one of two flawed options: full upfront trust (pay first, hope the other side delivers) or slow, manual negotiation with no structural protection if something goes wrong.

Formal escrow services exist, but they are built for high-value transactions (real estate, business sales) and are too heavy, slow, and expensive for everyday deals. There is no lightweight, automated way for two strangers to negotiate fair terms and have those terms actually enforced by where the money sits.

Brokerage AI is a prototype exploring whether an AI agent, combined with PayPal's existing payment infrastructure, can fill that gap: negotiate on a person's behalf, draft clear terms, and hold the platform accountable to a release condition instead of relying on goodwill alone.

---

## 3. How It Works

1. A seller lists an item or service.
2. A buyer starts a deal on that listing.
3. The buyer chooses one of two negotiation modes:
   - **Self Chat** — the buyer negotiates directly with the seller's AI agent.
   - **AI Negotiate** — the buyer's AI agent and the seller's AI agent negotiate with each other, within a capped number of exchanges.
4. Once both sides reach agreement on price and terms, the AI produces a structured summary of what was agreed.
5. The seller reviews and approves the terms.
6. The platform creates a PayPal invoice reflecting the agreed price and a platform fee.
7. The buyer reviews the invoice on the platform (not redirected to PayPal) and pays through an embedded PayPal checkout.
8. Payment is captured into the platform's PayPal Sandbox business account. The funds are not yet released to the seller.
9. The seller marks the item as shipped and provides tracking information.
10. The buyer confirms the item was received.
11. A return window begins. For demo purposes this window is a short, visible countdown rather than a multi-day period — this is explicitly a simulation of a real return policy, not a claim that real-world return windows are this short.
12. When the window closes without a dispute, the platform triggers a PayPal payout to the seller for the agreed amount minus the platform fee.
13. Both the buyer and seller dashboards reflect the deal as complete.

---

## 4. Features

| Feature | Description |
|---|---|
| Role-based accounts | Users sign up as either a buyer or a seller and are routed to a dashboard built for that role. |
| Seeded listings | A small set of demo listings exist so the negotiation and transaction flow can be demonstrated without building a full marketplace/search experience. |
| AI negotiation (agent-to-agent) | Two independently prompted AI agents, one representing the buyer's stated budget and conditions and one representing the seller's price floor and conditions, exchange offers up to a fixed number of rounds. |
| Self-chat alternative | A buyer who does not want to delegate negotiation can chat directly with the seller's AI agent instead. |
| Structured terms extraction | Once agreement is reached, the negotiation transcript is parsed into a structured terms summary (price, item, delivery terms, conditions) rather than left as unstructured chat text. |
| Real PayPal invoicing | A genuine invoice is created and sent through PayPal's Sandbox Invoicing API, not a custom-built invoice document. |
| On-site checkout | Payment is captured through PayPal's Orders API embedded directly in the platform's own UI, rather than redirecting the buyer to a PayPal-hosted page. |
| Held funds, conditional release | Captured funds are not forwarded to the seller immediately. Release is deferred until delivery is confirmed and a return window passes. |
| Automated payout with fee deduction | The platform calculates and deducts a fee before calling PayPal's Payouts API, so the seller receives the net amount automatically. |
| Scoped agent permissions | The buyer's AI agent and the seller's AI agent are each given access to a different, limited subset of PayPal's Agent Toolkit tools, matching what that role should be able to do. |

---

## 5. Architecture
### 5.1 System Layers

<img width="900" height="550" alt="Neon AI Marketplace Architecture Flow" src="https://github.com/user-attachments/assets/81736510-b2ec-4540-8640-39a16c256017" />

### 5.2 Layer Responsibilities

**Frontend (Next.js, App Router)**
Renders the buyer and seller dashboards, the deal detail/negotiation page, the invoice and checkout UI, and the status tracker. Never calls PayPal or the AI model directly — every external call goes through the backend.

**Backend (Next.js API routes)**
Owns the deal state machine (`negotiating → agreed → invoiced → paid → shipped → return_window → released`). Orchestrates calls to the AI layer and the PayPal layer, and is the only part of the system holding API credentials.

**AI layer (Google Gemini via the Vercel AI SDK)**
Runs the buyer and seller negotiation agents, the terms-extraction step, and (where implemented) the listing/buyer-matching step. Each agent is a distinct system prompt and a distinct, scoped tool set — not two separate models.

**PayPal layer (PayPal Agent Toolkit, Sandbox)**
Executes the actual PayPal actions: creating and sending invoices, creating and capturing orders, and issuing payouts. These calls are made through tools bound directly to the AI agents, not through hand-written REST calls made after the fact.

**Database (Supabase / Postgres)**
Stores users, listings, deals, messages, invoice records, and payout records. This is the single source of truth that both dashboards read from.

---

## 6. PayPal Integration

This project uses PayPal's Sandbox environment and the following APIs, accessed through the PayPal Agent Toolkit:

| API | Used For |
|---|---|
| Orders API | Creating and capturing the buyer's payment through the platform's own checkout UI. |
| Invoicing API | Creating and sending a formal invoice once terms are agreed, and recording it as paid after checkout. |
| Payouts API | Releasing held funds to the seller, net of the platform fee, once the return window closes. |

PayPal does not provide a dedicated escrow primitive. The "hold funds, then release" behavior in this project is implemented by the platform itself: capturing payment into the platform's own Sandbox business account first, and only calling the Payouts API once the return-window condition is met. This is stated plainly rather than implied, since it is a meaningful distinction from a true third-party escrow service.

The platform fee is calculated in application code (a fixed percentage of the agreed price) and subtracted before the payout call. There is no special PayPal fee-splitting feature in use here.

---

## 7. AI Agent Design

Two agents are used, both running on Gemini via the Vercel AI SDK:

**Buyer Agent**
- System prompt represents the buyer's stated budget and conditions.
- Tool access limited to: `orders.create`, `orders.get`, `orders.capture`.
- Cannot create invoices or trigger payouts.

**Seller Agent**
- System prompt represents the seller's price floor and conditions.
- Tool access limited to: `invoices.create`, `invoices.send`, `payouts.create`.
- Cannot capture a buyer's payment directly.

This split is deliberate, not incidental. Each agent can only take the actions that make sense for the party it represents. A judge inspecting the code should be able to see the tool scoping directly in the agent configuration, rather than taking a description of it on faith.

**Negotiation loop:** when "AI Negotiate" mode is selected, the two agents exchange offers for a fixed maximum number of rounds (configurable, set to 5 by default). If no agreement is reached by the final round, each agent is prompted to produce a final offer, and the deal is marked as unresolved rather than left open-ended. This cap exists both to keep the demo predictable and to avoid unbounded API usage against Gemini's free tier.

---

## 8. Database Schema

| Table | Key Fields |
|---|---|
| `users` | `id`, `email`, `role` (`buyer` \| `seller`) |
| `listings` | `id`, `seller_id`, `title`, `description`, `price` |
| `deals` | `id`, `listing_id`, `buyer_id`, `seller_id`, `status`, `agreed_price`, `platform_fee`, `negotiation_mode` |
| `messages` | `id`, `deal_id`, `sender` (`buyer` \| `seller` \| `buyer_agent` \| `seller_agent`), `text`, `is_ai_generated` |
| `invoices` | `id`, `deal_id`, `paypal_invoice_id`, `status` |
| `payouts` | `id`, `deal_id`, `amount`, `platform_fee`, `status`, `released_at` |

`deals.status` moves through: `negotiating → agreed → invoiced → paid → shipped → return_window → released` (or `disputed`, where implemented).

---

## 9. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js (App Router), React, Tailwind CSS | Fast to build, deploys cleanly to Vercel for a hosted demo. |
| Backend | Next.js API routes | Keeps frontend and backend in one deployable project for a hackathon timeline. |
| Auth & Database | Supabase | Managed auth and Postgres without building custom auth from scratch. |
| AI model | Google Gemini (`gemini-1.5-flash` / `gemini-2.0-flash`) | Supports tool/function calling, usable on a free tier. |
| AI orchestration | Vercel AI SDK | Model-agnostic tool-calling layer; integrates with PayPal's Agent Toolkit. |
| Payments | PayPal Sandbox, via `@paypal/agent-toolkit` | The hackathon's required integration; toolkit exposes PayPal's REST APIs as agent-callable tools. |
| Deployment | Vercel or Render | Free-tier hosting suitable for a judge-accessible demo URL. |

---

## 10. Project Structure

```
brokerage-ai/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── signup/
│   ├── buyer/dashboard/
│   ├── seller/dashboard/
│   ├── deal/[id]/
│   └── api/
│       ├── negotiate/
│       ├── invoice/
│       ├── checkout/
│       └── payout/
├── lib/
│   ├── agents/
│   │   ├── buyer-agent.ts
│   │   └── seller-agent.ts
│   ├── paypal/
│   └── supabase/
├── assets/
│   ├── architecture-overview.png
│   └── system-layers.png
├── supabase/
│   └── schema.sql
├── .env.example
├── LICENSE
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
# 4. Apply the database schema
#    Run supabase/schema.sql in the Supabase SQL editor, or:
npm run db:migrate

# 5. Start the app
npm run dev
```

The app will be available at `http://localhost:3000`.

---

## 12. Running a Test Deal

1. Create two accounts — one as a seller, one as a buyer — using two separate browser sessions (or one normal, one incognito).
2. As the seller, create a listing.
3. As the buyer, open that listing and start a deal. Choose either **Self Chat** or **AI Negotiate**.
4. Let the negotiation reach agreement, or negotiate manually if using self-chat mode.
5. As the seller, approve the agreed terms. This triggers invoice creation.
6. As the buyer, review the invoice, agree to the terms, and complete payment using a [PayPal Sandbox buyer test account](https://developer.paypal.com/dashboard/accounts).
7. As the seller, mark the deal as shipped.
8. As the buyer, confirm the item was received.
9. Wait for the return-window countdown to finish.
10. Confirm the deal status moves to complete on both dashboards, and that the payout appears in the seller's payout tracker.

---

## 13. Scope & Limitations

This section is included deliberately, because a hackathon judge evaluating "genuine effort and a working, non-trivial implementation" should know exactly what is real and what is simulated.

- **Marketplace browsing is intentionally minimal.** Listings are seeded demo data. There is no search, filtering, image upload, or category system. The project's focus is the negotiation and payment engine, not a general marketplace.
- **Escrow is simulated by the platform, not provided by PayPal.** PayPal has no native "hold funds" feature used here; the hold-then-release behavior is application logic sitting on top of PayPal's Orders and Payouts APIs.
- **The return window is shortened for demonstration purposes.** It is a fixed, short countdown rather than a realistic multi-day window, and is labeled as such in the UI.
- **AI negotiation is bounded, not open-ended.** The negotiation loop is capped at a fixed number of rounds to keep behavior predictable within a demo and within free-tier API limits, not because unbounded negotiation is technically infeasible.
- **Dispute resolution, if present, is a best-effort mediation suggestion**, not a binding resolution system — final release decisions in this prototype are automated based on the return-window condition only.

---

## 14. What Was Built During the Hackathon

This project was created new for the PayPal AI Hackathon submission period. [If based on prior work, state explicitly here what existed before the hackathon and what was added during the submission period, per the hackathon's "New & Existing" rule. Replace this bracketed note before submitting.]

---

## 15. Hackathon Category Alignment

This project is submitted primarily under **Agentic Commerce**: the core mechanic is two AI agents, each scoped to a distinct set of real PayPal actions, negotiating and executing a transaction on behalf of their respective users — not simply recommending one.

It also touches the **AI Agents or Automation** inspiration category directly, matching the hackathon's own example of "two agents negotiating and settling a payment between themselves."

---

## 16. License

This project is licensed under the [MIT License](LICENSE).
