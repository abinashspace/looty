-- Looty — revoke the default PUBLIC EXECUTE on functions
--
-- Postgres grants EXECUTE on every new function to PUBLIC automatically. Table
-- privileges work the opposite way — nothing until granted — so the schema looked
-- locked down while every function was in fact callable by `anon`.
--
-- Nothing was actually exploitable: each function checks auth.uid() and returns
-- nothing (or raises) for an anonymous caller. But that made safety a property of
-- every function remembering to check, rather than of the permission system. The
-- first function someone adds without that check would be a live hole.
--
-- This closes it for existing functions and, via ALTER DEFAULT PRIVILEGES, for
-- every function added later.

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

-- Re-grant exactly what the client is meant to call, and nothing else.
-- Anything absent here is service_role only: apply_verification, hash_email_code,
-- trips_word_filter, and the internal trigger functions.

grant execute on function public.current_tier()                            to authenticated;
grant execute on function public.is_banned(uuid)                           to authenticated;
grant execute on function public.is_alumni(smallint)                       to authenticated;
grant execute on function public.college_for_email(text)                   to authenticated;
grant execute on function public.confirm_college_email(text)               to authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid)               to authenticated;
grant execute on function public.is_thread_participant(uuid, uuid)         to authenticated;
grant execute on function public.can_post_to_thread(uuid)                  to authenticated;
grant execute on function public.open_dm_thread(uuid)                      to authenticated;
grant execute on function public.can_report()                              to authenticated;
grant execute on function public.join_group(public.group_category)         to authenticated;
grant execute on function public.leave_group(public.group_category)        to authenticated;
grant execute on function public.can_post_to_group(uuid)                   to authenticated;
grant execute on function public.match_feed(integer)                       to authenticated;
grant execute on function public.looted_you()                              to authenticated;
grant execute on function public.looted_you_count()                        to authenticated;
grant execute on function public.loots_remaining()                         to authenticated;
grant execute on function public.loots_used_today(uuid)                    to authenticated;
grant execute on function public.daily_loot_limit(uuid)                    to authenticated;
grant execute on function public.is_paid(uuid)                             to authenticated;

-- Future functions start with no client access at all.
alter default privileges in schema public revoke execute on functions from public;
