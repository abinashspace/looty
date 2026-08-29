-- Looty — make "functions are closed by default" actually true
--
-- Migration 12 ended with:
--   alter default privileges in schema public revoke execute on functions from public;
--
-- That line does not work. `pg_default_acl` stays empty and newly created
-- functions still get the built-in PUBLIC EXECUTE grant. It was verified: after
-- migration 12, a freshly created function was still executable by `anon`.
--
-- Migration 13 then added two trigger functions which were, accordingly, wide
-- open. Harmless in themselves — trigger functions do not need EXECUTE to fire,
-- and neither does anything useful for a caller — but it proved the guard was
-- imaginary, and the next function added might not be harmless.
--
-- Two layers now:
--   1. an event trigger that closes every function created in `public` from here on
--   2. a sweep for the ones that already exist
--
-- The test `anon can execute nothing in public` remains the backstop, and is what
-- caught this in the first place.

-- ---------------------------------------------------------------------------
-- 1. Close new functions as they are created
-- ---------------------------------------------------------------------------

create or replace function public.lock_new_functions()
returns event_trigger
language plpgsql
security definer
as $$
declare
  cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.schema_name = 'public' and cmd.object_type = 'function' then
      execute format('revoke all on function %s from public', cmd.object_identity);
    end if;
  end loop;
end;
$$;

-- Creating an event trigger needs elevated rights. If the platform refuses, the
-- sweep below and the test still cover us — so this must not fail the migration.
do $$
begin
  execute $ddl$
    create event trigger lock_functions_on_create
      on ddl_command_end when tag in ('CREATE FUNCTION')
      execute function public.lock_new_functions()
  $ddl$;
exception
  when insufficient_privilege or feature_not_supported then
    raise notice 'event trigger not permitted here; relying on the sweep and the test';
  when duplicate_object then
    null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Sweep everything that already exists
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

-- Re-grant exactly what the client calls. Anything not listed is service_role only.
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
grant execute on function public.match_feed(integer)                to authenticated;
grant execute on function public.looted_you()                       to authenticated;
grant execute on function public.looted_you_count()                 to authenticated;
grant execute on function public.loots_remaining()                  to authenticated;
grant execute on function public.loots_used_today(uuid)             to authenticated;
grant execute on function public.daily_loot_limit(uuid)             to authenticated;
grant execute on function public.is_paid(uuid)                      to authenticated;
