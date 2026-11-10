-- 008: serialize capture/cancellation, preserve provider truth, and freeze complete fulfillment terms.

-- Remove the earlier function signature so no server caller can create incomplete snapshots.
drop function if exists public.fn_propose_terms(uuid,uuid,integer,numeric);

create or replace function public.fn_propose_terms(
  p_deal_id uuid,
  p_seller_id uuid,
  p_price_cents integer,
  p_return_window_hours numeric,
  p_fulfillment_type text,
  p_delivery_expectations text,
  p_transaction_conditions text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.deals; l public.listings; v integer; t jsonb; h text;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.seller_id is distinct from p_seller_id then raise exception 'brk_forbidden'; end if;
  if d.status not in ('negotiating','agreed') then raise exception 'brk_invalid_state:%',d.status; end if;
  select * into l from public.listings where id=d.listing_id for update;
  if not found then raise exception 'brk_listing_not_found'; end if;
  if p_price_cents is null or p_price_cents<=0 or p_price_cents>round(l.price*100)::integer then raise exception 'brk_price_above_listing'; end if;
  if p_return_window_hours is null or p_return_window_hours<=0 or p_return_window_hours>1440 then raise exception 'brk_invalid_amount'; end if;
  if p_fulfillment_type is null or p_fulfillment_type not in ('physical_goods','service','other') then raise exception 'brk_invalid_fulfillment_type'; end if;
  if p_delivery_expectations is null or length(trim(p_delivery_expectations))<3 or length(p_delivery_expectations)>2000 then raise exception 'brk_invalid_delivery_terms'; end if;
  if length(coalesce(p_transaction_conditions,''))>2000 then raise exception 'brk_invalid_conditions'; end if;
  select coalesce(max(version),0)+1 into v from public.deal_agreements where deal_id=d.id;
  t:=jsonb_build_object(
    'price_cents',p_price_cents,'currency','USD','listing_id',l.id,'title',l.title,'description',l.description,
    'platform_fee_bps',300,'fee_payer','buyer','fee_rounding_policy','nearest cent, half up',
    'fulfillment_type',p_fulfillment_type,'delivery_expectations',trim(p_delivery_expectations),
    'buyer_conditions',coalesce(d.buyer_conditions,''),'transaction_conditions',trim(coalesce(p_transaction_conditions,'')),
    'conditions',coalesce(d.terms_json->'conditions','{}'::jsonb),
    'return_window_hours',p_return_window_hours,
    'return_window_policy','The window starts after buyer or admin delivery confirmation. Disputes pause release; unconfirmed delivery after seven days requires admin review.'
  );
  h:=encode(digest(convert_to(t::text,'UTF8'),'sha256'),'hex');
  perform set_config('brk.allow_terms_rewrite','on',true);
  insert into public.deal_agreements(deal_id,version,terms_hash,terms) values(d.id,v,h,t)
  on conflict(deal_id) do update set version=excluded.version,terms_hash=excluded.terms_hash,terms=excluded.terms,
    buyer_accepted_hash=null,seller_accepted_hash=null,buyer_accepted_at=null,seller_accepted_at=null,updated_at=now();
  perform set_config('brk.allow_terms_rewrite','off',true);
  update public.deals set status='negotiating',agreed_price=p_price_cents/100.0,platform_fee=round(p_price_cents*0.03)/100.0 where id=d.id;
  perform public._deal_event(d.id,p_seller_id,'seller','terms_proposed',d.status::text,'negotiating',jsonb_build_object('version',v,'terms_hash',h));
  return jsonb_build_object('version',v,'terms_hash',h,'terms',t);
end $$;

create or replace function public.fn_begin_payment(p_deal_id uuid,p_buyer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.deals; inv public.invoices; pay public.payments;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.buyer_id is distinct from p_buyer_id then raise exception 'brk_forbidden'; end if;
  if d.status<>'invoiced' then raise exception 'brk_invalid_state:%',d.status; end if;
  select * into inv from public.invoices where deal_id=d.id and status='open' order by created_at desc limit 1 for update;
  if not found then raise exception 'brk_no_open_invoice'; end if;
  perform public._void_abandoned_payments(d.id);
  select * into pay from public.payments where invoice_id=inv.id and status in ('created','order_created','approved','capture_pending') order by created_at desc limit 1 for update;
  if clock_timestamp()>inv.expires_at then
    -- A known PayPal order can be safely re-read/resumed; a local attempt without an order cannot create one after expiry.
    if found and pay.provider_order_id is not null and pay.status in ('order_created','approved','capture_pending') then
      return jsonb_build_object('ok',true,'reused',true,'payment',to_jsonb(pay),'invoice',to_jsonb(inv));
    end if;
    if found then update public.payments set status='voided',failed_reason='invoice_expired' where id=pay.id and status='created'; end if;
    update public.invoices set status='expired' where id=inv.id;
    update public.deals set status='agreed' where id=d.id;
    perform public._deal_event(d.id,null,'system','invoice_expired','invoiced','agreed',jsonb_build_object('invoice_number',inv.invoice_number));
    return jsonb_build_object('ok',false,'reason','invoice_expired');
  end if;
  if found then return jsonb_build_object('ok',true,'reused',true,'payment',to_jsonb(pay),'invoice',to_jsonb(inv)); end if;
  insert into public.payments(deal_id,invoice_id,status,amount_cents,currency,request_id)
  values(d.id,inv.id,'created',inv.total_cents,inv.currency,'brk-pay-'||gen_random_uuid()) returning * into pay;
  perform public._deal_event(d.id,p_buyer_id,'buyer','checkout_started','invoiced','invoiced',jsonb_build_object('payment_id',pay.id));
  return jsonb_build_object('ok',true,'reused',false,'payment',to_jsonb(pay),'invoice',to_jsonb(inv));
end $$;

create or replace function public.fn_set_payment_order(p_payment_id uuid,p_order_id text)
returns public.payments language plpgsql security definer set search_path=public as $$
declare deal_key uuid; invoice_key uuid; d public.deals; inv public.invoices; pay public.payments;
begin
  select deal_id,invoice_id into deal_key,invoice_key from public.payments where id=p_payment_id;
  if not found then raise exception 'brk_not_found'; end if;
  select * into d from public.deals where id=deal_key for update;
  select * into inv from public.invoices where id=invoice_key for update;
  select * into pay from public.payments where id=p_payment_id for update;
  if pay.deal_id is distinct from d.id or pay.invoice_id is distinct from inv.id then raise exception 'brk_invalid_state:payment'; end if;
  if p_order_id is null or length(p_order_id)=0 then raise exception 'brk_invalid_order'; end if;
  if pay.provider_order_id is not null and pay.provider_order_id is distinct from p_order_id then raise exception 'brk_order_mismatch'; end if;
  if pay.provider_order_id is null and (d.status<>'invoiced' or inv.status<>'open' or clock_timestamp()>inv.expires_at) then raise exception 'brk_invoice_expired'; end if;
  if pay.status not in ('created','order_created') then raise exception 'brk_invalid_state:payment'; end if;
  update public.payments set provider_order_id=p_order_id,status='order_created' where id=pay.id returning * into pay;
  return pay;
end $$;

-- Reserve capture in the database before calling PayPal. Cancellation locks the same deal first
-- and refuses once this state is reached, so the app never knowingly captures a cancelled deal.
create or replace function public.fn_mark_capture_started(p_payment_id uuid,p_order_id text)
returns boolean language plpgsql security definer set search_path=public as $$
declare deal_key uuid; invoice_key uuid; d public.deals; inv public.invoices; pay public.payments;
begin
  select deal_id,invoice_id into deal_key,invoice_key from public.payments where id=p_payment_id;
  if not found then raise exception 'brk_not_found'; end if;
  select * into d from public.deals where id=deal_key for update;
  select * into inv from public.invoices where id=invoice_key for update;
  select * into pay from public.payments where id=p_payment_id for update;
  if pay.provider_order_id is distinct from p_order_id then raise exception 'brk_order_mismatch'; end if;
  if d.status<>'invoiced' or inv.status<>'open' or pay.status not in ('order_created','approved','capture_pending') then return false; end if;
  update public.payments set status='capture_pending',provider_status=case when provider_status='PENDING' then provider_status else 'CAPTURE_REQUESTED' end where id=pay.id;
  return true;
end $$;

-- A second database check immediately before the external create-order request closes stale UI/API retries.
create or replace function public.fn_assert_order_creation(p_payment_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare deal_key uuid; invoice_key uuid; d public.deals; inv public.invoices; pay public.payments;
begin
  select deal_id,invoice_id into deal_key,invoice_key from public.payments where id=p_payment_id;
  if not found then raise exception 'brk_not_found'; end if;
  select * into d from public.deals where id=deal_key for update;
  select * into inv from public.invoices where id=invoice_key for update;
  select * into pay from public.payments where id=p_payment_id for update;
  if d.status<>'invoiced' or inv.status<>'open' or pay.status<>'created' or pay.provider_order_id is not null then raise exception 'brk_invalid_state:order_creation'; end if;
  if clock_timestamp()>inv.expires_at then
    update public.payments set status='voided',failed_reason='invoice_expired' where id=pay.id;
    update public.invoices set status='expired' where id=inv.id;
    update public.deals set status='agreed' where id=d.id;
    perform public._deal_event(d.id,null,'system','invoice_expired','invoiced','agreed',jsonb_build_object('invoice_number',inv.invoice_number));
    return false;
  end if;
  return true;
end $$;

create or replace function public.fn_record_capture(
  p_payment_id uuid,p_order_id text,p_capture_id text,p_amount_cents integer,p_currency text,
  p_provider_status text,p_payer_hash text,p_paypal_fee_cents integer,p_net_cents integer,p_summary jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare deal_key uuid; invoice_key uuid; pay public.payments; d public.deals; inv public.invoices; unexpected boolean;
begin
  -- All lifecycle writers lock deal -> invoice -> payment. This serializes with cancellation without lock inversion.
  select deal_id,invoice_id into deal_key,invoice_key from public.payments where id=p_payment_id;
  if not found then raise exception 'brk_not_found'; end if;
  select * into d from public.deals where id=deal_key for update;
  if not found then raise exception 'brk_not_found'; end if;
  select * into inv from public.invoices where id=invoice_key for update;
  if not found then raise exception 'brk_not_found'; end if;
  select * into pay from public.payments where id=p_payment_id for update;
  if pay.deal_id is distinct from d.id or pay.invoice_id is distinct from inv.id then raise exception 'brk_invalid_state:payment'; end if;
  if pay.provider_order_id is distinct from p_order_id then raise exception 'brk_order_mismatch'; end if;
  if pay.amount_cents is distinct from p_amount_cents or pay.currency is distinct from p_currency then raise exception 'brk_amount_mismatch'; end if;
  if pay.payer_ref_hash is not null and p_payer_hash is not null and pay.payer_ref_hash<>p_payer_hash then raise exception 'brk_payer_mismatch'; end if;
  if pay.status in ('captured','refund_pending','refunded') then
    if pay.provider_capture_id=p_capture_id then
      return jsonb_build_object('ok',true,'idempotent',true,'status',case when d.needs_review then 'needs_review' else pay.status end,'needs_review',d.needs_review);
    end if;
    raise exception 'brk_capture_conflict';
  end if;
  if p_provider_status is null or p_provider_status not in ('PENDING','COMPLETED') then raise exception 'brk_not_completed:%',p_provider_status; end if;
  if p_capture_id is null or length(p_capture_id)=0 then raise exception 'brk_capture_id_missing'; end if;
  if p_provider_status='PENDING' then
    unexpected:=d.status<>'invoiced' or inv.status<>'open' or pay.status in ('voided','failed');
    update public.payments set status='capture_pending',provider_capture_id=p_capture_id,provider_status=p_provider_status,
      payer_ref_hash=coalesce(payer_ref_hash,p_payer_hash) where id=pay.id;
    if unexpected then update public.deals set needs_review=true,review_reason='payment_capture_pending_after_cancellation' where id=d.id; end if;
    perform public._deal_event(d.id,null,'system','capture_pending',d.status::text,d.status::text,jsonb_build_object('payment_id',pay.id,'needs_review',unexpected));
    return jsonb_build_object('ok',true,'status',case when unexpected then 'needs_review' else 'capture_pending' end,'needs_review',unexpected);
  end if;
  unexpected:=d.status<>'invoiced' or inv.status<>'open' or pay.status in ('voided','failed');
  update public.payments set status='captured',provider_capture_id=p_capture_id,provider_status=p_provider_status,
    payer_ref_hash=coalesce(payer_ref_hash,p_payer_hash),paypal_fee_cents=p_paypal_fee_cents,net_cents=p_net_cents,
    provider_summary=coalesce(p_summary,'{}'::jsonb),captured_at=now() where id=pay.id;
  if not unexpected then
    update public.invoices set status='paid',paid_at=now() where id=inv.id;
    update public.deals set status='paid' where id=d.id;
    perform public._deal_event(d.id,null,'system','payment_captured','invoiced','paid',jsonb_build_object('payment_id',pay.id,'amount_cents',p_amount_cents,'paypal_fee_cents',p_paypal_fee_cents));
  else
    update public.deals set needs_review=true,review_reason='payment_captured_unexpected_state' where id=d.id;
    perform public._deal_event(d.id,null,'system','payment_captured_needs_review',d.status::text,d.status::text,jsonb_build_object('payment_id',pay.id,'invoice_status',inv.status));
  end if;
  return jsonb_build_object('ok',true,'status',case when unexpected then 'needs_review' else 'captured' end,'needs_review',unexpected);
end $$;

create or replace function public.fn_cancel_deal(p_deal_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.deals; role text;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.buyer_id=p_actor_id then role:='buyer'; elsif d.seller_id=p_actor_id then role:='seller'; else raise exception 'brk_forbidden'; end if;
  if d.status not in ('negotiating','agreed','invoiced') then raise exception 'brk_invalid_state:%',d.status; end if;
  -- Match capture's lock order. All lifecycle transitions acquire the deal lock first.
  perform id from public.invoices where deal_id=d.id order by id for update;
  perform id from public.payments where deal_id=d.id order by id for update;
  if exists(select 1 from public.payments where deal_id=d.id and status in ('capture_pending','captured','refund_pending','refunded')) then
    raise exception 'brk_payment_in_progress';
  end if;
  update public.payments set status='voided',failed_reason='deal_cancelled' where deal_id=d.id and status in ('created','order_created','approved');
  update public.invoices set status='void' where deal_id=d.id and status='open';
  update public.deals set status='cancelled' where id=d.id;
  perform public._deal_event(d.id,p_actor_id,role,'deal_cancelled',d.status::text,'cancelled','{}'::jsonb);
  return jsonb_build_object('ok',true);
end $$;

-- Admin recovery for the exceptional provider-completed capture that arrives after cancellation.
create or replace function public.fn_begin_refund(p_deal_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.deals; pay public.payments; cancelled_capture boolean;
begin
  if not public._is_admin(p_admin_id) then raise exception 'brk_forbidden'; end if;
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  cancelled_capture:=d.status='cancelled' and d.needs_review and d.review_reason='payment_captured_unexpected_state';
  if d.status not in ('paid','shipped','return_window','disputed') and not cancelled_capture then raise exception 'brk_invalid_state:%',d.status; end if;
  if d.status='disputed' and not exists(select 1 from public.disputes where deal_id=d.id and status='resolved_refund') then raise exception 'brk_dispute_not_resolved_for_refund'; end if;
  if exists(select 1 from public.payouts where deal_id=d.id and status in ('submitting','pending','succeeded','ambiguous','manual_review','eligible')) then raise exception 'brk_payout_started'; end if;
  select * into pay from public.payments where deal_id=d.id and status in ('captured','refund_pending') order by created_at desc limit 1 for update;
  if not found then raise exception 'brk_no_verified_payment'; end if;
  update public.payments set status='refund_pending' where id=pay.id;
  perform public._deal_event(d.id,p_admin_id,'admin','refund_started',d.status::text,d.status::text,jsonb_build_object('payment_id',pay.id,'cancelled_capture_recovery',cancelled_capture));
  return jsonb_build_object('payment_id',pay.id,'capture_id',pay.provider_capture_id,'amount_cents',pay.amount_cents,'currency',pay.currency,'request_id','brk-refund-'||pay.id);
end $$;

revoke all on function public.fn_propose_terms(uuid,uuid,integer,numeric,text,text,text),
  public.fn_begin_payment(uuid,uuid),public.fn_set_payment_order(uuid,text),public.fn_assert_order_creation(uuid),public.fn_mark_capture_started(uuid,text),
  public.fn_record_capture(uuid,text,text,integer,text,text,text,integer,integer,jsonb),public.fn_cancel_deal(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_propose_terms(uuid,uuid,integer,numeric,text,text,text),
  public.fn_begin_payment(uuid,uuid),public.fn_set_payment_order(uuid,text),public.fn_assert_order_creation(uuid),public.fn_mark_capture_started(uuid,text),
  public.fn_record_capture(uuid,text,text,integer,text,text,text,integer,integer,jsonb),public.fn_cancel_deal(uuid,uuid)
  to service_role;
