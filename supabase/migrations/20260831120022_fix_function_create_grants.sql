-- Looty — the event trigger was firing, and still not closing functions
--
-- Settled live on 2026-08-31. A throwaway function
-- `public._looty_event_trigger_probe()` was created on the production database
-- and called as `anon` via PostgREST. It returned 200 `"reachable"`. Then dropped.
--
-- The trigger `lock_functions_on_create` exists, is enabled, and DID run. The
-- resulting ACL was:
--
--   {postgres=X/postgres, anon=X/postgres,
--    authenticated=X/postgres, service_role=X/postgres}
--
-- No PUBLIC grant (`=X/` was absent). So `revoke ... from public` succeeded at
-- doing nothing useful. The grants that matter come from Supabase's
-- `ALTER DEFAULT PRIVILEGES` for the `postgres` role in schema `public`, which
-- grants EXECUTE on every new function to anon, authenticated and service_role
-- directly. Migration 12 revoked from PUBLIC, which was never the grantee.
-- Migration 14's trigger revoked from PUBLIC, which by the time it ran was
-- already gone.
--
-- Two layers now, both aimed at the grants that actually exist:
--   1. stop granting EXECUTE to anon/authenticated on new functions
--   2. the event trigger also revokes from anon, not just PUBLIC
--
-- `lock_client_functions()` remains mandatory at the end of every migration that
-- creates a function. The last two automatic attempts each failed while looking
-- like they had worked; this one is verified live after it ships, not before.

-- ---------------------------------------------------------------------------
-- 1. Default privileges: new functions start closed to clients
-- ---------------------------------------------------------------------------
--
-- Does not touch service_role — Edge Functions should keep EXECUTE. Does not
-- touch existing functions; those were swept by migration 21.

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Event trigger: revoke the grants that actually land
-- ---------------------------------------------------------------------------

create or replace function public.lock_new_functions()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.schema_name = 'public' and cmd.object_type = 'function' then
      execute format(
        'revoke all on function %s from public, anon',
        cmd.object_identity
      );
    end if;
  end loop;
end;
$$;

comment on function public.lock_new_functions() is
  'Event trigger helper. Revokes PUBLIC and anon — the roles the APK key can assume — from every new function in public. Authenticated is left alone so CREATE OR REPLACE of an existing client function does not strip its grant; service-role-only functions must still revoke authenticated themselves.';

-- The helper itself is not client-callable.
revoke all on function public.lock_new_functions() from public, anon, authenticated;

comment on function public.lock_client_functions() is
  'Call at the END of every migration that creates a function. Postgres and Supabase both grant EXECUTE to client roles by default. The event trigger now revokes anon as well as PUBLIC, and default privileges no longer grant to anon/authenticated — but two earlier automatic attempts failed while looking like they had worked, so the sweep is still the thing that must be called.';

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;

-- Re-assert the client's allowlist. The sweep does not touch authenticated
-- grants, so this is belt-and-braces against CREATE OR REPLACE of the helper
-- above having any surprising ACL side effects.
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
