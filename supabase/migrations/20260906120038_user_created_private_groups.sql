-- Looty — groups become user-created and private. Owner decision, 2026-09-06.
--
-- The three global rooms are gone. Study, Sports and Friends were a fixed
-- taxonomy guessed before anyone used the product, and a room nobody chose to be
-- in. In their place: anyone at Tier 1 creates a private group, names it, and
-- hands out an invite code.
--
-- What that changes about the old design, and why:
--
--   * `category` and `room_number` disappear. There is nothing to enumerate and
--     nothing to shard — a group is a place someone made, not a bucket you were
--     assigned to. `capacity` stays at 1024.
--   * `name` becomes user-supplied rather than derived. The trigger that forced
--     "Study 2" goes with it.
--   * Groups are private with no directory. There is no listing endpoint and no
--     search across groups you are not in; the invite code is the only way in.
--   * The 30-day purge is removed. It existed because a 1024-stranger firehose
--     is not worth keeping. A private group's history is the point of it.
--     NOTE: legal/privacy.md and docs/index.html both promise a 30-day window
--     and must be corrected in the same change.
--
-- Leaving and removal are deliberately different things:
--
--   * You leave on your own — you can rejoin later with the code, no ceremony.
--   * The owner removes you — you cannot rejoin with the code. Otherwise
--     removing someone would be theatre, since the code is the same one they
--     already have. Only an invite from the owner lets you back.
--   * The owner re-adding anyone arrives as an *invitation* they accept, never
--     an instant re-add. Someone who left to get away from a group must not be
--     dragged back into it silently.

-- ---------------------------------------------------------------------------
-- Out with the old
-- ---------------------------------------------------------------------------

-- Deletes the three seeded rooms and, by cascade, their members and messages.
delete from public.groups;

drop trigger if exists groups_set_name on public.groups;
drop function if exists public.set_group_name();
drop function if exists public.join_group(public.group_category);
drop function if exists public.leave_group(public.group_category);
drop function if exists public.purge_old_group_messages();
drop index if exists public.groups_open_idx;

alter table public.group_members drop constraint if exists group_members_user_id_category_key;
alter table public.group_members drop constraint if exists group_members_group_id_category_fkey;
alter table public.group_members drop column if exists category;

alter table public.groups drop constraint if exists groups_id_category_key;
alter table public.groups drop constraint if exists groups_category_room_number_key;
alter table public.groups drop column if exists category;
alter table public.groups drop column if exists room_number;

drop type if exists public.group_category;

-- ---------------------------------------------------------------------------
-- In with the new
-- ---------------------------------------------------------------------------

alter table public.groups
  add column if not exists owner_id    uuid references auth.users (id) on delete cascade,
  add column if not exists description text not null default '',
  add column if not exists invite_code text;

alter table public.groups alter column name drop default;

alter table public.groups drop constraint if exists groups_name_length;
alter table public.groups
  add constraint groups_name_length check (length(trim(name)) between 1 and 50);

alter table public.groups drop constraint if exists groups_description_length;
alter table public.groups
  add constraint groups_description_length check (length(description) <= 300);

-- Ambiguity-free alphabet: no O/0, no I/1/l. A code gets read aloud and typed by
-- hand, so the characters people confuse are simply not in it.
create or replace function public.new_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for _i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups g where g.invite_code = code);
  end loop;
  return code;
end;
$$;

update public.groups set invite_code = public.new_invite_code() where invite_code is null;

alter table public.groups alter column owner_id set not null;
alter table public.groups alter column invite_code set not null;
alter table public.groups add constraint groups_invite_code_key unique (invite_code);

create index if not exists groups_owner_idx on public.groups (owner_id);

comment on table public.groups is
  'User-created private groups. No directory: the invite code is the only way in.';

-- Owner-initiated invitations. Distinct from the code, which anyone holding can
-- use. A row here is a pending request the invited person accepts or declines.
create table if not exists public.group_invites (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_invites_user_idx on public.group_invites (user_id);

comment on table public.group_invites is
  'Pending owner invitations. Accepting is the only way a removed user rejoins.';

-- Someone the owner removed. Blocks join_by_code until they are invited back,
-- so removal means something without invalidating everyone else's code.
create table if not exists public.group_removals (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

comment on table public.group_removals is
  'Users the owner removed. They cannot rejoin with the code, only by invitation.';

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group and m.user_id = p_user
  );
$$;

create or replace function public.is_group_owner(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group and g.owner_id = p_user
  );
$$;

create or replace function public.can_post_to_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_tier() >= 1
     and public.is_group_member(p_group, auth.uid())
     -- The 10-per-minute flood limit lives here rather than in a trigger, and it
     -- counts a sender's messages across every group, not per group. Losing it
     -- while rewriting this function would be silent, so the suite checks it.
     and (
       select count(*) from public.group_messages gm
       where gm.sender_id = auth.uid()
         and gm.created_at > now() - interval '1 minute'
     ) < 10;
$$;

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------

create or replace function public.create_group(p_name text, p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if public.current_tier() < 1 then
    raise exception 'tier_too_low';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'name_required';
  end if;

  insert into public.groups (owner_id, name, description, invite_code)
  values (auth.uid(), trim(p_name), coalesce(trim(p_description), ''), public.new_invite_code())
  returning id into v_id;

  insert into public.group_members (group_id, user_id) values (v_id, auth.uid());
  return v_id;
end;
$$;

create or replace function public.join_group_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if public.current_tier() < 1 then
    raise exception 'tier_too_low';
  end if;

  select * into v_group from public.groups g
   where g.invite_code = upper(trim(p_code));
  if not found then
    raise exception 'no_such_code';
  end if;

  if public.is_group_member(v_group.id, auth.uid()) then
    return v_group.id;
  end if;

  -- Removal is not a soft signal. Only an invitation undoes it.
  if exists (
    select 1 from public.group_removals r
    where r.group_id = v_group.id and r.user_id = auth.uid()
  ) then
    raise exception 'removed_from_group';
  end if;

  if v_group.member_count >= v_group.capacity then
    raise exception 'group_full';
  end if;

  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid());
  delete from public.group_invites i
   where i.group_id = v_group.id and i.user_id = auth.uid();
  return v_group.id;
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- The owner cannot walk out of their own group and leave it ownerless; they
  -- delete it instead, which is an explicit and destructive choice.
  if public.is_group_owner(p_group, auth.uid()) then
    raise exception 'owner_cannot_leave';
  end if;
  delete from public.group_members m
   where m.group_id = p_group and m.user_id = auth.uid();
end;
$$;

create or replace function public.remove_group_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'not_group_owner';
  end if;
  if p_user = auth.uid() then
    raise exception 'cannot_remove_self';
  end if;

  delete from public.group_members m
   where m.group_id = p_group and m.user_id = p_user;
  insert into public.group_removals (group_id, user_id)
  values (p_group, p_user)
  on conflict do nothing;
  delete from public.group_invites i
   where i.group_id = p_group and i.user_id = p_user;
end;
$$;

create or replace function public.delete_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'not_group_owner';
  end if;
  delete from public.groups g where g.id = p_group;
end;
$$;

create or replace function public.regenerate_invite_code(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'not_group_owner';
  end if;
  v_code := public.new_invite_code();
  update public.groups g set invite_code = v_code where g.id = p_group;
  return v_code;
end;
$$;

create or replace function public.invite_to_group(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'not_group_owner';
  end if;
  if public.is_group_member(p_group, p_user) then
    return;
  end if;
  if public.is_blocked_pair(auth.uid(), p_user) then
    raise exception 'blocked';
  end if;

  -- An invitation is the owner's way of undoing a removal.
  delete from public.group_removals r
   where r.group_id = p_group and r.user_id = p_user;

  insert into public.group_invites (group_id, user_id, invited_by)
  values (p_group, p_user, auth.uid())
  on conflict (group_id, user_id) do update set created_at = now();
end;
$$;

create or replace function public.accept_group_invite(p_group uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.group_invites i
    where i.group_id = p_group and i.user_id = auth.uid()
  ) then
    raise exception 'no_invite';
  end if;

  select * into v_group from public.groups g where g.id = p_group;
  if not found then
    raise exception 'no_such_group';
  end if;
  if v_group.member_count >= v_group.capacity then
    raise exception 'group_full';
  end if;

  insert into public.group_members (group_id, user_id)
  values (p_group, auth.uid())
  on conflict do nothing;
  delete from public.group_invites i
   where i.group_id = p_group and i.user_id = auth.uid();
  return p_group;
end;
$$;

create or replace function public.decline_group_invite(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.group_invites i
   where i.group_id = p_group and i.user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- The Groups tab. Last message and its time are here so the list can show which
-- groups are alive without opening each one.
create or replace function public.my_groups()
returns table (
  id           uuid,
  name         text,
  description  text,
  member_count integer,
  is_owner     boolean,
  invite_code  text,
  last_body    text,
  last_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.name,
    g.description,
    g.member_count,
    g.owner_id = auth.uid(),
    -- The code is the key to the door: only the owner gets to read it.
    case when g.owner_id = auth.uid() then g.invite_code else null end,
    last.body,
    coalesce(last.created_at, g.created_at)
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  left join lateral (
    select gm.body, gm.created_at
    from public.group_messages gm
    where gm.group_id = g.id
    order by gm.created_at desc
    limit 1
  ) last on true
  where auth.uid() is not null
  order by coalesce(last.created_at, g.created_at) desc;
$$;

create or replace function public.my_group_invites()
returns table (
  group_id     uuid,
  name         text,
  description  text,
  member_count integer,
  invited_by   text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.group_id, g.name, g.description, g.member_count,
         coalesce(p.display_name, p.username::text), i.created_at
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  left join public.profiles p on p.id = i.invited_by
  where i.user_id = auth.uid()
  order by i.created_at desc;
$$;

create or replace function public.group_members_list(p_group uuid)
returns table (
  id           uuid,
  username     citext,
  display_name text,
  dp_url       text,
  is_owner     boolean,
  joined_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.dp_url, g.owner_id = p.id, m.joined_at
  from public.group_members m
  join public.groups g on g.id = m.group_id
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group, auth.uid())
  order by (g.owner_id = p.id) desc, m.joined_at;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select to authenticated
  using (
    public.is_group_member(id, auth.uid())
    or exists (
      select 1 from public.group_invites i
      where i.group_id = id and i.user_id = auth.uid()
    )
  );

drop policy if exists group_members_read on public.group_members;
create policy group_members_read on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id, auth.uid()));

alter table public.group_invites enable row level security;
revoke all on public.group_invites from anon, authenticated;
grant select on public.group_invites to authenticated;

drop policy if exists group_invites_read on public.group_invites;
create policy group_invites_read on public.group_invites
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_owner(group_id, auth.uid()));

alter table public.group_removals enable row level security;
revoke all on public.group_removals from anon, authenticated;


-- Private groups make both of these load-bearing. Under the old design rooms were
-- public and Tier 0 could read them, so `using (true)` was deliberate. Now the
-- same policy would let any signed-in user read every private group, and
-- group_thread() — SECURITY DEFINER, checking only that a caller exists — would
-- hand over any group's messages to anyone who knew its id.

drop policy if exists group_messages_read on public.group_messages;
create policy group_messages_read on public.group_messages
  for select to authenticated
  using (public.is_group_member(group_id, auth.uid()));

create or replace function public.group_thread(p_group uuid, p_limit integer default 50)
returns table (
  id           uuid,
  sender_id    uuid,
  username     citext,
  display_name text,
  dp_url       text,
  body         text,
  created_at   timestamptz,
  is_blocked   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.sender_id,
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else p.username end,
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else p.display_name end,
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else p.dp_url end,
    case when public.is_blocked_pair(auth.uid(), m.sender_id) then null else m.body end,
    m.created_at,
    public.is_blocked_pair(auth.uid(), m.sender_id)
  from public.group_messages m
  join public.profiles p on p.id = m.sender_id
  where m.group_id = p_group
    and auth.uid() is not null
    and public.is_group_member(p_group, auth.uid())
  order by m.created_at desc
  limit greatest(least(p_limit, 200), 1);
$$;

-- The DPDP export listed each membership's category, a column that no longer
-- exists. It now names the group and says whether you own it.
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
        'name', gr.name, 'joined_at', gm.joined_at, 'owner', gr.owner_id = uid
      )), '[]'::jsonb)
      from public.group_members gm
      join public.groups gr on gr.id = gm.group_id
      where gm.user_id = uid
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

-- The Groups tab badges pending invitations, which needs Realtime to see them.
do $$
begin
  alter publication supabase_realtime add table public.group_invites;
exception when duplicate_object then null;
end;
$$;

-- Match lost its scope and same-gender filters on 2026-09-06. The columns stay
-- for now, but the feed must stop reading them: with the toggles gone, anyone
-- whose match_scope still says same_college would have been silently pinned to
-- their own college with no way to change it, and no college means no feed.
create or replace function public.match_feed(p_limit integer default 20)
returns table (id uuid, username citext, display_name text, dp_url text, college_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.dp_url, p.college_id
  from public.profiles p
  where public.current_tier() >= 1
    and p.id <> auth.uid()
    and p.trust_tier >= 1
    and p.onboarding_complete
    and not public.is_banned(p.id)
    and not public.is_blocked_pair(auth.uid(), p.id)
    and not exists (
      select 1 from public.loots l
      where l.actor_id = auth.uid() and l.target_id = p.id
    )
  order by random()
  limit greatest(least(p_limit, 50), 1);
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.new_invite_code() from public, anon, authenticated;

grant execute on function public.current_tier()                          to authenticated;
grant execute on function public.is_banned(uuid)                         to authenticated;
grant execute on function public.is_alumni(smallint)                     to authenticated;
grant execute on function public.college_for_email(text)                 to authenticated;
grant execute on function public.confirm_college_email(text)             to authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid)             to authenticated;
grant execute on function public.is_thread_participant(uuid, uuid)       to authenticated;
grant execute on function public.can_post_to_thread(uuid)                to authenticated;
grant execute on function public.open_dm_thread(uuid)                    to authenticated;
grant execute on function public.can_report()                            to authenticated;
grant execute on function public.can_post_to_group(uuid)                 to authenticated;
grant execute on function public.is_group_member(uuid, uuid)             to authenticated;
grant execute on function public.is_group_owner(uuid, uuid)              to authenticated;
grant execute on function public.create_group(text, text)                to authenticated;
grant execute on function public.join_group_by_code(text)                to authenticated;
grant execute on function public.leave_group(uuid)                       to authenticated;
grant execute on function public.remove_group_member(uuid, uuid)         to authenticated;
grant execute on function public.delete_group(uuid)                      to authenticated;
grant execute on function public.regenerate_invite_code(uuid)            to authenticated;
grant execute on function public.invite_to_group(uuid, uuid)             to authenticated;
grant execute on function public.accept_group_invite(uuid)               to authenticated;
grant execute on function public.decline_group_invite(uuid)              to authenticated;
grant execute on function public.my_groups()                             to authenticated;
grant execute on function public.my_group_invites()                      to authenticated;
grant execute on function public.group_members_list(uuid)                to authenticated;
grant execute on function public.group_thread(uuid, integer)             to authenticated;
grant execute on function public.match_feed(integer)                     to authenticated;
grant execute on function public.looted_you()                            to authenticated;
grant execute on function public.looted_you_count()                      to authenticated;
grant execute on function public.loots_remaining()                       to authenticated;
grant execute on function public.loots_used_today(uuid)                  to authenticated;
grant execute on function public.daily_loot_limit(uuid)                  to authenticated;
grant execute on function public.is_paid(uuid)                           to authenticated;
grant execute on function public.my_threads()                            to authenticated;
grant execute on function public.my_match_prefs()                        to authenticated;
grant execute on function public.search_users(text, integer)             to authenticated;
grant execute on function public.my_friend_requests()                    to authenticated;
grant execute on function public.my_friends()                            to authenticated;
grant execute on function public.can_read_chat_image(text)               to authenticated;
grant execute on function public.can_write_chat_image(text)              to authenticated;
grant execute on function public.register_push_token(text)               to authenticated;
grant execute on function public.unregister_push_token(text)             to authenticated;
grant execute on function public.record_screenshot(uuid)                 to authenticated;
grant execute on function public.export_my_data()                        to authenticated;
grant execute on function public.my_blocks()                             to authenticated;
grant execute on function public.mark_thread_read(uuid)                  to authenticated;
grant execute on function public.set_typing(uuid)                        to authenticated;
grant execute on function public.clear_typing(uuid)                      to authenticated;
grant execute on function public.peer_is_typing(uuid)                    to authenticated;
