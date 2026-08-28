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
| 2 | Friends, DMs, block/report primitives | Not started |
| 3 | Groups | Not started |
| 4 | Looty Match | Not started |
| 5 | Automatic moderation engine | Not started |
| 6 | Ads + subscription | Not started |
| 7 | Play Store requirements | Not started |

### What exists right now

```
supabase/migrations/   4 migrations: colleges + domain allowlist, profiles,
                       verifications + bans + access gate, RLS + column grants
supabase/tests/run.mjs 34 behaviour tests, run with `npm run test:db`
supabase/seed.sql      sample colleges; domain list deliberately EMPTY
```

The tests run against an in-process Postgres (pglite), so they need **no Docker and
no Supabase project**. They are not a substitute for testing against real Supabase —
`auth.users`, `auth.uid()` and the client roles are stubbed.

### Still missing from Phase 1

The Expo app itself, Google Sign-In, phone OTP, the vision Edge Function that writes
verification results, the storage buckets for ID images, and the scheduled sweep
that deletes those images after 30 days.

### Blocked on the user (cannot proceed without these)

These require accounts and credentials that only the project owner can create:

- Supabase project, **created in `ap-south-1` (Mumbai)** — see §5 for why this is
  irreversible
- Google Cloud OAuth client (for Google Sign-In)
- SMS/OTP provider account — **note: Indian transactional SMS requires DLT
  registration**, which is a real regulatory step, not a signup form
- Vision API access for ID card OCR and face matching
- AdMob account, Google Play Console account

---

## 3. Product specification

Everything in this section is **decided**. Do not re-open without an explicit
decision recorded in LOG.md.

### 3.1 Profile

- **Profile picture required** at signup. Looty Match does not work without faces.
- **Legal name** comes from ID card OCR and is stored **privately**. It is never
  exposed to other users and is not readable from the client.
- **Display name** defaults to first name only. Users may shorten it further but
  cannot invent an unrelated name. Tier 2 users who skipped the ID step supply
  their own.
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

The original design gated signup on a college email domain. A domain is
**automatic, instant, free, and effectively unforgeable** — a college controls its
own domain, so nobody can fake `@iitb.ac.in`.

That was abandoned because **many Indian colleges issue no student mailboxes at
all.** Most students are at state universities and affiliated colleges that give out
nothing; students use Gmail for everything, including official college
communication. Gating on domains would have capped the addressable market at an
unknown and probably small number.

Signup is now open to any email. But note what was lost: **an ID card is the
opposite of a domain on every axis.** Indian college IDs have no standard format —
every college designs its own, and there is no database to check them against. A
genuine card from an unfamiliar college is indistinguishable from a fabricated one.
No reviewer can tell, and neither can a model.

**Therefore the ID card cannot carry the gate alone.** Access is layered instead.

### 4.2 The tiers

| Tier | Reached by | Can do |
|---|---|---|
| **0 — Unverified** | Google Sign-In + phone OTP | Browse and **read** groups. No posting, no DMs, no Match. |
| **1 — Verified** | ID card + live selfie passed automated checks | Full access |
| **2 — College Verified** | Signing up with a recognized college domain, **or** adding one later | Tier 1 + visible **Verified** badge |

Tier 0 is deliberately a harmless lurker mode. It costs nothing to allow, keeps
signup frictionless, and keeps the risky surfaces — Match especially — behind real
verification.

### 4.3 Signup flow

1. **Google Sign-In** — any email accepted.
2. **Phone number + OTP.**
3. Email domain checked against the allowlist.
   **Match → Tier 2**, college auto-assigned, ID step skipped entirely.
   **No match → continue to step 4.**
4. **Select college** from a searchable list, or file a "request to add college".
5. Capture **ID card photo + live selfie**. The selfie must be **camera-only with a
   random prompt** ("turn your head left") so a photo of a photo cannot pass.
6. **Automated checks:**
   - **Face match: ID card photo ↔ live selfie.** This is the highest-value check in
     the entire system. Almost nobody forges a card — what they actually do is use a
     real card belonging to a friend, sibling, or one found online. Face matching
     kills that entire category of abuse.
   - **College match:** OCR'd college name ↔ the college they selected.
   - **Expiry:** card still valid, where the card prints one.
   - All clean → **Tier 1**. Any mismatch or low confidence → flagged queue, stays
     Tier 0.
7. **Profile setup:** username, display name, DP, course length.

The ID card OCR is the **source** of the legal name. It is not compared against a
name the user typed — there is no such name.

### 4.4 Image retention — do not keep the photos

Store the **extracted fields and the match score only**. Delete the ID photo and
selfie after **30 days**. This preserves proof that verification passed without
accumulating a library of student ID cards and faces, which would be a severe
liability in a breach.

### 4.5 Ban evasion — phone is the anchor

With open Gmail signup, **hashing the email is worthless** as a ban anchor. A new
Gmail account takes two minutes to create.

**The phone number is the primary identity anchor.** Indian SIM cards are
Aadhaar-linked and limited per person, which makes phone numbers genuinely scarce in
a way email addresses are not. Permanent bans are enforced against a **hashed** phone
number. Phone numbers are never stored raw — the raw value is needed only
transiently, at OTP send time.

---

## 5. Architecture

### Stack

| Layer | Choice | Why |
|---|---|---|
| Client | **React Native (Expo)**, EAS Build | Native is *required*, not preferred — screenshot detection has no web equivalent |
| Backend | **Supabase** — Postgres, Realtime, Auth, Storage, Edge Functions | Friend graphs and match logic are relational; this is where Firestore gets painful |
| Region | **`ap-south-1` (Mumbai)** | See below |
| Vision | OCR + face match in an Edge Function | ID verification |
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
profiles            id, username, full_name(private), display_name, dp_url,
                    college_id, course_years, start_year, end_year, gender,
                    trust_tier(0|1|2), phone_hash(unique), phone_verified_at
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
banned_phone_hashes hash    -- primary ban anchor
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

**Column-level privacy.** `profiles.full_name` and `profiles.phone_hash` are not
readable by the client at all — enforced with Postgres column grants, not just RLS.

---

## 7. Known risks and open items

**OCR accuracy on Indian college IDs.** Formats vary enormously, print quality is
often poor, lamination causes glare. Expect a meaningful flagged rate. Consequence:
although moderation is fully automatic by design, **verification will still need a
small manual queue** for flagged cards. There is no way around this — the
alternative is either rejecting real students or admitting fakes. Keep the volume
low by tuning confidence thresholds.

**Face matching may count as biometric processing under DPDP**, and with no age gate
some users will be minors. This is a genuine increase in legal exposure compared to
the email-only design. The 30-day deletion policy in §4.4 is the main mitigation.
**This warrants a lawyer's review before launch** — it is past the point where an
engineering judgement call is appropriate.

**Screenshot detection below Android 14 — undecided, needed before Phase 4.**
Android 14 (API 34) provides a real `ScreenCaptureCallback`. Below that there is no
detection API at all — only `FLAG_SECURE`, which *blocks* screenshots rather than
notifying. A large share of Indian devices are pre-14. Proposed handling:
`FLAG_SECURE` on <14 (screenshots blocked), `ScreenCaptureCallback` on 14+ (allowed
but the other person is notified). Behaviour would differ by device.

**Phase 0 — college domain list.** No longer blocking, but every domain added moves
signups from the slow ID path to the instant Tier 2 path. Worth building
continuously. For each college confirm: do students get mailboxes, the exact
domain/subdomain, and roughly what share of students have one.

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
