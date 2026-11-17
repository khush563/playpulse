-- Optional development-only two-minute window for the existing simulated fixture.
-- No memberships are deleted or changed. Normal scheduling remains unchanged.
begin;
alter table public.playpulse_match_pools drop constraint if exists playpulse_match_pools_check;
alter table public.playpulse_match_pools drop constraint if exists playpulse_match_pools_check1;
alter table public.playpulse_match_pools drop constraint if exists playpulse_pool_opening_policy;
alter table public.playpulse_match_pools drop constraint if exists playpulse_pool_duration_policy;
alter table public.playpulse_match_pools add constraint playpulse_pool_opening_policy check (
  opens_at = kickoff_at - interval '4 hours'
  or (match_id = 'arsenal-chelsea-local-demo' and closes_at = opens_at + interval '2 minutes')
);
alter table public.playpulse_match_pools add constraint playpulse_pool_duration_policy check (
  (closes_at >= opens_at + interval '1 hour' and closes_at <= opens_at + interval '2 hours')
  or (match_id = 'arsenal-chelsea-local-demo' and closes_at = opens_at + interval '2 minutes')
);
-- Existing closes_at < kickoff_at, RLS, admin checks and join validation stay in force.
commit;
