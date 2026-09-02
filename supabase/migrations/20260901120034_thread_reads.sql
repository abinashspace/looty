-- Looty — unread in the inbox (not a read receipt for the other person)
--
-- CONTEXT listed read receipts as unconfirmed. This is only "did I open this
-- since they last wrote." The other person never sees a tick.

create table public.thread_reads (
  thread_id    uuid not null references public.threads (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table public.thread_reads enable row level security;
revoke all on public.thread_reads from anon, authenticated;

create or replace function public.mark_thread_read(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_thread_participant(p_thread) then
    raise exception 'not_participant';
  end if;
  insert into public.thread_reads (thread_id, user_id, last_read_at)
  values (p_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update
    set last_read_at = now();
end;
$$;

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
    select m.body, m.image_url, m.created_at, m.sender_id
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

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null;
end;
$$;

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.purge_old_group_messages() from public, anon, authenticated;
revoke all on function public.connections_end_thread() from public, anon, authenticated;
revoke all on function public.friendships_end_dm() from public, anon, authenticated;
revoke all on function public.mark_thread_read(uuid) from public, anon;

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
