-- Looty — 30-day rolling window for group messages
--
-- Privacy policy and CONTEXT §7: DMs stay; group rooms are strangers at scale
-- and do not keep a permanent archive. Clients already only fetch the last 50.
-- This deletes the rest after 30 days so the promise is not just a SELECT limit.
--
-- Not client-callable. Hosted Postgres runs it via pg_cron when that extension
-- exists; pglite (the test runner) does not, so the schedule is best-effort.

create or replace function public.purge_old_group_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.group_messages
  where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.purge_old_group_messages() is
  'Deletes group_messages older than 30 days. Service-only. Scheduled with pg_cron when available.';

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.purge_old_group_messages() from public, anon, authenticated;

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

-- 21:15 UTC ≈ 02:45 IST, after campus traffic dies down.
do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'purge-old-group-messages',
    '15 21 * * *',
    $job$select public.purge_old_group_messages()$job$
  );
exception
  when others then
    raise notice 'pg_cron unavailable (%); purge_old_group_messages() still exists', SQLERRM;
end;
$cron$;
