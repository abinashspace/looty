-- Looty — Phase 1: profiles, username rules, alumni derivation
--
-- Privacy note: full_name and phone_hash are NEVER readable by the client. That is
-- enforced with column-level grants in the RLS migration, not by RLS alone (RLS is
-- row-level and cannot hide a column).

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,

  username            citext unique,
  username_changed_at timestamptz,

  -- PRIVATE. Source is ID card OCR — the user never types this and never sees it
  -- back. display_name is what everyone else sees.
  full_name           text,
  display_name        text,
  dp_url              text,

  -- Set server-side only, after verification passes. Never client-writable.
  college_id          uuid references public.colleges (id) on delete set null,

  course_years        smallint check (course_years between 1 and 7),
  start_year          smallint check (start_year between 2000 and 2100),
  end_year            smallint generated always as (start_year + course_years) stored,

  gender              text check (gender in ('man', 'woman', 'non_binary', 'undisclosed')),

  -- 0 unverified / 1 ID-verified / 2 college-verified. Never client-writable.
  trust_tier          smallint not null default 0 check (trust_tier between 0 and 2),

  -- PRIVATE. Hashed with a server-side pepper in the Edge Function; the raw number
  -- is used only transiently at OTP send time and never stored. This is the ban
  -- anchor — email hashes are worthless now that Gmail signup is open.
  phone_hash          text unique,
  phone_verified_at   timestamptz,

  onboarding_complete boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint profiles_username_shape
    check (username is null or username::text ~* '^[a-z0-9_]{3,20}$')
);

create index profiles_college_idx on public.profiles (college_id);
create index profiles_tier_idx on public.profiles (trust_tier);

-- ---------------------------------------------------------------------------
-- Reserved usernames
-- ---------------------------------------------------------------------------
-- A table rather than a check constraint so the list can grow without a migration.

create table public.reserved_usernames (
  username citext primary key
);

insert into public.reserved_usernames (username) values
  ('looty'), ('admin'), ('support'), ('official'), ('team'), ('help'),
  ('moderator'), ('mod'), ('staff'), ('system'), ('root'), ('null');

-- ---------------------------------------------------------------------------
-- Username rules: reserved list + one change per 14 days
-- ---------------------------------------------------------------------------

create or replace function public.enforce_username_rules()
returns trigger
language plpgsql
as $$
begin
  if new.username is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if exists (select 1 from public.reserved_usernames r where r.username = new.username) then
    raise exception 'username_reserved' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE'
     and old.username is not null
     and old.username_changed_at is not null
     and old.username_changed_at > now() - interval '14 days' then
    raise exception 'username_change_too_soon' using errcode = 'check_violation';
  end if;

  new.username_changed_at := now();
  return new;
end;
$$;

create trigger profiles_username_rules
  before insert or update of username on public.profiles
  for each row execute function public.enforce_username_rules();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Alumni
-- ---------------------------------------------------------------------------
--
-- Alumni are NEVER cut off — this drives a badge, not a ban. Indian academic years
-- end around May/June, so someone whose end_year is the current year becomes alumni
-- from July rather than waiting until January.

create or replace function public.is_alumni(p_end_year smallint)
returns boolean
language sql
immutable
as $$
  select p_end_year is not null
     and (p_end_year < extract(year from now())::smallint
          or (p_end_year = extract(year from now())::smallint
              and extract(month from now())::smallint > 6));
$$;

comment on function public.is_alumni(smallint) is
  'Drives the Alumni badge. Alumni retain full access — this is display only.';

-- ---------------------------------------------------------------------------
-- Profile row is created automatically on signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
