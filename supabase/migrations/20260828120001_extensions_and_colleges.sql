-- Looty — Phase 1: extensions, colleges, domain allowlist, college requests
--
-- The domain allowlist is the FAST PATH to Tier 2, not a signup gate. Any email
-- can sign up (Tier 0). A domain match here means the user skips ID verification
-- entirely. See CONTEXT.md §4.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive usernames + domains
create extension if not exists pg_trgm;    -- fuzzy college name search

-- ---------------------------------------------------------------------------
-- Colleges
-- ---------------------------------------------------------------------------

create type public.college_status as enum ('active', 'pending');

create table public.colleges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  state       text,
  status      public.college_status not null default 'active',
  created_at  timestamptz not null default now()
);

-- Students search this list by name during signup; trigram index keeps it fast
-- and tolerant of spelling ("indian institue of tech").
create index colleges_name_trgm_idx on public.colleges using gin (name gin_trgm_ops);
create index colleges_status_idx on public.colleges (status) where status = 'active';

-- ---------------------------------------------------------------------------
-- Domain allowlist
-- ---------------------------------------------------------------------------
--
-- TRAP 1: never decide "is this a college domain" by checking whether the mail is
-- Google-hosted. Many Indian colleges run Workspace, so name@college.ac.in is
-- Gmail underneath. Matching is a literal string lookup against this table.
--
-- TRAP 2: no wildcards. A college may use @xyz.ac.in for staff and
-- @student.xyz.ac.in for students. Storing a wildcard would also admit
-- @alumni.xyz.ac.in. Every domain is listed exactly.

create table public.college_domains (
  id          uuid primary key default gen_random_uuid(),
  college_id  uuid not null references public.colleges (id) on delete cascade,
  domain      citext not null unique,
  created_at  timestamptz not null default now(),

  -- Shape check doubles as the wildcard guard: '*' and '%' cannot match.
  constraint college_domains_shape
    check (domain::text ~* '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$')
);

create index college_domains_college_idx on public.college_domains (college_id);

comment on table public.college_domains is
  'Exact college email domains. Match = instant Tier 2, ID step skipped. Not a signup gate.';

-- ---------------------------------------------------------------------------
-- "Request to add my college" queue
-- ---------------------------------------------------------------------------

create type public.request_status as enum ('pending', 'approved', 'rejected');

create table public.college_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users (id) on delete cascade,
  college_name  text not null,
  city          text,
  domain        citext,
  status        public.request_status not null default 'pending',
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);

create index college_requests_pending_idx
  on public.college_requests (created_at) where status = 'pending';
create index college_requests_requester_idx on public.college_requests (requester_id);

-- ---------------------------------------------------------------------------
-- Domain lookup used by the signup flow
-- ---------------------------------------------------------------------------
--
-- Returns the college for an email address, or null. security definer so it works
-- before the caller has a profile row.

create or replace function public.college_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cd.college_id
  from public.college_domains cd
  join public.colleges c on c.id = cd.college_id
  where cd.domain = split_part(lower(trim(p_email)), '@', 2)::citext
    and c.status = 'active'
  limit 1;
$$;

comment on function public.college_for_email(text) is
  'Literal domain lookup. Returns college id for a college email, null otherwise.';
