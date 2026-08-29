-- Looty — chat list helper and realtime
--
-- `threads` stores a pair as user_a/user_b, so building an inbox client-side means
-- "which column am I, fetch the other one, then fetch their profile, then fetch the
-- last message" — three round trips per row. This does it once, server-side.

create or replace function public.my_threads()
returns table (
  thread_id          uuid,
  type               public.thread_type,
  other_id           uuid,
  other_username     citext,
  other_display_name text,
  other_dp_url       text,
  last_body          text,
  last_image         boolean,
  last_at            timestamptz,
  ended_at           timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.type,
    other.id,
    other.username,
    other.display_name,
    other.dp_url,
    last.body,
    last.image_url is not null,
    coalesce(last.created_at, t.created_at),
    t.ended_at
  from public.threads t
  join public.profiles other
    on other.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
  left join lateral (
    select m.body, m.image_url, m.created_at
    from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) last on true
  where auth.uid() is not null
    and (t.user_a = auth.uid() or t.user_b = auth.uid())
    -- A blocked pair keeps its rows, but the thread stops appearing for either of
    -- them. Deleting instead would destroy evidence a report may depend on.
    and not public.is_blocked_pair(t.user_a, t.user_b)
  order by coalesce(last.created_at, t.created_at) desc;
$$;

grant execute on function public.my_threads() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Postgres changes are broadcast through RLS, so a subscriber only receives rows
-- they could have selected anyway. Clients still filter by thread or group in the
-- subscription itself — group_messages is readable by everyone, and shipping every
-- message in every room to every device would be absurd.

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.group_messages;
exception when duplicate_object then null;
end;
$$;
