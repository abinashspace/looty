-- Looty — Phase 3: global group rooms
--
-- Study / Sports / Friends. Global (not per-college), open join, TEXT ONLY.
-- 1024 members per room, matching WhatsApp; at capacity the next numbered room is
-- created automatically — Study 1, Study 2, Study 3…
--
-- Tier 0 reads. Posting needs Tier 1+ and membership.

create type public.group_category as enum ('study', 'sports', 'friends');

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  category     public.group_category not null,
  room_number  integer not null check (room_number >= 1),
  member_count integer not null default 0 check (member_count >= 0),
  capacity     integer not null default 1024 check (capacity > 0),
  created_at   timestamptz not null default now(),

  -- "Study 2". Always derived from category + room_number by the trigger below,
  -- never free text, so a room's label cannot drift from what it actually is.
  -- (A generated column would be the natural fit, but casting an enum to text is
  -- not immutable enough for one.)
  name         text not null default '',

  unique (category, room_number)
);

create or replace function public.set_group_name()
returns trigger
language plpgsql
as $$
begin
  new.name := initcap(new.category::text) || ' ' || new.room_number;
  return new;
end;
$$;

create trigger groups_set_name
  before insert or update of category, room_number on public.groups
  for each row execute function public.set_group_name();

-- Lets group_members carry a category that is guaranteed to match its group,
-- which is what makes "one room per category per user" a plain constraint below.
alter table public.groups add constraint groups_id_category_key unique (id, category);

create index groups_open_idx on public.groups (category, room_number)
  where member_count < capacity;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,

  -- Denormalised so a user cannot end up in Study 1 and Study 2 at once. The
  -- composite foreign key below guarantees it still matches the group's category.
  category  public.group_category not null,
  joined_at timestamptz not null default now(),

  primary key (group_id, user_id),
  unique (user_id, category),
  foreign key (group_id, category)
    references public.groups (id, category) on delete cascade
);

create index group_members_user_idx on public.group_members (user_id);

-- member_count is maintained by trigger rather than by the join function, so that
-- leaving, cascade deletes and any future admin removal all keep it honest.
create or replace function public.sync_group_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.groups set member_count = member_count + 1 where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups set member_count = greatest(member_count - 1, 0) where id = old.group_id;
  end if;
  return null;
end;
$$;

create trigger group_members_count
  after insert or delete on public.group_members
  for each row execute function public.sync_group_member_count();

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
--
-- THERE IS NO image_url COLUMN, and that is the point. "Text only" is enforced by
-- the column not existing rather than by a validation rule someone can later
-- relax. Groups are strangers at scale; images there would be the single largest
-- moderation burden in the app.

create table public.group_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  sender_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint group_messages_body_length check (length(trim(body)) between 1 and 2000)
);

create index group_messages_room_idx on public.group_messages (group_id, created_at desc);
create index group_messages_sender_recent_idx on public.group_messages (sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Automatic word filter
-- ---------------------------------------------------------------------------
--
-- Deliberately shipped EMPTY. Populate it separately — a word list is a policy
-- decision, and a bad one is worse than none.

create table public.blocked_terms (
  term       citext primary key,
  created_at timestamptz not null default now()
);

/**
 * Whether a message trips the word filter.
 *
 * Matches on WORD BOUNDARIES (\m … \M), not substrings. A plain LIKE '%term%'
 * would reject "Scunthorpe", "assignment", "classic" and so on — the classic
 * false-positive trap, and one that makes a filter look broken to real users.
 */
create or replace function public.trips_word_filter(p_body text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_terms t
    where p_body ~* ('\m' || t.term::text || '\M')
  );
$$;

/**
 * Applied as a TRIGGER, not inside the RLS policy, and that placement matters.
 *
 * An RLS `with check` runs as the calling user, so referencing trips_word_filter
 * there would require granting EXECUTE on it to `authenticated` — which hands
 * clients an oracle for probing the word list one guess at a time. A security
 * definer trigger runs as the owner, so the list stays private.
 *
 * It also produces a clearer failure: 'message_blocked' rather than a generic
 * row-level-security violation the client cannot explain to the user.
 */
create or replace function public.reject_filtered_group_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.trips_word_filter(new.body) then
    raise exception 'message_blocked' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger group_messages_word_filter
  before insert on public.group_messages
  for each row execute function public.reject_filtered_group_message();

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

/**
 * Joins the caller to a category, returning the room they landed in.
 *
 * Assignment is automatic: first room with space, else a new one. Users never pick
 * a room number — "Study 3" is an implementation detail of capacity, not a place
 * anyone chose to be.
 *
 * The loop plus row lock is what makes this safe when two people take the last
 * seat at the same time: the second waits, re-reads the now-full room, and moves
 * on to the next. The unique_violation catch covers two people creating the same
 * new room number simultaneously.
 */
create or replace function public.join_group(p_category public.group_category)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
  v_next  integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- current_tier() folds in the ban check, so a banned user cannot join either.
  if public.current_tier() < 1 then
    raise exception 'tier_too_low';
  end if;

  select g.* into v_group
  from public.groups g
  join public.group_members m on m.group_id = g.id
  where m.user_id = auth.uid() and g.category = p_category;
  if found then
    return v_group.id;
  end if;

  loop
    select * into v_group
    from public.groups
    where category = p_category and member_count < capacity
    order by room_number
    limit 1
    for update;

    if found then
      insert into public.group_members (group_id, user_id, category)
      values (v_group.id, auth.uid(), p_category);
      return v_group.id;
    end if;

    select coalesce(max(room_number), 0) + 1 into v_next
    from public.groups where category = p_category;

    begin
      insert into public.groups (category, room_number)
      values (p_category, v_next)
      returning * into v_group;

      insert into public.group_members (group_id, user_id, category)
      values (v_group.id, auth.uid(), p_category);
      return v_group.id;
    exception when unique_violation then
      -- Someone else created this room number first. Go round again and join it.
      null;
    end;
  end loop;
end;
$$;

create or replace function public.leave_group(p_category public.group_category)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.group_members
  where user_id = auth.uid() and category = p_category;
$$;

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------

/**
 * Whether the caller may post to a group right now.
 *
 * Rate limit is per user across ALL rooms, not per room — otherwise a spammer
 * simply spreads the same flood across Study, Sports and Friends.
 */
create or replace function public.can_post_to_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_tier() >= 1
     and exists (
       select 1 from public.group_members m
       where m.group_id = p_group and m.user_id = auth.uid()
     )
     and (
       select count(*) from public.group_messages gm
       where gm.sender_id = auth.uid()
         and gm.created_at > now() - interval '1 minute'
     ) < 10;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.group_messages enable row level security;
alter table public.blocked_terms  enable row level security;

-- Rooms and membership are public to signed-in users: these are global open
-- rooms, and seeing who is in one is part of deciding to join.
grant select on public.groups to authenticated;
create policy groups_read on public.groups
  for select to authenticated using (true);

grant select on public.group_members to authenticated;
create policy group_members_read on public.group_members
  for select to authenticated using (true);

-- No INSERT or DELETE grant: membership changes only via join_group/leave_group,
-- which enforce tier, capacity and one-room-per-category.

-- Tier 0 reads. This is the one surface unverified users get, so the policy is
-- deliberately open rather than membership-gated.
grant select on public.group_messages to authenticated;
create policy group_messages_read on public.group_messages
  for select to authenticated using (true);

grant insert (group_id, sender_id, body) on public.group_messages to authenticated;
create policy group_messages_insert on public.group_messages
  for insert to authenticated
  -- The word filter is NOT here — see reject_filtered_group_message() above for
  -- why it has to be a trigger instead.
  with check (
    sender_id = auth.uid()
    and public.can_post_to_group(group_id)
  );

-- Senders may delete their own. Nobody may edit — same reasoning as DMs: a report
-- is judged on what was actually sent.
grant delete on public.group_messages to authenticated;
create policy group_messages_delete_own on public.group_messages
  for delete to authenticated using (sender_id = auth.uid());

-- blocked_terms gets no client grant. Publishing the word list tells people
-- exactly what to work around.

grant execute on function public.join_group(public.group_category) to authenticated;
grant execute on function public.leave_group(public.group_category) to authenticated;
grant execute on function public.can_post_to_group(uuid) to authenticated;
revoke all on function public.trips_word_filter(text) from public, anon, authenticated;
