-- Looty — device push tokens, and a single place that honours notification_prefs
--
-- Prefs shipped in migration 23 with nothing to send. This is the token side.
-- Delivery (Expo Push → FCM) is not wired yet; register/unregister and
-- should_notify() are what it will call. Groups default off in prefs, so a
-- future fanout that forgets to ask should_notify would still be a bug — the
-- function exists so that forgetfulness has one place to be tested.
--
-- A token uniquely identifies a device. On conflict it moves to the caller:
-- signing into a different account on the same phone must not keep notifying
-- the previous person.

create table public.push_tokens (
  token      text primary key check (length(btrim(token)) between 16 and 4096),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

comment on table public.push_tokens is
  'Expo push tokens. Own-row from the client via register_push_token / unregister_push_token. No SELECT of other people''s tokens.';

create trigger push_tokens_touch_updated_at
  before update on public.push_tokens
  for each row execute function public.touch_updated_at();

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

-- The client never touches the table directly. Tokens can move between users
-- (same phone, new account), which a WITH CHECK on user_id = auth.uid() would
-- refuse when the existing row belongs to someone else.
create or replace function public.register_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_token is null or length(btrim(p_token)) < 16 then
    raise exception 'invalid_token';
  end if;
  insert into public.push_tokens (token, user_id)
  values (btrim(p_token), auth.uid())
  on conflict (token) do update
    set user_id = excluded.user_id, updated_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.push_tokens
  where token = btrim(p_token) and user_id = auth.uid();
end;
$$;

/**
 * Whether this user wants this kind of notification.
 *
 * Missing prefs row uses the same defaults as the table (groups off, rest on)
 * so a user created before migration 23 is not spammed in group rooms.
 */
create or replace function public.should_notify(p_user uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case p_kind
       when 'dms'             then dms
       when 'friend_requests' then friend_requests
       when 'connections'     then connections
       when 'groups'          then groups
       else false
     end
     from public.notification_prefs
     where user_id = p_user),
    p_kind is distinct from 'groups'
  );
$$;

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.register_push_token(text)   from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
revoke all on function public.should_notify(uuid, text)   from public, anon, authenticated;

grant execute on function public.register_push_token(text)   to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
-- should_notify is for Edge Functions / triggers, not the client. A client that
-- can ask "does this other person want DMs?" is a probe.

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
