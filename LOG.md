# Looty — Change Log

> **What this file is.** An append-only, dated record of everything that happens on
> this project: decisions made, decisions reversed, work completed, problems found.
> **Entries are never edited or deleted.** If something here later turns out to be
> wrong or gets reversed, write a *new* entry saying so — do not rewrite history.
>
> **What this file is not.** It is not the current state of the project. Reading
> this top to bottom will show you decisions that have since been overturned. For
> what is true right now, read [`CONTEXT.md`](CONTEXT.md).
>
> **Newest entries at the top.**
>
> Entry format: `## YYYY-MM-DD — Title`, then what changed, then **Why**.

---

## 2026-08-28 — ID card verification removed; college email is the only route

**Reversed this morning's decision to layer ID-card verification on top of open
Gmail signup.** Verification is now: sign in with Google, confirm a college email,
done. Migration `20260828120009` deployed to the live project; 79 tests passing.

**What this removes:** the per-signup KYC vendor fee, the vendor selection entirely,
biometric processing under DPDP, storing student ID photos, the 30-day image
deletion sweep, and the manual review queue for cards the automated check could not
read. It also removed **phone OTP**, and with it DLT registration — weeks of
telecom paperwork needing business documents.

The owner's todo list went from four items to two: Play Console, and the college
domain list.

**What this costs, stated honestly:** reach is now exactly the domain allowlist.
A student whose college issues no email can never pass Tier 0. This is the same
TAM cap that caused the ID path to be added in the first place — reintroduced
deliberately. It is defensible while launching at colleges that do issue email
(IITs, NITs, BITS, large private universities); it breaks if the launch depends on
state and affiliated colleges, most of which issue nothing.

**Decisions taken alongside it:**
- Users with no college domain are **let in read-only** rather than refused. They
  browse groups and can request their college. Those requests become the growth
  roadmap — the colleges asked for most often are the ones worth chasing.
  Consequence: **Tier 0 is now permanent for some users, not a waiting room**, so
  the app must say "Looty isn't at your college yet" rather than parking them on a
  verification screen they can never pass.
- **Phone OTP dropped.** Its only job was anchoring bans, and a college address does
  that better — one per student, hard to get another, no regulator involved.
  `banned_phone_hashes` was replaced by `banned_identities (hash, kind)`.
- **ID-card schema left dormant, not dropped.** `verifications.ocr_*`,
  `face_match_score`, image paths, the `id_card` method, `profiles.phone_hash` and
  `full_name` all remain unused. Reinstating the ID path should cost a decision, not
  a rebuild, if the domain list turns out too small.

**Serious bug caught by a test — worth reading if you touch this code.**
`confirm_college_email` originally incremented the failed-attempt counter and then
called `raise exception 'invalid_code'`. In PL/pgSQL, `raise` aborts the surrounding
subtransaction, which **rolled back the increment**. So `attempts` stayed at zero
forever and the five-try lockout never fired — leaving a six-digit code
brute-forceable in seconds.

Fixed by returning a status string (`ok` / `invalid_code` / `expired` /
`too_many_attempts` / …) instead of raising, so the counter commits. Callers must
check the return value. There is a test asserting the counter actually persists, and
a warning in CONTEXT.md §4.6 against "tidying" it back into exceptions.

**Code handling:** codes are stored as `sha256(code || per-row salt)` using core
Postgres `sha256`, deliberately not pgcrypto, so the pglite test harness can run it
without extensions. Codes are issued only by an Edge Function under `service_role`;
confirming is client-callable since it only succeeds with the right code.

**New dependency, smaller than what it replaced:** an email sending provider
(Resend, SES) for the codes. No registration regime, unlike SMS.

---

## 2026-08-28 — Supabase project created; all 8 migrations deployed

Project `zsfjwlmeeodsiwruvine`, region **`ap-south-1` (Mumbai)** as required,
Postgres 17.6, free plan. Repo linked with the Supabase CLI and all 8 migrations
pushed successfully.

**Note on the project's history:** it was originally created under the name
"ai cfo" and renamed to "looty" — same project ref throughout. Confirmed via
`supabase projects list` that this is the only project in the org, so nothing was
displaced. The database was empty before the push.

**Verified against the live database**, not just pglite:
- All 13 tables exist. Confirmed by probing each one and reading the error code:
  `42501 permission denied` proves a table exists, whereas a missing table returns
  `42P01`.
- **Every table refuses the `anon` role.** This is the property that matters most —
  the anon key ships inside the APK and can be extracted in a minute, so anything
  readable by `anon` is effectively public. Nothing is.
- The PostgREST OpenAPI root returns zero tables and zero functions to `anon`,
  consistent with the above.

**Not verified live:** authenticated-role behaviour. Testing that means creating a
real user in the production project, which was not done unprompted. The 66 pglite
tests cover the logic; what remains unproven is only that it behaves identically on
real Postgres 17, which is likely but not demonstrated.

**Two environment notes for future sessions:**
- `supabase db dump` and `supabase db diff` need Docker, which is not installed on
  this machine. `db push` does not, so deploying works but schema diffing does not.
- `supabase db push` did **not** prompt for the database password — the CLI
  authenticates with the stored access token. Linking with `--password ""` was
  enough.

`mobile/.env` now holds the real project URL and anon key, and is gitignored.

---

## 2026-08-28 — Phase 2 schema: friendships, blocks, DMs, reports

Four migrations and 31 new tests (66 total, all passing). Friendships with
directional request but symmetric uniqueness, blocks, 1:1 threads, messages, and
report capture.

**Design decisions:**

- **Friendship pairs are unique in both directions** via an expression index on
  `least/greatest` of the two ids. Who asked still matters — only the addressee may
  accept — but A→B and B→A cannot both sit pending forever.
- **Threads store the pair in canonical order** (`user_a < user_b`), so "one thread
  per pair per type" falls out of a plain unique constraint instead of every call
  site having to check both directions.
- **Threads have no INSERT grant.** They are created only through
  `open_dm_thread()`, which verifies the friendship and enforces the ordering.
- **Messages are not editable by anyone** — no UPDATE grant at all. A report is
  judged on what was actually sent, and editable history makes every report
  unfalsifiable. Senders may delete their own; recipients may not delete the other
  side's, for the same reason.
- **`can_post_to_thread()` re-checks everything at send time** — participation,
  tier, ban, block, thread state — rather than trusting that any of it still held
  when the thread was opened.
- **Blocking tears down the friendship** rather than hiding it, via a trigger.
  Merely hiding would make the pair reappear the moment a block was lifted, which
  is not what "block" means to a user.
- **Reports are write-only from the client.** No SELECT policy at all, not even for
  your own: knowing a report landed tells a brigade how close it is to the
  threshold, and knowing you were reported tells you to switch accounts.

**Bug caught while writing the RLS:** the report policy initially required that no
block existed between reporter and target. That is backwards — blocking and
reporting are the same gesture for someone being harassed, usually block first then
report. It would have disabled the safety system exactly when it was needed.
Removed, with a comment explaining why it must not come back.

**Testing approach changed, and this matters.** Phase 2 tests run as a real
`authenticated` role with a JWT claim set, so RLS actually applies — Phase 1 tests
run as superuser and only inspect grant metadata. Writing them surfaced that **RLS
refuses in two different ways**: an INSERT violating WITH CHECK raises an error, but
an UPDATE or DELETE whose USING clause does not match simply affects zero rows and
succeeds. A test that only catches thrown errors will pass whether or not the policy
works. There are now two helpers, `denied()` and `noEffect()`, and the difference is
documented in the test file.

---

## 2026-08-28 — Expo app scaffolded; repo made private

Scaffolded the Expo app into `mobile/` (SDK 57, RN 0.86, React 19.2) with
expo-router, the Supabase client, a session/profile context, and the full
navigation shell. Every screen is a placeholder naming its phase.

**Repo switched from public to private** before the first push, per the flag raised
in the previous entry. The commit was also re-authored to the GitHub noreply address
— GitHub's email privacy protection rejected the push otherwise.

**Layout decision:** monorepo-ish. `mobile/` holds the app, `supabase/` holds
migrations and tests, and the root `package.json` runs the database tests. Keeps the
Expo scaffold from colliding with the test tooling.

**Two things changed in the schema as a result of building the client:**

- `phone_verified_at` and `onboarding_complete` had to be **granted to
  `authenticated`** — the app cannot tell which signup step to show without them.
  Column grants are role-wide, so these are now readable about other users too.
  Accepted deliberately: a timestamp saying someone finished onboarding is not
  sensitive. `phone_hash` and `full_name` remain ungranted, which is the part that
  matters. A test now pins them as readable-but-not-writable.
- Migration files were edited in place rather than superseded, since nothing is
  deployed yet.

**Bug caught by bundling:** `supabase.ts` threw at import time when `.env` was
missing, which would red-screen the app before anything rendered. Changed to export
an `isSupabaseConfigured` flag and fall back to a setup screen, so the shell can be
run and navigated before a Supabase project exists.

**Design decisions in the client:**

- `src/lib/tiers.ts` is documented as **not security**. It exists so the UI can pick
  the right screen; the database refuses gated queries on its own. If the two ever
  disagree, the database is right.
- **Gated tabs stay visible at Tier 0** rather than being hidden. An unverified user
  should see what verification unlocks — that is the point of Tier 0 being a usable
  browsing state rather than a wall.
- **A ban is not a logout.** Banned users keep the account, can still read groups,
  and can file an appeal.

**Verified:** 35/35 database tests pass, `tsc --noEmit` clean, and
`expo export --platform android` bundles successfully. Nothing has been run on a
device — there is no emulator on this machine and no Supabase project yet.

---

## 2026-08-28 — Phase 1 database schema written and tested

Four migrations under `supabase/migrations/`: colleges + domain allowlist,
profiles, verifications + bans + access gate, and RLS + column grants. Plus 34
behaviour tests (`npm run test:db`) — all passing.

**Design decisions made while writing it:**

- **Two protection layers, not one.** RLS decides which *rows* a caller may touch;
  **column-level grants** decide which *columns*. RLS cannot hide a column, so
  `full_name` and `phone_hash` are unreadable and `trust_tier` unwritable by virtue
  of never being granted to `authenticated`. There is no policy a client can satisfy
  to promote itself — the privilege simply does not exist.
- **`current_tier()` folds the ban check in.** A banned user collapses to Tier 0
  (can still read groups, cannot post/DM/Match), so every future RLS policy gets ban
  enforcement for free by comparing tiers, without repeating the check.
- **The `bans` table was pulled forward from Phase 5** because the access gate
  depends on it. The ban *engine* — thresholds, anti-brigade rules, escalation —
  still lands in Phase 5. Access control should not be retrofitted.
- **`apply_verification()` is the only path that raises a tier**, and it is
  service-role only with execute revoked from clients.
- **`seed.sql` ships with an empty domain list, deliberately.** A wrong domain is
  worse than a missing one: a missing domain sends the student down the ID path, a
  wrong one hands Tier 2 to the wrong people.

**Testing approach:** no Docker on this machine, so migrations are validated with
**pglite**, an in-process Postgres. `auth.users`, `auth.uid()` and the client roles
are stubbed; `pgcrypto` is stripped since `gen_random_uuid()` is core Postgres 13+.
This catches schema and logic errors but is **not** a substitute for testing against
a real Supabase project.

**Why:** the plan called for Supabase logic to be testable with seeded rows before
any UI exists, specifically so that server-side enforcement could be proven rather
than assumed. The privilege-escalation tests are the ones that matter most.

---

## 2026-08-28 — Repo wired up, CONTEXT.md and LOG.md created

Created `CONTEXT.md` (always-current project state) and this file. Wired the local
project to `github.com/abinashspace/looty`. Ran `supabase init`.

**Why:** the plan had been evolving across a long conversation and existed only in
chat scrollback plus a session-scoped plan file outside the repo. It needed a home
in the repo itself, split into a living document (CONTEXT) and a history (LOG).

**Flagged, unresolved:** the GitHub repo is **public**. The moderation thresholds
and anti-brigade rules are therefore readable by anyone, which makes the report
system easier to game. Recommended making it private before launch. No action taken.

---

## 2026-08-28 — Signup opened to any email; trust tiers introduced

**Reversed the college-email-domain signup gate.** Anyone can now sign up with
Gmail or any other provider. Verification is layered on top via trust tiers
(Tier 0 unverified → Tier 1 ID-verified → Tier 2 college-verified). Full
specification in CONTEXT.md §4.

Also decided in the same change:
- ID card + **live selfie** with automated OCR and **face matching**
- ID and selfie images **deleted after 30 days**, extracted fields retained
- **Phone OTP required**, phone stored hashed, and it becomes the **ban anchor**
- College email domain retained as an **instant fast path** to Tier 2, not a gate

**Why:** the domain gate capped the addressable market at colleges that actually
issue student mailboxes — a number that was unknown and probably small, since most
Indian students are at state and affiliated colleges that issue nothing. This was
the single biggest risk in the plan and this change removes it.

**Cost accepted:** the domain was automatic, instant, free and effectively
unforgeable. An ID card is none of those — Indian college IDs have no standard
format and no database to check against, so a real card from an unfamiliar college
cannot be distinguished from a fake one. Layering (tiers + face match + phone) is
what compensates.

**Knock-on consequences:**
- Email hashes became useless as a ban anchor → replaced with hashed phone numbers.
- The personal-provider blocklist was deleted entirely — Gmail is now explicitly
  allowed.
- Phase 0 (college domain research) stopped being a launch blocker and became
  continuous background work.
- Phase 1 absorbed the risk and is now the largest, least predictable phase.

**Rejected in the same discussion:** invite-based vouching, where verified students
invite others. Considered as a growth-plus-verification mechanic; declined.

---

## 2026-08-28 — Dating removed; Looty repositioned as a friends app

Removed the **Dating** group category (categories are now Study, Sports, Friends)
and reframed Looty Match as friend-finding rather than dating. Removed the date-of-
birth field and the age gate entirely. Renamed the mutual-loot state from "match" to
**"Connected"**.

**Why:** dating functionality forces an 18+ rating on both app stores. Combined with
an ad-supported free tier and Indian college intakes that include 17-year-olds, this
collided with DPDP's requirement for verifiable parental consent for under-18s and
its ban on behavioural advertising aimed at them. Repositioning removed all of it at
once, and student friend-finding is a far less crowded market than student dating.

**Constraint this creates, permanently:** the repositioning only works if it is
carried through everywhere. No romantic framing in UI, copy, notifications,
onboarding, or the store listing. One "find your campus crush" in the store
description puts the 18+ rating back. This is why "match" is banned as a
user-facing word.

**Related:** ads set to **non-personalised app-wide**. Since there is no age gate,
some users will be under 18, and this removes the DPDP targeting problem without
needing to know anyone's age.

---

## 2026-08-28 — Corrections to the original product plan

Reviewed `Looty_App_Plan.md` and reversed several items that would not have survived
contact with the app stores or Indian conditions.

| Was | Now | Why |
|---|---|---|
| "No screenshots allowed" | Screenshot **detection** + notify | Neither platform can reliably block. iOS cannot prevent screenshots at all — detection only. A second phone defeats both regardless. |
| Google Maps college picker | Removed | Maps was never the source of truth — the email domain was. The two could disagree, allowing someone to claim a more prestigious college. Also billed per session on the highest-traffic screen. |
| ₹19/day, ad-free | **₹119/month**, ₹49 first month | Neither store offers daily auto-renewing subscriptions — weekly is the shortest period. ₹19/day ≈ ₹570/month, more than Netflix Mobile India, aimed at students. |
| 3 loots/hour free, 6/hour paid | **10/day free, 50/day paid** | Hourly caps feel broken on a scroll feed; dating apps use daily quotas for a reason. |
| 4 reports → 5-day ban | **8 unique reporters** + anti-brigade rules | Four coordinated friends could ban anyone. Rules added: one report per reporter per target ever; reporter must be 7+ days old and Tier 1+; a reporter who is later banned has their past reports retroactively discounted. |
| Groups: Study/Sports/Dating/Friends | Study/Sports/Friends | See repositioning entry above. |
| Unbounded global rooms | **1024-member cap**, auto-numbered rooms | Matches WhatsApp. A single unbounded global room is a firehose and a moderation impossibility. |

**Also decided:** bans stay **fully automatic with no human review**, but appeals go
to a human-reviewed queue — appeals are low volume because only banned users file
them. Verification, separately, will still need a small manual queue for
OCR-flagged cards; this is unavoidable.

**Gaps filled that the original plan did not mention at all:** block (separate from
report), in-app account deletion, unmatch/leave, username field (it was used for DM
search but never specified), gender and college-scope filters for Match, and what
happens to a banned user's existing threads and friend requests.

**New risk identified:** the original plan said image moderation was unnecessary
because DMs are friend-gated. True for DMs — but Match/Connected chats also allow
images and those are between *strangers*. Decided: images in connected chats are
**blurred by default with tap-to-reveal**. DMs remain unmoderated as originally
planned.

---

## 2026-08-28 — Project start

Starting point: `C:\Users\DELL\Documents\Looty_App_Plan.md`, a product sketch for a
chat-first social app for verified Indian college students, with an open "tech stack
decision" and several unresolved questions.

Stack chosen: **React Native (Expo) + Supabase, `ap-south-1` (Mumbai)**, Android
only, mobile only.

**Why Mumbai:** chat round-trips the server on every message. Mumbai is ~20–40ms
from Indian users vs ~250ms from US-East. Keeping ID images onshore is a secondary
benefit. Note the region **cannot be changed after project creation**.

**Why Android only:** India is ~95% Android. Halves the work and avoids the stricter
App Store review. iOS deferred, not designed out.

**Why native, not web:** screenshot detection has no web equivalent. This is a
requirement, not a preference.
