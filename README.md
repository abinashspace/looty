# Looty

A text-first social app for verified college students in India. Friends, not dating.

**Start here → [CONTEXT.md](CONTEXT.md)** — what Looty is, every settled decision,
the architecture, and what is still open. It is kept current.
For how things got this way, see [LOG.md](LOG.md).

## Status

Pre-alpha. Nothing is shipped. The repo currently holds the Phase 1 database schema
and its tests; there is no app yet.

## Running the database tests

No Docker or Supabase project needed — the tests run the migrations against an
in-process Postgres.

```bash
npm install
npm run test:db
```

They cover the domain fast path, username rules, tier promotion, ban behaviour, and
that a client cannot promote its own trust tier or read private columns.

## Layout

```
supabase/migrations/   schema, applied in filename order
supabase/tests/run.mjs behaviour tests (pglite, no Docker)
supabase/seed.sql      local dev data — sample colleges, UNVERIFIED domains
CONTEXT.md             current state of the project
LOG.md                 dated history, append-only
```

## Before this can run for real

Requires accounts only the project owner can create: a Supabase project **in
`ap-south-1` (Mumbai)** — the region is fixed at creation and cannot be changed —
plus Google OAuth credentials, an SMS/OTP provider (Indian transactional SMS needs
DLT registration), vision API access for ID OCR and face matching, AdMob, and Google
Play Console.
