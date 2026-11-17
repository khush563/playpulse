-- Isolated database checks. All fixture records roll back; no email is sent.
begin;
insert into auth.users(id, email, email_confirmed_at)
values ('aaaaaaaa-1111-4111-8111-111111111111', 'pool-owner-test@example.invalid', now()),
       ('bbbbbbbb-2222-4222-8222-222222222222', 'pool-fan-test@example.invalid', now()),
       ('cccccccc-3333-4333-8333-333333333333', 'pool-other-test@example.invalid', now());
insert into public.playpulse_staff(user_id, role) values ('aaaaaaaa-1111-4111-8111-111111111111', 'admin');

-- This fixture ID is separate from the app's pool. It has the same constraints.
insert into public.playpulse_match_pools(match_id, kickoff_at, opens_at, closes_at)
values ('pool-database-transaction-test', now() + interval '3 hours', now() - interval '1 hour', now() + interval '1 hour');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
do $$
declare original jsonb; repeated jsonb; seen jsonb;
begin
  if public.playpulse_my_role() <> 'fan' then raise exception 'Default account role is not fan'; end if;
  original := public.playpulse_join_pool('pool-database-transaction-test', 'Arsenal');
  repeated := public.playpulse_join_pool('pool-database-transaction-test', 'Arsenal');
  if original->'membership' <> repeated->'membership' or repeated->>'duplicate' <> 'true' then raise exception 'Membership retries changed the record'; end if;
  if (repeated->>'total_members')::integer <> 1 then raise exception 'Duplicate membership counted twice'; end if;
  begin
    perform public.playpulse_join_pool('pool-database-transaction-test', 'Chelsea');
    raise exception 'Team switching was allowed';
  exception when check_violation then null;
  end;
  begin
    perform public.playpulse_schedule_pool('arsenal-chelsea-local-demo', now() + interval '4 hours', 120);
    raise exception 'Fan scheduling was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.playpulse_pool_memberships(match_id, user_id, team)
    values ('pool-database-transaction-test', 'cccccccc-3333-4333-8333-333333333333', 'Chelsea');
    raise exception 'Direct membership writes were allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- A closed pool rejects a new account; the original member can still recover it.
update public.playpulse_match_pools set kickoff_at = now() + interval '1 hour', opens_at = now() - interval '3 hours', closes_at = now() - interval '1 hour'
where match_id = 'pool-database-transaction-test';
select set_config('request.jwt.claims', '{"sub":"cccccccc-3333-4333-8333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$
declare result jsonb;
begin
  result := public.playpulse_pool('pool-database-transaction-test');
  if result->'membership' <> 'null'::jsonb then raise exception 'Another fan can read membership details'; end if;
  begin
    perform public.playpulse_join_pool('pool-database-transaction-test', 'Chelsea');
    raise exception 'Late registration was allowed';
  exception when check_violation then null;
  end;
end;
$$;
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public.playpulse_join_pool('pool-database-transaction-test', 'Arsenal')->>'duplicate' as retry_after_close;

-- Public discovery exposes counts, never an account's membership or write access.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare result jsonb;
begin
  result := public.playpulse_pool('pool-database-transaction-test');
  if result->'membership' <> 'null'::jsonb or (result->>'total_members')::integer <> 1 then raise exception 'Public pool projection is incorrect'; end if;
  begin
    perform public.playpulse_join_pool('pool-database-transaction-test', 'Arsenal');
    raise exception 'Guest registration was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
select 'All pool database checks passed; test records rolled back.' as result;
