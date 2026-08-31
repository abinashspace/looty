-- Looty — picking a username was impossible on live
--
-- Found 2026-08-31 by taking a real account to Tier 2 and PATCHing profiles as
-- `authenticated`. Postgres returned:
--
--   42501 permission denied for table reserved_usernames
--   hint: GRANT SELECT ON public.reserved_usernames TO authenticated
--
-- `enforce_username_rules` is an ordinary trigger. It runs as the caller, and it
-- SELECTs `reserved_usernames`, which has no client grants on purpose — the list
-- is not something a user should enumerate. So the reserved-name check, written
-- to protect usernames, made every username write fail.
--
-- The word-filter trigger in migration 10 was already SECURITY DEFINER for the
-- same reason (a WITH CHECK would have needed EXECUTE on trips_word_filter,
-- handing clients an oracle). The username trigger was the same shape and was
-- missed because every test that set a username ran as superuser.
--
-- Do NOT grant SELECT on reserved_usernames to authenticated. That would let
-- anyone read the blocklist. The trigger must run as the owner instead.

create or replace function public.enforce_username_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.username is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if exists (select 1 from public.reserved_usernames r where r.username = new.username) then
    raise exception 'username_reserved' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE'
     and old.username is not null
     and old.username_changed_at is not null
     and old.username_changed_at > now() - interval '14 days' then
    raise exception 'username_change_too_soon' using errcode = 'check_violation';
  end if;

  new.username_changed_at := now();
  return new;
end;
$$;

comment on function public.enforce_username_rules() is
  'SECURITY DEFINER because it reads reserved_usernames, which has no client grants. Invoker rights made every username write fail on live.';

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.enforce_username_rules() from public, anon, authenticated;

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
