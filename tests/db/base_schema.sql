-- TEST BOOTSTRAP ONLY: mimics the pre-existing Supabase schema (types/database.types.ts) so the
-- migrations can be exercised on plain Postgres. Never run this on a real project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create extension if not exists pgcrypto;
create type public.deal_status as enum ('negotiating','agreed','invoiced','paid','shipped','return_window','released','disputed');
create type public.message_sender as enum ('buyer','seller','buyer_agent','seller_agent');
create type public.negotiation_mode as enum ('self_chat','ai_negotiate');
create type public.user_role as enum ('buyer','seller');
create table public.users (id uuid primary key, email text, role public.user_role not null, created_at timestamptz default now());
create table public.listings (id uuid primary key default gen_random_uuid(), seller_id uuid references public.users(id), title text not null, description text, price numeric not null, floor_price numeric, created_at timestamptz default now());
create table public.deals (id uuid primary key default gen_random_uuid(), listing_id uuid references public.listings(id), buyer_id uuid references public.users(id), seller_id uuid references public.users(id), status public.deal_status default 'negotiating', agreed_price numeric, platform_fee numeric, buyer_budget numeric, buyer_conditions text, negotiation_mode public.negotiation_mode, terms_json jsonb, tracking_number text, created_at timestamptz default now());
create table public.invoices (id uuid primary key default gen_random_uuid(), deal_id uuid references public.deals(id), invoice_data jsonb, paypal_invoice_id text, status text, created_at timestamptz default now());
create table public.payouts (id uuid primary key default gen_random_uuid(), deal_id uuid references public.deals(id), amount numeric not null, platform_fee numeric not null, status text, paypal_payout_batch_id text, released_at timestamptz);
create table public.messages (id uuid primary key default gen_random_uuid(), deal_id uuid references public.deals(id), sender public.message_sender not null, text text not null, is_ai_generated boolean, created_at timestamptz default now());
create unique index payouts_deal_id_key on public.payouts(deal_id);
alter table public.deals enable row level security; alter table public.invoices enable row level security; alter table public.payouts enable row level security;
-- Supabase default privileges hand new public tables to these roles; replicate that worst case.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant select on public.deals, public.invoices, public.payouts to authenticated;
grant all on all tables in schema public to service_role;
