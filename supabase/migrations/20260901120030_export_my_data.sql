-- Looty — DPDP access: the caller can download what we store about them
--
-- Privacy policy said "email support if you need a copy." That is not access.
-- This returns a JSON document of the caller's own rows. Other people's
-- messages, emails and private columns are not included. Image storage paths
-- are omitted (a boolean is enough). Push tokens are a yes/no, not the token.

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  payload jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'account', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at
    ),
    'profile', jsonb_build_object(
      'username', p.username,
      'display_name', p.display_name,
      'dp_url', p.dp_url,
      'college_email', p.college_email,
      'college_id', p.college_id,
      'course_years', p.course_years,
      'start_year', p.start_year,
      'end_year', p.end_year,
      'gender', p.gender,
      'trust_tier', p.trust_tier,
      'match_scope', p.match_scope,
      'match_same_gender_only', p.match_same_gender_only,
      'onboarding_complete', p.onboarding_complete,
      'created_at', p.created_at
    ),
    'notification_prefs', (
      select to_jsonb(np) - 'user_id' from public.notification_prefs np where np.user_id = uid
    ),
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category', gm.category, 'joined_at', gm.joined_at
      )), '[]'::jsonb)
      from public.group_members gm where gm.user_id = uid
    ),
    'messages_sent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'thread_id', m.thread_id,
        'body', m.body,
        'has_image', m.image_url is not null,
        'kind', m.kind,
        'created_at', m.created_at
      )), '[]'::jsonb)
      from public.messages m where m.sender_id = uid
    ),
    'group_messages_sent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'group_id', g.group_id, 'body', g.body, 'created_at', g.created_at
      )), '[]'::jsonb)
      from public.group_messages g where g.sender_id = uid
    ),
    'friendships', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'status', f.status,
        'role', case when f.requester_id = uid then 'requester' else 'addressee' end,
        'other_username', o.username
      )), '[]'::jsonb)
      from public.friendships f
      join public.profiles o
        on o.id = case when f.requester_id = uid then f.addressee_id else f.requester_id end
      where f.requester_id = uid or f.addressee_id = uid
    ),
    'blocks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'blocked_username', o.username, 'created_at', b.created_at
      )), '[]'::jsonb)
      from public.blocks b
      join public.profiles o on o.id = b.blocked_id
      where b.blocker_id = uid
    ),
    'loots', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', l.action, 'target_username', o.username, 'created_at', l.created_at
      )), '[]'::jsonb)
      from public.loots l
      join public.profiles o on o.id = l.target_id
      where l.actor_id = uid
    ),
    'reports_filed', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reason', r.reason, 'context', r.context, 'created_at', r.created_at
      )), '[]'::jsonb)
      from public.reports r where r.reporter_id = uid
    ),
    'college_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'college_name', c.college_name,
        'city', c.city,
        'domain', c.domain,
        'status', c.status,
        'created_at', c.created_at
      )), '[]'::jsonb)
      from public.college_requests c where c.requester_id = uid
    ),
    'bans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'type', b.type,
        'starts_at', b.starts_at,
        'ends_at', b.ends_at,
        'lifted_at', b.lifted_at
      )), '[]'::jsonb)
      from public.bans b where b.user_id = uid
    ),
    'appeals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', a.body, 'status', a.status, 'created_at', a.created_at
      )), '[]'::jsonb)
      from public.appeals a where a.user_id = uid
    ),
    'has_push_token', exists (select 1 from public.push_tokens t where t.user_id = uid)
  )
  into payload
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = uid;

  return payload;
end;
$$;

comment on function public.export_my_data() is
  'DPDP access copy: the caller''s own rows as JSON. Not other people''s mail or messages.';

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
grant execute on function public.export_my_data()                   to authenticated;
