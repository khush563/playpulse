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

-- Run migration 202611170002 first. These are explicit IST test times.
-- If this window has passed, replace BOTH timestamps with your next test slot.
begin;
do $$
declare
  opening timestamptz := '2026-11-17 23:48:00+05:30';
  closing timestamptz := '2026-11-17 23:50:00+05:30';
begin
  perform pg_advisory_xact_lock(hashtextextended('arsenal-chelsea-local-demo', 0));
  if closing <= clock_timestamp() then
    raise exception 'This test slot has passed. Choose new opening and closing times before running again.';
  end if;
  if exists(select 1 from public.playpulse_pool_memberships where match_id = 'arsenal-chelsea-local-demo') then
    raise exception 'Fans have already joined. Their pool is locked; no memberships were changed.';
  end if;
  insert into public.playpulse_match_pools(match_id, kickoff_at, opens_at, closes_at)
  values ('arsenal-chelsea-local-demo', closing + interval '2 hours', opening, closing)
  on conflict(match_id) do update set kickoff_at = excluded.kickoff_at,
    opens_at = excluded.opens_at, closes_at = excluded.closes_at,
    cancelled = false, updated_at = clock_timestamp();
end;
$$;
commit;
select public.playpulse_pool('arsenal-chelsea-local-demo');
