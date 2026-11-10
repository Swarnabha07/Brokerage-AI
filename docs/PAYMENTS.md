# Payments, invoices, delivery and payouts

Status: implemented for **PayPal Sandbox only**. Live payments are deliberately impossible until PayPal eligibility and legal
requirements are confirmed (see "Live gating").

## What this is (and is not)
Buyer pays price + 3% through PayPal Checkout into the **platform's** PayPal account. Brokerage AI then holds the funds in an
**application-managed hold** and pays the seller the full agreed price after delivery is confirmed and the return window ends.
This is **not** PayPal escrow, **not** PayPal delayed disbursement, and **not** a regulated escrow service. It uses standard
Orders + Payouts. PayPal-native delayed disbursement needs approved partner status and seller onboarding and was not built.

## Lifecycle (enforced in Postgres functions across migrations 006-008)
| From -> To | Who | Rule |
|---|---|---|
| negotiating -> agreed | buyer and seller | Seller proposes versioned terms; each participant must accept the same version/hash through `POST /api/deals/[id]/terms`. Proposing changed terms resets both acceptances. |
| agreed -> invoiced | seller | `POST /api/deals/[id]/invoice`; SQL locks the listing, enforces accepted price <= listing, independently computes the exact 3% fee, checks totals, and freezes the accepted terms and payout destination. |
| invoiced -> paid | server only | `POST .../payments/capture`: order re-read and verified for platform payee identity, amount, currency, custom_id, and one COMPLETED capture before `fn_record_capture` |
| invoiced -> agreed | server only | invoice expired and no payment in progress |
| paid -> shipped | seller | tracking reference; requires a verified captured payment |
| shipped -> return_window | buyer (`confirm-receipt`) or admin | **seller tracking never starts the window.** Server stamps start/end from the database clock |
| return_window -> released | server only | `fn_evaluate_release`: window ended, delivery evidence, no open dispute, no review flag, verified payment, destination snapshot |
| shipped/return_window -> disputed | buyer | blocks release |
| disputed -> return_window or refund | admin | `resolve_dispute` |
| agreed/invoiced/negotiating -> cancelled | either party | allowed before capture is reserved; open checkout attempts are voided. A reserved capture blocks cancellation. |
| paid..disputed -> refunded | admin | PayPal refund; blocked once a payout started; pending remains pending until a verified refund GET or verified webhook reconciliation confirms COMPLETED |
`released` means "eligible and payout queued". The UI shows **Complete only after PayPal reports the payout ITEM as SUCCESS**.

## Fulfillment and PayPal shipping limitation
The parties choose a fulfillment type (physical goods, service, or other) and accept a snapshot with delivery/service expectations,
buyer conditions, additional conditions, item description, price, and return-window policy. Physical goods and services use the same
Checkout money flow; the order does not label either as `DIGITAL_GOODS`. Checkout uses `NO_SHIPPING`: PayPal does not collect or verify
a shipping address or delivery details. The parties coordinate fulfillment separately under their accepted terms. Tracking references
entered in Brokerage AI are records only; no carrier API verifies them. Services can record a deliverable and due date in the same terms field.
The immutable agreement also states that the buyer pays the 3% fee, the fee is rounded to the nearest cent half up, and the seller receives the agreed price before provider fees.

## Money safety rules
- Amounts are integer cents read from the database; the browser sends only the seller's final price (invoice step).
- One live invoice per deal; one active payment per invoice; one payout per deal (unique indexes).
- Idempotency: deterministic `PayPal-Request-Id` for order (`brk-pay-<uuid>`), capture (`brk-cap-<payment>`), payout
  (`brk-po-req-<deal>`), refund (`brk-refund-<payment>`); payout `sender_batch_id` = `brk-po-<deal>`.
- Payout claim is atomic (`fn_claim_payout`). Database coverage includes a 12-caller concurrency test; run it against a disposable local Postgres before relying on it.
- Ambiguous provider answers (timeouts, 5xx, accepted-without-id) are **never retried automatically**; the payout becomes
  `ambiguous` for an admin to check in PayPal and requeue. After an ambiguous result the same batch id is kept so PayPal rejects a duplicate.
- A capture whose facts do not match the invoice is never marked paid; the deal is flagged `needs_review`.
- If a provider capture completes after cancellation, the captured payment remains reviewable and an admin can begin a verified PayPal refund for that exceptional canceled deal. Normal canceled deals cannot be refunded through this recovery path.
- Capture, cancellation, and payment-order creation serialize on the deal row, then invoice and payment rows. If PayPal reports a completed capture after cancellation already won, the provider capture is stored and the cancelled deal is flagged for admin reconciliation; it is never silently discarded or changed back to paid.
- Before PayPal capture is requested, a short database reservation moves the payment to `capture_pending`; cancellation then waits on the same deal lock and refuses the cancellation. If cancellation wins before reservation, the service does not request capture. A late provider completion from an already in-flight request is still stored and flagged for review.
- Invoice expiry is checked before payment reuse and again immediately before requesting a new PayPal order. An existing known PayPal order can be resumed after invoice expiry; a local payment attempt without an order is voided and cannot initiate a new order.
- Missing or incomplete PayPal payee identity fails closed before capture and after capture; mismatched or unavailable identity cannot mark a payment paid.
- Payout success requires the exact sender batch ID, one payout item with an item ID, SUCCESS item and batch statuses, expected amount/currency, and recipient. Missing facts route to manual review.
- Seller payout email changes use a database RPC that locks the seller row before checking/updating the 24-hour cooldown. Existing per-deal snapshots remain write-once.
- Refund replies are checked against PayPal's refund resource ID, status, amount, and currency. An admin can request `reconcile_refund`; a pending refund is never marked refunded just because the POST was accepted.
- GET handlers and page rendering never write or call PayPal (guarded by a static test).
- State-changing cookie-authenticated routes require a same-origin `Origin` header (CSRF). Cron uses a bearer secret; webhooks use PayPal signature verification.

## Fees (provider fees are NOT assumed covered by the 3%)
PayPal's processing fee (read from the capture) and payout fee (read from the payout item) are stored. Buyers and sellers see
them transparently; the **platform's net** (`fee - processing fee - payout fee`) is returned only by the admin endpoint
`GET /api/admin/deals/[id]` and can be negative. On a $5 deal the 3% ($0.15) is unlikely to cover PayPal's charges.

## Setup order
1. Use a **separate staging Supabase project**. Confirm `supabase/security_hardening.sql` was applied (its verification queries are at the bottom).
2. Follow `SUPABASE_SETUP.md` and run migrations `001` through `008` in order. `001_enum_values.sql` must be run alone outside a transaction; run each later migration individually.
3. Regenerate or hand-edit `types/database.types.ts` if you want the new columns typed (the payment code uses an untyped admin client and does not need it).
4. Env vars: see `.env.example` ("Transaction system"). `PAYPAL_ENVIRONMENT` must be exactly `SANDBOX`.
5. First admin: `update public.users set is_admin = true where email = 'you@example.com';` (no API can grant admin).
6. Sellers add their payout PayPal email on the seller dashboard before issuing an invoice.
7. Optional webhook: create a Sandbox webhook to `https://<public-host>/api/webhooks/paypal` for `PAYMENT.CAPTURE.*`, `PAYMENT.PAYOUTS-ITEM.*`, `CUSTOMER.DISPUTE.CREATED`; set `PAYPAL_WEBHOOK_ID`.
8. Scheduled eligibility pass: `POST /api/internal/payouts/run` with `Authorization: Bearer $CRON_SECRET`. Vercel Cron only issues GET, so use another scheduler
   (GitHub Actions `schedule`, cron-job.org, or Supabase `pg_cron` + `pg_net`). Without a scheduler the member **Check release** button performs the same evaluation.
   PowerShell test: `Invoke-RestMethod -Method Post -Uri "$env:APP_BASE_URL/api/internal/payouts/run" -Headers @{Authorization="Bearer $env:CRON_SECRET"}`

## Return window and silence policy
`RETURN_WINDOW_HOURS` (default 24) starts when the buyer confirms receipt or an admin verifies delivery. If a shipment stays unconfirmed for
`REVIEW_UNCONFIRMED_AFTER_DAYS` (default 7) it is flagged for manual review; **funds are never auto-released on seller tracking alone**.
No carrier API is integrated, so automatic carrier-verified delivery is **not implemented**.

## Admin operations (`POST /api/admin/deals/[id]`, `users.is_admin` only)
`verify_delivery`, `resolve_dispute` (release|refund), `refund`, `requeue_payout`, `clear_review`. There is no admin UI yet; use the API (authenticated browser session) or SQL.

## Tests
- `npm test` unit tests (no network, no DB). `npm run test:db` needs a disposable Postgres + `psql`:
  load `tests/db/base_schema.sql`, then migrations 001-008, then `TEST_DATABASE_URL=postgres://... npm run test:db`. Never point it at Supabase.
- `npm run lint`, `npm run build` (needs network for Google Fonts and a reachable Supabase for static params).

## Not verified / not implemented (be honest in demos)
- No real PayPal Sandbox call was executed by the authors of this change; PayPal client and refund/payout verifiers are covered by offline mocks only. Run the end-to-end checklist below.
- Webhook delivery and signature verification need a public URL and `PAYPAL_WEBHOOK_ID`; untested against PayPal.
- Real PayPal fee values appear only after a Sandbox capture/payout reports them.
- Live eligibility, PayPal's permission to hold funds, India payout restrictions (PayPal lists India as receive-only for Payouts), and legal/regulatory treatment are unresolved.
- PayPal cannot verify that a seller owns their payout email; snapshot + 24h change cooldown reduce but do not remove the risk.
- Cross-process rate limiting is not provided (the existing in-memory limiter is per instance); duplicate money movement is prevented by the database, not by rate limits.
- Browser-level responsive testing was not run; layouts use wrapping/`break-words`/stacking utilities and need a manual pass at 360/768/1280 px.
- `POST /api/deals` (deal creation, pre-existing) has no same-origin check; it is non-financial.
- Native PayPal delayed disbursement and PayPal Agent Toolkit tools for payee/disbursement are not used.
- AI negotiation extraction is out of scope: the seller confirms the final price manually.

## Manual end-to-end checklist (Sandbox)
1 Seller sets payout email. 2 Buyer starts a deal, both reach `agreed`. 3 Seller issues invoice (final price). 4 Buyer pays via PayPal (Sandbox buyer), returns, sees "verified".
5 Seller ships. 6 Buyer confirms receipt (set `RETURN_WINDOW_HOURS=0.02` for ~1 min). 7 Press **Check release** or run the scheduler. 8 Confirm the payout item is SUCCESS in the
Sandbox dashboard and the UI shows Complete. 9 Repeat with a dispute (release blocked) and an admin refund.
