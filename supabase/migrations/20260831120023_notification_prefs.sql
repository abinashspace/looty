-- Looty — notification preferences
--
-- Play Store requires a way to control notifications in-app. Push delivery is
-- not built yet (no push_tokens, no Expo Push / FCM). These rows are the
-- preference surface that delivery will read when it exists; shipping the
-- table later would mean a migration through live student data for something
-- that can be empty and private today.
--
-- Account deletion is an Edge Function (delete-account), not a SQL function:
-- removing an auth.users row requires the Auth Admin API. banned_identities
-- has no user_id on purpose, so a permanent ban still blocks the college
-- address after the account is gone. See that function for the rest.

create table public.notification_prefs (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  dms              boolean not null default true,
  friend_requests  boolean not null default true,
  -- Mutual loot. Named for the product state ("Connected"), not the dating word.
  connections      boolean not null default true,
  -- Off by default: a 1024-member room would otherwise wake the phone constantly.
  groups           boolean not null default false,
  updated_at       timestamptz not null default now()
);

comment on table public.notification_prefs is
  'Per-user notification switches. Own-row only. Delivery is not wired yet; the values are what it will honour.';

create trigger notification_prefs_touch_updated_at
  before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

alter table public.notification_prefs enable row level security;

revoke all on public.notification_prefs from anon, authenticated;

grant select on public.notification_prefs to authenticated;
grant insert (user_id, dms, friend_requests, connections, groups)
  on public.notification_prefs to authenticated;
grant update (dms, friend_requests, connections, groups)
  on public.notification_prefs to authenticated;

create policy notification_prefs_own on public.notification_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Create the row with the profile. Existing users are backfilled below.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  insert into public.notification_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

insert into public.notification_prefs (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- CREATE OR REPLACE of handle_new_user does not strip existing client grants,
-- but the allowlist is cheap to re-assert and is the documented close-out.
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
