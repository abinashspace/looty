-- Looty — Phase 5: automatic moderation
--
-- Bans are issued with NO human review. That is a deliberate choice, and it puts
-- all the weight on the input filtering and on the engine being self-correcting:
--
--   * one report per reporter per target, ever      (Phase 2 unique index)
--   * reporter must be 7+ days old and Tier 1+      (Phase 2 can_report)
--   * reports from banned reporters stop counting   (here — and retroactively)
--
-- The last one is what makes automatic banning survivable. A brigade that gets
-- itself banned has its damage undone without anyone filing a ticket.

-- ---------------------------------------------------------------------------
-- Bans gain a lifted state
-- ---------------------------------------------------------------------------

alter table public.bans
  add column lifted_at   timestamptz,
  add column lift_reason text,
  add column issued_by   text not null default 'system'
    check (issued_by in ('system', 'appeal', 'manual'));

comment on column public.bans.lifted_at is
  'Set when a ban is undone — by appeal, or automatically when its reports were discounted. Lifted bans do not count toward the 3-strike escalation.';

-- A lifted ban is no ban. This shadows the Phase 1 definition.
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
      and b.lifted_at is null
      and b.starts_at <= now()
      and (b.ends_at is null or b.ends_at > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- Which reports justified which ban
-- ---------------------------------------------------------------------------
--
-- Linking them is what makes retroactive discounting possible: when a reporter is
-- banned, we can find exactly which bans leaned on their report and recount.

alter table public.reports
  add column resolved_by_ban_id uuid references public.bans (id) on delete set null;

create index reports_unresolved_idx on public.reports (target_id)
  where resolved_by_ban_id is null;
create index reports_by_ban_idx on public.reports (resolved_by_ban_id)
  where resolved_by_ban_id is not null;

-- ---------------------------------------------------------------------------
-- Thresholds, in one place
-- ---------------------------------------------------------------------------

create or replace function public.report_ban_threshold()
returns integer language sql immutable as $$ select 8 $$;

create or replace function public.bans_before_permanent()
returns integer language sql immutable as $$ select 3 $$;

create or replace function public.temporary_ban_days()
returns integer language sql immutable as $$ select 5 $$;

/**
 * Reports that currently count against a user.
 *
 * Excludes reports already spent on a previous ban (so one incident cannot ban
 * someone twice) and reports from anyone currently banned themselves.
 */
create or replace function public.effective_report_count(p_target uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.reports r
  where r.target_id = p_target
    and r.resolved_by_ban_id is null
    and not public.is_banned(r.reporter_id);
$$;

-- ---------------------------------------------------------------------------
-- Issuing bans
-- ---------------------------------------------------------------------------

/**
 * Bans a user if their effective report count has reached the threshold.
 *
 * Escalates to permanent on the third *unlifted* ban. Lifted bans do not count —
 * a ban that was overturned should not push someone closer to permanent.
 */
create or replace function public.evaluate_reports(p_target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count  integer;
  v_prior  integer;
  v_perm   boolean;
  v_ban_id uuid;
  v_email  citext;
begin
  v_count := public.effective_report_count(p_target);
  if v_count < public.report_ban_threshold() then
    return null;
  end if;

  -- Do not stack a second ban on someone already serving one.
  if public.is_banned(p_target) then
    return null;
  end if;

  select count(*)::integer into v_prior
  from public.bans where user_id = p_target and lifted_at is null;

  v_perm := (v_prior + 1) >= public.bans_before_permanent();

  insert into public.bans (user_id, type, reason, ends_at, issued_by)
  values (
    p_target,
    case when v_perm then 'permanent' else 'temporary' end::public.ban_type,
    'automatic: ' || v_count || ' unique reports',
    case when v_perm then null
         else now() + (public.temporary_ban_days() || ' days')::interval end,
    'system'
  )
  returning id into v_ban_id;

  -- Spend the reports on this ban so the same incident cannot ban again, and so a
  -- later recount knows which reports this ban rested on.
  update public.reports
     set resolved_by_ban_id = v_ban_id
   where target_id = p_target
     and resolved_by_ban_id is null
     and not public.is_banned(reporter_id);

  -- Permanent bans are anchored on the hashed college address, so deleting the
  -- account and signing up again does not clear them.
  if v_perm then
    select college_email into v_email from public.profiles where id = p_target;
    if v_email is not null then
      insert into public.banned_identities (hash, kind)
      values (encode(sha256(convert_to(lower(v_email::text), 'UTF8')), 'hex'), 'college_email')
      on conflict (hash) do nothing;
    end if;
  end if;

  return v_ban_id;
end;
$$;

create or replace function public.on_report_filed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.evaluate_reports(new.target_id);
  return null;
end;
$$;

create trigger reports_evaluate
  after insert on public.reports
  for each row execute function public.on_report_filed();

-- ---------------------------------------------------------------------------
-- Retroactive unwinding
-- ---------------------------------------------------------------------------

/**
 * When someone is banned, every ban that leaned on their reports is recounted.
 *
 * This is the mechanism that makes a brigade self-defeating: eight coordinated
 * accounts can ban a victim, but the moment those accounts are themselves banned,
 * the victim's ban is lifted automatically. Nobody has to notice or file anything.
 *
 * Only INSERT fires this, and lifting is an UPDATE, so it cannot recurse.
 */
create or replace function public.unwind_bans_from_banned_reporter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_remaining integer;
begin
  for b in
    select distinct bn.id, bn.user_id
    from public.reports r
    join public.bans bn on bn.id = r.resolved_by_ban_id
    where r.reporter_id = new.user_id
      and bn.lifted_at is null
      and bn.user_id <> new.user_id
      and (bn.ends_at is null or bn.ends_at > now())
  loop
    select count(*)::integer into v_remaining
    from public.reports r
    where r.resolved_by_ban_id = b.id
      and not public.is_banned(r.reporter_id);

    if v_remaining < public.report_ban_threshold() then
      update public.bans
         set lifted_at = now(),
             lift_reason = 'reports discounted: ' || v_remaining
                           || ' of ' || public.report_ban_threshold() || ' reporters still in good standing'
       where id = b.id;

      -- A lifted permanent ban must release the identity anchor too, or the user
      -- stays locked out of signup for a ban that no longer exists.
      delete from public.banned_identities
      where hash = (
        select encode(sha256(convert_to(lower(p.college_email::text), 'UTF8')), 'hex')
        from public.profiles p where p.id = b.user_id and p.college_email is not null
      );
    end if;
  end loop;

  return null;
end;
$$;

create trigger bans_unwind_brigades
  after insert on public.bans
  for each row execute function public.unwind_bans_from_banned_reporter();

-- ---------------------------------------------------------------------------
-- Appeals
-- ---------------------------------------------------------------------------
--
-- The one place a human is involved. Volume is low by construction — only banned
-- users file them.

create type public.appeal_status as enum ('pending', 'upheld', 'overturned');

create table public.appeals (
  id          uuid primary key default gen_random_uuid(),
  ban_id      uuid not null references public.bans (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  body        text not null check (length(trim(body)) between 10 and 2000),
  status      public.appeal_status not null default 'pending',
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,

  -- One appeal per ban. Otherwise the "low volume" assumption stops holding.
  unique (ban_id)
);

create index appeals_queue_idx on public.appeals (created_at) where status = 'pending';

/**
 * Service-role only — this is the human decision. Overturning lifts the ban and
 * releases the identity anchor.
 */
create or replace function public.resolve_appeal(p_appeal uuid, p_outcome public.appeal_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.appeals%rowtype;
begin
  if p_outcome not in ('upheld', 'overturned') then
    raise exception 'invalid_outcome';
  end if;

  select * into a from public.appeals where id = p_appeal;
  if not found then
    raise exception 'appeal_not_found';
  end if;

  update public.appeals
     set status = p_outcome, reviewed_at = now()
   where id = p_appeal;

  if p_outcome = 'overturned' then
    update public.bans
       set lifted_at = now(), lift_reason = 'appeal overturned', issued_by = 'appeal'
     where id = a.ban_id and lifted_at is null;

    delete from public.banned_identities
    where hash = (
      select encode(sha256(convert_to(lower(p.college_email::text), 'UTF8')), 'hex')
      from public.profiles p where p.id = a.user_id and p.college_email is not null
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.appeals enable row level security;

grant select on public.appeals to authenticated;
grant insert (ban_id, user_id, body) on public.appeals to authenticated;

create policy appeals_read_own on public.appeals
  for select to authenticated using (user_id = auth.uid());

-- You may only appeal your own ban, and only one that is actually in force.
create policy appeals_insert_own on public.appeals
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.bans b
      where b.id = ban_id
        and b.user_id = auth.uid()
        and b.lifted_at is null
    )
  );

-- No UPDATE grant: an appellant cannot mark their own appeal overturned.

grant execute on function public.is_banned(uuid) to authenticated;
revoke all on function public.evaluate_reports(uuid)      from public, anon, authenticated;
revoke all on function public.effective_report_count(uuid) from public, anon, authenticated;
revoke all on function public.resolve_appeal(uuid, public.appeal_status) from public, anon, authenticated;
revoke all on function public.report_ban_threshold()      from public, anon, authenticated;
revoke all on function public.bans_before_permanent()     from public, anon, authenticated;
revoke all on function public.temporary_ban_days()        from public, anon, authenticated;
