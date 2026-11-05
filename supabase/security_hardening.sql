-- =============================================================================
-- Brokerage-AI security hardening migration   (REVIEW BEFORE RUNNING)
-- Not executed by the app, by CI, or by Claude. Owner of the Supabase project
-- (project ref trmmwetqswsnyraciigb) must approve and run it in the SQL editor.
--
-- Safe to re-run: every statement is idempotent. Runs in one transaction; any
-- failure rolls everything back.
--
-- PRE-FLIGHT (run these first, read-only):
--   select pg_get_functiondef('public.handle_new_user'::regproc);   -- section 6 replaces it;
--                                                                   -- confirm it does nothing else
--   select deal_id, count(*) from public.payouts group by 1 having count(*) > 1;  -- must be 0 rows
--   select version();                                               -- security_invoker views need PG15+
--
-- DESIGN
--   * The Next.js server uses the service-role key (bypasses RLS) AFTER its own auth +
--     membership checks. These policies protect against direct anon-key access from a browser.
--   * Browser reads that exist today: Navbar -> own users row; DealWorkspace -> Realtime on
--     deals/messages. Everything else is server-side. No client write path exists.
--   * listings.floor_price is private: anon/authenticated get COLUMN-level SELECT on the public
--     columns only (so `select *` on listings fails closed), and a security_invoker view exposes
--     the same columns. No owner-bypass ("security definer") view is used.
--   * Verified assumptions only: no FK is assumed beyond those in the 2026 audit
--     (deals->users x2, deals->listings, listings->users, invoices/messages/payouts->deals).
-- =============================================================================

begin;

-- 1) Payout idempotency backstop: at most one payout per (non-null) deal.
--    NULL deal_ids stay allowed (unique indexes ignore NULLs). Fails loudly if duplicates exist.
do $$
begin
  if exists (select 1 from public.payouts where deal_id is not null group by deal_id having count(*) > 1) then
    raise exception 'Duplicate payouts exist for a deal_id; resolve them before applying this migration';
  end if;
end $$;
create unique index if not exists payouts_deal_id_key on public.payouts (deal_id);

-- 2) Supporting indexes for the membership policies (cheap, idempotent).
create index if not exists deals_buyer_id_idx   on public.deals (buyer_id);
create index if not exists deals_seller_id_idx  on public.deals (seller_id);
create index if not exists messages_deal_id_idx on public.messages (deal_id);
create index if not exists invoices_deal_id_idx on public.invoices (deal_id);

-- 3) Row Level Security on ALL seven public tables (buyer_profiles included).
alter table public.users          enable row level security;
alter table public.buyer_profiles enable row level security;
alter table public.listings       enable row level security;
alter table public.deals          enable row level security;
alter table public.messages       enable row level security;
alter table public.invoices       enable row level security;
alter table public.payouts        enable row level security;

-- 4) Privileges. Start from zero for the browser-facing roles, then grant only what is used.
--    service_role keeps full access (it also bypasses RLS).
revoke all on public.users, public.buyer_profiles, public.listings, public.deals,
              public.messages, public.invoices, public.payouts
  from anon, authenticated;

grant select on public.users, public.deals, public.messages, public.invoices, public.payouts to authenticated;
-- buyer_profiles: no browser access at all (contains email + budget). Server only.

-- listings: public columns only. floor_price is deliberately NOT granted.
grant select (id, seller_id, title, description, price, created_at) on public.listings to anon, authenticated;

grant all on public.users, public.buyer_profiles, public.listings, public.deals,
             public.messages, public.invoices, public.payouts
  to service_role;

-- 5) Policies. No INSERT/UPDATE/DELETE policies exist on purpose: all writes go through the server.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users for select to authenticated
  using (auth.uid() = id);

drop policy if exists listings_public_select on public.listings;
create policy listings_public_select on public.listings for select to anon, authenticated
  using (true);   -- row visibility only; the column grant above is what hides floor_price

drop policy if exists deals_member_select on public.deals;
create policy deals_member_select on public.deals for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

drop policy if exists messages_member_select on public.messages;
create policy messages_member_select on public.messages for select to authenticated
  using (exists (select 1 from public.deals d
                 where d.id = messages.deal_id and (d.buyer_id = auth.uid() or d.seller_id = auth.uid())));

drop policy if exists invoices_member_select on public.invoices;
create policy invoices_member_select on public.invoices for select to authenticated
  using (exists (select 1 from public.deals d
                 where d.id = invoices.deal_id and (d.buyer_id = auth.uid() or d.seller_id = auth.uid())));

drop policy if exists payouts_member_select on public.payouts;
create policy payouts_member_select on public.payouts for select to authenticated
  using (exists (select 1 from public.deals d
                 where d.id = payouts.deal_id and (d.buyer_id = auth.uid() or d.seller_id = auth.uid())));

-- 6) Public listing view WITHOUT floor_price. security_invoker = true => it runs with the CALLER's
--    privileges and RLS, so it can never expose more than the column grant in section 4 allows.
create or replace view public.listings_public
  with (security_invoker = true) as
  select id, seller_id, title, description, price, created_at from public.listings;
revoke all on public.listings_public from public, anon, authenticated;
grant select on public.listings_public to anon, authenticated;

-- 7) Signup trigger function: SECURITY DEFINER with a pinned, empty search_path and schema-qualified
--    references. The role comes from the signup request's `signup_role` metadata ONLY at the moment
--    the row is created (default buyer; anything other than 'seller' is buyer). After creation,
--    public.users.role is the sole authority and clients have no write access to it. The app
--    (lib/auth/server.ts ensureUserProfile) additionally corrects a default row inside the
--    first-registration window, which covers Google OAuth where no metadata can be supplied.
--    The existing trigger on auth.users (on_auth_user_created) keeps pointing at this function.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, role)
  values (
    new.id,
    new.email,
    case when new.raw_user_meta_data ->> 'signup_role' = 'seller'
         then 'seller'::public.user_role
         else 'buyer'::public.user_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 8) Realtime: deals and messages must be in the publication; subscribers only receive rows their
--    RLS SELECT policy allows (sections 4-5).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deals') then
    alter publication supabase_realtime add table public.deals;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

commit;

-- =============================================================================
-- POST-RUN VERIFICATION (read-only; run after commit)
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;      -- all 7 = true
--   select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime'; -- deals, messages
--   select has_column_privilege('anon', 'public.listings', 'floor_price', 'select');  -- false
--   select has_table_privilege('authenticated', 'public.deals', 'update');            -- false
--   select pg_get_functiondef('public.handle_new_user'::regproc);                     -- search_path=''
--   -- Then, with the anon key: GET /rest/v1/listings?select=*          -> permission denied (expected)
--   --                          GET /rest/v1/listings_public?select=*   -> rows, no floor_price
--   --                          GET /rest/v1/deals                      -> []
-- ROLLBACK NOTES: disable RLS per table and re-grant privileges only if the app breaks;
--   the unique index and publication entries are safe to keep.
-- =============================================================================
