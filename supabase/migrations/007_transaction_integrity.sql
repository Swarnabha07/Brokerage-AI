-- 007: financial validation, mutual acceptance, and atomic payout destination cooldown.

create table if not exists public.deal_agreements (
  deal_id uuid primary key references public.deals(id),
  version integer not null check (version > 0), terms_hash text not null, terms jsonb not null,
  buyer_accepted_hash text, seller_accepted_hash text, buyer_accepted_at timestamptz, seller_accepted_at timestamptz,
  updated_at timestamptz not null default now()
);
-- Old one-sided `agreed` rows have no accepted snapshot; put unpaid, un-invoiced rows back into terms review.
update public.deals d set status='negotiating'
where d.status='agreed' and not exists(select 1 from public.invoices i where i.deal_id=d.id and i.status in ('open','paid'))
  and not exists(select 1 from public.deal_agreements a where a.deal_id=d.id);
alter table public.deal_agreements enable row level security;
revoke all on public.deal_agreements from public, anon, authenticated;
grant all on public.deal_agreements to service_role;

create or replace function public.trg_agreement_guard() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'deal agreements are append-only' using errcode='42501'; end if;
  if tg_op='INSERT' and coalesce(current_setting('brk.allow_terms_rewrite',true),'off')<>'on' then raise exception 'terms must be proposed through the agreement function' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.version is distinct from old.version or new.terms_hash is distinct from old.terms_hash or new.terms is distinct from old.terms)
    and coalesce(current_setting('brk.allow_terms_rewrite',true),'off')<>'on' then raise exception 'accepted terms are immutable' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.buyer_accepted_hash is distinct from old.buyer_accepted_hash or new.seller_accepted_hash is distinct from old.seller_accepted_hash or
    new.buyer_accepted_at is distinct from old.buyer_accepted_at or new.seller_accepted_at is distinct from old.seller_accepted_at)
    and coalesce(current_setting('brk.allow_terms_rewrite',true),'off')<>'on' then raise exception 'acceptance must use the agreement function' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists agreement_guard on public.deal_agreements;
create trigger agreement_guard before insert or update or delete on public.deal_agreements for each row execute function public.trg_agreement_guard();

create or replace function public.trg_invoice_financial_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare d public.deals; l public.listings; a public.deal_agreements; fee integer;
begin
  if coalesce(current_setting('brk.allow_invoice_issue',true),'off')<>'on' then raise exception 'invoice must be issued through the financial function' using errcode='42501'; end if;
  select * into d from public.deals where id=new.deal_id for update;
  select * into l from public.listings where id=d.listing_id for update;
  select * into a from public.deal_agreements where deal_id=d.id for update;
  if d.status<>'agreed' or a.buyer_accepted_hash is distinct from a.terms_hash or a.seller_accepted_hash is distinct from a.terms_hash then raise exception 'brk_terms_not_mutually_accepted'; end if;
  fee:=round(new.price_cents::numeric*3/100)::integer;
  if new.currency<>'USD' or new.status<>'open' or new.price_cents is null or new.price_cents<=0 or
    new.price_cents<>(a.terms->>'price_cents')::integer or new.price_cents>round(l.price*100)::integer or
    new.fee_cents is distinct from fee or new.total_cents is distinct from new.price_cents+fee or
    a.terms->>'fulfillment_type' not in ('physical_goods','service','other') or
    nullif(trim(a.terms->>'delivery_expectations'),'') is null or
    nullif(trim(a.terms->>'return_window_policy'),'') is null or
    new.invoice_data->>'terms_hash' is distinct from a.terms_hash or new.invoice_data->'accepted_terms' is distinct from a.terms then
    raise exception 'brk_invoice_financial_mismatch';
  end if;
  return new;
end $$;
drop trigger if exists invoice_financial_guard on public.invoices;
create trigger invoice_financial_guard before insert on public.invoices for each row execute function public.trg_invoice_financial_guard();

create or replace function public.trg_payout_profile_cooldown() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'payout profile deletion is not allowed' using errcode='42501'; end if;
  if lower(new.paypal_email)<>lower(old.paypal_email) and old.updated_at>clock_timestamp()-interval '24 hours' then raise exception 'brk_cooldown'; end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
drop trigger if exists payout_profile_cooldown on public.seller_payout_profiles;
create trigger payout_profile_cooldown before update or delete on public.seller_payout_profiles for each row execute function public.trg_payout_profile_cooldown();

create or replace function public.fn_propose_terms(p_deal_id uuid,p_seller_id uuid,p_price_cents integer,p_return_window_hours numeric)
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
  select coalesce(max(version),0)+1 into v from public.deal_agreements where deal_id=d.id;
  t:=jsonb_build_object('price_cents',p_price_cents,'currency','USD','listing_id',l.id,'title',l.title,'description',l.description,
    'delivery_expectations',coalesce(d.terms_json->'delivery_expectations','null'::jsonb),'conditions',coalesce(d.terms_json->'conditions','{}'::jsonb),'return_window_hours',p_return_window_hours);
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

create or replace function public.fn_accept_terms(p_deal_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.deals; a public.deal_agreements; member_role text; buyer_ok boolean; seller_ok boolean;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if p_user_id=d.buyer_id then member_role:='buyer'; elsif p_user_id=d.seller_id then member_role:='seller'; else raise exception 'brk_forbidden'; end if;
  select * into a from public.deal_agreements where deal_id=d.id for update;
  if not found then raise exception 'brk_no_terms'; end if;
  perform set_config('brk.allow_terms_rewrite','on',true);
  if member_role='buyer' then update public.deal_agreements set buyer_accepted_hash=a.terms_hash,buyer_accepted_at=coalesce(buyer_accepted_at,now()) where deal_id=d.id;
  else update public.deal_agreements set seller_accepted_hash=a.terms_hash,seller_accepted_at=coalesce(seller_accepted_at,now()) where deal_id=d.id; end if;
  perform set_config('brk.allow_terms_rewrite','off',true);
  select * into a from public.deal_agreements where deal_id=d.id;
  buyer_ok:=a.buyer_accepted_hash=a.terms_hash and a.buyer_accepted_at is not null;
  seller_ok:=a.seller_accepted_hash=a.terms_hash and a.seller_accepted_at is not null;
  if buyer_ok and seller_ok then update public.deals set status='agreed',agreed_price=(a.terms->>'price_cents')::integer/100.0,
    platform_fee=round((a.terms->>'price_cents')::numeric*0.03)/100.0 where id=d.id; end if;
  perform public._deal_event(d.id,p_user_id,member_role,'terms_accepted',d.status::text,case when buyer_ok and seller_ok then 'agreed' else d.status::text end,
    jsonb_build_object('version',a.version,'terms_hash',a.terms_hash,'buyer_accepted',buyer_ok,'seller_accepted',seller_ok));
  return jsonb_build_object('version',a.version,'terms_hash',a.terms_hash,'buyer_accepted',buyer_ok,'seller_accepted',seller_ok,'agreed',buyer_ok and seller_ok);
end $$;

create or replace function public.fn_issue_invoice(p_deal_id uuid,p_seller_id uuid,p_price_cents integer,p_fee_cents integer,p_expiry_hours integer,p_invoice_data jsonb)
returns public.invoices language plpgsql security definer set search_path=public as $$
declare d public.deals; l public.listings; prof public.seller_payout_profiles; inv public.invoices; a public.deal_agreements; fee integer;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.seller_id is distinct from p_seller_id then raise exception 'brk_forbidden'; end if;
  if d.status<>'agreed' then raise exception 'brk_invalid_state:%',d.status; end if;
  select * into l from public.listings where id=d.listing_id for update;
  if not found then raise exception 'brk_listing_not_found'; end if;
  select * into a from public.deal_agreements where deal_id=d.id for update;
  if not found or a.buyer_accepted_hash is distinct from a.terms_hash or a.seller_accepted_hash is distinct from a.terms_hash then raise exception 'brk_terms_not_mutually_accepted'; end if;
  if p_price_cents is null or p_price_cents<=0 or p_price_cents<>(a.terms->>'price_cents')::integer or p_price_cents>round(l.price*100)::integer then raise exception 'brk_invalid_amount'; end if;
  fee:=round(p_price_cents*0.03)::integer;
  if p_fee_cents is distinct from fee then raise exception 'brk_fee_mismatch'; end if;
  if p_expiry_hours is null or p_expiry_hours<1 or p_expiry_hours>720 then raise exception 'brk_invalid_amount'; end if;
  select * into prof from public.seller_payout_profiles where user_id=p_seller_id for update;
  if not found then raise exception 'brk_no_payout_profile'; end if;
  perform set_config('brk.allow_destination_rewrite','on',true);
  insert into public.deal_payout_destinations(deal_id,seller_id,destination,destination_hash) values(d.id,p_seller_id,lower(prof.paypal_email),encode(digest(lower(prof.paypal_email),'sha256'),'hex'))
  on conflict(deal_id) do update set seller_id=excluded.seller_id,destination=excluded.destination,destination_hash=excluded.destination_hash,created_at=now();
  perform set_config('brk.allow_destination_rewrite','off',true);
  perform set_config('brk.allow_invoice_issue','on',true);
  insert into public.invoices(deal_id,invoice_number,status,currency,price_cents,fee_cents,total_cents,expires_at,invoice_data)
  values(d.id,'BRK-INV-'||lpad(nextval('public.invoice_number_seq')::text,6,'0'),'open','USD',p_price_cents,fee,p_price_cents+fee,
    now()+make_interval(hours=>p_expiry_hours),coalesce(p_invoice_data,'{}'::jsonb)||jsonb_build_object('accepted_terms',a.terms,'terms_hash',a.terms_hash,'terms_version',a.version)) returning * into inv;
  perform set_config('brk.allow_invoice_issue','off',true);
  update public.deals set status='invoiced',agreed_price=p_price_cents/100.0,platform_fee=fee/100.0 where id=d.id;
  perform public._deal_event(d.id,p_seller_id,'seller','invoice_issued','agreed','invoiced',jsonb_build_object('invoice_number',inv.invoice_number,'price_cents',p_price_cents,'fee_cents',fee,'terms_hash',a.terms_hash));
  return inv;
end $$;

create or replace function public.fn_update_payout_profile(p_seller_id uuid,p_email text)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare cur public.seller_payout_profiles; now_at timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.users where id=p_seller_id and role='seller') then raise exception 'brk_forbidden'; end if;
  if p_email is null or length(p_email)>254 or p_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'brk_invalid_email'; end if;
  perform 1 from public.users where id=p_seller_id for update;
  select * into cur from public.seller_payout_profiles where user_id=p_seller_id for update;
  if found and lower(cur.paypal_email)<>lower(p_email) and cur.updated_at>now_at-interval '24 hours' then raise exception 'brk_cooldown'; end if;
  insert into public.seller_payout_profiles(user_id,paypal_email,updated_at) values(p_seller_id,lower(p_email),now_at)
  on conflict(user_id) do update set paypal_email=excluded.paypal_email,updated_at=excluded.updated_at;
  return now_at;
end $$;

create or replace function public.fn_complete_refund(p_payment_id uuid,p_refund_id text,p_refunded_cents integer,p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare pay public.payments; d public.deals; deal_key uuid;
begin
  select deal_id into deal_key from public.payments where id=p_payment_id;
  if not found then raise exception 'brk_not_found'; end if;
  select * into d from public.deals where id=deal_key for update;
  select * into pay from public.payments where id=p_payment_id for update;
  if not found or pay.deal_id is distinct from deal_key then raise exception 'brk_not_found'; end if;
  if pay.status='refunded' then return jsonb_build_object('ok',true,'idempotent',true,'status','refunded'); end if;
  if pay.status not in ('refund_pending','captured') then raise exception 'brk_invalid_state:%',pay.status; end if;
  if exists(select 1 from public.payouts where deal_id=d.id and status in ('eligible','submitting','pending','succeeded','ambiguous','manual_review')) then raise exception 'brk_payout_in_progress'; end if;
  if pay.provider_refund_id is not null and p_refund_id is not null and pay.provider_refund_id is distinct from p_refund_id then raise exception 'brk_refund_unverified'; end if;
  if p_status='COMPLETED' then
    if p_refund_id is null or p_refunded_cents is distinct from pay.amount_cents then raise exception 'brk_refund_unverified'; end if;
    update public.payments set status='refunded',provider_refund_id=p_refund_id,refunded_cents=p_refunded_cents,provider_status='REFUNDED' where id=pay.id;
    update public.deals set status='refunded',needs_review=false where id=pay.deal_id;
    perform public._deal_event(pay.deal_id,null,'system','refund_completed',d.status::text,'refunded',jsonb_build_object('refund_id',p_refund_id,'refunded_cents',p_refunded_cents));
    return jsonb_build_object('ok',true,'status','refunded');
  elsif p_status='PENDING' then
    update public.payments set status='refund_pending',provider_refund_id=coalesce(p_refund_id,provider_refund_id),refunded_cents=null,provider_status='REFUND_PENDING' where id=pay.id;
    return jsonb_build_object('ok',true,'status','refund_pending');
  elsif p_status='FAILED' then
    update public.payments set status='captured',provider_status='REFUND_FAILED',provider_refund_id=coalesce(p_refund_id,provider_refund_id) where id=pay.id;
    return jsonb_build_object('ok',true,'status','captured');
  end if;
  raise exception 'brk_refund_unverified';
end $$;

create or replace function public.fn_begin_refund(p_deal_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.deals; pay public.payments;
begin
  if not public._is_admin(p_admin_id) then raise exception 'brk_forbidden'; end if;
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  if d.status not in ('paid','shipped','return_window','disputed') then raise exception 'brk_invalid_state:%',d.status; end if;
  if d.status='disputed' and not exists(select 1 from public.disputes where deal_id=d.id and status='resolved_refund') then raise exception 'brk_dispute_not_resolved_for_refund'; end if;
  if exists(select 1 from public.payouts where deal_id=d.id and status in ('submitting','pending','succeeded','ambiguous','manual_review','eligible')) then raise exception 'brk_payout_started'; end if;
  select * into pay from public.payments where deal_id=d.id and status in ('captured','refund_pending') for update;
  if not found then raise exception 'brk_no_verified_payment'; end if;
  update public.payments set status='refund_pending' where id=pay.id;
  perform public._deal_event(d.id,p_admin_id,'admin','refund_started',d.status::text,d.status::text,jsonb_build_object('payment_id',pay.id));
  return jsonb_build_object('payment_id',pay.id,'capture_id',pay.provider_capture_id,'amount_cents',pay.amount_cents,'currency',pay.currency,'request_id','brk-refund-'||pay.id);
end $$;

create or replace function public.fn_record_refund_reconciliation(p_payment_id uuid,p_refund_id text,p_amount_cents integer,p_currency text,p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare pay public.payments;
begin
  select * into pay from public.payments where id=p_payment_id;
  if not found or pay.provider_refund_id is distinct from p_refund_id or pay.currency is distinct from p_currency or pay.amount_cents is distinct from p_amount_cents then raise exception 'brk_refund_unverified'; end if;
  return public.fn_complete_refund(pay.id,p_refund_id,p_amount_cents,p_status);
end $$;

revoke all on function public.fn_propose_terms(uuid,uuid,integer,numeric),public.fn_accept_terms(uuid,uuid),public.fn_update_payout_profile(uuid,text),public.fn_record_refund_reconciliation(uuid,text,integer,text,text),public.fn_begin_refund(uuid,uuid),public.fn_complete_refund(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.fn_propose_terms(uuid,uuid,integer,numeric),public.fn_accept_terms(uuid,uuid),public.fn_update_payout_profile(uuid,text),public.fn_record_refund_reconciliation(uuid,text,integer,text,text),public.fn_begin_refund(uuid,uuid),public.fn_complete_refund(uuid,text,integer,text) to service_role;
