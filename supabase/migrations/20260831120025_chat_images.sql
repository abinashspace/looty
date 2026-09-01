-- Looty — images in DMs and Connected chats
--
-- Group messages stay text-only: there is no image column on group_messages and
-- this bucket is not used there. 1:1 messages already have image_url (migration
-- 6); the client never wrote it because there was nowhere legal to put the file.
--
-- PRIVATE bucket. Avatars are public because Match cards show DPs to strangers.
-- A chat photo is the opposite — it is the unsolicited-image risk, and a public
-- URL would let anyone who saw the path fetch it. Read is limited to the
-- uploader and to participants of a thread that already references the object.
--
-- Path: chat-images/<user_id>/<thread_id>/<uuid>.jpg
--   segment 1  you cannot write into someone else's folder
--   segment 2  you cannot upload unless you can currently post to that thread
--
-- messages.image_url stores that path, not a URL. The client mints a signed URL
-- at display time. A Connected chat still does not fetch until the recipient
-- taps — blur-of-a-downloaded-file is not privacy (see looted-you).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  false,
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_write_chat_image(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  parts text[];
  thread uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  parts := storage.foldername(p_name);
  if parts[1] is distinct from auth.uid()::text then
    return false;
  end if;
  begin
    thread := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.can_post_to_thread(thread);
end;
$$;

create or replace function public.can_read_chat_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select auth.uid() is not null
     and (
       (storage.foldername(p_name))[1] = auth.uid()::text
       or exists (
         select 1 from public.messages m
         where m.image_url = p_name
           and public.is_thread_participant(m.thread_id)
       )
     );
$$;

comment on function public.can_write_chat_image(text) is
  'Storage INSERT/UPDATE guard for chat-images. Own folder, and can_post_to_thread on the path thread id.';
comment on function public.can_read_chat_image(text) is
  'Storage SELECT guard for chat-images. Uploader, or a participant of a thread that references the path.';

drop policy if exists "chat images readable by participants" on storage.objects;
drop policy if exists "users upload their own chat images"   on storage.objects;
drop policy if exists "users replace their own chat images"  on storage.objects;
drop policy if exists "users delete their own chat images"   on storage.objects;

create policy "chat images readable by participants"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and public.can_read_chat_image(name));

create policy "users upload their own chat images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and public.can_write_chat_image(name));

create policy "users replace their own chat images"
  on storage.objects for update to authenticated
  using (bucket_id = 'chat-images' and public.can_write_chat_image(name))
  with check (bucket_id = 'chat-images' and public.can_write_chat_image(name));

create policy "users delete their own chat images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.can_write_chat_image(text) from public, anon;
revoke all on function public.can_read_chat_image(text) from public, anon;

grant execute on function public.can_write_chat_image(text) to authenticated;
grant execute on function public.can_read_chat_image(text)  to authenticated;

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
