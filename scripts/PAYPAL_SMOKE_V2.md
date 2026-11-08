# PayPal Sandbox smoke test v2 (Gate 1, no PayPal Invoicing)

Sandbox only. Script: `scripts/paypal-sandbox-smoke-v2.mjs`. State: `.paypal-smoke-state.v2.json` (IDs and progress only).
The v1 script and `.paypal-smoke-state.json` are never read, changed or deleted by v2. There is no `--fresh`; `--new-run` archives, never deletes.

## Why two modes
| | `--mode=delayed` (preferred) | `--mode=fallback` |
|---|---|---|
| PayPal feature | Commerce Platform / Complete Payments: Orders with `payee`, `disbursement_mode: DELAYED`, `platform_fees`, then Referenced Payouts | Plain Orders capture into the platform account, then standard Payouts |
| Official requirement | Approved partner status, seller onboarded with `DELAY_FUNDS_DISBURSEMENT` and `PARTNER_FEE`, `PayPal-Auth-Assertion`, partner attribution ID (BN code) | Payouts must be enabled for the app/account; India is listed as receive-only for Payouts |
| Meaning of a pass | PayPal-native hold-then-release works in Sandbox for this setup | Only that Orders + Payouts work in Sandbox. NOT marketplace delayed disbursement |

Per PayPal's docs, partner APIs can be tested in Sandbox with Platform REST app credentials before approval; unapproved calls to partner APIs return 401. Sandbox success is not Live eligibility.

## Delayed-mode prerequisites (you must do these in the PayPal dashboard; the script cannot)
1. A Sandbox **Platform** REST app under your Sandbox API-caller (platform) business account; put its client ID and secret in `.env.local`.
2. A Sandbox **seller business** account onboarded to that platform through Partner Referrals with features `DELAY_FUNDS_DISBURSEMENT` and `PARTNER_FEE`. Note its merchant (payer) ID.
3. Add to `.env.local` (names only here): `PAYPAL_SMOKE_SELLER_MERCHANT_ID`, optionally `PAYPAL_SMOKE_BUYER_PAYER_ID`, `PAYPAL_PARTNER_MERCHANT_ID`, `PAYPAL_PARTNER_ATTRIBUTION_ID`.
Your existing REST app and seller account are probably NOT set up this way. Step C will tell you if not (nothing moves before that).

## Steps
A OAuth. B optional read-only seller status. C create order (no money moves) and buyer approval. D identity check, capture, verify. E simulated return window. F release/disbursement and verify the item state.
Capture (D) and release (F) each require typing `yes`; `--yes` does not bypass them.

## Safety rules implemented
- Identity: payee and payer are compared by email AND by PayPal ID where available. Results are MATCH / MISMATCH / UNAVAILABLE. UNAVAILABLE is reported as not verified. A MISMATCH before capture stops without capture; it is sticky in the state file and blocks later steps.
- Idempotency: deterministic `PayPal-Request-Id` per run for order, capture and release; intent is saved before every money-moving call.
- Ambiguous responses: capture is verified by re-reading the order. An ambiguous release/payout is never retried automatically; check Sandbox activity, then use `--confirm-retry-release` once.
- Success means: capture COMPLETED with exact amount and a single capture; for delayed mode `disbursement_mode` DELAYED where PayPal returns it (INSTANT fails the run); release item `processing_state.status` SUCCESS (documented values: PROCESSING, SUCCESS, FAILED, PAYOUT_FAILED); for fallback the payout ITEM `transaction_status` SUCCESS.
- Nothing prints or stores tokens, secrets, emails or raw merchant/payer IDs. Error text is scrubbed.

## Known fee-model conflict to expect
PayPal deducts its processing fee from the seller's funds on partner orders, so the seller's PayPal-reported net will be below 5.00. The script prints PayPal's reported net so you can see the gap.

## Commands (PowerShell, from the repo root)
```powershell
node --env-file=.env.local scripts/paypal-sandbox-smoke-v2.mjs --status
node --env-file=.env.local scripts/paypal-sandbox-smoke-v2.mjs --diagnose
node --env-file=.env.local scripts/paypal-sandbox-smoke-v2.mjs --mode=delayed
node --env-file=.env.local scripts/paypal-sandbox-smoke-v2.mjs --new-run --mode=fallback
node scripts/paypal-smoke-v2.test.mjs
```

## State file (version 2)
`version, environment, mode, runId, createdAt, fingerprint, amounts, diagnosis{delayedCapability, sellerStatus}, order{id, customId, requestId, captureRequestId, status, createAttempted, captureAttempted, verified}, capture{id, status, hold, paypalFee, sellerNet, platformFeeSeen}, window{seconds, startedAt}, release{requestId, itemId|batchId, state, final, attempted}, identity{payee{status,basis}, payer{status,basis}, payerPin}, results, completedAt`.
