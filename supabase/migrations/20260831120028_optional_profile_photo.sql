-- Looty — profile photo is optional
--
-- Reversal of CONTEXT §3.1 "Profile picture required at signup."
-- Owner decision 2026-09-01: a required face fights anonymity and the
-- friends-not-dating position. College email is the identity proof. A photo
-- is something you may add, not a gate.
--
-- onboarding_complete is still derived, still not client-writable. It no
-- longer waits on dp_url.

create or replace function public.sync_onboarding_complete()
returns trigger
language plpgsql
as $$
begin
  new.onboarding_complete :=
        new.username     is not null
    and new.display_name is not null and length(trim(new.display_name)) > 0
    and new.course_years is not null
    and new.start_year   is not null;
  return new;
end;
$$;

drop trigger if exists profiles_sync_onboarding on public.profiles;
create trigger profiles_sync_onboarding
  before insert or update of username, display_name, dp_url, course_years, start_year
  on public.profiles
  for each row execute function public.sync_onboarding_complete();

-- Recompute for anyone who already filled name/course but had no photo.
update public.profiles set username = username;

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.sync_onboarding_complete() from public, anon, authenticated;

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
