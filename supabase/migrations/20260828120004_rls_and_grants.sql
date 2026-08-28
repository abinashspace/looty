-- Looty — Phase 1: row-level security and column-level grants
--
-- Two layers are used deliberately:
--   RLS      decides WHICH ROWS a caller may touch.
--   GRANTS   decide WHICH COLUMNS. RLS cannot hide a column, so privacy fields
--            (full_name, phone_hash) and privileged fields (trust_tier) are
--            protected with column grants instead.
--
-- Anything the client must not control lives outside its grants entirely: trust
-- tier, college assignment, ban state. There is no policy a client can satisfy to
-- write them.

alter table public.colleges             enable row level security;
alter table public.college_domains      enable row level security;
alter table public.college_requests     enable row level security;
alter table public.profiles             enable row level security;
alter table public.reserved_usernames   enable row level security;
alter table public.verifications        enable row level security;
alter table public.bans                 enable row level security;
alter table public.banned_phone_hashes  enable row level security;

-- Start from zero for every client role, then grant back deliberately.
revoke all on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Colleges and domains — read-only reference data
-- ---------------------------------------------------------------------------

grant select on public.colleges to authenticated;
create policy colleges_read on public.colleges
  for select to authenticated using (status = 'active');

-- The allowlist is not secret (the signup flow needs it), but it is not writable.
grant select on public.college_domains to authenticated;
create policy college_domains_read on public.college_domains
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- College requests — file your own, see your own
-- ---------------------------------------------------------------------------

grant select on public.college_requests to authenticated;
grant insert (requester_id, college_name, city, domain) on public.college_requests to authenticated;

create policy college_requests_read_own on public.college_requests
  for select to authenticated using (requester_id = auth.uid());

create policy college_requests_insert_own on public.college_requests
  for insert to authenticated with check (requester_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
--
-- Readable columns exclude full_name and phone_hash. Writable columns exclude
-- trust_tier, college_id, full_name, phone_hash and every timestamp — a client
-- cannot promote itself to Tier 1 no matter what it sends.
--
-- NOTE Phase 2: the read policy must additionally exclude users who have blocked
-- the caller, or whom the caller has blocked. The blocks table does not exist yet.

-- phone_verified_at and onboarding_complete are granted because the client must
-- know which signup step to show next. Column grants are role-wide, so these are
-- readable about other users too — accepted deliberately: a timestamp saying
-- someone finished onboarding is not sensitive. The phone NUMBER (phone_hash) and
-- the legal name (full_name) remain ungranted, which is what actually matters.
grant select (
  id, username, display_name, dp_url, college_id,
  course_years, start_year, end_year, gender, trust_tier, created_at,
  phone_verified_at, onboarding_complete
) on public.profiles to authenticated;

grant insert (
  id, username, display_name, dp_url, course_years, start_year, gender
) on public.profiles to authenticated;

grant update (
  username, display_name, dp_url, course_years, start_year, gender
) on public.profiles to authenticated;

create policy profiles_read_all on public.profiles
  for select to authenticated using (true);

create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Reserved usernames are checked by a security-definer trigger, so the client
-- needs no access to the list.

-- ---------------------------------------------------------------------------
-- Verifications — submit your own, read your own, update nothing
-- ---------------------------------------------------------------------------
--
-- The client supplies the claim and the images. Status, OCR output and the face
-- match score are written only by the Edge Function under service_role. There is
-- no UPDATE grant, so a client cannot mark its own verification passed.

grant select on public.verifications to authenticated;
grant insert (
  user_id, method, claimed_college_id, id_image_path, selfie_image_path
) on public.verifications to authenticated;

create policy verifications_read_own on public.verifications
  for select to authenticated using (user_id = auth.uid());

create policy verifications_insert_own on public.verifications
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Bans — visible to the banned user, writable by nobody client-side
-- ---------------------------------------------------------------------------
--
-- Users can see their own ban so the app can explain it and offer an appeal.

grant select on public.bans to authenticated;
create policy bans_read_own on public.bans
  for select to authenticated using (user_id = auth.uid());

-- banned_phone_hashes gets no grant and no policy at all: service_role only.
-- Exposing it would let anyone test whether a given phone number is banned.

-- ---------------------------------------------------------------------------
-- Gate helpers stay callable
-- ---------------------------------------------------------------------------

grant execute on function public.current_tier() to authenticated;
grant execute on function public.is_banned(uuid) to authenticated;
grant execute on function public.is_alumni(smallint) to authenticated;
grant execute on function public.college_for_email(text) to authenticated;

-- Default privileges for future tables in this schema: nothing, unless granted.
alter default privileges in schema public revoke all on tables from anon, authenticated;
