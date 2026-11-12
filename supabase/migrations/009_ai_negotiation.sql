-- Private AI negotiation state and guarded bridge to the existing agreement lifecycle.
-- Operational prerequisite: pause/remove deals from every publication and set DEFAULT
-- replica identity before this migration; see SUPABASE_OPERATION_CHECKLIST.md.
begin;

do $$ begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'AI negotiation requires PostgreSQL 15+ for publication column lists';
  end if;
  if exists (select 1 from pg_publication_tables where schemaname='public' and tablename='deals') then
    raise exception 'Pause/remove public.deals from all Realtime publications before migration';
  end if;
  if (select relreplident from pg_class where oid='public.deals'::regclass)<>'d' then
    raise exception 'Set public.deals REPLICA IDENTITY DEFAULT before clearing legacy budgets';
  end if;
  if exists(select 1 from pg_publication where puballtables and pubname='supabase_realtime') then
    raise exception 'supabase_realtime is FOR ALL TABLES; configure an explicit table publication before migration';
  end if;
end $$;

create schema if not exists negotiation_private;
revoke all on schema negotiation_private from public, anon, authenticated, service_role;
grant usage on schema negotiation_private to postgres, service_role;

create table if not exists negotiation_private.sessions (
  deal_id uuid primary key references public.deals(id) on delete restrict,
  mode text not null check (mode in ('self_chat','ai_negotiate')),
  state text not null check (state in ('setup_pending','active','approved','accepted','closed','expired','cancelled')),
  buyer_max_cents integer check (buyer_max_cents is null or buyer_max_cents > 0),
  seller_floor_cents integer check (seller_floor_cents is null or seller_floor_cents > 0),
  listing_price_cents integer not null check (listing_price_cents > 0),
  round_no smallint not null default 0 check (round_no between 0 and 5),
  turn_count smallint not null default 0 check (turn_count between 0 and 10),
  next_actor text not null default 'buyer_agent' check (next_actor in ('buyer_agent','seller_agent')),
  last_buyer_offer_cents integer,
  last_seller_offer_cents integer,
  approved_terms_hash text,
  lease_token uuid,
  lease_request_id uuid,
  lease_expires_at timestamptz,
  gemini_calls integer not null default 0,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lease_token is null) = (lease_expires_at is null)),
  check (buyer_max_cents is null or (buyer_max_cents <= listing_price_cents and buyer_max_cents <= 100000000)),
  check (seller_floor_cents is null or seller_floor_cents <= listing_price_cents)
);
create table if not exists negotiation_private.turns (
  deal_id uuid not null references negotiation_private.sessions(deal_id) on delete restrict,
  request_id uuid not null,
  sequence_no smallint not null,
  actor_id uuid not null references public.users(id) on delete restrict,
  lease_token uuid not null,
  state text not null check (state in ('claimed','complete','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (deal_id,request_id), unique (deal_id,sequence_no)
);
create table if not exists negotiation_private.usage (
  user_id uuid not null references public.users(id) on delete restrict,
  usage_day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key(user_id,usage_day)
);
create table if not exists negotiation_private.deal_requests (
  buyer_id uuid not null references public.users(id) on delete restrict,
  request_id uuid not null,
  listing_id uuid not null references public.listings(id) on delete restrict,
  mode text not null,
  buyer_conditions text not null default '',
  ai_enabled boolean not null,
  deal_id uuid references public.deals(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (buyer_id,request_id)
);
alter table negotiation_private.sessions enable row level security;
alter table negotiation_private.sessions force row level security;
alter table negotiation_private.turns enable row level security;
alter table negotiation_private.turns force row level security;
alter table negotiation_private.usage enable row level security;
alter table negotiation_private.usage force row level security;
alter table negotiation_private.deal_requests enable row level security;
alter table negotiation_private.deal_requests force row level security;
revoke all on all tables in schema negotiation_private from public, anon, authenticated, service_role;
grant all on negotiation_private.sessions, negotiation_private.turns, negotiation_private.usage, negotiation_private.deal_requests to postgres;

-- Privacy operation is fail-closed: column remains for compatibility but can never hold a value.
update public.deals set buyer_budget = null where buyer_budget is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.deals'::regclass and conname='deals_buyer_budget_must_be_null') then
    alter table public.deals add constraint deals_buyer_budget_must_be_null check (buyer_budget is null) not valid;
  end if;
end $$;
alter table public.deals validate constraint deals_buyer_budget_must_be_null;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.deals (id);
  end if;
end $$;

-- Keep old implementations byte-for-byte as private helpers. They preserve canonical JSON,
-- SHA-256 terms hashes, triggers, acceptance resets, invoice guards and existing invoice logic.
alter function public.fn_propose_terms(uuid,uuid,integer,numeric,text,text,text) set schema negotiation_private;
alter function negotiation_private.fn_propose_terms(uuid,uuid,integer,numeric,text,text,text) rename to _fn_propose_terms_legacy;
alter function public.fn_accept_terms(uuid,uuid) set schema negotiation_private;
alter function negotiation_private.fn_accept_terms(uuid,uuid) rename to _fn_accept_terms_legacy;
alter function public.fn_issue_invoice(uuid,uuid,integer,integer,integer,jsonb) set schema negotiation_private;
alter function negotiation_private.fn_issue_invoice(uuid,uuid,integer,integer,integer,jsonb) rename to _fn_issue_invoice_legacy;
revoke all on function negotiation_private._fn_propose_terms_legacy(uuid,uuid,integer,numeric,text,text,text),
  negotiation_private._fn_accept_terms_legacy(uuid,uuid),
  negotiation_private._fn_issue_invoice_legacy(uuid,uuid,integer,integer,integer,jsonb)
  from public,anon,authenticated,service_role;

create function public.fn_create_negotiated_deal(p_buyer_id uuid,p_listing_id uuid,p_mode text,p_buyer_conditions text,p_request_id uuid,p_ai_enabled boolean)
returns public.deals language plpgsql security definer set search_path='' as $$
declare l public.listings; d public.deals; prior negotiation_private.deal_requests; inserted integer; price_cents integer; conditions text;
begin
  if p_mode is null or p_mode not in ('self_chat','ai_negotiate') or p_buyer_id is null or p_request_id is null then raise exception 'brk_invalid_input'; end if;
  conditions:=left(coalesce(p_buyer_conditions,''),1000);
  insert into negotiation_private.deal_requests(buyer_id,request_id,listing_id,mode,buyer_conditions,ai_enabled)
    values(p_buyer_id,p_request_id,p_listing_id,p_mode,conditions,p_ai_enabled) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted=0 then
    select * into prior from negotiation_private.deal_requests where buyer_id=p_buyer_id and request_id=p_request_id;
    if prior.listing_id is distinct from p_listing_id or prior.mode is distinct from p_mode or prior.buyer_conditions is distinct from conditions or prior.ai_enabled is distinct from p_ai_enabled then raise exception 'brk_idempotency_conflict'; end if;
    select * into d from public.deals where id=prior.deal_id;
    return d;
  end if;
  select * into l from public.listings where id=p_listing_id for update;
  if not found or l.seller_id=p_buyer_id then raise exception 'brk_listing_unavailable'; end if;
  insert into public.deals(listing_id,buyer_id,seller_id,negotiation_mode,buyer_budget,buyer_conditions,status)
    values(l.id,p_buyer_id,l.seller_id,p_mode::public.negotiation_mode,null,conditions,'negotiating') returning * into d;
  update negotiation_private.deal_requests set deal_id=d.id where buyer_id=p_buyer_id and request_id=p_request_id;
  if p_ai_enabled then
    price_cents:=round(l.price*100)::integer;
    insert into negotiation_private.sessions(deal_id,mode,state,listing_price_cents)
      values(d.id,p_mode,'setup_pending',price_cents);
  end if;
  return d;
end $$;

create function public.fn_neg_start(p_deal_id uuid,p_buyer_id uuid,p_buyer_max_cents integer,p_min_deal_cents integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.deals; l public.listings; s negotiation_private.sessions; floor_cents integer; listing_cents integer;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found or d.buyer_id is distinct from p_buyer_id then raise exception 'brk_forbidden'; end if;
  if d.status<>'negotiating' then raise exception 'brk_neg_not_active'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id for update;
  if not found then raise exception 'brk_neg_not_startable'; end if;
  if s.state='active' and s.buyer_max_cents=p_buyer_max_cents then return jsonb_build_object('ok',true,'mode',s.mode,'idempotent',true); end if;
  if s.state <> 'setup_pending' then raise exception 'brk_neg_not_startable'; end if;
  select * into l from public.listings where id=d.listing_id for update;
  if not found or l.seller_id is distinct from d.seller_id then raise exception 'brk_listing_unavailable'; end if;
  listing_cents:=round(l.price*100)::integer;
  floor_cents:=greatest(coalesce(round(l.floor_price*100)::integer,p_min_deal_cents),p_min_deal_cents);
  if p_min_deal_cents is null or p_min_deal_cents<=0 or p_buyer_max_cents is null or p_buyer_max_cents<p_min_deal_cents or p_buyer_max_cents>100000000 or p_buyer_max_cents>listing_cents then raise exception 'brk_neg_invalid_limit'; end if;
  if floor_cents>listing_cents then raise exception 'brk_neg_invalid_floor'; end if;
  update negotiation_private.sessions set buyer_max_cents=p_buyer_max_cents,seller_floor_cents=floor_cents,
    state='active',next_actor='buyer_agent',expires_at=clock_timestamp()+interval '24 hours',updated_at=clock_timestamp()
    where deal_id=p_deal_id;
  return jsonb_build_object('ok',true,'mode',s.mode);
end $$;

create function public.fn_neg_claim_turn(p_deal_id uuid,p_user_id uuid,p_request_id uuid,p_lease_seconds integer,p_daily_limit integer,p_session_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.deals; s negotiation_private.sessions; t negotiation_private.turns; n integer; tok uuid; day date;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found or p_user_id not in (d.buyer_id,d.seller_id) then raise exception 'brk_forbidden'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id for update;
  if not found then raise exception 'brk_neg_not_started'; end if;
  select * into t from negotiation_private.turns where deal_id=p_deal_id and request_id=p_request_id;
  if found and t.state='complete' then return jsonb_build_object('kind','replay','result',t.result); end if;
  if d.status<>'negotiating' then raise exception 'brk_neg_not_active'; end if;
  if s.state='closed' then return jsonb_build_object('kind','closing'); end if;
  if s.state='active' and s.buyer_max_cents<s.seller_floor_cents then
    update negotiation_private.sessions set state='closed',updated_at=clock_timestamp() where deal_id=p_deal_id;
    return jsonb_build_object('kind','closing');
  end if;
  if s.state='active' and s.expires_at<=clock_timestamp() then
    update negotiation_private.sessions set state='expired',lease_token=null,lease_request_id=null,lease_expires_at=null,updated_at=clock_timestamp() where deal_id=p_deal_id;
    return jsonb_build_object('kind','expired');
  end if;
  if s.state<>'active' then raise exception 'brk_neg_not_active'; end if;
  if s.turn_count>=10 or s.round_no>=5 then return jsonb_build_object('kind','closing'); end if;
  if s.lease_token is not null and s.lease_expires_at>clock_timestamp() then raise exception 'brk_neg_turn_busy'; end if;
  if s.lease_token is not null then
    delete from negotiation_private.turns where deal_id=p_deal_id and lease_token=s.lease_token and state='claimed';
  end if;
  if p_lease_seconds not between 5 and 60 or p_daily_limit not between 1 and 1000 or p_session_limit not between 1 and 100 then raise exception 'brk_neg_config'; end if;
  if s.gemini_calls>=p_session_limit then raise exception 'brk_neg_quota'; end if;
  day:=(clock_timestamp() at time zone 'utc')::date;
  insert into negotiation_private.usage(user_id,usage_day,calls) values(p_user_id,day,1)
    on conflict(user_id,usage_day) do update set calls=negotiation_private.usage.calls+1 returning calls into n;
  if n>p_daily_limit then update negotiation_private.usage set calls=calls-1 where user_id=p_user_id and usage_day=day; raise exception 'brk_neg_quota'; end if;
  tok=gen_random_uuid();
  update negotiation_private.sessions set lease_token=tok,lease_request_id=p_request_id,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),gemini_calls=gemini_calls+1 where deal_id=p_deal_id returning * into s;
  insert into negotiation_private.turns(deal_id,request_id,sequence_no,actor_id,lease_token,state)
    values(p_deal_id,p_request_id,s.turn_count+1,p_user_id,tok,'claimed')
    on conflict(deal_id,request_id) do update set lease_token=excluded.lease_token,state='claimed';
  return jsonb_build_object('kind','turn','lease',tok,'mode',s.mode,'actor',case when s.mode='self_chat' then 'seller_agent' else s.next_actor end,
    'round',s.round_no,'turn_count',s.turn_count,'listing_cents',s.listing_price_cents,'buyer_max_cents',s.buyer_max_cents,
    'seller_floor_cents',s.seller_floor_cents,'buyer_offer_cents',s.last_buyer_offer_cents,'seller_offer_cents',s.last_seller_offer_cents);
end $$;

create function public.fn_neg_release_turn(p_deal_id uuid,p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  update negotiation_private.sessions set lease_token=null,lease_request_id=null,lease_expires_at=null
    where deal_id=p_deal_id and lease_token=p_lease;
  delete from negotiation_private.turns where deal_id=p_deal_id and lease_token=p_lease and state='claimed';
end $$;

create function public.fn_neg_commit_turn(p_deal_id uuid,p_user_id uuid,p_request_id uuid,p_lease uuid,p_buyer_text text,p_buyer_offer_cents integer,p_agent_sender text,p_agent_text text,p_server_offer_cents integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.deals; s negotiation_private.sessions; t negotiation_private.turns; result jsonb; public_text text;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found or p_user_id not in (d.buyer_id,d.seller_id) then raise exception 'brk_forbidden'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id for update;
  if not found then raise exception 'brk_neg_not_started'; end if;
  select * into t from negotiation_private.turns where deal_id=p_deal_id and request_id=p_request_id for update;
  if found and t.state='complete' then return t.result; end if;
  if d.status<>'negotiating' then raise exception 'brk_neg_not_active'; end if;
  if s.state<>'active' or s.lease_token is distinct from p_lease or s.lease_expires_at<=clock_timestamp() or t.lease_token is distinct from p_lease or t.actor_id is distinct from p_user_id then raise exception 'brk_neg_lease_lost'; end if;
  if p_agent_sender is null or p_agent_sender not in ('buyer_agent','seller_agent')
     or p_agent_text is null or length(trim(p_agent_text)) not between 1 and 500
     or p_agent_text ~ '[0-9$€£]' then raise exception 'brk_neg_invalid_output'; end if;
  if s.mode='self_chat' then
    if p_user_id is distinct from d.buyer_id or p_agent_sender<>'seller_agent' or length(trim(coalesce(p_buyer_text,''))) not between 1 and 500 then raise exception 'brk_forbidden'; end if;
    if p_buyer_offer_cents is not null and (p_buyer_offer_cents<=0 or p_buyer_offer_cents>s.buyer_max_cents) then raise exception 'brk_neg_invalid_offer'; end if;
    if p_server_offer_cents is null or p_server_offer_cents<s.seller_floor_cents or p_server_offer_cents>s.listing_price_cents then raise exception 'brk_neg_invalid_offer'; end if;
    insert into public.messages(deal_id,sender,text,is_ai_generated) values(d.id,'buyer',left(trim(p_buyer_text),500),false);
    update negotiation_private.sessions set turn_count=turn_count+1,round_no=round_no+1,
      last_buyer_offer_cents=coalesce(p_buyer_offer_cents,last_buyer_offer_cents),
      last_seller_offer_cents=coalesce(p_server_offer_cents,last_seller_offer_cents) where deal_id=p_deal_id returning * into s;
  else
    if p_buyer_text is not null or p_agent_sender is distinct from s.next_actor then raise exception 'brk_neg_out_of_turn'; end if;
    if p_agent_sender='buyer_agent' then
      if p_server_offer_cents is null or p_server_offer_cents<=0 or p_server_offer_cents>s.buyer_max_cents then raise exception 'brk_neg_invalid_offer'; end if;
      update negotiation_private.sessions set last_buyer_offer_cents=p_server_offer_cents,next_actor='seller_agent',turn_count=turn_count+1 where deal_id=p_deal_id returning * into s;
    else
      if p_server_offer_cents is null or p_server_offer_cents<s.seller_floor_cents or p_server_offer_cents>s.listing_price_cents then raise exception 'brk_neg_invalid_offer'; end if;
      update negotiation_private.sessions set last_seller_offer_cents=p_server_offer_cents,next_actor='buyer_agent',turn_count=turn_count+1,
        round_no=round_no+1 where deal_id=p_deal_id returning * into s;
    end if;
  end if;
  public_text:=trim(p_agent_text)||' Offer: $'||(p_server_offer_cents/100)::text||'.'||lpad((p_server_offer_cents%100)::text,2,'0');
  insert into public.messages(deal_id,sender,text,is_ai_generated) values(d.id,p_agent_sender,public_text,true);
  update negotiation_private.sessions set lease_token=null,lease_request_id=null,lease_expires_at=null where deal_id=p_deal_id;
  result:=jsonb_build_object('ok',true,'round',s.round_no,'turnCount',s.turn_count,'status',s.state);
  update negotiation_private.turns set state='complete',result=result where deal_id=p_deal_id and request_id=p_request_id;
  return result;
end $$;

create function public.fn_neg_finish(p_deal_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.deals; s negotiation_private.sessions;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found or p_user_id not in (d.buyer_id,d.seller_id) then raise exception 'brk_forbidden'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id for update;
  if not found then raise exception 'brk_neg_not_started'; end if;
  if s.state='closed' then return jsonb_build_object('ok',true,'status','closed','round',s.round_no,'proposalPriceCents',null); end if;
  if s.state<>'active' or s.round_no<5 or s.lease_token is not null then raise exception 'brk_neg_not_ready'; end if;
  update negotiation_private.sessions set state='closed',updated_at=clock_timestamp() where deal_id=p_deal_id;
  return jsonb_build_object('ok',true,'status','closed','round',5,'proposalPriceCents',null);
end $$;

-- Approval bridge: only authenticated seller route can invoke the service-role RPC;
-- terms hash is created by the canonical legacy helper, then seller acceptance is bound to it.
create function public.fn_neg_seller_propose(p_deal_id uuid,p_seller_id uuid,p_price_cents integer,p_return_window_hours numeric,p_fulfillment_type text,p_delivery_expectations text,p_transaction_conditions text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.deals; s negotiation_private.sessions; a public.deal_agreements; l public.listings; result jsonb;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found or d.seller_id is distinct from p_seller_id then raise exception 'brk_forbidden'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id for update;
  if not found or s.state not in ('active','closed','approved','expired') then raise exception 'brk_neg_approval_required'; end if;
  if s.lease_token is not null and s.lease_expires_at>clock_timestamp() then raise exception 'brk_neg_turn_busy'; end if;
  if p_price_cents is null or p_price_cents<s.seller_floor_cents or p_price_cents>coalesce(s.buyer_max_cents,s.listing_price_cents) then raise exception 'brk_neg_invalid_offer'; end if;
  if s.state='approved' then
    select * into l from public.listings where id=d.listing_id for update;
    select * into a from public.deal_agreements where deal_id=p_deal_id for update;
    if a.terms->>'price_cents'=p_price_cents::text
       and a.terms->>'return_window_hours'=p_return_window_hours::text
       and a.terms->>'fulfillment_type'=p_fulfillment_type
       and a.terms->>'delivery_expectations'=trim(p_delivery_expectations)
       and a.terms->>'transaction_conditions'=trim(coalesce(p_transaction_conditions,''))
       and a.terms->>'buyer_conditions'=coalesce(d.buyer_conditions,'')
       and a.terms->>'listing_id'=l.id::text and a.terms->>'title'=l.title
       and a.terms->>'description'=l.description
       and a.terms->'conditions'=coalesce(d.terms_json->'conditions','{}'::jsonb) then
      return jsonb_build_object('version',a.version,'terms_hash',a.terms_hash,'terms',a.terms);
    end if;
  end if;
  result:=negotiation_private._fn_propose_terms_legacy(p_deal_id,p_seller_id,p_price_cents,p_return_window_hours,p_fulfillment_type,p_delivery_expectations,p_transaction_conditions);
  select * into a from public.deal_agreements where deal_id=p_deal_id for update;
  perform negotiation_private._fn_accept_terms_legacy(p_deal_id,p_seller_id);
  update negotiation_private.sessions set state='approved',approved_terms_hash=a.terms_hash,updated_at=clock_timestamp() where deal_id=p_deal_id;
  return result;
end $$;

create function public.fn_propose_terms(p_deal_id uuid,p_seller_id uuid,p_price_cents integer,p_return_window_hours numeric,p_fulfillment_type text,p_delivery_expectations text,p_transaction_conditions text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from negotiation_private.sessions where deal_id=p_deal_id) then raise exception 'brk_neg_approval_required'; end if;
  return negotiation_private._fn_propose_terms_legacy(p_deal_id,p_seller_id,p_price_cents,p_return_window_hours,p_fulfillment_type,p_delivery_expectations,p_transaction_conditions);
end $$;

create function public.fn_accept_terms(p_deal_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.deals; s negotiation_private.sessions; a public.deal_agreements;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id for update;
  if found then
    select * into a from public.deal_agreements where deal_id=p_deal_id for update;
    if p_user_id is distinct from d.buyer_id or s.state<>'approved' or s.approved_terms_hash is distinct from a.terms_hash
       or a.seller_accepted_hash is distinct from a.terms_hash or a.seller_accepted_at is null then raise exception 'brk_neg_seller_approval_required'; end if;
    return negotiation_private._fn_accept_terms_legacy(p_deal_id,p_user_id);
  end if;
  return negotiation_private._fn_accept_terms_legacy(p_deal_id,p_user_id);
end $$;

create function public.fn_issue_invoice(p_deal_id uuid,p_seller_id uuid,p_price_cents integer,p_fee_cents integer,p_expiry_hours integer,p_invoice_data jsonb)
returns public.invoices language plpgsql security definer set search_path='' as $$
declare d public.deals; s negotiation_private.sessions; a public.deal_agreements;
begin
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'brk_not_found'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id for update;
  if found then
    select * into a from public.deal_agreements where deal_id=p_deal_id for update;
    if s.state not in ('approved','accepted') or s.approved_terms_hash is distinct from a.terms_hash
       or a.buyer_accepted_hash is distinct from a.terms_hash or a.buyer_accepted_at is null
       or a.seller_accepted_hash is distinct from a.terms_hash or a.seller_accepted_at is null then raise exception 'brk_neg_acceptance_required'; end if;
  end if;
  return negotiation_private._fn_issue_invoice_legacy(p_deal_id,p_seller_id,p_price_cents,p_fee_cents,p_expiry_hours,p_invoice_data);
end $$;

-- No direct application/client reads of private state. Expose only a compact safe DTO via RPC.
create function public.fn_neg_public_state(p_deal_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.deals; s negotiation_private.sessions;
begin
  select * into d from public.deals where id=p_deal_id;
  if not found or p_user_id not in (d.buyer_id,d.seller_id) then raise exception 'brk_forbidden'; end if;
  select * into s from negotiation_private.sessions where deal_id=p_deal_id;
  if not found then return null; end if;
  return jsonb_build_object('mode',s.mode,'status',case when d.status='cancelled' then 'cancelled' else s.state end,'round',s.round_no,'maxRounds',5,
    'nextActor',case when s.state='active' then s.next_actor else null end);
end $$;

revoke all on function public.fn_create_negotiated_deal(uuid,uuid,text,text,uuid,boolean),
 public.fn_neg_start(uuid,uuid,integer,integer), public.fn_neg_claim_turn(uuid,uuid,uuid,integer,integer,integer),
 public.fn_neg_release_turn(uuid,uuid), public.fn_neg_commit_turn(uuid,uuid,uuid,uuid,text,integer,text,text,integer),
 public.fn_neg_finish(uuid,uuid), public.fn_neg_seller_propose(uuid,uuid,integer,numeric,text,text,text),
 public.fn_neg_public_state(uuid,uuid), public.fn_propose_terms(uuid,uuid,integer,numeric,text,text,text),
 public.fn_accept_terms(uuid,uuid), public.fn_issue_invoice(uuid,uuid,integer,integer,integer,jsonb)
 from public,anon,authenticated;
grant execute on function public.fn_create_negotiated_deal(uuid,uuid,text,text,uuid,boolean),
 public.fn_neg_start(uuid,uuid,integer,integer), public.fn_neg_claim_turn(uuid,uuid,uuid,integer,integer,integer),
 public.fn_neg_release_turn(uuid,uuid), public.fn_neg_commit_turn(uuid,uuid,uuid,uuid,text,integer,text,text,integer),
 public.fn_neg_finish(uuid,uuid), public.fn_neg_seller_propose(uuid,uuid,integer,numeric,text,text,text),
 public.fn_neg_public_state(uuid,uuid), public.fn_propose_terms(uuid,uuid,integer,numeric,text,text,text),
 public.fn_accept_terms(uuid,uuid), public.fn_issue_invoice(uuid,uuid,integer,integer,integer,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
