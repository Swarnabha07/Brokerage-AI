-- 002: deal lifecycle columns, admin flag, immutable server-backed invoices. Safe to re-run.
alter table public.users add column if not exists is_admin boolean not null default false;

alter table public.deals
  add column if not exists shipped_at timestamptz,
  add column if not exists return_window_started_at timestamptz,
  add column if not exists return_window_ends_at timestamptz,
  add column if not exists delivery_confirmed_at timestamptz,
  add column if not exists delivery_confirmed_by text,
  add column if not exists delivery_note text,
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deals_delivery_confirmed_by_chk') then
    alter table public.deals add constraint deals_delivery_confirmed_by_chk
      check (delivery_confirmed_by is null or delivery_confirmed_by in ('buyer','admin'));
  end if;
end $$;

-- Backfill from the old terms_json location (legacy demo windows were 60 seconds).
update public.deals set return_window_started_at = (terms_json->>'return_window_started_at')::timestamptz
  where return_window_started_at is null and terms_json ? 'return_window_started_at';
update public.deals set return_window_ends_at = return_window_started_at + interval '60 seconds'
  where return_window_ends_at is null and return_window_started_at is not null;
update public.deals set delivery_confirmed_at = return_window_started_at, delivery_confirmed_by = 'buyer'
  where delivery_confirmed_at is null and return_window_started_at is not null;

alter table public.invoices
  add column if not exists invoice_number text,
  add column if not exists currency text not null default 'USD',
  add column if not exists price_cents integer,
  add column if not exists fee_cents integer,
  add column if not exists total_cents integer,
  add column if not exists expires_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_status_chk') then
    alter table public.invoices add constraint invoices_status_chk
      check (status in ('open','paid','expired','void')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_total_chk') then
    alter table public.invoices add constraint invoices_total_chk
      check (total_cents is null or (price_cents > 0 and fee_cents >= 0 and total_cents = price_cents + fee_cents));
  end if;
end $$;

create sequence if not exists public.invoice_number_seq;
create unique index if not exists invoices_invoice_number_key on public.invoices (invoice_number);
-- At most one live (open or paid) invoice per deal: no accidental second payable invoice.
create unique index if not exists invoices_one_live_per_deal on public.invoices (deal_id) where status in ('open','paid');

create or replace function public.trg_invoices_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'invoices are append-only' using errcode = '42501'; end if;
  if new.deal_id is distinct from old.deal_id or new.invoice_number is distinct from old.invoice_number
     or new.price_cents is distinct from old.price_cents or new.fee_cents is distinct from old.fee_cents
     or new.total_cents is distinct from old.total_cents or new.currency is distinct from old.currency
     or new.invoice_data is distinct from old.invoice_data or new.expires_at is distinct from old.expires_at then
    raise exception 'invoice financial fields are immutable' using errcode = '42501';
  end if;
  if old.status in ('paid','void','expired') and new.status is distinct from old.status then
    raise exception 'invoice status % is final', old.status using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard before update or delete on public.invoices for each row execute function public.trg_invoices_guard();
