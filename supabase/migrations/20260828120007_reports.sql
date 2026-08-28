-- Looty — Phase 2: report capture
--
-- Capture only. The ban engine — counting unique reporters, retroactively
-- discounting reporters who are themselves banned, escalating to permanent — is
-- Phase 5. What matters here is that reports are recorded in a shape the engine
-- can trust, because the engine has no human in the loop to catch bad input.

create type public.report_context as enum ('profile', 'dm', 'connection', 'group');

create type public.report_reason as enum (
  'harassment',
  'sexual_content',
  'spam',
  'impersonation',
  'not_a_student',
  'other'
);

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  target_id    uuid not null references auth.users (id) on delete cascade,
  context      public.report_context not null,
  -- Message or thread the report was filed from. Nullable for 'profile' reports.
  context_id   uuid,
  reason       public.report_reason not null,
  detail       text check (detail is null or length(detail) <= 1000),
  created_at   timestamptz not null default now(),

  constraint reports_not_self check (reporter_id <> target_id)
);

-- ONE REPORT PER REPORTER PER TARGET, EVER.
--
-- This is the single most important constraint in the moderation system. Without
-- it, four friends could stack eight reports and trigger an automatic ban between
-- them. The threshold counts rows; this makes rows mean "distinct people".
create unique index reports_one_per_pair on public.reports (reporter_id, target_id);

create index reports_target_idx on public.reports (target_id);

/**
 * Whether the caller is allowed to file reports at all.
 *
 * Two automatic gates, no human judgement involved:
 *   - Tier 1+, so a throwaway unverified account cannot report. current_tier()
 *     folds in the ban check, so banned users cannot report either.
 *   - Account at least 7 days old, so a ring cannot be spun up on demand.
 */
create or replace function public.can_report()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_tier() >= 1
     and exists (
       select 1 from public.profiles p
       where p.id = auth.uid()
         and p.created_at <= now() - interval '7 days'
     );
$$;

comment on function public.can_report() is
  'Automatic reporter eligibility. Bans are issued with no human review, so the input has to be filtered instead.';
