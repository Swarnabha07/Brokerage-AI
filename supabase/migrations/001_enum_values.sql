-- 001: new deal states. RUN THIS FILE ON ITS OWN (ALTER TYPE ... ADD VALUE cannot be used in the
-- same transaction as statements that use the new values). Safe to re-run.
alter type public.deal_status add value if not exists 'cancelled';
alter type public.deal_status add value if not exists 'refunded';
