-- Looty — stop Tier 0 from enumerating every student
--
-- Found by signing in as a real Tier 0 user against the live project: a plain
-- `select * from profiles` returned every row. Anyone could sign up with a throwaway
-- Gmail and dump the entire directory — username, display name, photo URL, college
-- — for every verified student on the platform.
--
-- That is a scraping vector aimed squarely at the one thing Looty sells: a peer-only
-- space. Tier 0 is meant to be able to read groups, nothing more.
--
-- Verified students enumerating each other is fine and is in fact the product —
-- username search and the Match feed both depend on it. The hole is specifically
-- that Tier 0 had the same reach.

drop policy if exists profiles_read_visible on public.profiles;

create policy profiles_read_visible on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (
      public.current_tier() >= 1
      and not public.is_blocked_pair(auth.uid(), id)
    )
  );

-- ---------------------------------------------------------------------------
-- Group reading still needs sender names
-- ---------------------------------------------------------------------------
--
-- Tier 0 can read groups, and a wall of anonymous uuids is not readable. This
-- returns messages already joined to their sender, so an unverified user learns
-- about exactly the people who posted in the room they are reading — instead of
-- being handed the whole directory.
--
-- It also implements the "new joiners see the last 50" default in one place.

create or replace function public.group_thread(p_group uuid, p_limit integer default 50)
returns table (
  id           uuid,
  sender_id    uuid,
  username     citext,
  display_name text,
  dp_url       text,
  body         text,
  created_at   timestamptz,
  is_blocked   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.sender_id,
    -- Blocked users collapse rather than vanish: removing their messages outright
    -- would leave replies dangling and read as a bug.
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else p.username end,
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else p.display_name end,
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else p.dp_url end,
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else m.body end,
    m.created_at,
    public.is_blocked_pair(auth.uid(), m.sender_id)
  from public.group_messages m
  join public.profiles p on p.id = m.sender_id
  where m.group_id = p_group
    and auth.uid() is not null
  order by m.created_at desc
  limit greatest(least(p_limit, 200), 1);
$$;

grant execute on function public.group_thread(uuid, integer) to authenticated;
