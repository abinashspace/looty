-- Looty — screenshot notices in Connected chats
--
-- CONTEXT.md §3.4 / §7: Android 14+ notifies the other person; below 14
-- FLAG_SECURE blocks capture. This is the server half of the notify path.
--
-- A screenshot is not a chat message the user typed. Clients cannot INSERT
-- kind='screenshot' (the column is not granted). record_screenshot() is the
-- only writer. Silent no-op if called twice within a minute so a burst of
-- OS events cannot flood the thread.
--
-- DMs do not get this. Those are friend-gated.

alter table public.messages
  add column if not exists kind text not null default 'user';

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check check (kind in ('user', 'screenshot'));

alter table public.messages drop constraint if exists messages_not_empty;
alter table public.messages
  add constraint messages_not_empty check (
    kind = 'screenshot'
    or coalesce(nullif(trim(body), ''), image_url) is not null
  );

comment on column public.messages.kind is
  'user = ordinary chat. screenshot = system notice that the sender captured the thread. Client cannot set this column.';

create or replace function public.record_screenshot(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.threads t
    where t.id = p_thread
      and t.type = 'connection'
      and t.ended_at is null
      and (t.user_a = auth.uid() or t.user_b = auth.uid())
      and not public.is_blocked_pair(t.user_a, t.user_b)
  ) then
    return;
  end if;

  if exists (
    select 1 from public.messages m
    where m.thread_id = p_thread
      and m.sender_id = auth.uid()
      and m.kind = 'screenshot'
      and m.created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  insert into public.messages (thread_id, sender_id, kind, body)
  values (p_thread, auth.uid(), 'screenshot', 'screenshot');
end;
$$;

comment on function public.record_screenshot(uuid) is
  'Connected chats only. Inserts a system notice that the caller captured the screen. Not a user-typed message.';

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.record_screenshot(uuid) from public, anon;

grant execute on function public.record_screenshot(uuid) to authenticated;

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
