-- Looty — Phase 2: 1:1 threads and messages
--
-- Two kinds of 1:1 chat share this table:
--   'dm'          friend-gated. Images unmoderated — CONTEXT.md §3.2.
--   'connection'  from a mutual loot (Phase 4). Between STRANGERS, so the client
--                 blurs images until tapped. That difference is the reason the
--                 thread type is stored rather than inferred.
--
-- Group chat is deliberately NOT here. It is many-to-many with different rules
-- (1024 cap, text only, last-50 history) and gets its own tables in Phase 3.

create type public.thread_type as enum ('dm', 'connection');

create table public.threads (
  id         uuid primary key default gen_random_uuid(),
  type       public.thread_type not null,
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at   timestamptz,

  -- Canonical ordering. Storing the pair sorted means one thread per pair per
  -- type falls out of a plain unique constraint, with no "did I look it up in
  -- both directions" bugs at the call site.
  constraint threads_canonical_order check (user_a < user_b)
);

create unique index threads_pair_uniq on public.threads (type, user_a, user_b);
create index threads_user_a_idx on public.threads (user_a);
create index threads_user_b_idx on public.threads (user_b);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.threads (id) on delete cascade,
  sender_id  uuid not null references auth.users (id) on delete cascade,
  body       text,
  image_url  text,
  created_at timestamptz not null default now(),

  -- No video anywhere in Looty. A message is text, an image, or both.
  constraint messages_not_empty check (
    coalesce(nullif(trim(body), ''), image_url) is not null
  ),
  constraint messages_body_length check (body is null or length(body) <= 4000)
);

-- Chat reads newest-first and paginates backwards.
create index messages_thread_idx on public.messages (thread_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_thread_participant(p_thread uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.threads t
    where t.id = p_thread and (t.user_a = p_uid or t.user_b = p_uid)
  );
$$;

/**
 * Whether the caller may post into a thread right now.
 *
 * Deliberately re-checks everything at send time rather than trusting that the
 * thread was valid when it was opened: the other user may have blocked you, you
 * may have been banned, or the thread may have ended since.
 */
create or replace function public.can_post_to_thread(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.threads t
    where t.id = p_thread
      and t.ended_at is null
      and (t.user_a = auth.uid() or t.user_b = auth.uid())
      and not public.is_blocked_pair(t.user_a, t.user_b)
  )
  -- Tier 1+ to message anyone. current_tier() already collapses banned users to 0,
  -- so a ban blocks sending without a separate check.
  and public.current_tier() >= 1;
$$;

/**
 * Opens (or returns) the DM thread for an accepted friendship.
 *
 * A function rather than a client insert because the pair must be stored in
 * canonical order and the friendship must be verified — neither of which a client
 * can be trusted to do.
 */
create or replace function public.open_dm_thread(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_lo   uuid := least(v_me, p_other);
  v_hi   uuid := greatest(v_me, p_other);
  v_id   uuid;
begin
  if v_me is null or v_me = p_other then
    raise exception 'invalid_participants';
  end if;

  if public.current_tier() < 1 then
    raise exception 'tier_too_low';
  end if;

  if public.is_blocked_pair(v_me, p_other) then
    raise exception 'blocked';
  end if;

  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = v_lo
      and greatest(f.requester_id, f.addressee_id) = v_hi
  ) then
    raise exception 'not_friends';
  end if;

  insert into public.threads (type, user_a, user_b)
  values ('dm', v_lo, v_hi)
  on conflict (type, user_a, user_b) do update set type = excluded.type
  returning id into v_id;

  return v_id;
end;
$$;
