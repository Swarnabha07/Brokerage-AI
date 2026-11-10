-- 003: provider payment records. Server-only (service role); no client access. Safe to re-run.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id),
  invoice_id uuid not null references public.invoices(id),
  provider text not null default 'paypal',
  provider_order_id text unique,
  provider_capture_id text unique,
  status text not null check (status in ('created','order_created','approved','capture_pending','captured','failed','voided','refund_pending','refunded')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  request_id text not null unique,
  payer_ref_hash text,
  paypal_fee_cents integer,
  net_cents integer,
  provider_status text,
  provider_summary jsonb,
  provider_refund_id text unique,
  refunded_cents integer,
  failed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  captured_at timestamptz
);
-- One active payment per invoice: duplicate clicks cannot create two payable orders.
create unique index if not exists payments_one_active_per_invoice on public.payments (invoice_id)
  where status in ('created','order_created','approved','capture_pending','captured','refund_pending');
create index if not exists payments_deal_id_idx on public.payments (deal_id);

create or replace function public.trg_payments_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'payments are append-only' using errcode = '42501'; end if;
  if new.deal_id is distinct from old.deal_id or new.invoice_id is distinct from old.invoice_id
     or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
     or new.request_id is distinct from old.request_id then
    raise exception 'payment identity/amount fields are immutable' using errcode = '42501';
  end if;
  if old.status in ('captured','refund_pending','refunded') and new.status in ('created','order_created','approved','failed','voided') then
    raise exception 'captured payment cannot move back to %', new.status using errcode = '42501';
  end if;
  if old.status = 'refunded' and new.status <> 'refunded' then raise exception 'refunded is final' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists payments_guard on public.payments;
create trigger payments_guard before update or delete on public.payments for each row execute function public.trg_payments_guard();

alter table public.payments enable row level security;
revoke all on public.payments from public, anon, authenticated;
grant all on public.payments to service_role;
