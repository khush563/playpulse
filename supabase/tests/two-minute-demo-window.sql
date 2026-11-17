-- Run after migration 202611170002. Uses a temporary table; real pools are untouched.
begin;
create temporary table pool_window_check
  (like public.playpulse_match_pools including defaults including constraints) on commit drop;
do $$
begin
  insert into pool_window_check(match_id, kickoff_at, opens_at, closes_at)
  values ('arsenal-chelsea-local-demo', '2030-01-02 02:00Z', '2030-01-01 23:48Z', '2030-01-01 23:50Z');
  insert into pool_window_check(match_id, kickoff_at, opens_at, closes_at)
  values ('normal-fixture', '2030-01-02 04:00Z', '2030-01-02 00:00Z', '2030-01-02 02:00Z');
  begin
    insert into pool_window_check(match_id, kickoff_at, opens_at, closes_at)
    values ('other-fixture', '2030-01-02 02:00Z', '2030-01-01 23:48Z', '2030-01-01 23:50Z');
    raise exception 'Another fixture accepted the two-minute exception';
  exception when check_violation then null;
  end;
  begin
    insert into pool_window_check(match_id, kickoff_at, opens_at, closes_at)
    values ('arsenal-chelsea-local-demo', '2030-01-02 02:00Z', '2030-01-01 23:48Z', '2030-01-01 23:51Z');
    raise exception 'An unsupported three-minute window was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into pool_window_check(match_id, kickoff_at, opens_at, closes_at)
    values ('arsenal-chelsea-local-demo', '2030-01-01 23:49Z', '2030-01-01 23:48Z', '2030-01-01 23:50Z');
    raise exception 'Registration after kickoff was accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
select 'Two-minute demo and normal window constraints passed; real pools untouched.' as result;
