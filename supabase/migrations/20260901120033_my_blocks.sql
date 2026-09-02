-- Looty — list of people you blocked
--
-- Blocking hides both profiles from each other, so a client SELECT on
-- profiles cannot build an unblock screen. This returns only rows where
-- the caller is the blocker — never "who blocked me".

create or replace function public.my_blocks()
returns table (
  blocked_id   uuid,
  username     citext,
  display_name text,
  dp_url       text,
  blocked_at   timestamptz
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
    b.created_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

comment on function public.my_blocks() is
  'People the caller blocked. Security definer so usernames remain visible for unblock. Does not reveal who blocked the caller.';

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.purge_old_group_messages() from public, anon, authenticated;
revoke all on function public.connections_end_thread() from public, anon, authenticated;
revoke all on function public.friendships_end_dm() from public, anon, authenticated;

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
