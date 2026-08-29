-- Looty — username search and the friend-request inbox
--
-- Both return the *relationship* alongside the person, because a search result
-- with an "Add friend" button that is actually already a friend is worse than no
-- button at all. Working that out client-side means one query per result.

-- Prefix and substring search on username. The unique index on `username` is a
-- btree over citext and does not help `like '%x%'`.
create index if not exists profiles_username_trgm_idx
  on public.profiles using gin ((username::text) gin_trgm_ops);

/**
 * Search students by username.
 *
 * Tier 1+ only — the same rule that stops Tier 0 enumerating the directory
 * (migration 15) has to hold here, or search would be the way around it.
 *
 * Blocked pairs and banned accounts never appear.
 */
create or replace function public.search_users(p_query text, p_limit integer default 20)
returns table (
  id           uuid,
  username     citext,
  display_name text,
  dp_url       text,
  college_id   uuid,
  relationship text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.dp_url,
    p.college_id,
    case
      when p.id = auth.uid()                                      then 'self'
      when f.status = 'accepted'                                  then 'friends'
      when f.status = 'pending' and f.requester_id = auth.uid()   then 'pending_out'
      when f.status = 'pending'                                   then 'pending_in'
      else 'none'
    end
  from public.profiles p
  left join public.friendships f
    on least(f.requester_id, f.addressee_id) = least(auth.uid(), p.id)
   and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), p.id)
  where public.current_tier() >= 1
    and length(trim(p_query)) >= 2
    and p.username::text ilike '%' || trim(p_query) || '%'
    and p.onboarding_complete
    and p.trust_tier >= 1
    and not public.is_banned(p.id)
    and not public.is_blocked_pair(auth.uid(), p.id)
  -- Exact match first, then shortest — "rahul" should outrank "rahul_kumar_2027".
  order by (p.username::text = lower(trim(p_query))) desc, length(p.username::text), p.username
  limit greatest(least(p_limit, 50), 1);
$$;

/**
 * Pending friend requests in both directions, with the other person attached.
 *
 * `direction` is 'incoming' when someone asked you, 'outgoing' when you asked
 * them — the two need different buttons, so the caller should not have to work it
 * out from requester_id.
 */
create or replace function public.my_friend_requests()
returns table (
  friendship_id uuid,
  direction     text,
  other_id      uuid,
  username      citext,
  display_name  text,
  dp_url        text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    case when f.addressee_id = auth.uid() then 'incoming' else 'outgoing' end,
    other.id,
    other.username,
    other.display_name,
    other.dp_url,
    f.created_at
  from public.friendships f
  join public.profiles other
    on other.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() is not null
    and f.status = 'pending'
    and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and not public.is_blocked_pair(f.requester_id, f.addressee_id)
  order by f.created_at desc;
$$;

/**
 * Accepted friends, with the DM thread if one has been opened.
 *
 * `thread_id` is null until someone actually starts the conversation, which is
 * what tells the UI whether to say "Message" or open an existing chat.
 */
create or replace function public.my_friends()
returns table (
  other_id     uuid,
  username     citext,
  display_name text,
  dp_url       text,
  thread_id    uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    other.id,
    other.username,
    other.display_name,
    other.dp_url,
    t.id
  from public.friendships f
  join public.profiles other
    on other.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  left join public.threads t
    on t.type = 'dm'
   and t.user_a = least(auth.uid(), other.id)
   and t.user_b = greatest(auth.uid(), other.id)
  where auth.uid() is not null
    and f.status = 'accepted'
    and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and not public.is_blocked_pair(f.requester_id, f.addressee_id)
  order by other.display_name nulls last, other.username;
$$;

grant execute on function public.search_users(text, integer) to authenticated;
grant execute on function public.my_friend_requests()        to authenticated;
grant execute on function public.my_friends()                to authenticated;
