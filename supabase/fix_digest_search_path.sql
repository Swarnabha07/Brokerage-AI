-- pgcrypto installs digest() into the `extensions` schema. public.fn_issue_invoice
-- calls digest() without schema-qualifying it, and its search_path didn't include
-- `extensions`, so Postgres raised:
--   function digest(bytea, unknown) does not exist
-- even though the pgcrypto extension is enabled.
--
-- Run this once in the Supabase SQL Editor (production project) to fix it:

ALTER FUNCTION public.fn_propose_terms(
  p_deal_id uuid,
  p_seller_id uuid,
  p_price_cents integer,
  p_return_window_hours numeric,
  p_fulfillment_type text,
  p_delivery_expectations text,
  p_transaction_conditions text
) SET search_path = public, extensions;
