-- Looty — typing indicators in 1:1 chats (DMs and Connected)
--
-- CONTEXT listed typing indicators as assumed yes. Groups of a thousand people
-- do not get them: the signal is noise, and the fan-out is not free.
--
-- The row is a heartbeat, not a presence record. peer_is_typing() is true only
-- if the other person pulsed in the last four seconds. The client also clears
-- on send, empty field, and leaving the screen. Stale rows are swept on the
-- next pulse so the table cannot grow without bound.
--
-- Writes go through RPCs. SELECT is granted so Realtime postgres_changes can
-- deliver the other person's pulses — without SELECT, those events never
-- reach the client (the same reason messages are readable and thread_reads
-- are not). RLS still hides your own row and every other thread.

create table public.thread_typing (
  thread_id  uuid not null references public.threads (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

comment on table public.thread_typing is
  '1:1 typing heartbeat. peer_is_typing is true for 4s after the last pulse. No client writes; SELECT is peer-only so Realtime works.';

alter table public.thread_typing enable row level security;
revoke all on public.thread_typing from anon, authenticated;
grant select on public.thread_typing to authenticated;

create policy thread_typing_read_peer on public.thread_typing
  for select to authenticated
  using (
    user_id is distinct from auth.uid()
    and public.is_thread_participant(thread_id)
  );

create or replace function public.set_typing(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_post_to_thread(p_thread) then
    raise exception 'cannot_type';
  end if;
  delete from public.thread_typing
   where updated_at < now() - interval '30 seconds';
  insert into public.thread_typing (thread_id, user_id, updated_at)
  values (p_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update
    set updated_at = now();
end;
$$;

create or replace function public.clear_typing(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.thread_typing
   where thread_id = p_thread and user_id = auth.uid();
end;
$$;

create or replace function public.peer_is_typing(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.thread_typing t
     where t.thread_id = p_thread
       and t.user_id is distinct from auth.uid()
       and t.updated_at > now() - interval '4 seconds'
       and public.is_thread_participant(p_thread)
  );
$$;

do $$
begin
  alter publication supabase_realtime add table public.thread_typing;
exception when duplicate_object then null;
end;
$$;

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.set_typing(uuid)     from public, anon;
revoke all on function public.clear_typing(uuid)   from public, anon;
revoke all on function public.peer_is_typing(uuid) from public, anon;

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
