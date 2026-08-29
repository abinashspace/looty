# Looty — Project Context

> **What this file is.** The always-current description of Looty: what it is, every
> decision that has been settled, how it is built, and what is still open. It is
> edited in place — when something changes, the old text is **replaced**, not
> appended. If you read only one file to understand this project, read this one.
>
> **What this file is not.** It is not a history. Every change to this file should
> also get a dated entry in [`LOG.md`](LOG.md), which is append-only and never
> edited. CONTEXT = what is true now. LOG = how it got that way.
>
> Last updated: 2026-08-28

---

## 1. What Looty is

Looty is a **text-first social app for verified college students in India**. The
promise is a peer-only space — no parents, teachers, relatives, or outsiders. That
promise is the entire product, and every verification decision below exists to
protect it.

**Looty is a friends app, not a dating app.** This is a deliberate position, not a
technicality. It was originally specced with a Dating group category and a
dating-shaped matching feature. That was removed because:

- Dating functionality forces an 18+ rating on both app stores.
- India's DPDP Act requires verifiable parental consent for under-18 users and bans
  behavioural advertising aimed at them, which collided with the ad-supported tier.
- Student dating is a crowded market; student friend-finding is not.

**The repositioning only holds if it is carried through everywhere.** Nothing in the
UI, copy, notifications, onboarding, or the Play Store listing may use romantic
framing — no "crush", no hearts, no "someone likes you 😍". A single line like "find
your campus crush" in the store description undoes it and puts the rating back to
18+. This constraint is permanent and applies to every future feature.

### Vocabulary (use these words, they are load-bearing)

| Term | Meaning | Never call it |
|---|---|---|
| **Loot** | Tapping to like someone in the discovery feed | "swipe", "like" |
| **Connected** | Mutual loot — chat unlocks | "match" (dating connotation) |
| **Looty Match** | The discovery feed feature name | — |
| **Tier 0 / 1 / 2** | Trust levels, see §4 | "unverified user" loosely |

---

## 2. Current status

**Nothing is shipped. No app exists yet.** As of 2026-08-28 the repo contains this
document, the log, the Phase 1 database schema, and its tests.

| Phase | Scope | Status |
|---|---|---|
| 0 | College domain list | **Not started — needs the owner**, see §7 |
| 1 | Auth, verification, trust tiers, profile | **Schema + tests done.** No app, no Edge Functions |
| 2 | Friends, DMs, block/report primitives | **Schema + tests done.** No UI |
| 3 | Groups | Not started |
| 4 | Looty Match | Not started |
| 5 | Automatic moderation engine | Not started |
| 6 | Ads + subscription | Not started |
| 7 | Play Store requirements | Not started |

### What exists right now

```
supabase/migrations/   9 migrations. Phase 1: colleges + domain allowlist,
                       profiles, verifications + bans + access gate, RLS +
                       column grants. Phase 2: blocks + friendships, threads +
                       messages, reports, Phase 2 RLS. Then: college email
                       verification (the only route to Tier 2)
supabase/tests/run.mjs 79 behaviour tests, run with `npm run test:db`
supabase/seed.sql      sample colleges; domain list deliberately EMPTY
mobile/                Expo app (SDK 57, RN 0.86), Android-only
  src/lib/tiers.ts     client mirror of the server tier gate — NOT security
  src/lib/session.tsx  auth session + profile + signup step resolution
  src/lib/supabase.ts  client; degrades to a setup screen when .env is absent
  src/app/(auth)/      sign-in, verify (college email), college, profile-setup
  src/app/(app)/       tabs: groups, match, looted, chats, profile
```

Every screen under `src/app` is a **placeholder** naming the phase that will fill it
in. The navigation shell, tier gating and routing are real; nothing behind them is.

The database tests run against an in-process Postgres (pglite), so they need **no
Docker and no Supabase project**. They are not a substitute for testing against real
Supabase — `auth.users`, `auth.uid()` and the client roles are stubbed.

### Verified so far

`npm run test:db` passes 79/79. `npx tsc --noEmit` is clean, and
`npx expo export --platform android` produces a bundle, which proves imports
resolve. Nothing has been run on a device or emulator.

The Phase 2 tests run as an actual `authenticated` role with a JWT claim set, so
RLS genuinely applies to them. Phase 1 tests run as superuser and therefore check
grant *metadata* rather than live enforcement — a weaker guarantee, worth knowing
when reading them.

**Against the live database:** all 13 tables exist, and every one of them refuses
the `anon` role outright (`42501 permission denied`). That matters more than it
looks — the anon key ships inside the APK and anyone can extract it in a minute, so
"anon can read nothing" is the property that keeps the whole database private.

Not yet verified live: authenticated-role behaviour. That would mean creating a real
user in the production project, which has not been done.

### Still missing from Phase 1

Google Sign-In, and the Edge Function that issues college-email codes (generates
the code, stores its hash, sends the mail). Both blocked on credentials — see
below. Everything else in Phase 1 is done.

### Live infrastructure

**Supabase project `zsfjwlmeeodsiwruvine`**, region `ap-south-1` (Mumbai),
Postgres 17.6, on the free plan. All 9 migrations are deployed. The repo is linked
via the Supabase CLI, so `npx supabase db push` applies new migrations directly —
it authenticates with the stored access token and does not prompt for the database
password.

`mobile/.env` holds the project URL and anon key. It is gitignored; recreate it
from `mobile/.env.example` if it goes missing.

### Blocked on the user (cannot proceed without these)

These require accounts and credentials that only the project owner can create:

- Google Cloud OAuth client (for Google Sign-In)
- An **email sending provider** for the college-email codes — Resend, SES or
  similar. Far easier than the SMS path that was dropped: no DLT registration, no
  business documents, and free tiers cover early volume comfortably.
- AdMob account, Google Play Console account

No longer needed, since the ID path was removed: a KYC/vision vendor, and an
SMS provider with DLT registration.

---

## 3. Product specification

Everything in this section is **decided**. Do not re-open without an explicit
decision recorded in LOG.md.

### 3.1 Profile

- **Profile picture required** at signup. Looty Match does not work without faces.
- **Display name** is entered by the user. With the ID path gone there is no
  document to take a legal name from, so nothing verifies it — the college email is
  what proves someone is a student, not their name. `profiles.full_name` is dormant
  along with the rest of the ID machinery (§4.5).
- **Username**: unique, lowercase letters/numbers/underscore, 3–20 characters,
  changeable **once every 14 days**. Reserved blocklist: `looty`, `admin`,
  `support`, `official`.
- **No date of birth is collected. There is no age gate.** This follows from the
  friends-app repositioning.
- **Course length** captured at signup (B.Tech = 4 years, B.Sc = 3 years, etc.),
  which derives an expected end year.
- **Alumni are never cut off.** Once the course period passes, the profile shows an
  **Alumni** badge so students can see who they are talking to. Access is unchanged.
- **Email cannot be changed in-app.** Support only.

### 3.2 Direct messages — Tier 1+

Friend-request based, mutual accept required. Search by username. Text and images.
No video. **No content moderation** — these are friend-gated, so the risk is low.

### 3.3 Groups — read at Tier 0, post at Tier 1+

- Categories: **Study, Sports, Friends**. (Dating was removed.)
- Global — open to all students, not college-specific. Open join, no approval.
- **Text only.** No images. This is what keeps the moderation load survivable.
- **1024 members per room**, matching WhatsApp's limit. At capacity, the next room
  auto-creates: Study 1, Study 2, Study 3…
- New joiners see the **last 50 messages**.
- Automatic profanity filter.

### 3.4 Looty Match — Tier 1+ only

- Vertical scroll feed. Card shows DP, username, display name.
- **Loot or pass.** Both are recorded; a pass removes that person from the feed.
- **10 loots/day free, 50/day paid.** (Originally 3/hour — hourly caps feel broken
  on a scroll feed.)
- Mutual loot → **Connected**, chat unlocks.
- The **looted-you list is blurred**; revealing it is a paid feature.
- Connected chats allow text and images. **Images are blurred by default with
  tap-to-reveal** — these chats are between strangers, unlike DMs, which makes them
  the app's main unsolicited-image risk.
- **Screenshot detection notifies the other person.** It does not block. See §7.
- Filters: college scope (same college / all India, **default same college**), plus
  an opt-in "only show me the same gender" safety toggle.

### 3.5 Safety

- **Bans are fully automatic. No human reviews reports.**
- **8 unique reporters → 5-day ban.** The number matters less than the rules
  around it, all of which are automatic:
  - one report per reporter per target, **ever** (no repeat stacking)
  - reporter's account must be **7+ days old and Tier 1+**
  - if a reporter is later banned themselves, **their past reports stop counting**
    — this retroactively unwinds brigades
- **3 bans → permanent block**, anchored on hashed phone number (see §4.3).
- **Appeals** via in-app form → queue reviewed every few days. Volume is low because
  only banned users file them.
- **Block is separate from report.** Reporting is for the platform; blocking is for
  the user. A block removes any connection or friendship, hides threads, prevents new
  requests, permanently removes each from the other's feed, and collapses their group
  messages. It is silent — the blocked person is not told. No cap. Survives bans.

### 3.6 Monetization

- **₹119/month, ₹49 for the first month.** Google Play Billing — in-app purchase is
  mandatory for digital goods, so Razorpay/UPI is not an option inside the app.
- Paid tier = ad-free + 50 loots/day + reveal who looted you.
- Free tier = **non-personalised ads only, app-wide** (AdMob). Because there is no
  age gate, some users will be under 18, and DPDP prohibits behavioural advertising
  to them. Serving everyone non-personalised ads removes the problem without needing
  to know anyone's age.

### 3.7 Platform

- **Android only** for v1. India is roughly 95% Android; this halves the work and
  avoids the stricter App Store review. iOS is deferred, not designed out.
- **Mobile only. No web version** — screenshot detection does not exist on web.

---

## 4. Verification and trust tiers

This is the most important system in the app and the one most likely to be
misunderstood, so it is documented in full.

### 4.1 Why it is built this way

**A college email domain is the only proof Looty accepts.** A domain is automatic,
instant, free, and effectively unforgeable — a college controls its own domain, so
nobody can fake `@iitb.ac.in`.

An ID card is the opposite on every axis. Indian college IDs have no standard
format — every college designs its own, and there is no database to check them
against. A genuine card from an unfamiliar college is indistinguishable from a
fabricated one; no reviewer can tell, and neither can a model. Verifying them means
paying a vendor per signup, handling biometric data under DPDP, and staffing a
manual queue for cards the automated check cannot read.

**That path was built into the schema and then removed from the product.** Its
columns remain, dormant — see §4.5.

**The trade this makes, stated plainly: reach is now exactly the domain
allowlist.** A student whose college issues no email can never pass Tier 0. Many
Indian colleges — particularly state and affiliated ones — issue nothing. This is
acceptable while launching at colleges that do issue email (IITs, NITs, BITS, large
private universities), and it is the reason §7 lists the domain list as the single
most important open task rather than a background one.

### 4.2 The tiers

| Tier | Reached by | Can do |
|---|---|---|
| **0 — Unverified** | Google Sign-In alone | **Read** groups, request a college. No posting, no DMs, no Match. |
| **1 — Verified** | *Nothing. Dormant.* | — |
| **2 — College Verified** | College email confirmed | Full access, **Verified** badge |

**Tier 0 is not a waiting room.** For a student whose college has no email domain it
is permanent. The app must say so honestly — "Looty isn't at your college yet" — and
offer the request-a-college flow rather than leaving them staring at a verification
screen they can never pass. Those requests are the growth roadmap: the colleges
asked for most often are the ones worth chasing a domain for.

Tier 1 is kept in the numbering so capability minimums stay meaningful and
reinstating the ID path is a decision rather than a migration.

### 4.3 Signup flow

1. **Google Sign-In** — any email accepted.
2. Email domain checked against the allowlist.
   **Match → Tier 2 immediately**, college auto-assigned, nothing else needed. This
   is the ideal path: colleges on Google Workspace have addresses like
   `name@college.ac.in` that *are* Google accounts, so it is one tap.
   **No match → step 3.**
3. **"Add your college email."** They enter a college address, a 6-digit code is
   emailed to it, they enter the code → **Tier 2**.
   Offer this before anything else — it is free, instant, and costs nothing to run.
4. **No college email at all** → they stay Tier 0, read groups, and can **request
   their college**.
5. **Profile setup** (Tier 2 only): username, display name, DP, course length.

### 4.4 Code handling

The code is **never stored** — only `sha256(code || per-row salt)`. A database leak
therefore hands nobody a working code.

**Five attempts, then locked out.** A six-digit code is a million guesses; without a
working counter it falls in seconds. See the warning in §4.6 about how that counter
was nearly broken.

Codes are **issued only by an Edge Function under `service_role`**, never by the
client — the raw code must reach the mailbox and nothing else. Confirming is
client-callable, since it only succeeds with the right code.

### 4.5 Dormant, not deleted

The ID-card machinery is still in the schema: `verifications.ocr_*`,
`face_match_score`, the image path columns, the `id_card` method, and
`profiles.phone_hash` / `phone_verified_at`. Nothing writes to them.

They are kept so that reinstating verification — if the domain list turns out too
small — is a decision rather than a rebuild. Do not mistake their presence for a
feature that exists.

### 4.6 Ban evasion — the college address is the anchor

A Gmail is free and infinite, so hashing it is worthless as a ban anchor. **A
college address is one per student and hard to get another of**, which makes it the
right thing to anchor to. Permanent bans are enforced against a hashed college
address in `banned_identities`, which survives account deletion — the point of it.

Phone OTP was considered for this job and **dropped**: it would have required DLT
registration with Indian telecom operators, which takes weeks and business
documents, to solve a problem the college address already solves.

**Do not "fix" `confirm_college_email` to raise exceptions instead of returning
status strings.** `raise` aborts the surrounding subtransaction, which rolls back
the attempt counter incremented moments earlier — leaving `attempts` permanently at
zero and the lockout permanently dead. This was a real bug, caught by a test that is
still there.

---

## 5. Architecture

### Stack

| Layer | Choice | Why |
|---|---|---|
| Client | **React Native (Expo)**, EAS Build | Native is *required*, not preferred — screenshot detection has no web equivalent |
| Backend | **Supabase** — Postgres, Realtime, Auth, Storage, Edge Functions | Friend graphs and match logic are relational; this is where Firestore gets painful |
| Region | **`ap-south-1` (Mumbai)** | See below |
| Email | Provider TBD (Resend / SES) via Edge Function | College-email codes |
| Push | Expo Push → FCM | |
| Ads | AdMob, non-personalised globally | |
| Billing | Google Play Billing | IAP mandatory for digital goods |

### Why Mumbai region specifically

**Latency is the main reason.** Chat round-trips the server on every message. Mumbai
is roughly 20–40ms from Indian users; Singapore is 60–90ms; US-East is 250ms+. At
30ms a message feels instant. At 250ms the app feels broken, and users read that as
"this app is slow" without knowing why.

**Data residency is secondary.** To be accurate: the DPDP Act does **not** mandate
data localisation — that was in earlier draft bills; the final Act uses a blocklist
model. Keeping student ID images onshore is risk reduction, not a legal requirement.

**This decision is irreversible.** Supabase region is fixed at project creation and
cannot be changed without a full migration.

### Note on tooling

The shadcn / UI-registry workflow used on other projects in this account **does not
apply here.** React Native is a different component ecosystem.

---

## 6. Data model

Full schema lives in `supabase/migrations/`. Core tables:

```
colleges            id, name, city, state, status
college_domains     id, college_id, domain          -- exact strings, no wildcards
college_requests    id, name, domain, requester, status
profiles            id, username, display_name, dp_url, college_id,
                    college_email(private, unique — the ban anchor),
                    course_years, start_year, end_year, gender,
                    trust_tier(0|2; 1 dormant)
                    full_name / phone_hash / phone_verified_at — dormant, §4.5
verifications       id, user_id, method, status, claimed_college_id,
                    ocr_*, face_match_score, image paths, images_deleted_at
friendships         id, requester_id, addressee_id, status
blocks              blocker_id, blocked_id
loots               id, actor_id, target_id, action(loot|pass)   -- unique pair
connections         id, user_a, user_b, status(active|ended)
threads             id, type(dm|connection), participants
messages            id, thread_id, sender_id, body, image_url, created_at
groups              id, category, room_number, member_count
group_members       group_id, user_id
reports             id, reporter_id, target_id, context, reason
                    -- unique (reporter_id, target_id)
bans                id, user_id, type, starts_at, ends_at
appeals             id, ban_id, user_id, text, status
banned_identities   hash, kind  -- ban anchor; survives account deletion
email_verifications user_id, email, college_id, code_salt, code_hash,
                    expires_at, attempts, consumed_at
subscriptions       user_id, status, product_id, current_period_end
push_tokens         user_id, token
notification_prefs  user_id, loots, connections, dms, requests, groups
```

### The rule that matters most

**Enforce server-side, never in the client.** Trust tier gating, loot quotas, ban
thresholds, the domain allowlist, room capacity, and subscription entitlements must
all live in the database or an Edge Function. Anything enforced only by hiding UI
will be bypassed within a week of launch. Tests explicitly call endpoints directly,
bypassing the UI, to prove this.

**Column-level privacy.** `profiles.college_email`, `full_name` and `phone_hash`
are not readable by the client at all, and neither are `email_verifications`
`code_hash` / `code_salt` — enforced with Postgres column grants, not just RLS,
because RLS filters rows and cannot hide a column.

---

## 7. Known risks and open items

**The domain list is now the product's entire reach — this is the biggest open
risk.** Every college missing from `college_domains` is a college where Looty
cannot be used beyond read-only, permanently. Nothing else compensates now that the
ID path is gone.

Worse, the size of that reach is currently **unknown**, because nobody has yet
confirmed how many Indian colleges actually issue student mailboxes. If the answer
turns out to be "far fewer than expected", the honest options are to narrow the
launch to colleges that do, or to reinstate the ID path from §4.5. Finding out is
Phase 0 and it cannot be done from a keyboard.

**A student can hold their college address after graduating.** Most Indian college
mailboxes stay live for years, so a 2020 graduate can still verify today. The Alumni
badge (§3.1) makes this visible rather than preventing it, which is the intended
behaviour — but it does mean "verified" means "has a college address", not "is
currently enrolled".

**Screenshot detection below Android 14 — undecided, needed before Phase 4.**
Android 14 (API 34) provides a real `ScreenCaptureCallback`. Below that there is no
detection API at all — only `FLAG_SECURE`, which *blocks* screenshots rather than
notifying. A large share of Indian devices are pre-14. Proposed handling:
`FLAG_SECURE` on <14 (screenshots blocked), `ScreenCaptureCallback` on 14+ (allowed
but the other person is notified). Behaviour would differ by device.

**Phase 0 — college domain list. Now the single most important open task.** For
each college confirm: do students actually get mailboxes, the exact domain and
subdomain, and roughly what share of students have one. A wrong entry is worse than
a missing one — a missing domain merely locks a student out, a wrong one hands full
access to whoever holds an address on it.

**This repo is public.** The moderation thresholds and anti-brigade rules in §3.5
are therefore readable by anyone, which makes them easier to game. Consider making
the repo private before launch.

### Assumptions never explicitly confirmed

Flag if any of these are wrong: image blur in connected chats; non-personalised ads
app-wide; college-scope and same-gender filters in Match; unmatch/leave; message
retention (DMs indefinite, groups 30-day rolling); notification granularity; typing
indicators yes, read receipts in DMs only, no last-seen.

**Rejected, do not revisit without a decision:** invite-based vouching (verified
students inviting others) was considered and declined.

---

## 8. Domain traps — things that look like bugs but are not

- **Never block by "is this email Google-hosted".** Many Indian colleges run their
  email on Google Workspace, so the address is `name@college.ac.in` but the mailbox
  is Gmail underneath. Domain checks must be **literal string matches** against the
  allowlist. There is no personal-provider blocklist any more — Gmail is explicitly
  allowed at Tier 0.
- **No wildcard domains.** A college may use `@xyz.ac.in` for staff and
  `@student.xyz.ac.in` for students. Store exact domains. A wildcard would let
  `@alumni.xyz.ac.in` through.
- **"Match" the word is banned in user-facing copy.** The feature is Looty Match;
  the state is "Connected". See §1.
- **Alumni are not removed.** Expired course period means a badge, not a ban.
