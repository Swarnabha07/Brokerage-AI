-- 006: atomic financial/lifecycle functions. All SECURITY DEFINER, executable ONLY by service_role
-- (the app's server). Each one re-checks identity, state and ownership itself, so a bug in an API
-- route cannot skip a rule. Errors are raised as 'brk_<code>' for the app to map. Safe to re-run.

create or replace function public._deal_event(p_deal uuid, p_actor uuid, p_role text, p_type text, p_from text, p_to text, p_data jsonb default '{}'::jsonb)
returns void language sql as $$
  insert into public.deal_events (deal_id, actor_id, actor_role, type, from_status, to_status, data)
  values (p_deal, p_actor, p_role, p_type, p_from, p_to, coalesce(p_data, '{}'::jsonb));
$$;

create or replace function public._is_admin(p_user uuid) returns boolean language sql stable as $$
  select coalesce((select is_admin from public.users where id = p_user), false);
$$;

-- Seller approves terms with a final price: creates the frozen invoice + payout destination snapshot.
create or replace function public.fn_issue_invoice(p_deal_id uuid, p_seller_id uuid, p_price_cents integer, p_fee_cents integer, p_expiry_hours integer, p_invoice_data jsonb)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare d public.deals; prof public.seller_payout_profiles; inv public.invoices;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.seller_id is distinct from p_seller_id then raise exception 'brk_forbidden'; end if;
  if d.status <> 'agreed' then raise exception 'brk_invalid_state:%', d.status; end if;
  if p_price_cents is null or p_price_cents <= 0 or p_fee_cents is null or p_fee_cents < 0 then raise exception 'brk_invalid_amount'; end if;
  select * into prof from public.seller_payout_profiles where user_id = p_seller_id;
  if not found then raise exception 'brk_no_payout_profile'; end if;
  -- Re-issue after an expired invoice is the only case with an existing snapshot; no payment can exist yet.
  perform set_config('brk.allow_destination_rewrite', 'on', true);
  insert into public.deal_payout_destinations (deal_id, seller_id, destination, destination_hash)
  values (d.id, p_seller_id, lower(prof.paypal_email), encode(digest(lower(prof.paypal_email), 'sha256'), 'hex'))
  on conflict (deal_id) do update set seller_id = excluded.seller_id, destination = excluded.destination,
    destination_hash = excluded.destination_hash, created_at = now();
  perform set_config('brk.allow_destination_rewrite', 'off', true);
  insert into public.invoices (deal_id, invoice_number, status, currency, price_cents, fee_cents, total_cents, expires_at, invoice_data)
  values (d.id, 'BRK-INV-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'), 'open', 'USD',
          p_price_cents, p_fee_cents, p_price_cents + p_fee_cents, now() + make_interval(hours => p_expiry_hours), coalesce(p_invoice_data, '{}'::jsonb))
  returning * into inv;
  update public.deals set status = 'invoiced', agreed_price = p_price_cents / 100.0, platform_fee = p_fee_cents / 100.0 where id = d.id;
  perform public._deal_event(d.id, p_seller_id, 'seller', 'invoice_issued', 'agreed', 'invoiced',
    jsonb_build_object('invoice_number', inv.invoice_number, 'price_cents', p_price_cents, 'fee_cents', p_fee_cents));
  return inv;
end $$;

-- Voids unpaid payment attempts that PayPal itself would have expired (orders live ~3 hours).
create or replace function public._void_abandoned_payments(p_deal_id uuid) returns void language sql as $$
  update public.payments set status = 'voided', failed_reason = 'abandoned'
  where deal_id = p_deal_id and status in ('created','order_created','approved') and updated_at < now() - interval '3 hours';
$$;

-- Buyer starts (or resumes) checkout. Idempotent: returns the existing active payment if there is one.
create or replace function public.fn_begin_payment(p_deal_id uuid, p_buyer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; inv public.invoices; pay public.payments;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.buyer_id is distinct from p_buyer_id then raise exception 'brk_forbidden'; end if;
  if d.status <> 'invoiced' then raise exception 'brk_invalid_state:%', d.status; end if;
  perform public._void_abandoned_payments(d.id);
  select * into inv from public.invoices where deal_id = d.id and status = 'open' order by created_at desc limit 1;
  if not found then raise exception 'brk_no_open_invoice'; end if;
  select * into pay from public.payments where invoice_id = inv.id and status in ('created','order_created','approved','capture_pending');
  if found then
    return jsonb_build_object('ok', true, 'reused', true, 'payment', to_jsonb(pay), 'invoice', to_jsonb(inv));
  end if;
  if inv.expires_at < now() then
    update public.invoices set status = 'expired' where id = inv.id;
    update public.deals set status = 'agreed' where id = d.id;
    perform public._deal_event(d.id, null, 'system', 'invoice_expired', 'invoiced', 'agreed', jsonb_build_object('invoice_number', inv.invoice_number));
    return jsonb_build_object('ok', false, 'reason', 'invoice_expired');
  end if;
  insert into public.payments (deal_id, invoice_id, status, amount_cents, currency, request_id)
  values (d.id, inv.id, 'created', inv.total_cents, inv.currency, 'brk-pay-' || gen_random_uuid())
  returning * into pay;
  perform public._deal_event(d.id, p_buyer_id, 'buyer', 'checkout_started', 'invoiced', 'invoiced', jsonb_build_object('payment_id', pay.id));
  return jsonb_build_object('ok', true, 'reused', false, 'payment', to_jsonb(pay), 'invoice', to_jsonb(inv));
end $$;

create or replace function public.fn_set_payment_order(p_payment_id uuid, p_order_id text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  update public.payments set provider_order_id = p_order_id, status = 'order_created'
  where id = p_payment_id and status in ('created','order_created') and (provider_order_id is null or provider_order_id = p_order_id)
  returning * into pay;
  if not found then raise exception 'brk_invalid_state:payment'; end if;
  return pay;
end $$;

-- The ONLY place a deal becomes 'paid'. Called after the server verified the capture with PayPal.
create or replace function public.fn_record_capture(p_payment_id uuid, p_order_id text, p_capture_id text, p_amount_cents integer, p_currency text,
  p_provider_status text, p_payer_hash text, p_paypal_fee_cents integer, p_net_cents integer, p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay public.payments; d public.deals; inv public.invoices;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  select * into d from public.deals where id = pay.deal_id for update;
  select * into inv from public.invoices where id = pay.invoice_id for update;
  if pay.provider_order_id is distinct from p_order_id then raise exception 'brk_order_mismatch'; end if;
  if pay.amount_cents <> p_amount_cents or pay.currency <> p_currency then raise exception 'brk_amount_mismatch'; end if;
  if pay.payer_ref_hash is not null and p_payer_hash is not null and pay.payer_ref_hash <> p_payer_hash then raise exception 'brk_payer_mismatch'; end if;
  if pay.status in ('captured','refund_pending','refunded') then
    if pay.provider_capture_id = p_capture_id then
      return jsonb_build_object('ok', true, 'idempotent', true, 'status', pay.status);
    end if;
    raise exception 'brk_capture_conflict';
  end if;
  if pay.status in ('failed','voided') then raise exception 'brk_invalid_state:payment'; end if;
  if p_provider_status = 'PENDING' then
    update public.payments set status = 'capture_pending', provider_capture_id = p_capture_id, provider_status = p_provider_status,
      payer_ref_hash = coalesce(payer_ref_hash, p_payer_hash) where id = pay.id;
    perform public._deal_event(d.id, null, 'system', 'capture_pending', d.status::text, d.status::text, jsonb_build_object('payment_id', pay.id));
    return jsonb_build_object('ok', true, 'status', 'capture_pending');
  end if;
  if p_provider_status <> 'COMPLETED' then raise exception 'brk_not_completed:%', p_provider_status; end if;
  update public.payments set status = 'captured', provider_capture_id = p_capture_id, provider_status = p_provider_status,
    payer_ref_hash = coalesce(payer_ref_hash, p_payer_hash), paypal_fee_cents = p_paypal_fee_cents, net_cents = p_net_cents,
    provider_summary = p_summary, captured_at = now() where id = pay.id;
  if d.status = 'invoiced' and inv.status = 'open' then
    update public.invoices set status = 'paid', paid_at = now() where id = inv.id;
    update public.deals set status = 'paid' where id = d.id;
    perform public._deal_event(d.id, null, 'system', 'payment_captured', 'invoiced', 'paid',
      jsonb_build_object('payment_id', pay.id, 'amount_cents', p_amount_cents, 'paypal_fee_cents', p_paypal_fee_cents));
  else
    -- Money was captured but the deal moved on (cancelled/expired). Never silently lose it: flag for an admin.
    update public.deals set needs_review = true, review_reason = 'payment_captured_unexpected_state' where id = d.id;
    perform public._deal_event(d.id, null, 'system', 'payment_captured_needs_review', d.status::text, d.status::text, jsonb_build_object('payment_id', pay.id));
  end if;
  return jsonb_build_object('ok', true, 'status', 'captured');
end $$;

create or replace function public.fn_fail_payment(p_payment_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.payments set status = 'failed', failed_reason = left(p_reason, 200)
  where id = p_payment_id and status in ('created','order_created','approved','capture_pending');
end $$;

create or replace function public.fn_mark_shipped(p_deal_id uuid, p_seller_id uuid, p_tracking text)
returns public.deals language plpgsql security definer set search_path = public as $$
declare d public.deals;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.seller_id is distinct from p_seller_id then raise exception 'brk_forbidden'; end if;
  if d.status <> 'paid' then raise exception 'brk_invalid_state:%', d.status; end if;
  if not exists (select 1 from public.payments where deal_id = d.id and status = 'captured') then raise exception 'brk_no_verified_payment'; end if;
  update public.deals set status = 'shipped', tracking_number = p_tracking, shipped_at = now() where id = d.id returning * into d;
  perform public._deal_event(d.id, p_seller_id, 'seller', 'shipped', 'paid', 'shipped', jsonb_build_object('has_tracking', true));
  return d;
end $$;

-- Delivery evidence = buyer confirmation or admin verification. Seller tracking alone never starts the window.
create or replace function public.fn_confirm_delivery(p_deal_id uuid, p_actor_id uuid, p_actor text, p_note text, p_window_hours numeric)
returns public.deals language plpgsql security definer set search_path = public as $$
declare d public.deals;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if p_actor = 'buyer' then
    if d.buyer_id is distinct from p_actor_id then raise exception 'brk_forbidden'; end if;
  elsif p_actor = 'admin' then
    if not public._is_admin(p_actor_id) then raise exception 'brk_forbidden'; end if;
  else raise exception 'brk_forbidden'; end if;
  if d.status <> 'shipped' then raise exception 'brk_invalid_state:%', d.status; end if;
  if p_window_hours is null or p_window_hours <= 0 then raise exception 'brk_invalid_amount'; end if;
  update public.deals set status = 'return_window', delivery_confirmed_at = now(), delivery_confirmed_by = p_actor,
    delivery_note = left(p_note, 500), return_window_started_at = now(),
    return_window_ends_at = now() + (p_window_hours * interval '1 hour')
  where id = d.id returning * into d;
  perform public._deal_event(d.id, p_actor_id, p_actor, 'delivery_confirmed', 'shipped', 'return_window',
    jsonb_build_object('by', p_actor, 'window_hours', p_window_hours));
  return d;
end $$;

create or replace function public.fn_open_dispute(p_deal_id uuid, p_buyer_id uuid, p_reason text, p_details text)
returns public.disputes language plpgsql security definer set search_path = public as $$
declare d public.deals; disp public.disputes;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.buyer_id is distinct from p_buyer_id then raise exception 'brk_forbidden'; end if;
  select * into disp from public.disputes where deal_id = d.id and status = 'open';
  if found then return disp; end if;
  if d.status not in ('shipped','return_window') then raise exception 'brk_invalid_state:%', d.status; end if;
  insert into public.disputes (deal_id, opened_by, reason, details, prior_status)
  values (d.id, p_buyer_id, p_reason, left(p_details, 2000), d.status::text) returning * into disp;
  update public.deals set status = 'disputed' where id = d.id;
  perform public._deal_event(d.id, p_buyer_id, 'buyer', 'dispute_opened', d.status::text, 'disputed', jsonb_build_object('reason', p_reason));
  return disp;
end $$;

-- The single set of release rules. Used by the scheduled job AND the member "Check release" action.
create or replace function public.fn_evaluate_release(p_deal_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; inv public.invoices;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found then return jsonb_build_object('released', false, 'reason', 'not_found'); end if;
  if d.status = 'released' then return jsonb_build_object('released', true, 'already', true); end if;
  if d.status <> 'return_window' then return jsonb_build_object('released', false, 'reason', 'not_in_return_window'); end if;
  if d.needs_review then return jsonb_build_object('released', false, 'reason', 'manual_review'); end if;
  if d.delivery_confirmed_at is null or d.return_window_ends_at is null then return jsonb_build_object('released', false, 'reason', 'no_delivery_confirmation'); end if;
  if exists (select 1 from public.disputes where deal_id = d.id and status = 'open') then return jsonb_build_object('released', false, 'reason', 'dispute_open'); end if;
  if now() < d.return_window_ends_at then
    return jsonb_build_object('released', false, 'reason', 'window_open', 'seconds_left', ceil(extract(epoch from (d.return_window_ends_at - now()))));
  end if;
  if not exists (select 1 from public.payments where deal_id = d.id and status = 'captured') then return jsonb_build_object('released', false, 'reason', 'no_verified_payment'); end if;
  select * into inv from public.invoices where deal_id = d.id and status = 'paid';
  if not found then return jsonb_build_object('released', false, 'reason', 'no_paid_invoice'); end if;
  if not exists (select 1 from public.deal_payout_destinations where deal_id = d.id) then return jsonb_build_object('released', false, 'reason', 'no_destination'); end if;
  update public.deals set status = 'released' where id = d.id;
  insert into public.payouts (deal_id, amount, platform_fee, amount_cents, fee_cents, status, released_at, sender_batch_id, request_id)
  values (d.id, inv.price_cents / 100.0, inv.fee_cents / 100.0, inv.price_cents, inv.fee_cents, 'eligible', now(), 'brk-po-' || d.id, 'brk-po-req-' || d.id)
  on conflict (deal_id) do nothing;
  perform public._deal_event(d.id, null, 'system', 'released', 'return_window', 'released', jsonb_build_object('amount_cents', inv.price_cents));
  return jsonb_build_object('released', true);
end $$;

-- Atomic claim: exactly one caller ever moves eligible -> submitting; everyone else gets claimed=false.
create or replace function public.fn_claim_payout(p_deal_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; po public.payouts; dest public.deal_payout_destinations;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found or d.status <> 'released' or d.needs_review then return jsonb_build_object('claimed', false); end if;
  if exists (select 1 from public.disputes where deal_id = d.id and status = 'open') then return jsonb_build_object('claimed', false); end if;
  if not exists (select 1 from public.payments where deal_id = d.id and status = 'captured') then return jsonb_build_object('claimed', false); end if;
  update public.payouts set status = 'submitting', attempt_count = attempt_count + 1, submitted_at = now(), last_error = null
  where deal_id = d.id and status = 'eligible' returning * into po;
  if not found then return jsonb_build_object('claimed', false); end if;
  select * into dest from public.deal_payout_destinations where deal_id = d.id;
  if not found then
    update public.payouts set status = 'manual_review', last_error = 'no_destination' where id = po.id;
    return jsonb_build_object('claimed', false);
  end if;
  return jsonb_build_object('claimed', true, 'deal_id', d.id, 'amount_cents', po.amount_cents, 'sender_batch_id', po.sender_batch_id,
    'request_id', po.request_id, 'destination', dest.destination, 'attempt', po.attempt_count);
end $$;

create or replace function public.fn_record_payout_submitted(p_deal_id uuid, p_batch_id text) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.payouts set status = 'pending', paypal_payout_batch_id = p_batch_id where deal_id = p_deal_id and status = 'submitting';
  if not found then raise exception 'brk_invalid_state:payout'; end if;
  perform public._deal_event(p_deal_id, null, 'system', 'payout_submitted', 'released', 'released', '{}'::jsonb);
end $$;

create or replace function public.fn_mark_payout_ambiguous(p_deal_id uuid, p_error text) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.payouts set status = 'ambiguous', last_error = left(p_error, 300) where deal_id = p_deal_id and status = 'submitting';
  perform public._deal_event(p_deal_id, null, 'system', 'payout_ambiguous', 'released', 'released', '{}'::jsonb);
end $$;

-- Only provider-verified item states are recorded here. 'succeeded' is final.
create or replace function public.fn_record_payout_result(p_deal_id uuid, p_status text, p_item_id text, p_fee_cents integer, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po public.payouts;
begin
  if p_status not in ('succeeded','failed','pending','manual_review') then raise exception 'brk_invalid_state:status'; end if;
  select * into po from public.payouts where deal_id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if po.status = 'succeeded' then return jsonb_build_object('ok', true, 'status', 'succeeded', 'idempotent', true); end if;
  if po.status not in ('submitting','pending','ambiguous','manual_review') then raise exception 'brk_invalid_state:%', po.status; end if;
  update public.payouts set status = p_status, provider_item_id = coalesce(p_item_id, provider_item_id),
    payout_fee_cents = coalesce(p_fee_cents, payout_fee_cents), last_error = left(p_error, 300),
    completed_at = case when p_status in ('succeeded','failed') then now() else completed_at end where id = po.id;
  perform public._deal_event(p_deal_id, null, 'system', 'payout_' || p_status, 'released', 'released', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

create or replace function public.fn_requeue_payout(p_deal_id uuid, p_admin_id uuid, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare po public.payouts;
begin
  if not public._is_admin(p_admin_id) then raise exception 'brk_forbidden'; end if;
  select * into po from public.payouts where deal_id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if po.status not in ('failed','ambiguous','manual_review') then raise exception 'brk_invalid_state:%', po.status; end if;
  -- After a definite failure use a fresh batch id. After an ambiguous result KEEP the id so PayPal rejects a duplicate send.
  update public.payouts set status = 'eligible',
    sender_batch_id = case when po.status = 'failed' then 'brk-po-' || p_deal_id || '-r' || po.attempt_count else po.sender_batch_id end,
    request_id = case when po.status = 'failed' then 'brk-po-req-' || p_deal_id || '-r' || po.attempt_count else po.request_id end,
    paypal_payout_batch_id = case when po.status = 'failed' then null else po.paypal_payout_batch_id end
  where id = po.id;
  perform public._deal_event(p_deal_id, p_admin_id, 'admin', 'payout_requeued', 'released', 'released', jsonb_build_object('from', po.status, 'note', left(p_note, 300)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fn_resolve_dispute(p_dispute_id uuid, p_admin_id uuid, p_resolution text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare disp public.disputes; d public.deals;
begin
  if not public._is_admin(p_admin_id) then raise exception 'brk_forbidden'; end if;
  if p_resolution not in ('release','refund') then raise exception 'brk_invalid_state:resolution'; end if;
  select * into disp from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if disp.status <> 'open' then raise exception 'brk_invalid_state:%', disp.status; end if;
  select * into d from public.deals where id = disp.deal_id for update;
  update public.disputes set status = case p_resolution when 'release' then 'resolved_release' else 'resolved_refund' end,
    resolution_note = left(p_note, 2000), resolved_by = p_admin_id, resolved_at = now() where id = disp.id;
  if p_resolution = 'release' then
    -- Evidence was reviewed by an admin: record it as admin-verified delivery and end the window now.
    update public.deals set status = 'return_window', needs_review = false,
      delivery_confirmed_at = coalesce(delivery_confirmed_at, now()), delivery_confirmed_by = coalesce(delivery_confirmed_by, 'admin'),
      return_window_started_at = coalesce(return_window_started_at, now()), return_window_ends_at = now() where id = d.id;
  end if;
  perform public._deal_event(d.id, p_admin_id, 'admin', 'dispute_resolved_' || p_resolution, 'disputed', case p_resolution when 'release' then 'return_window' else 'disputed' end,
    jsonb_build_object('dispute_id', disp.id));
  return jsonb_build_object('ok', true, 'resolution', p_resolution);
end $$;

create or replace function public.fn_begin_refund(p_deal_id uuid, p_admin_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; pay public.payments;
begin
  if not public._is_admin(p_admin_id) then raise exception 'brk_forbidden'; end if;
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.status not in ('paid','shipped','return_window','disputed') then raise exception 'brk_invalid_state:%', d.status; end if;
  if d.status = 'disputed' and not exists (select 1 from public.disputes where deal_id = d.id and status = 'resolved_refund') then
    raise exception 'brk_dispute_not_resolved_for_refund';
  end if;
  if exists (select 1 from public.payouts where deal_id = d.id and status in ('submitting','pending','succeeded','ambiguous','eligible')) then raise exception 'brk_payout_started'; end if;
  select * into pay from public.payments where deal_id = d.id and status in ('captured','refund_pending') for update;
  if not found then raise exception 'brk_no_verified_payment'; end if;
  update public.payments set status = 'refund_pending' where id = pay.id;
  perform public._deal_event(d.id, p_admin_id, 'admin', 'refund_started', d.status::text, d.status::text, jsonb_build_object('payment_id', pay.id));
  return jsonb_build_object('payment_id', pay.id, 'capture_id', pay.provider_capture_id, 'amount_cents', pay.amount_cents, 'currency', pay.currency, 'request_id', 'brk-refund-' || pay.id);
end $$;

create or replace function public.fn_complete_refund(p_payment_id uuid, p_refund_id text, p_refunded_cents integer, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if pay.status = 'refunded' then return jsonb_build_object('ok', true, 'idempotent', true); end if;
  if pay.status <> 'refund_pending' then raise exception 'brk_invalid_state:%', pay.status; end if;
  if p_status = 'COMPLETED' then
    update public.payments set status = 'refunded', provider_refund_id = p_refund_id, refunded_cents = p_refunded_cents where id = pay.id;
    update public.deals set status = 'refunded', needs_review = false where id = pay.deal_id;
    perform public._deal_event(pay.deal_id, null, 'system', 'refund_completed', null, 'refunded', jsonb_build_object('refunded_cents', p_refunded_cents));
    return jsonb_build_object('ok', true, 'status', 'refunded');
  elsif p_status in ('FAILED','CANCELLED') then
    update public.payments set status = 'captured' where id = pay.id;
    return jsonb_build_object('ok', true, 'status', 'captured');
  end if;
  return jsonb_build_object('ok', true, 'status', 'refund_pending');
end $$;

create or replace function public.fn_cancel_deal(p_deal_id uuid, p_actor_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; role text;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.buyer_id = p_actor_id then role := 'buyer'; elsif d.seller_id = p_actor_id then role := 'seller'; else raise exception 'brk_forbidden'; end if;
  if d.status not in ('negotiating','agreed','invoiced') then raise exception 'brk_invalid_state:%', d.status; end if;
  if exists (select 1 from public.payments where deal_id = d.id and status in ('capture_pending','captured','refund_pending','refunded')) then raise exception 'brk_payment_in_progress'; end if;
  update public.payments set status = 'voided', failed_reason = 'deal_cancelled' where deal_id = d.id and status in ('created','order_created','approved');
  update public.invoices set status = 'void' where deal_id = d.id and status = 'open';
  update public.deals set status = 'cancelled' where id = d.id;
  perform public._deal_event(d.id, p_actor_id, role, 'deal_cancelled', d.status::text, 'cancelled', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fn_flag_stale_shipments(p_days integer) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with u as (update public.deals set needs_review = true, review_reason = 'no_delivery_confirmation'
    where status = 'shipped' and not needs_review and shipped_at < now() - make_interval(days => p_days) returning id)
  select count(*) into n from u;
  return n;
end $$;

create or replace function public.fn_clear_review(p_deal_id uuid, p_admin_id uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_admin_id) then raise exception 'brk_forbidden'; end if;
  update public.deals set needs_review = false, review_reason = null where id = p_deal_id;
  perform public._deal_event(p_deal_id, p_admin_id, 'admin', 'review_cleared', null, null, jsonb_build_object('note', left(p_note, 300)));
end $$;

-- Lock every function down to the server (service role) only.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'fn\_%' or p.proname in ('_deal_event','_is_admin','_void_abandoned_payments')) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
