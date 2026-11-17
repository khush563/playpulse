-- Run once in this project's SQL editor. No passwords or API secrets belong here.
begin;

create table if not exists public.playpulse_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin'))
);
alter table public.playpulse_staff enable row level security;
revoke all on public.playpulse_staff from public, anon, authenticated;

create table if not exists public.playpulse_match_pools (
  match_id text primary key,
  kickoff_at timestamptz not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  cancelled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (opens_at = kickoff_at - interval '4 hours'),
  check (closes_at >= opens_at + interval '1 hour' and closes_at <= opens_at + interval '2 hours'),
  check (closes_at < kickoff_at)
);
alter table public.playpulse_match_pools enable row level security;
revoke all on public.playpulse_match_pools from public, anon, authenticated;

create table if not exists public.playpulse_pool_memberships (
  match_id text not null references public.playpulse_match_pools(match_id),
  user_id uuid not null references auth.users(id) on delete cascade,
  team text not null check (team in ('Arsenal', 'Chelsea')),
  joined_at timestamptz not null default clock_timestamp(),
  primary key (match_id, user_id)
);
create index if not exists playpulse_pool_memberships_user on public.playpulse_pool_memberships(user_id);
alter table public.playpulse_pool_memberships enable row level security;
revoke all on public.playpulse_pool_memberships from public, anon, authenticated;
-- Mutations are only through the constrained functions below, never direct table writes.

create or replace function public.playpulse_my_role()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select role from public.playpulse_staff where user_id = auth.uid()), 'fan');
$$;

create or replace function public.playpulse_pool(p_match_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'server_now', floor(extract(epoch from statement_timestamp()) * 1000),
    'pool', (select to_jsonb(p) from public.playpulse_match_pools p where p.match_id = p_match_id),
    'membership', (select jsonb_build_object('match_id', m.match_id, 'team', m.team, 'joined_at', m.joined_at)
                   from public.playpulse_pool_memberships m where m.match_id = p_match_id and m.user_id = auth.uid()),
    'total_members', (select count(*) from public.playpulse_pool_memberships where match_id = p_match_id),
    'team_counts', jsonb_build_object(
       'Arsenal', (select count(*) from public.playpulse_pool_memberships where match_id = p_match_id and team = 'Arsenal'),
       'Chelsea', (select count(*) from public.playpulse_pool_memberships where match_id = p_match_id and team = 'Chelsea'))
  );
$$;

create or replace function public.playpulse_schedule_pool(p_match_id text, p_kickoff_at timestamptz, p_registration_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.playpulse_my_role() <> 'admin' then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_match_id <> 'arsenal-chelsea-local-demo' or p_kickoff_at is null or p_kickoff_at <= clock_timestamp()
     or p_registration_minutes is null or p_registration_minutes < 60 or p_registration_minutes > 120 then
    raise exception 'Choose the demo fixture, a future kickoff and a 60–120 minute registration window.' using errcode = '22023';
  end if;
  -- Serialize scheduling and joining on the same match, including its first insert.
  perform pg_advisory_xact_lock(hashtextextended(p_match_id, 0));
  if exists(select 1 from public.playpulse_pool_memberships where match_id = p_match_id) then
    raise exception 'The schedule is locked because fans have already joined.' using errcode = '23514';
  end if;
  insert into public.playpulse_match_pools(match_id, kickoff_at, opens_at, closes_at)
  values(p_match_id, p_kickoff_at, p_kickoff_at - interval '4 hours',
    p_kickoff_at - interval '4 hours' + p_registration_minutes * interval '1 minute')
  on conflict(match_id) do update set kickoff_at = excluded.kickoff_at, opens_at = excluded.opens_at,
    closes_at = excluded.closes_at, cancelled = false, updated_at = clock_timestamp();
  return public.playpulse_pool(p_match_id);
end;
$$;

create or replace function public.playpulse_join_pool(p_match_id text, p_team text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  chosen public.playpulse_pool_memberships;
  pool public.playpulse_match_pools;
  moment timestamptz;
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'A verified account is required.' using errcode = '42501';
  end if;
  if p_team is null or p_team not in ('Arsenal', 'Chelsea') then
    raise exception 'Choose Arsenal or Chelsea.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_match_id, 0));
  select * into chosen from public.playpulse_pool_memberships where match_id = p_match_id and user_id = auth.uid();
  if found then
    if chosen.team <> p_team then raise exception 'Your team is locked for this match.' using errcode = '23514'; end if;
    -- Retries recover the original membership, even after registration closes.
    return public.playpulse_pool(p_match_id) || jsonb_build_object('duplicate', true);
  end if;
  select * into pool from public.playpulse_match_pools where match_id = p_match_id for update;
  moment := clock_timestamp();
  if not found or pool.cancelled or moment < pool.opens_at or moment >= pool.closes_at then
    raise exception 'Registration is not open for this match.' using errcode = '23514';
  end if;
  insert into public.playpulse_pool_memberships(match_id, user_id, team) values(p_match_id, auth.uid(), p_team);
  return public.playpulse_pool(p_match_id) || jsonb_build_object('duplicate', false);
end;
$$;

revoke all on function public.playpulse_my_role() from public, anon;
grant execute on function public.playpulse_my_role() to authenticated;
revoke all on function public.playpulse_pool(text) from public;
grant execute on function public.playpulse_pool(text) to anon, authenticated;
revoke all on function public.playpulse_schedule_pool(text, timestamptz, integer) from public, anon;
grant execute on function public.playpulse_schedule_pool(text, timestamptz, integer) to authenticated;
revoke all on function public.playpulse_join_pool(text, text) from public, anon;
grant execute on function public.playpulse_join_pool(text, text) to authenticated;

commit;

-- After the owner signs up and confirms their email, grant admin access in a
-- SEPARATE SQL query (replace the address; never grant this through public signup):
-- insert into public.playpulse_staff(user_id, role)
-- select id, 'admin' from auth.users where lower(email) = lower('YOUR_OWNER_EMAIL')
-- on conflict(user_id) do update set role = excluded.role;
