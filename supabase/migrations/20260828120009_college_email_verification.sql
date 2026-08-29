-- Looty — college email becomes the only route to full access
--
-- The ID card path is removed from the product. Everything about it in the schema
-- (verifications.ocr_*, face_match_score, image paths, the 'id_card' method) is
-- left in place but DORMANT, so reinstating it costs a decision rather than a
-- rebuild — see LOG.md 2026-08-28.
--
-- Consequence to keep in mind: reach is now exactly the domain allowlist. A student
-- whose college issues no email can never pass Tier 0. That is a deliberate trade,
-- not an oversight.

-- ---------------------------------------------------------------------------
-- The verified college address lives on the profile
-- ---------------------------------------------------------------------------
--
-- Unique across all users: one mailbox, one account. This is also the ban anchor
-- now that phone OTP is gone — a Gmail is free and infinite, a college address is
-- one per student and hard to get another of.
--
-- PRIVATE: never granted to `authenticated`, same as full_name.

alter table public.profiles
  add column college_email citext unique;

comment on column public.profiles.college_email is
  'Verified college address. Private, and the anchor permanent bans are enforced against.';

-- phone_hash / phone_verified_at are now dormant too. Phone OTP was dropped because
-- the college address does the ban-anchoring job without DLT registration.

-- ---------------------------------------------------------------------------
-- Ban anchors, generalised
-- ---------------------------------------------------------------------------

drop table if exists public.banned_phone_hashes;

create table public.banned_identities (
  hash      text primary key,
  kind      text not null check (kind in ('college_email', 'phone')),
  banned_at timestamptz not null default now()
);

comment on table public.banned_identities is
  'Hashed identifiers of permanently banned users. Survives account deletion, which is the point.';

-- ---------------------------------------------------------------------------
-- Email verification codes
-- ---------------------------------------------------------------------------

create table public.email_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       citext not null,
  college_id  uuid not null references public.colleges (id),

  -- The code is never stored. sha256(code || per-row salt) is, so a database leak
  -- does not hand anyone a working code. Core Postgres sha256 — deliberately not
  -- pgcrypto, so the test harness can run this without extensions.
  code_salt   text not null,
  code_hash   text not null,

  expires_at  timestamptz not null,
  attempts    smallint not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index email_verifications_user_idx on public.email_verifications (user_id, created_at desc);
create index email_verifications_live_idx on public.email_verifications (user_id)
  where consumed_at is null;

/**
 * Hash a code against a salt. Kept in one place so issuing and checking can never
 * drift apart.
 */
create or replace function public.hash_email_code(p_code text, p_salt text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_code || p_salt, 'UTF8')), 'hex');
$$;

/**
 * Confirms a code and promotes the user to Tier 2.
 *
 * Client-callable: it takes the code as input and only succeeds if it is right, so
 * there is nothing to leak. Issuing the code is the opposite — that runs in an Edge
 * Function under service_role, because the raw code must go to the mailbox and
 * never to the caller.
 *
 * RETURNS A STATUS STRING RATHER THAN RAISING, and that is load-bearing.
 * `raise exception` aborts the surrounding subtransaction, which would roll back
 * the attempt counter incremented moments earlier — leaving `attempts` permanently
 * at zero and the five-try lockout permanently disabled. A six-digit code with no
 * working lockout is brute-forceable in seconds. Callers must check the return
 * value; 'ok' is the only success.
 *
 * Statuses: ok | no_pending | expired | too_many_attempts | invalid_code |
 *           email_already_claimed | identity_banned | not_authenticated
 */
create or replace function public.confirm_college_email(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.email_verifications%rowtype;
begin
  if auth.uid() is null then
    return 'not_authenticated';
  end if;

  select * into v
  from public.email_verifications
  where user_id = auth.uid() and consumed_at is null
  order by created_at desc
  limit 1;

  if not found then
    return 'no_pending';
  end if;

  if v.expires_at <= now() then
    return 'expired';
  end if;

  -- Five tries against a six-digit code. Without a counter that actually persists,
  -- a million guesses walks straight in.
  if v.attempts >= 5 then
    return 'too_many_attempts';
  end if;

  if v.code_hash <> public.hash_email_code(p_code, v.code_salt) then
    update public.email_verifications set attempts = attempts + 1 where id = v.id;
    return 'invalid_code';
  end if;

  -- Someone else already holds this address. One mailbox, one account.
  if exists (select 1 from public.profiles p
             where p.college_email = v.email and p.id <> auth.uid()) then
    return 'email_already_claimed';
  end if;

  if exists (select 1 from public.banned_identities b
             where b.kind = 'college_email'
               and b.hash = encode(sha256(convert_to(lower(v.email::text), 'UTF8')), 'hex')) then
    return 'identity_banned';
  end if;

  update public.email_verifications set consumed_at = now() where id = v.id;

  update public.profiles
     set college_email = v.email,
         college_id    = v.college_id,
         trust_tier    = greatest(trust_tier, 2::smallint)
   where id = auth.uid();

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.email_verifications enable row level security;
alter table public.banned_identities   enable row level security;

-- The client may see that a verification is pending and when it expires, so the UI
-- can show a countdown. It may NOT see code_hash or code_salt.
grant select (id, email, college_id, expires_at, attempts, consumed_at, created_at)
  on public.email_verifications to authenticated;

create policy email_verifications_read_own on public.email_verifications
  for select to authenticated using (user_id = auth.uid());

-- No INSERT grant: codes are issued only by the Edge Function under service_role.
-- No UPDATE grant: attempts and consumption are moved by confirm_college_email().

grant execute on function public.confirm_college_email(text) to authenticated;
revoke all on function public.hash_email_code(text, text) from public, anon, authenticated;

-- banned_identities gets no grant and no policy: service_role only. Exposing it
-- would let anyone test whether a given address is banned.
