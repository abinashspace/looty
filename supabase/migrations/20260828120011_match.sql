-- Looty — Phase 4: Looty Match
--
-- Vertical feed of students. Loot or pass. A mutual loot becomes a **Connection**
-- (never "match" in anything a user can read — CONTEXT.md §1).
--
-- Tier 1+ only. Free tier gets 10 loots/day, paid 50.

-- ---------------------------------------------------------------------------
-- Subscription state (pulled forward from Phase 6)
-- ---------------------------------------------------------------------------
--
-- Only the shape needed to answer "is this user paid", because the loot quota
-- depends on it. Google Play Billing wiring is still Phase 6.

create table public.subscriptions (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  status             text not null check (status in ('active', 'expired', 'cancelled')),
  product_id         text,
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

create or replace function public.is_paid(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_uid
      and s.status = 'active'
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- Match preferences
-- ---------------------------------------------------------------------------

create type public.match_scope as enum ('same_college', 'all_india');

alter table public.profiles
  add column match_scope public.match_scope not null default 'same_college',
  -- Opt-in safety toggle, NOT a dating preference. There is no "show me men /
  -- women" filter — that would read as dating and undercut the repositioning.
  add column match_same_gender_only boolean not null default false;

comment on column public.profiles.match_same_gender_only is
  'Safety toggle. Deliberately not a gender preference filter — Looty is a friends app.';

-- ---------------------------------------------------------------------------
-- Loots
-- ---------------------------------------------------------------------------

create type public.loot_action as enum ('loot', 'pass');

create table public.loots (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null references auth.users (id) on delete cascade,
  target_id  uuid not null references auth.users (id) on delete cascade,
  action     public.loot_action not null,
  created_at timestamptz not null default now(),

  constraint loots_not_self check (actor_id <> target_id)
);

-- One decision per person, ever. Re-deciding would let someone farm the feed.
create unique index loots_one_per_pair on public.loots (actor_id, target_id);
create index loots_target_idx on public.loots (target_id) where action = 'loot';
create index loots_quota_idx on public.loots (actor_id, created_at) where action = 'loot';

/**
 * Loots used today, counted in **IST**.
 *
 * Not UTC: a UTC day boundary resets everyone's quota at 5:30am India time, which
 * is both surprising and exploitable by anyone awake at the wrong hour.
 */
create or replace function public.loots_used_today(p_uid uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.loots l
  where l.actor_id = p_uid
    and l.action = 'loot'
    and (l.created_at at time zone 'Asia/Kolkata')::date
        = (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Passing is FREE and uncapped. Charging for passes would make the feed unusable —
-- a user must be able to skip as many people as they like to reach someone they
-- want to loot.
create or replace function public.daily_loot_limit(p_uid uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_paid(p_uid) then 50 else 10 end;
$$;

create or replace function public.loots_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(public.daily_loot_limit() - public.loots_used_today(), 0);
$$;

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------

create type public.connection_status as enum ('active', 'ended');

create table public.connections (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  status     public.connection_status not null default 'active',
  created_at timestamptz not null default now(),
  ended_at   timestamptz,

  constraint connections_canonical_order check (user_a < user_b)
);

create unique index connections_pair_uniq on public.connections (user_a, user_b);
create index connections_user_a_idx on public.connections (user_a);
create index connections_user_b_idx on public.connections (user_b);

/**
 * A mutual loot creates the Connection and opens its chat.
 *
 * Both sides must have action='loot'. A pass is final — if A passed B, B looting A
 * later connects nobody. That is why `loots` is unique per pair: it is a decision,
 * not a vote.
 */
create or replace function public.connect_on_mutual_loot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lo uuid := least(new.actor_id, new.target_id);
  v_hi uuid := greatest(new.actor_id, new.target_id);
begin
  if new.action <> 'loot' then
    return null;
  end if;

  if not exists (
    select 1 from public.loots l
    where l.actor_id = new.target_id
      and l.target_id = new.actor_id
      and l.action = 'loot'
  ) then
    return null;
  end if;

  insert into public.connections (user_a, user_b)
  values (v_lo, v_hi)
  on conflict (user_a, user_b) do nothing;

  -- The chat exists the moment the Connection does; reuses the same 1:1 threads
  -- table as DMs, distinguished by type. The client blurs images in 'connection'
  -- threads because those are strangers, unlike friend DMs.
  insert into public.threads (type, user_a, user_b)
  values ('connection', v_lo, v_hi)
  on conflict (type, user_a, user_b) do nothing;

  return null;
end;
$$;

create trigger loots_connect
  after insert on public.loots
  for each row execute function public.connect_on_mutual_loot();

-- Blocking must end a Connection, not just hide it — same reasoning as friendships
-- in Phase 2. Extends the existing teardown.
create or replace function public.blocks_teardown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lo uuid := least(new.blocker_id, new.blocked_id);
  v_hi uuid := greatest(new.blocker_id, new.blocked_id);
begin
  delete from public.friendships
  where least(requester_id, addressee_id) = v_lo
    and greatest(requester_id, addressee_id) = v_hi;

  update public.connections
     set status = 'ended', ended_at = now()
   where user_a = v_lo and user_b = v_hi and status = 'active';

  update public.threads
     set ended_at = now()
   where user_a = v_lo and user_b = v_hi and ended_at is null;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The feed
-- ---------------------------------------------------------------------------

/**
 * Candidates for the caller's feed.
 *
 * Excludes: themselves, anyone already decided on, blocks in either direction,
 * banned users, unverified users, and anyone failing their scope or safety filter.
 */
create or replace function public.match_feed(p_limit integer default 20)
returns table (id uuid, username citext, display_name text, dp_url text, college_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.dp_url, p.college_id
  from public.profiles p
  cross join (
    select match_scope, match_same_gender_only, college_id, gender
    from public.profiles where id = auth.uid()
  ) me
  where public.current_tier() >= 1
    and p.id <> auth.uid()
    and p.trust_tier >= 1
    and p.onboarding_complete
    and not public.is_banned(p.id)
    and not public.is_blocked_pair(auth.uid(), p.id)
    and not exists (
      select 1 from public.loots l
      where l.actor_id = auth.uid() and l.target_id = p.id
    )
    and (me.match_scope = 'all_india' or p.college_id = me.college_id)
    and (not me.match_same_gender_only or p.gender = me.gender)
  order by random()
  limit greatest(least(p_limit, 50), 1);
$$;

-- ---------------------------------------------------------------------------
-- "Looted you"
-- ---------------------------------------------------------------------------
--
-- Two functions rather than one that blurs, DELIBERATELY.
--
-- Blurring in the client is not privacy — the rows still arrive over the network
-- and anyone can read them off the wire. Free users get a COUNT and nothing else;
-- the identities are never sent unless the caller is actually paid.

create or replace function public.looted_you_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.loots l
  where l.target_id = auth.uid()
    and l.action = 'loot'
    and public.current_tier() >= 1
    and not public.is_banned(l.actor_id)
    and not public.is_blocked_pair(auth.uid(), l.actor_id)
    and not exists (
      select 1 from public.loots mine
      where mine.actor_id = auth.uid() and mine.target_id = l.actor_id
    );
$$;

create or replace function public.looted_you()
returns table (id uuid, username citext, display_name text, dp_url text, looted_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.dp_url, l.created_at
  from public.loots l
  join public.profiles p on p.id = l.actor_id
  where l.target_id = auth.uid()
    and l.action = 'loot'
    and public.is_paid()            -- identities are never returned to free users
    and public.current_tier() >= 1
    and not public.is_banned(l.actor_id)
    and not public.is_blocked_pair(auth.uid(), l.actor_id)
    and not exists (
      select 1 from public.loots mine
      where mine.actor_id = auth.uid() and mine.target_id = l.actor_id
    )
  order by l.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.loots         enable row level security;
alter table public.connections   enable row level security;
alter table public.subscriptions enable row level security;

-- A user sees only the decisions THEY made. Reading `loots` by target_id would
-- hand away the paid "who looted you" feature for free.
grant select on public.loots to authenticated;
create policy loots_read_own on public.loots
  for select to authenticated using (actor_id = auth.uid());

grant insert (actor_id, target_id, action) on public.loots to authenticated;
create policy loots_insert_own on public.loots
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and public.current_tier() >= 1
    and not public.is_blocked_pair(actor_id, target_id)
    -- Quota applies to loots only; passes are free and uncapped.
    and (action = 'pass' or public.loots_used_today() < public.daily_loot_limit())
  );

grant select on public.connections to authenticated;
create policy connections_read_own on public.connections
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- Either side may end a Connection. No INSERT grant — connections exist only as a
-- consequence of a mutual loot.
grant update (status, ended_at) on public.connections to authenticated;
create policy connections_end_own on public.connections
  for update to authenticated
  using ((user_a = auth.uid() or user_b = auth.uid()) and status = 'active')
  with check (status = 'ended');

-- Subscription state is written by the Play Billing webhook under service_role.
grant select on public.subscriptions to authenticated;
create policy subscriptions_read_own on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

grant execute on function public.match_feed(integer) to authenticated;
grant execute on function public.looted_you() to authenticated;
grant execute on function public.looted_you_count() to authenticated;
grant execute on function public.loots_remaining() to authenticated;
grant execute on function public.loots_used_today(uuid) to authenticated;
grant execute on function public.daily_loot_limit(uuid) to authenticated;
grant execute on function public.is_paid(uuid) to authenticated;
