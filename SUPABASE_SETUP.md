# Supabase staging setup

Use a dedicated **staging** Supabase project. Do not run these instructions against production. Do not paste service-role or PayPal secrets into chat.

## 1. Check the existing security hardening

The repository has `supabase/security_hardening.sql` in addition to the numbered migrations. It enables RLS and establishes base grants/policies for the existing tables, installs the auth-user trigger, and adds `deals` and `messages` to Realtime. It is not run automatically by the application.

Before running it, read its preflight section and run its duplicate-payout and PostgreSQL-version checks. Confirm `handle_new_user()` has no custom behavior that the file would overwrite. Check the Supabase migration history and the post-run verification queries at the bottom of the file. If it is already applied, do not rerun it blindly. If its state cannot be established, stop and reconcile the schema/grants first. If it is confirmed absent, review and run it once before the payment migrations; it is written to run in a transaction.

## 2. Apply the payment migrations in order

Run each numbered file separately in Supabase Dashboard → SQL Editor. These are manual SQL operations; the app does not run migrations.

| Order | File | Notes |
|---|---|---|
| 1 | `supabase/migrations/001_enum_values.sql` | Run by itself, outside any explicit transaction. It adds enum values that later migrations use. |
| 2 | `supabase/migrations/002_deals_invoices.sql` | Lifecycle columns, admin flag, immutable internal invoice schema. |
| 3 | `supabase/migrations/003_payments.sql` | Server-only payment records and append-only protections. |
| 4 | `supabase/migrations/004_payouts.sql` | Seller payout profile, immutable deal destination snapshot, payout states and member-safe column grants. |
| 5 | `supabase/migrations/005_events_disputes.sql` | Audit events, webhook deduplication, disputes and supporting RLS/grants. |
| 6 | `supabase/migrations/006_functions.sql` | Atomic lifecycle/financial functions and service-role execution grants. |
| 7 | `supabase/migrations/007_transaction_integrity.sql` | Mutual terms acceptance, SQL fee/price checks, atomic payout-email cooldown, refund reconciliation functions. |
| 8 | `supabase/migrations/008_capture_expiry_terms_safety.sql` | Consistent deal→invoice→payment lock order, capture/cancel reconciliation, invoice expiry checks, complete immutable fulfillment terms. |

Only migration 001 must run outside a transaction. Run the other files individually so a failure is easy to identify; do not combine them into one large SQL-editor submission. Migrations 002–008 use guarded DDL/`create or replace` and are intended to be rerunnable, but a rerun is not a substitute for checking partial application.

If any migration fails, stop before proceeding. Record the error and inspect the objects it created; do not blindly rerun security hardening or drop tables/functions. These migrations add schema and replace functions, so rollback should normally be a reviewed forward-fix. Restore a staging snapshot if a failed/manual edit left an inconsistent schema. Enum values from migration 001 cannot be removed safely as a routine rollback.

## 3. Configure the first administrator

After migration 002 adds `users.is_admin`, set the intended account manually, using the account's verified email:

```sql
update public.users set is_admin = true where email = 'admin@example.test';
select id, email, role, is_admin from public.users where email = 'admin@example.test';
```

The second query must return exactly the intended account with `is_admin = true`. Never add an API or client-side path that grants admin.

## 4. Verify schema, RLS, and grants

Run these read-only checks after all migrations:

```sql
select to_regclass('public.payments') as payments,
       to_regclass('public.deal_agreements') as deal_agreements,
       to_regclass('public.provider_events') as provider_events,
       to_regclass('public.disputes') as disputes;

select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fn_issue_invoice','fn_propose_terms','fn_accept_terms','fn_begin_payment',
    'fn_set_payment_order','fn_assert_order_creation','fn_mark_capture_started','fn_record_capture','fn_cancel_deal',
    'fn_update_payout_profile','fn_record_refund_reconciliation','fn_evaluate_release','fn_claim_payout')
order by p.proname;

select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('payments','seller_payout_profiles','deal_payout_destinations','deal_events','provider_events','disputes','deal_agreements')
order by c.relname;

select has_function_privilege('anon','public.fn_accept_terms(uuid,uuid)','EXECUTE') as anon_can_accept,
       has_function_privilege('authenticated','public.fn_accept_terms(uuid,uuid)','EXECUTE') as user_can_accept,
       has_function_privilege('service_role','public.fn_accept_terms(uuid,uuid)','EXECUTE') as service_can_accept;

select column_name from information_schema.column_privileges
where table_schema='public' and table_name='payouts' and grantee='authenticated'
order by column_name;

select pubname, schemaname, tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' order by tablename;
```

Expected: the named tables/functions exist; each server-only table has RLS enabled; `anon_can_accept` and `user_can_accept` are false and `service_can_accept` true; authenticated payout columns are limited to the safe list in migration 004; the pre-existing Realtime publication includes `deals` and `messages`. `service_role` is intentionally privileged and must never be exposed to a browser.

## 5. Environment variables

Set these in local `.env.local` and the hosting provider's server environment. Use Sandbox credentials only. Never prefix secrets with `NEXT_PUBLIC_`.

| Variable | Required | Purpose / safe example |
|---|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL, e.g. `https://project-ref.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser Supabase anon/publishable key. |
| `SUPABASE_URL` | Yes | Server Supabase URL; usually the same project URL. |
| `SUPABASE_ANON_KEY` | Yes | Server auth client key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only privileged key. |
| `PAYPAL_ENVIRONMENT` | Yes | Must be exactly `SANDBOX`; other values disable payments. |
| `PAYPAL_CLIENT_ID` | Yes | PayPal Sandbox REST app client ID. |
| `PAYPAL_SECRET` | Yes | PayPal Sandbox REST app secret; server-only. |
| `PAYPAL_PLATFORM_MERCHANT_ID` | One of these | Sandbox platform merchant/payer ID expected on the order payee. |
| `PAYPAL_PLATFORM_BUSINESS_EMAIL` | One of these | Sandbox platform email expected on the order payee. Configure at least one identity value. |
| `APP_BASE_URL` | Yes | Public app origin, e.g. `http://localhost:3000` locally or an HTTPS staging URL. |
| `PAYPAL_WEBHOOK_ID` | Optional | ID of the Sandbox webhook registered for this app; enables signature verification. |
| `CRON_SECRET` | For scheduler | Long random bearer secret for `POST /api/internal/payouts/run`. |
| `RETURN_WINDOW_HOURS` | Optional | Defaults to `24`; allowed range is 0.001–1440 hours. |
| `REVIEW_UNCONFIRMED_AFTER_DAYS` | Optional | Defaults to `7`; flags unconfirmed delivery for admin review. |
| `INVOICE_EXPIRY_HOURS` | Optional | Defaults to `48`; allowed range is 1–720 hours. |
| `MIN_DEAL_CENTS` | Optional | Defaults to `100` (USD $1.00). |

`GOOGLE_GENERATIVE_AI_API_KEY` is present for the separate AI roadmap, but this transaction flow does not use Gemini or Agent Toolkit tools. The `PAYPAL_SMOKE_*` variables in `.env.example` belong to standalone smoke scripts, not the application transaction flow.

## 6. PayPal Sandbox Dashboard

1. Create/choose a Sandbox REST app and set its Sandbox client ID and secret in server environment variables.
2. Use Sandbox buyer, platform-business, and seller accounts. Configure the expected platform merchant identity/email to match the payee on Sandbox Checkout orders.
3. If using webhooks, register `https://<staging-host>/api/webhooks/paypal`, copy the webhook ID to `PAYPAL_WEBHOOK_ID`, and subscribe to capture events (`PAYMENT.CAPTURE.*`), payout item/batch events (`PAYMENT.PAYOUTS-ITEM.*`, `PAYMENT.PAYOUTSBATCH.*`), and `CUSTOMER.DISPUTE.CREATED`.
4. Webhooks must be delivered to a public HTTPS endpoint; the handler verifies PayPal signatures, deduplicates event IDs, and re-fetches/reconciles provider state. Do not use the simulator as proof of a completed transaction.
5. A scheduler must send authenticated POST requests to `/api/internal/payouts/run`. Vercel Cron's GET-only trigger does not match this route; use a scheduler capable of POST with `Authorization: Bearer <CRON_SECRET>`. The member-facing Check release action uses the same database eligibility function.

## 7. Safe verification checklist

- Confirm the application refuses payment when `PAYPAL_ENVIRONMENT` is not `SANDBOX`.
- Start with a non-UUID demo deal and confirm its local demonstration behavior remains available.
- On a real UUID deal, confirm a seller proposal is not agreed until both the buyer and seller accept the same version.
- Change the proposal after one or both accept and confirm both acceptance indicators reset.
- Confirm invoice creation is rejected for invalid/above-listing price, wrong fee, or unilateral acceptance.
- Verify browser users cannot read payment internals or execute financial RPCs.
- Use PayPal Sandbox only for manual provider testing; do not use a Supabase staging/production database as the automated `npm run test:db` target.
