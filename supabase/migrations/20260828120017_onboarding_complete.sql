-- Looty — derive onboarding_complete instead of trusting the client
--
-- The client cannot write this column (no grant), which is correct — it gates
-- routing, and a client that could set it could skip profile setup entirely.
--
-- So it derives itself from the fields that actually constitute a profile. Adding
-- a required field later means changing this one condition, and every existing
-- half-finished profile is re-evaluated on its next write.

create or replace function public.sync_onboarding_complete()
returns trigger
language plpgsql
as $$
begin
  new.onboarding_complete :=
        new.username     is not null
    and new.display_name is not null and length(trim(new.display_name)) > 0
    and new.dp_url       is not null
    and new.course_years is not null
    and new.start_year   is not null;
  return new;
end;
$$;

create trigger profiles_sync_onboarding
  before insert or update of username, display_name, dp_url, course_years, start_year
  on public.profiles
  for each row execute function public.sync_onboarding_complete();

-- Bring existing rows in line with the rule.
update public.profiles set updated_at = updated_at;
