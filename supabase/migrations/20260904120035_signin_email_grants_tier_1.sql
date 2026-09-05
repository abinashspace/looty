-- Looty — a confirmed sign-in address is enough. The domain list becomes a badge.
--
-- Until now the college domain allowlist was the gate: no college mailbox, no
-- posting, no DMs, no Match, permanently. CONTEXT.md §7 called that the single
-- biggest risk in the product, because reach was exactly the allowlist and most
-- Indian colleges issue no student mail at all.
--
-- This migration removes it as a *gate* and keeps it as a *badge*:
--
--   Tier 0  no confirmed address, or a banned one   read groups, nothing else
--   Tier 1  any confirmed sign-in address           FULL ACCESS          ← new
--   Tier 2  college address confirmed               full + College Verified
--
-- No RLS policy changes, and none are needed: every gate in every phase already
-- reads `current_tier() >= 1`, and nothing has ever reached Tier 1. Tier 1 was
-- deliberately kept in the numbering for a change like this one, so waking it up
-- unlocks groups, DMs, reports and Match at once. Tier 2 gates nothing and never
-- did — it is the badge and the strong ban anchor.
--
-- WHAT THIS COSTS, STATED PLAINLY. §4.6 anchored permanent bans on the college
-- address because "a Gmail is free and infinite, so hashing it is worthless as a
-- ban anchor". That reasoning is still true, and this migration does not repeal
-- it. Anchoring on the sign-in address (below) raises the cost of evasion from
-- nothing to "make another address" — real, but weak. Accepted deliberately for
-- now; see LOG.md 2026-09-04.

-- ---------------------------------------------------------------------------
-- The anchor hash, in one place
-- ---------------------------------------------------------------------------
--
-- Same expression the moderation engine already inlines for college addresses.
-- Named here so the new call sites cannot drift from it.

create or replace function public.email_anchor_hash(p_email text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(lower(p_email), 'UTF8')), 'hex');
$$;

comment on function public.email_anchor_hash(text) is
  'sha256 of a lowercased address, hex. The form stored in banned_identities.';

alter table public.banned_identities
  drop constraint banned_identities_kind_check;

alter table public.banned_identities
  add constraint banned_identities_kind_check
  check (kind in ('college_email', 'phone', 'account_email'));

comment on table public.banned_identities is
  'Hashed identifiers of permanently banned users. Survives account deletion, which is the point. college_email is the strong anchor (one per student); account_email is weak (free and infinite) and is best-effort only.';

-- ---------------------------------------------------------------------------
-- What a sign-in address is worth
-- ---------------------------------------------------------------------------

create or replace function public.signin_tier(p_email text, p_confirmed_at timestamptz)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- An address nobody has proved they can read is worth nothing. With email
    -- confirmation disabled Supabase stamps email_confirmed_at at signup, so
    -- this is a live check in both configurations rather than dead code.
    when p_email is null or p_confirmed_at is null then 0::smallint
    when exists (
      select 1 from public.banned_identities b
      where b.kind = 'account_email'
        and b.hash = public.email_anchor_hash(p_email)
    ) then 0::smallint
    else 1::smallint
  end;
$$;

comment on function public.signin_tier(text, timestamptz) is
  'Tier a sign-in address alone earns: 1 once confirmed, 0 if unconfirmed or banned.';

-- ---------------------------------------------------------------------------
-- Granting it
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, trust_tier)
  values (new.id, public.signin_tier(new.email, new.email_confirmed_at))
  on conflict (id) do nothing;
  -- Carried forward from migration 23. A create-or-replace here silently drops
  -- whatever the previous definition also did, and the prefs row is that.
  insert into public.notification_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- If confirmation is ever switched on, it lands as an UPDATE well after signup.
-- greatest() so this can only ever raise a tier, never demote a Tier 2 student.
create or replace function public.on_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set trust_tier = greatest(trust_tier,
                               public.signin_tier(new.email, new.email_confirmed_at))
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (new.email_confirmed_at is not null and old.email_confirmed_at is null)
  execute function public.on_email_confirmed();

-- Everyone who signed up under the old rule and is sitting at Tier 0 for no
-- reason other than not having a college mailbox.
update public.profiles p
   set trust_tier = 1
  from auth.users u
 where u.id = p.id
   and p.trust_tier = 0
   and public.signin_tier(u.email, u.email_confirmed_at) = 1;

-- ---------------------------------------------------------------------------
-- The weak ban anchor
-- ---------------------------------------------------------------------------
--
-- Additive on purpose. evaluate_reports() / unwind_bans_from_banned_reporter() /
-- resolve_appeal() keep sole ownership of the college_email anchor; this pair of
-- triggers owns the account_email one and nothing else, so the strong path is
-- untouched by this change.
--
-- Permanent ban == ends_at is null.

create or replace function public.anchor_account_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = new.user_id;
  if v_email is not null then
    insert into public.banned_identities (hash, kind)
    values (public.email_anchor_hash(v_email), 'account_email')
    on conflict (hash) do nothing;
  end if;
  return null;
end;
$$;

-- A lifted ban must release the anchor, or the user stays locked out of a ban
-- that no longer exists — the same trap the college_email path documents.
create or replace function public.release_account_email_anchor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = new.user_id;
  if v_email is not null then
    delete from public.banned_identities
    where kind = 'account_email'
      and hash = public.email_anchor_hash(v_email);
  end if;
  return null;
end;
$$;

drop trigger if exists bans_anchor_account_email on public.bans;
create trigger bans_anchor_account_email
  after insert on public.bans
  for each row
  when (new.ends_at is null and new.lifted_at is null)
  execute function public.anchor_account_email();

drop trigger if exists bans_release_account_email on public.bans;
create trigger bans_release_account_email
  after update of lifted_at on public.bans
  for each row
  when (new.lifted_at is not null and old.lifted_at is null)
  execute function public.release_account_email_anchor();

-- Postgres grants EXECUTE on new functions to anon by default. See CONTEXT.md §2.
select public.lock_client_functions();
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.on_email_confirmed() from public, anon, authenticated;
revoke all on function public.signin_tier(text, timestamptz) from public, anon, authenticated;
revoke all on function public.email_anchor_hash(text) from public, anon, authenticated;
