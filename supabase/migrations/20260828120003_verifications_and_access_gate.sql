-- Looty — Phase 1: verification records, minimal ban table, access gate
--
-- The ban table is created here rather than in Phase 5 because the access gate
-- depends on it. Access control is not something to retrofit later; the ban
-- *engine* (thresholds, anti-brigade rules, escalation) still lands in Phase 5.

-- ---------------------------------------------------------------------------
-- Verifications
-- ---------------------------------------------------------------------------

create type public.verification_method as enum ('college_email', 'id_card');
create type public.verification_status as enum ('pending', 'passed', 'flagged', 'rejected');

create table public.verifications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  method             public.verification_method not null,
  status             public.verification_status not null default 'pending',

  -- The college the user SAID they attend. OCR result is compared against this.
  claimed_college_id uuid references public.colleges (id),

  -- OCR output. ocr_name is the source of profiles.full_name — it is not compared
  -- against anything the user typed, because the user never types a name.
  ocr_name           text,
  ocr_college        text,
  ocr_roll           text,
  ocr_expiry         date,

  -- ID card photo vs live selfie. The single highest-value check in the system:
  -- almost nobody forges a card, they use a real card belonging to someone else.
  face_match_score   numeric(4, 3) check (face_match_score between 0 and 1),

  failure_reason     text,

  -- Deleted after 30 days by a scheduled sweep. Extracted fields and the score are
  -- retained as proof; the images are not. See CONTEXT.md §4.4.
  id_image_path      text,
  selfie_image_path  text,
  images_deleted_at  timestamptz,

  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz
);

create index verifications_user_idx on public.verifications (user_id);

-- Manual review queue. Small by design — tune confidence thresholds to keep it that
-- way. It cannot be eliminated: Indian college IDs have no standard format, so some
-- genuine cards will always fail automated checks.
create index verifications_queue_idx on public.verifications (created_at)
  where status in ('pending', 'flagged');

-- Drives the 30-day image deletion sweep.
create index verifications_retention_idx on public.verifications (created_at)
  where images_deleted_at is null;

-- ---------------------------------------------------------------------------
-- Bans (minimal — engine arrives in Phase 5)
-- ---------------------------------------------------------------------------

create type public.ban_type as enum ('temporary', 'permanent');

create table public.bans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       public.ban_type not null,
  reason     text,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_at timestamptz not null default now(),

  constraint bans_duration check (
    (type = 'permanent' and ends_at is null) or
    (type = 'temporary' and ends_at is not null)
  )
);

create index bans_user_idx on public.bans (user_id);

-- Permanent bans are anchored on the hashed phone number, not email. A new Gmail
-- takes two minutes; an Indian SIM is Aadhaar-linked and scarce.
create table public.banned_phone_hashes (
  phone_hash text primary key,
  banned_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access gate
-- ---------------------------------------------------------------------------
--
-- Every RLS policy in every later phase calls current_tier(). Gating must never
-- live in the client — hidden UI is not access control, and tests deliberately
-- call endpoints directly to prove it.

create or replace function public.is_banned(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bans b
    where b.user_id = p_uid
      and b.starts_at <= now()
      and (b.ends_at is null or b.ends_at > now())
  );
$$;

-- A banned user collapses to Tier 0: they can still read groups but cannot post,
-- DM, or use Match. This means the ban check is built into every tier comparison
-- and does not need repeating in each policy.
create or replace function public.current_tier()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 0::smallint
    when public.is_banned(auth.uid()) then 0::smallint
    else coalesce(
      (select p.trust_tier from public.profiles p where p.id = auth.uid()),
      0::smallint
    )
  end;
$$;

comment on function public.current_tier() is
  'Effective trust tier of the caller. Banned users collapse to 0. Every gated RLS policy uses this.';

-- ---------------------------------------------------------------------------
-- Applying a verification result
-- ---------------------------------------------------------------------------
--
-- Service-role only. This is the ONLY path that raises a trust tier — nothing
-- client-side can reach trust_tier at all (see column grants in the RLS migration).

create or replace function public.apply_verification(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.verifications%rowtype;
  v_tier smallint;
begin
  select * into v from public.verifications where id = p_verification_id;
  if not found then
    raise exception 'verification_not_found';
  end if;

  if v.status <> 'passed' then
    return;  -- flagged/rejected/pending grant nothing
  end if;

  v_tier := case v.method when 'college_email' then 2 else 1 end;

  update public.profiles
     set trust_tier = greatest(trust_tier, v_tier),
         college_id = coalesce(v.claimed_college_id, college_id),
         full_name  = coalesce(v.ocr_name, full_name)
   where id = v.user_id;
end;
$$;

revoke all on function public.apply_verification(uuid) from public, anon, authenticated;
