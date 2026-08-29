-- Looty — storage bucket for profile pictures
--
-- Public-read, because DPs are shown on Match cards and in group threads to people
-- who are not yet connected to you. Write access is locked to the owner: the file
-- path must start with the uploader's own user id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,                                   -- 2 MB is plenty for a DP
  array['image/jpeg', 'image/png', 'image/webp']     -- no GIF, no SVG (SVG can carry script)
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: avatars/<user_id>/<filename>. The first path segment is the
-- owner, which is what every policy below keys on — so a client cannot write into
-- someone else's folder no matter what name it sends.

drop policy if exists "avatars are publicly readable"      on storage.objects;
drop policy if exists "users upload their own avatar"      on storage.objects;
drop policy if exists "users replace their own avatar"     on storage.objects;
drop policy if exists "users delete their own avatar"      on storage.objects;

create policy "avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users replace their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
