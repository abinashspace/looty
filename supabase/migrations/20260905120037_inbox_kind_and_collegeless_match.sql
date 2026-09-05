-- Looty — two defects found walking the app on two real phones, 2026-09-05.
--
-- 1. The Chats inbox rendered a screenshot notice as the literal string
--    "screenshot". my_threads() returned last_body but not the message kind, so
--    the client had no way to tell a system notice from someone typing the word.
--    kind is now returned and the client renders its own label.
--
-- 2. A user with no college got a permanently empty Match feed. match_scope
--    defaults to 'same_college', and the filter compared p.college_id to a NULL
--    college_id, which is never true. Before 2026-09-04 that was nearly
--    unreachable — everyone with access had confirmed a college address. Now a
--    Gmail is full access, so a collegeless account is the common case, and the
--    default stranded it on an empty screen that said "Nobody new at your
--    college right now" to someone who has no college.
--
--    "Same college" cannot mean anything without a college, so it now falls back
--    to all-India rather than matching nobody. The toggle still reads what the
--    user chose; only the impossible case changes.

drop function if exists public.my_threads();

create or replace function public.my_threads()
returns table (
  thread_id          uuid,
  type               public.thread_type,
  other_id           uuid,
  other_username     citext,
  other_display_name text,
  other_dp_url       text,
  last_body          text,
  last_kind          text,
  last_image         boolean,
  last_at            timestamptz,
  ended_at           timestamptz,
  unread             boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.type,
    other.id,
    other.username,
    other.display_name,
    other.dp_url,
    last.body,
    last.kind,
    last.image_url is not null,
    coalesce(last.created_at, t.created_at),
    t.ended_at,
    (
      last.sender_id is not null
      and last.sender_id is distinct from auth.uid()
      and last.created_at > coalesce(rd.last_read_at, '-infinity'::timestamptz)
    )
  from public.threads t
  join public.profiles other
    on other.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
  left join lateral (
    select m.body, m.kind, m.image_url, m.created_at, m.sender_id
    from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) last on true
  left join public.thread_reads rd
    on rd.thread_id = t.id and rd.user_id = auth.uid()
  where auth.uid() is not null
    and (t.user_a = auth.uid() or t.user_b = auth.uid())
    and not public.is_blocked_pair(t.user_a, t.user_b)
  order by coalesce(last.created_at, t.created_at) desc;
$$;

comment on function public.my_threads() is
  'Inbox rows. last_kind mirrors messages.kind so the client can label a screenshot notice instead of printing its body.';

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
    -- A caller with no college cannot scope to one. Fall back to all-India
    -- rather than matching nobody.
    and (
      me.match_scope = 'all_india'
      or me.college_id is null
      or p.college_id = me.college_id
    )
    and (not me.match_same_gender_only or p.gender = me.gender)
  order by random()
  limit greatest(least(p_limit, 50), 1);
$$;

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;

grant execute on function public.current_tier()                     to authenticated;
grant execute on function public.is_banned(uuid)                    to authenticated;
grant execute on function public.is_alumni(smallint)                to authenticated;
grant execute on function public.college_for_email(text)            to authenticated;
grant execute on function public.confirm_college_email(text)        to authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid)        to authenticated;
grant execute on function public.is_thread_participant(uuid, uuid)  to authenticated;
grant execute on function public.can_post_to_thread(uuid)           to authenticated;
grant execute on function public.open_dm_thread(uuid)               to authenticated;
grant execute on function public.can_report()                       to authenticated;
grant execute on function public.join_group(public.group_category)  to authenticated;
grant execute on function public.leave_group(public.group_category) to authenticated;
grant execute on function public.can_post_to_group(uuid)            to authenticated;
grant execute on function public.group_thread(uuid, integer)        to authenticated;
grant execute on function public.match_feed(integer)                to authenticated;
grant execute on function public.looted_you()                       to authenticated;
grant execute on function public.looted_you_count()                 to authenticated;
grant execute on function public.loots_remaining()                  to authenticated;
grant execute on function public.loots_used_today(uuid)             to authenticated;
grant execute on function public.daily_loot_limit(uuid)             to authenticated;
grant execute on function public.is_paid(uuid)                      to authenticated;
grant execute on function public.my_threads()                       to authenticated;
grant execute on function public.my_match_prefs()                   to authenticated;
grant execute on function public.search_users(text, integer)        to authenticated;
grant execute on function public.my_friend_requests()               to authenticated;
grant execute on function public.my_friends()                       to authenticated;
grant execute on function public.can_read_chat_image(text)          to authenticated;
grant execute on function public.can_write_chat_image(text)         to authenticated;
grant execute on function public.register_push_token(text)          to authenticated;
grant execute on function public.unregister_push_token(text)        to authenticated;
grant execute on function public.record_screenshot(uuid)            to authenticated;
grant execute on function public.export_my_data()                   to authenticated;
grant execute on function public.my_blocks()                        to authenticated;
grant execute on function public.mark_thread_read(uuid)             to authenticated;
grant execute on function public.set_typing(uuid)                   to authenticated;
grant execute on function public.clear_typing(uuid)                 to authenticated;
grant execute on function public.peer_is_typing(uuid)               to authenticated;
