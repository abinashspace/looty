-- Looty — let users actually change their Match filters
--
-- `match_scope` and `match_same_gender_only` were added in migration 11 but never
-- granted to `authenticated`, so the columns existed and nothing could write them.
-- Caught while building the Match screen.

grant update (match_scope, match_same_gender_only) on public.profiles to authenticated;

/**
 * The caller's own Match filters.
 *
 * A function rather than a SELECT grant, because column grants are role-wide: a
 * grant would let anyone read anyone's `match_same_gender_only`, which quietly
 * announces that a person filters by gender. That is their business.
 */
create or replace function public.my_match_prefs()
returns table (match_scope public.match_scope, match_same_gender_only boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.match_scope, p.match_same_gender_only
  from public.profiles p
  where p.id = auth.uid();
$$;

grant execute on function public.my_match_prefs() to authenticated;
