# Looty

A text-first social app for college students in India. Friends, not dating.

**Start here → [CONTEXT.md](CONTEXT.md)** — what Looty is, every settled decision,
the architecture, and what is still open. It is kept current.
For how things got this way, see [LOG.md](LOG.md).

## Status

Pre-alpha, not shipped — but built. The Expo app has every screen working against a
live Supabase project in Mumbai: sign-in, optional college-email badge, profile
setup, group rooms, DMs (text + images), username search, friend requests, Looty
Match, and the moderation appeal flow. A confirmed sign-in address is full access;
college email is the College Verified badge.

It has been run on a real Android phone (USB + Expo Go 57). Correctness also
rests on 220 database tests, typechecking, and direct calls against the live API
— including as a real Tier 2 user (groups, DMs, friends, Match). A green suite is
not proof on this project.

Not done: Google Sign-In, real email delivery for college-badge codes, ads and
billing (Phase 6), and Play Console. Account deletion and notification prefs
(Phase 7's in-app half) are built. The Play listing is drafted in `legal/`.

## Running the database tests

No Docker or Supabase project needed — the tests run the migrations against an
in-process Postgres.

```bash
npm install
npm run test:db
```

They cover the domain fast path, username rules, tier promotion, ban behaviour,
brigade unwinding, group capacity, the loot quota, and that a client cannot promote
its own trust tier, read private columns, or execute privileged functions.

## Layout

```
mobile/                Expo app (SDK 57, Android-only)
supabase/migrations/   schema, applied in filename order
supabase/functions/    Edge Functions (issue-college-code)
supabase/tests/run.mjs behaviour tests (pglite, no Docker)
supabase/seed.sql      local dev data — sample colleges, UNVERIFIED domains
CONTEXT.md             current state of the project
LOG.md                 dated history, append-only
```

## Running the app

```bash
cd mobile && npx expo run:android
```

Needs `mobile/.env` — copy `mobile/.env.example` and fill in the Supabase URL and
anon key.

## Still needed from the project owner

- **College email domains** (`college_domains`) for the College Verified badge.
  A missing domain no longer locks anyone out — it only costs the badge. Still
  worth filling in; a wrong entry is worse than a missing one.
- **A Google Cloud OAuth client** for Google Sign-In. Free.
- **An email provider** (Resend, SES) so college-badge codes actually send. Free
  tier is plenty. Without it the Edge Function logs the code instead.
- **Google Play Console** ($25) and **AdMob**, for Phases 6 and 7. Play Console
  imposes a 12-tester, 14-day closed test before public release, so it is worth
  starting early.

No longer needed: the SMS/DLT path and a KYC/vision vendor, both removed when
verification became college-email only.
