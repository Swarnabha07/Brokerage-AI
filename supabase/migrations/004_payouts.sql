-- 004: seller payout profile, per-deal destination snapshot, payout lifecycle columns. Safe to re-run.
create table if not exists public.seller_payout_profiles (
  user_id uuid primary key references public.users(id),
  paypal_email text not null check (paypal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(paypal_email) <= 254),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deal_payout_destinations (
  deal_id uuid primary key references public.deals(id),
  seller_id uuid not null references public.users(id),
  provider text not null default 'paypal',
  destination text not null,
  destination_hash text not null,
  created_at timestamptz not null default now()
);
-- The snapshot is write-once. It may only be rewritten by fn_issue_invoice while the deal is still
-- 'agreed' (nothing can have been paid yet), via a transaction-local switch.
create or replace function public.trg_destinations_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('brk.allow_destination_rewrite', true), 'off') <> 'on' then
    raise exception 'payout destination snapshot is immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists destinations_guard on public.deal_payout_destinations;
create trigger destinations_guard before update or delete on public.deal_payout_destinations for each row execute function public.trg_destinations_guard();

update public.payouts set status = 'legacy_ledger' where status is null or status = 'released';
alter table public.payouts
  add column if not exists amount_cents integer,
  add column if not exists fee_cents integer,
  add column if not exists payout_fee_cents integer,
  add column if not exists provider_item_id text,
  add column if not exists sender_batch_id text,
  add column if not exists request_id text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists submitted_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payouts_status_chk') then
    alter table public.payouts add constraint payouts_status_chk
      check (status in ('legacy_ledger','eligible','submitting','pending','succeeded','failed','ambiguous','manual_review'));
  end if;
end $$;
create unique index if not exists payouts_sender_batch_id_key on public.payouts (sender_batch_id);

create or replace function public.trg_payouts_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'payouts are append-only' using errcode = '42501'; end if;
  if old.status = 'succeeded' and new.status is distinct from 'succeeded' then
    raise exception 'a succeeded payout is final' using errcode = '42501';
  end if;
  if old.amount_cents is not null and new.amount_cents is distinct from old.amount_cents then
    raise exception 'payout amount is immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists payouts_guard on public.payouts;
create trigger payouts_guard before update or delete on public.payouts for each row execute function public.trg_payouts_guard();

alter table public.seller_payout_profiles enable row level security;
alter table public.deal_payout_destinations enable row level security;
revoke all on public.seller_payout_profiles, public.deal_payout_destinations from public, anon, authenticated;
grant all on public.seller_payout_profiles, public.deal_payout_destinations to service_role;

-- Members may read only the non-sensitive payout columns (no request IDs, errors or provider IDs).
revoke select on public.payouts from authenticated;
grant select (id, deal_id, amount, platform_fee, amount_cents, fee_cents, payout_fee_cents, status, released_at, completed_at)
  on public.payouts to authenticated;
