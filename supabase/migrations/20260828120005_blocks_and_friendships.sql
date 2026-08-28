-- Looty — Phase 2: blocks and friendships
--
-- Blocking ships in the same migration as friendships on purpose. Reporting is for
-- the platform; blocking is for the user, and no social surface should go live
-- without it. See CONTEXT.md §3.5.

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
--
-- Silent: the blocked person is never told. No cap on how many you may block.
-- Survives bans — a block outlives whatever moderation does to either account.

create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

-- Reverse lookup: "who has blocked me" is asked as often as "who have I blocked",
-- because visibility must break in both directions.
create index blocks_blocked_idx on public.blocks (blocked_id);

/**
 * True when either user has blocked the other.
 *
 * Blocking is symmetric in effect even though the row is one-directional: if A
 * blocks B, neither can see the other. Every visibility rule in the app funnels
 * through this one function so the symmetry cannot drift.
 */
create or replace function public.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- ---------------------------------------------------------------------------
-- Friendships
-- ---------------------------------------------------------------------------

create type public.friendship_status as enum ('pending', 'accepted');

create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status       public.friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,

  constraint friendships_not_self check (requester_id <> addressee_id)
);

-- Who asked matters (only the addressee may accept), but a pair may only have one
-- row regardless of direction — otherwise A→B and B→A both sit pending forever.
create unique index friendships_pair_uniq on public.friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
);

create index friendships_requester_idx on public.friendships (requester_id);
create index friendships_addressee_idx on public.friendships (addressee_id) where status = 'pending';

-- Blocking tears down the relationship rather than merely hiding it. Leaving an
-- accepted friendship in place would let the pair reappear for each other the
-- moment the block is lifted, which is not what "block" means to a user.
create or replace function public.blocks_teardown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friendships
  where least(requester_id, addressee_id) = least(new.blocker_id, new.blocked_id)
    and greatest(requester_id, addressee_id) = greatest(new.blocker_id, new.blocked_id);

  -- Phase 4 adds `connections` here: a block must also end any Connected chat.
  return new;
end;
$$;

create trigger blocks_teardown_on_insert
  after insert on public.blocks
  for each row execute function public.blocks_teardown();

-- ---------------------------------------------------------------------------
-- Blocked users disappear from each other
-- ---------------------------------------------------------------------------
--
-- Phase 1 left profiles readable by every authenticated user. Now that blocks
-- exist, that policy has to respect them — this is the note left in the Phase 1
-- RLS migration.

drop policy if exists profiles_read_all on public.profiles;

create policy profiles_read_visible on public.profiles
  for select to authenticated
  using (id = auth.uid() or not public.is_blocked_pair(auth.uid(), id));
