-- Looty — unfriend ends the DM; adding them again reopens it
--
-- Friendships could already be deleted by either side. The app had no Unfriend
-- button, and deleting the row left the thread sendable because
-- can_post_to_thread did not re-check the friendship. Same class of bug as
-- ending a Connection without closing the thread.

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
      and (
        t.type <> 'dm'
        or exists (
          select 1 from public.friendships f
          where f.status = 'accepted'
            and least(f.requester_id, f.addressee_id) = t.user_a
            and greatest(f.requester_id, f.addressee_id) = t.user_b
        )
      )
  )
  and public.current_tier() >= 1;
$$;

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
  on conflict (type, user_a, user_b) do update
    set ended_at = null
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.friendships_end_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'accepted' then
    update public.threads
       set ended_at = now()
     where type = 'dm'
       and user_a = least(old.requester_id, old.addressee_id)
       and user_b = greatest(old.requester_id, old.addressee_id)
       and ended_at is null;
  end if;
  return old;
end;
$$;

drop trigger if exists friendships_end_dm on public.friendships;
create trigger friendships_end_dm
  after delete on public.friendships
  for each row execute function public.friendships_end_dm();

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
