-- 005: append-only audit trail, webhook dedupe, disputes. Server-only. Safe to re-run.
create table if not exists public.deal_events (
  id bigint generated always as identity primary key,
  deal_id uuid not null references public.deals(id),
  actor_id uuid,
  actor_role text not null check (actor_role in ('buyer','seller','system','admin')),
  type text not null,
  from_status text,
  to_status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists deal_events_deal_idx on public.deal_events (deal_id, id);
create or replace function public.trg_append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
drop trigger if exists deal_events_append_only on public.deal_events;
create trigger deal_events_append_only before update or delete on public.deal_events for each row execute function public.trg_append_only();

create table if not exists public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paypal',
  event_id text not null,
  event_type text not null,
  resource_id text,
  verified boolean not null default false,
  payload jsonb,
  outcome text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id),
  opened_by uuid not null references public.users(id),
  reason text not null check (reason in ('not_received','not_as_described','damaged','other')),
  details text check (details is null or length(details) <= 2000),
  prior_status text not null,
  status text not null default 'open' check (status in ('open','resolved_release','resolved_refund','withdrawn')),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  resolved_by uuid references public.users(id),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists disputes_one_open_per_deal on public.disputes (deal_id) where status = 'open';

alter table public.deal_events enable row level security;
alter table public.provider_events enable row level security;
alter table public.disputes enable row level security;
revoke all on public.deal_events, public.provider_events, public.disputes from public, anon, authenticated;
grant all on public.deal_events, public.provider_events, public.disputes to service_role;
