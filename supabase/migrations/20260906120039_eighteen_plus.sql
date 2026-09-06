-- Looty — the app becomes 18+. Owner decision, 2026-09-06.
--
-- This reverses part of the 2026-08-28 repositioning, which removed the dating
-- framing and the age gate together specifically to avoid an 18+ rating and
-- DPDP's verifiable-parental-consent obligation. Dating framing stays removed;
-- the age gate comes back, and personalised ads come with it.
--
-- Read this honestly, because the reasoning matters more than the column:
--
--   * A self-declared date of birth is **not** verification. A 16-year-old types
--     a year and is through. So this does not discharge DPDP's parental-consent
--     duty — it narrows exposure and documents an intent, nothing more. The
--     previous position ("we hold no age data, so we treat everyone as possibly
--     a minor and never behaviourally target anyone") was weaker commercially
--     and stronger legally. That trade was made deliberately.
--   * It excludes 17-year-old first-years, who are a real share of Indian intake
--     and arguably the most valuable segment for a friends app. Also deliberate.
--
-- date_of_birth is the raw value rather than a stored age, because an age is
-- wrong the day after you compute it. `is_adult()` derives it on read.

alter table public.profiles
  add column if not exists date_of_birth date;

alter table public.profiles drop constraint if exists profiles_dob_sane;
alter table public.profiles
  add constraint profiles_dob_sane check (
    date_of_birth is null
    or (date_of_birth > date '1900-01-01' and date_of_birth < current_date)
  );

comment on column public.profiles.date_of_birth is
  'Self-declared. Gates signup at 18+. Not verified and not verifiable — see migration 39.';

create or replace function public.is_adult(p_dob date)
returns boolean
language sql
immutable
as $$
  select p_dob is not null and p_dob <= (current_date - interval '18 years');
$$;

-- Refuse an under-18 date outright rather than storing it and gating later. The
-- less minor data that exists, the smaller the DPDP surface.
create or replace function public.reject_underage_profile()
returns trigger
language plpgsql
as $$
begin
  if new.date_of_birth is not null and not public.is_adult(new.date_of_birth) then
    raise exception 'under_18';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reject_underage on public.profiles;
create trigger profiles_reject_underage
  before insert or update of date_of_birth on public.profiles
  for each row execute function public.reject_underage_profile();

-- Onboarding is not finished without it, which is what makes the gate real: a
-- client that skipped the field would simply never reach the app.
create or replace function public.sync_onboarding_complete()
returns trigger
language plpgsql
as $$
begin
  -- dp_url is deliberately absent: migration 28 made the photo optional, and
  -- reinstating it here would quietly un-onboard everyone without one.
  new.onboarding_complete :=
        new.username      is not null
    and new.display_name  is not null and length(trim(new.display_name)) > 0
    and new.course_years  is not null
    and new.start_year    is not null
    and new.date_of_birth is not null;
  return new;
end;
$$;

-- The trigger fires on a fixed column list, so date_of_birth has to join it or
-- setting only the date would never recompute the flag.
drop trigger if exists profiles_sync_onboarding on public.profiles;
create trigger profiles_sync_onboarding
  before insert or update of
    username, display_name, dp_url, course_years, start_year, date_of_birth
  on public.profiles
  for each row execute function public.sync_onboarding_complete();

-- Existing profiles have no date of birth, so they are no longer complete until
-- they supply one. Recompute rather than leaving a stale true behind.
update public.profiles set username = username;

grant update (date_of_birth) on public.profiles to authenticated;

select public.lock_client_functions();
revoke all on function public.lock_client_functions() from public, anon, authenticated;
revoke all on function public.reject_underage_profile() from public, anon, authenticated;
grant execute on function public.is_adult(date) to authenticated;
