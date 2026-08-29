-- Looty — a function lockdown that actually works on Supabase
--
-- THE PROBLEM, TWICE OVER.
--
-- Postgres grants EXECUTE on every new function to PUBLIC. Migration 12 tried to
-- change that default with `alter default privileges` — which silently does
-- nothing. Migration 14 replaced it with an event trigger, wrapped in an exception
-- handler so a platform that forbids event triggers would not fail the migration.
--
-- Supabase forbids them. The handler swallowed it, and every function created
-- since — my_threads, group_thread, my_match_prefs, search_users, my_friends,
-- my_friend_requests — shipped executable by `anon`, the key that lives inside the
-- APK. Found by calling them anonymously against the live project.
--
-- Nothing leaked: each one checks auth.uid() or current_tier() and returns empty.
-- But that is twice now that the *guard* was imaginary while the tests said
-- otherwise, because pglite happily runs event triggers and Supabase does not.
--
-- So: no more clever defaults. An explicit, idempotent sweep that can be re-run,
-- and must be, at the end of every migration that adds a function.

/**
 * Revokes PUBLIC and anon EXECUTE across the public schema.
 *
 * Deliberately does NOT touch `authenticated` grants, so it is safe to call after
 * the grants in the same migration — or at any later point — without undoing them.
 */
create or replace function public.lock_client_functions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end;
$$;

comment on function public.lock_client_functions() is
  'Call at the END of every migration that creates a function. Postgres grants EXECUTE to PUBLIC by default and neither ALTER DEFAULT PRIVILEGES nor an event trigger reliably prevents it on Supabase.';

-- Close everything that is currently open.
select public.lock_client_functions();

-- The sweep just revoked from itself as well, which is correct — no client should
-- ever call it. Same for the event-trigger helper, now dead weight but harmless.
revoke all on function public.lock_client_functions() from public, anon, authenticated;

-- Re-assert the client's allowlist, since the sweep above cannot know it.
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
