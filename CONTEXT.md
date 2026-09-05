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
> Last updated: 2026-09-05

---

## 1. What Looty is

Looty is a **text-first social app for college students in India**. The promise is
a peer space — a place that is for students and feels like it.

**Read that as aspiration, not as an enforced property. It changed on 2026-09-04.**
Until then the promise was literal: a college email domain was the gate, and
anyone without one was locked out of everything but reading. That gate is gone. A
confirmed sign-in address — a Gmail — now reaches Tier 1, and Tier 1 opens groups,
DMs and Match. Nothing stops a parent, a teacher, or a stranger from signing up.

What remains of the original promise is a **badge**: confirming a college address
still reaches Tier 2 and shows College Verified. The peer-only space is now a
social norm the badge supports, plus moderation, rather than a wall the database
enforces. Every claim in this file that says otherwise has been rewritten; if you
find one that was missed, it is a bug in the document. See LOG.md, 2026-09-04.

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

**Nothing is shipped, but the app is built.** Every screen exists and works against
the live Supabase project. **It has been run on a real Android phone** (Realme
RMX3771) via USB + Expo Go 57. On 2026-09-01 the owner signed in, confirmed a
college email at `thangavelu.edu.in`, finished profile setup as **Abinash S /
@abinashspace** (College Verified, optional photo uploaded), and walked Groups,
Match, Looted you, Chats, and You. Study / Sports / Friends are joined. A group
text send was verified on device. On 2026-09-02 the composer was walked again:
Expo Go still overlays the IME, `ChatShell` pads by keyboard `screenY`, tabs
hide while typing, and a Study send landed with the field visible.

**On 2026-09-05 the app was walked on two phones at once** — the Realme (Android
15) as `@abinashspace` and a Samsung SM-F415F (Android 12) as a new account
`@priya`. The two Android versions sit either side of the 14 line, so both
branches of the screenshot split were exercised, one per phone. Verified on
device: a fresh signup reaching Tier 1 with full access, Match between two real
accounts through mutual loot to Connected, `FLAG_SECURE` set inside a Connected
chat on 12 and cleared on leaving, capture allowed on 15, and typing indicators.
Two defects turned up and were fixed in migration 37 — see LOG.md, 2026-09-05.
**The Android 14+ screenshot notice is the exception: it fired once in six tries
and is an open bug (§7).** **1:1 photos are the one flow still never walked on a
phone.**

`expo-notifications` must not be imported at module load in
Expo Go (SDK 53 throws); `registerPushToken` lazy-requires it only in a native
build.

**It has also been run once in a browser**, on 2026-08-30, via `react-native-web`.
That found the signup-routing bug. The verified-student API surface was exercised
live as Tier 2 on 2026-08-31.

| Phase | Scope | Status |
|---|---|---|
| 0 | College domain list | **No longer blocking.** Downgraded 2026-09-04 from launch gate to badge coverage — a missing domain now costs a badge, not access. Live has `thangavelu.edu.in` plus probe domain `looty.test.invalid` |
| 1 | Auth, verification, trust tiers, profile | Schema, screens and Edge Function done. **Missing: Google Sign-In, real email delivery** |
| 2 | Friends, DMs, block/report | Done — schema, tests, inbox, threads, search, requests. **Verified live as Tier 2** |
| 3 | Groups | Done — schema, tests, room list and live chat. **Verified live as Tier 2** |
| 4 | Looty Match | Done — schema, tests, feed, quota, Looted-you paywall. **Verified live as Tier 2** (loot, mutual Connect, quota) |
| 5 | Automatic moderation engine | Done — schema, tests, restriction screen and appeal form |
| 6 | Ads + subscription | **Not started — needs AdMob and Play Console** |
| 7 | Play Store requirements | Account deletion and notification prefs are **built**. Listing drafted in `legal/`. Privacy is hosted at https://abinashspace.github.io/looty/. Play Console still needed |

### What exists right now

```
supabase/migrations/   37 migrations. Phase 1: colleges + domain allowlist,
                       profiles, verifications + bans + access gate, RLS +
                       column grants. Phase 2: blocks + friendships, threads +
                       messages, reports, Phase 2 RLS. Then: college email
                       verification (the only route to Tier 2). Phase 3:
                       groups, membership, group messages, word filter.
                       Phase 4: loots, connections, subscriptions, feed +
                       quota. Phase 5: ban engine, brigade unwinding,
                       appeals. Then: function EXECUTE lockdown (x2),
                       profile-enumeration fix + group_thread(), avatars
                       storage bucket, derived onboarding_complete,
                       my_threads() + realtime publication, match filter
                       grants + my_match_prefs(), friend discovery,
                       function lockdown sweep, function-create grants fix,
                       notification_prefs, username trigger SECURITY DEFINER,
                       chat-images bucket, push_tokens, screenshot notices,
                       group-message 30-day purge, export_my_data,
                       connection-end closes thread, unfriend ends DM, my_blocks,
                       thread_reads + inbox unread, sign-in email grants Tier 1,
                       1:1 typing heartbeat, inbox last_kind + collegeless
                       Match fallback
supabase/functions/    issue-college-code, delete-account (both deployed)
supabase/tests/run.mjs 231 behaviour tests, run with `npm run test:db`
supabase/seed.sql      sample colleges; domain list deliberately EMPTY
                       (a missing domain now costs a badge, not access)
mobile/                Expo app (SDK 57, RN 0.86), Android-only
  src/lib/tiers.ts     client mirror of the server tier gate — NOT security
  src/lib/session.tsx  auth session + profile + signup step resolution
  src/lib/supabase.ts  client; degrades to a setup screen when .env is absent
  src/lib/chat-image.ts  private upload + signed URL for 1:1 photos
  src/lib/push.ts      register/unregister Expo push token (no-op in Expo Go)
  src/lib/profile-photo.ts  512px DP upload (setup and edit)
  src/components/avatar.tsx  Photo or initials; Match card variant
  src/components/ui.tsx  Screen / Field / Button / Notice / Toggle — the whole kit
  src/components/chat.tsx  ChatShell + MessageList + Composer (groups and DMs)
  src/app/(auth)/      sign-in, profile-setup — the whole signup. verify and
                       college still live here but are OFF the signup path;
                       they are reached from You as an optional badge
  src/app/(app)/       groups/ (list, room), chats/ (inbox, thread, search,
                       requests), match, looted, profile — all REAL.
                       Chats tab badge = unread threads + incoming requests.
                       Looted-you tab badge = looted_you_count (number only)
  src/app/banned.tsx   restriction notice + appeal form — REAL
```

**Every screen is now built.** Sign in, college-email verification, profile setup
with photo, your own profile (tier badge, notification switches, data export, account deletion),
three group rooms with live chat, the DM inbox, friends list and 1:1 chat, the Match feed with
loot/pass and daily quota, the Looted-you list with its paywall, and the
restriction screen with an appeal form. Report and Block sit in the 1:1 chat header. In group rooms, long-press someone
else's message to report or block them.

The only remaining `Placeholder` is the "Supabase not configured" screen, which is
meant to be one.

**Not built yet:** Phase 6 (ads, Play Billing). Google Sign-In is **wired** and
hidden until the OAuth client exists. Push *delivery* (Expo Push → FCM) is not
sent yet. The client calls `register_push_token` after onboarding and
`unregister_push_token` on sign-out; Expo Go on Android cannot obtain a remote
token (SDK 53+), so that path is a no-op until a native/EAS build with a
`projectId`. Play listing copy is drafted under `legal/`. The privacy policy
is hosted at https://abinashspace.github.io/looty/ (`docs/` on this repo).

**1:1 chats can carry images.** Stored in the private `chat-images` bucket;
`messages.image_url` holds the path, not a public URL. Connected chats do not
fetch the file until the recipient taps ("Photo · tap to view") — a blurred
download is still a download. Friend DMs show immediately. Groups stay text-only.

**Development auth is email/password.** Google Sign-In is the intended production
entry point and drops in beside it — nothing downstream looks at how you
authenticated.

The database tests run against an in-process Postgres (pglite), so they need **no
Docker and no Supabase project**. They are not a substitute for testing against real
Supabase — `auth.users`, `auth.uid()` and the client roles are stubbed.

### Verified so far

`npm run test:db` passes 231/231. `npx tsc --noEmit` is clean. The UI has rendered
on a real Android device (2026-08-31, again 2026-09-01 through profile, groups,
and a Study send) and once in a browser (2026-08-30). Chat images and push-token
RPCs were verified against the live API on 2026-09-01; the 1:1 image picker has
not been tapped on a device.

**Two-phone walkthrough, 2026-09-05.** Realme (Android 15) and Samsung SM-F415F
(Android 12), both on USB. Confirmed on device: a plain confirmed signup reaches
Tier 1 with full access; Match between two real accounts through mutual loot into a
Connected chat; `FLAG_SECURE` set inside a Connected chat on Android 12 and cleared
on leaving; capture allowed on Android 15; typing indicators. The two defects this
found are fixed in migration 37 and covered by the two tests added with it — both
were checked against the unfixed code and do fail without it.

**Not verified, despite an earlier claim in this file that it was:** the Android
14+ screenshot notice. It fired once in six attempts (§7). The inbox "Screenshot"
label added in migration 37 is therefore also unconfirmed on a device — it is
covered by a database test, but the notice has to fire for it to be visible.

The Phase 2 tests run as an actual `authenticated` role with a JWT claim set, so
RLS genuinely applies to them. Phase 1 tests run as superuser and therefore check
grant *metadata* rather than live enforcement — a weaker guarantee, worth knowing
when reading them.

**Against the live database:** all 26 tables exist, and every one of them refuses
the `anon` role outright (`42501 permission denied`). Re-checked for
`notification_prefs` and `push_tokens` on 2026-09-01. That matters more than it looks — the anon
key ships inside the APK and anyone can extract it in a minute, so "anon can
read nothing" is the property that keeps the whole database private.

**Functions are locked too, and this needed fixing.** Postgres grants EXECUTE on
every new function to PUBLIC by default — the opposite of tables, which start
closed. So `anon` could call `looted_you()` and `match_feed()` on the live project.
Nothing leaked, because each function checks `auth.uid()` and returned empty. But
that made safety depend on every function remembering to check, rather than on the
permission system. Two attempted fixes both failed silently. Migration 12's
`alter default privileges` does nothing (`pg_default_acl` stays empty). Migration
14 replaced it with an **event trigger**, and every function added afterwards still
shipped open to `anon`.

> **Why migration 14's event trigger failed is now SETTLED, live, 2026-08-31.**
> The trigger exists, is enabled, and **does run**. A throwaway
> `public._looty_event_trigger_probe()` was created on production and called as
> `anon` via PostgREST: it returned 200 `"reachable"`. The resulting ACL was
> `{postgres=X, anon=X, authenticated=X, service_role=X}` — no PUBLIC grant. So
> `revoke … from public` succeeded at doing nothing useful.
>
> The grants that matter come from Supabase's `ALTER DEFAULT PRIVILEGES` for the
> `postgres` role in schema `public`, which grants EXECUTE on every new function
> to `anon`, `authenticated` and `service_role` **directly**. Migration 12 revoked
> from PUBLIC, which was never the grantee. The earlier claim that "Supabase
> forbids event triggers" was false; the trigger was aimed at the wrong grant.
>
> Migration 22 stops those default privileges (leaving `service_role`) and makes
> the trigger revoke from `anon` as well as PUBLIC. Re-probed live: a new function
> now returns `42501 permission denied` to `anon`, ACL
> `{postgres=X, service_role=X}` only. Then dropped.

**The working mechanisms are now three, in order of how much we trust them:**

1. `lock_client_functions()` (migration 21) — explicit sweep. Still mandatory.
2. Default privileges no longer grant EXECUTE to `anon` / `authenticated`.
3. The event trigger, now actually revoking `anon`.

> **Every migration that creates a function must still end with**
> `select public.lock_client_functions();`
> Two earlier automatic attempts failed while looking like they had worked. The
> third is verified live, and the sweep stays.

**Authenticated behaviour is now verified live too.** A real test account
(`looty.devtest2@gmail.com`) confirms: the signup trigger creates the profile row,
`full_name` is refused (`42501`), self-promotion to Tier 2 is refused, `current_tier()`
then returned 0, and a Tier 0 user sees only their own profile row. After migration
35 that same confirmed Gmail is Tier 1; the remaining live Tier 0 is
`looty.devtest1@gmail.com`, whose address was never confirmed.

That last one was a **bug found by this test**: before migration 15, any Tier 0 user
could `select * from profiles` and dump the whole student directory. See §7.

### Still missing from Phase 1

Google Sign-In (needs a free Google Cloud OAuth client) and real email delivery.
The `issue-college-code` function is deployed and working; without `RESEND_API_KEY`
it logs the code instead of sending it, and refuses to do that when
`LOOTY_ENV=production`.

**Neither is launch-blocking any more.** Since 2026-09-04 a confirmed sign-in
address is enough for full access, so a user who never touches college email has
a complete app. `RESEND_API_KEY` now only gates the College Verified badge.

**A real mailbox domain is now on the allowlist** (`thangavelu.edu.in`), but
codes still do not email — that needs `RESEND_API_KEY`. The rest of the path
**has** been verified live, using a test college (`Looty Test College`, domain
`looty.test.invalid`, RFC 2606 so it can never resolve) and a code row inserted
as postgres: `confirm_college_email` returned `ok`, `current_tier()` returned 2,
and the same session joined a group, posted, searched, friend-requested, DM'd,
looted, and deleted both accounts via `delete-account`. See LOG.md, 2026-08-31.

A second live bug turned up on that same run: **nobody could pick a username.**
`enforce_username_rules` ran as the caller and SELECTed `reserved_usernames`,
which has no client grants. Profile setup has never been reachable as
`authenticated` before (signup routing was broken until 2026-08-30, and every
username test ran as superuser). Migration 24 makes the trigger SECURITY DEFINER,
same pattern as the word-filter trigger. Verified live: the profile PATCH that
returned `42501` then succeeded, and `match_feed` showed the other test student.

### Live infrastructure

**Supabase project `zsfjwlmeeodsiwruvine`**, region `ap-south-1` (Mumbai),
Postgres 17.6, on the free plan. All 37 migrations are deployed, plus the
`issue-college-code` and `delete-account` Edge Functions. The repo is linked
via the Supabase CLI, so `npx supabase db push` applies new migrations directly —
it authenticates with the stored access token and does not prompt for the database
password. `npx supabase db query --linked` can write as well as read; that is how
the event-trigger probe and the test college were applied.

Live `college_domains` has two rows:

- **`thangavelu.edu.in`** — Thangavelu Engineering College, Chennai. Added
  2026-09-01 after the owner confirmed they hold a mailbox on it. First real
  college on the allowlist.
- **`looty.test.invalid`** — probe only. `.invalid` cannot resolve.

Codes still do not email: no `RESEND_API_KEY`. The function logs the code when
`LOOTY_ENV` is not production. The owner's confirm used a code written onto the
pending row.

`mobile/.env` holds the project URL and anon key. It is gitignored; recreate it
from `mobile/.env.example` if it goes missing.

### Working on this machine

Notes that cost time to rediscover:

- **PowerShell blocks `npx.ps1`** ("running scripts is disabled on this system").
  Use `npx.cmd`, or Command Prompt, or Git Bash. Do not change the execution policy
  for this.
- **Docker is not installed.** `supabase db push`, `functions deploy` and
  `config push` all work without it. `supabase db dump` and `db diff` do not, so
  schema diffing against the remote is unavailable — the migrations are the record.
- **`supabase db push` never prompts for the database password.** The CLI is linked
  and authenticates with the stored access token; linking used `--password ""`.
- **The database tests need no network at all** — pglite runs the migrations
  in-process. pglite does not carry Supabase's `ALTER DEFAULT PRIVILEGES` that
  grant EXECUTE on new functions to `anon`, so a test that a new function is
  closed can pass here and still have been false in production (migration 14).
  A green suite is not proof about production. Call the live API.
- **A dev test account exists**, `looty.devtest2@gmail.com`, used for the live
  authenticated checks. Its password is deliberately not in the repo; reset it from
  the Supabase dashboard (Authentication → Users) if needed. Email confirmation is
  off, so new test accounts can be created and used immediately.
- **Android on this machine, as of 2026-08-31.** No full Android Studio SDK.
  Platform-tools only, via winget (`Google.PlatformTools`). `adb` lives at
  `C:\Users\DELL\AppData\Local\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe`
  and is on the user PATH (new shells pick it up; this agent's shell often does
  not — prepend that folder). A junction exists at
  `%LOCALAPPDATA%\Android\Sdk\platform-tools` so Expo can find `adb`.
- **Debugging inside Expo Go is nearly blind, learned 2026-09-05.** Fast refresh
  did **not** pick up source edits — every change needed
  `adb shell am force-stop host.exp.exponent` followed by a relaunch. Hermes
  `console.log` reaches neither logcat nor a Metro whose stdout is redirected to a
  file, so the only probe channel that worked was `Alert.alert`, read back with
  `uiautomator dump`. Budget for this before trying to diagnose anything on device.
- **Driving the UI from adb.** `uiautomator dump /sdcard/ui.xml` then
  `adb exec-out cat` gives tappable bounds; `input tap` needs the screen to have
  settled or it lands on the previous screen. Run adb from Git Bash with
  `MSYS_NO_PATHCONV=1`, or `/sdcard/...` is rewritten into a Windows path.
- **Second phone:** Samsung SM-F415F, serial `RZ8NA28NKEM`, Android 12, Expo Go
  57.0.9. Useful precisely because it is below Android 14 — it is the only way to
  exercise the `FLAG_SECURE` half of the screenshot split. It dropped off adb twice
  in one session; check the USB mode has not reverted to charging-only.
- **Phone:** Realme RMX3771, serial `7HG6IRAEKNWG4L5D`, Android 15. USB debugging on. Expo Go
  **57.0.9** was sideloaded (`adb install`); do not rely on Play Store Expo Go
  matching SDK 57. Keep the USB cable in — the router isolates Wi-Fi clients.
- **Start the app on the phone:**
  1. Plug in, `adb devices` shows `device`
  2. `adb reverse tcp:8081 tcp:8081`
  3. From `mobile/`: `npx.cmd expo start --port 8081` (do **not** pass
     `--localhost` — that binds IPv6 `::1` only, and `adb reverse` talks IPv4
     `127.0.0.1`, so the phone gets "Failed to download remote update")
  4. `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" -p host.exp.exponent`
- **`npx supabase db query --linked` is how you run SQL on live.** It is postgres,
  so it bypasses RLS. That is the right tool for probes and the wrong tool for
  claiming a client can do something — always follow a write with the same call
  as `anon` or a user JWT.

### Blocked on the user (cannot proceed without these)

These require accounts and credentials that only the project owner can create.
Step-by-step: [`legal/google-and-email.md`](legal/google-and-email.md).

- Google Cloud OAuth **Web** client. The Sign-In button is already in the app
  and stays hidden until `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is set, **and**
  the Google provider is enabled in the Supabase dashboard.
- Resend (or SES) API key for college-email codes
- AdMob account, Google Play Console account. Listing draft is in
  [`legal/`](legal/). Privacy URL for Play:
  https://abinashspace.github.io/looty/

College domains to confirm: [`colleges/CANDIDATES.md`](colleges/CANDIDATES.md).
Do not add a row to live until a student mailbox on that exact domain is real.

No longer needed, since the ID path was removed: a KYC/vision vendor, and an
SMS provider with DLT registration.

---

## 3. Product specification

Everything in this section is **decided**. Do not re-open without an explicit
decision recorded in LOG.md.

### 3.1 Profile

- **Profile picture optional.** College email is the badge, not a gate. A required
  face fought anonymity and the friends-not-dating position (owner, 2026-09-01).
  Match cards and lists show a photo if someone added one; otherwise two
  initials from the display name (else username). The Looted-you paywall still
  uses `?` placeholders — those are not initials of real people.
- **Display name** is entered by the user. With the ID path gone there is no
  document to take a legal name from, so nothing verifies it. A college email, if
  they add one, is what the College Verified badge rests on, not their name.
  `profiles.full_name` is dormant
  along with the rest of the ID machinery (§4.5).
- **Username**: unique, lowercase letters/numbers/underscore, 3–20 characters,
  changeable **once every 14 days** from You → Edit profile. Reserved blocklist:
  `looty`, `admin`, `support`, `official`. Display name and photo can change
  any time.
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

### 3.3 Groups — read at Tier 0, post at Tier 1+ (i.e. anyone with a confirmed address)

- Categories: **Study, Sports, Friends**. (Dating was removed.)
- Global — open to all students, not college-specific. Open join, no approval.
- **Text only.** No images. This is what keeps the moderation load survivable.
- **1024 members per room**, matching WhatsApp's limit. At capacity, the next room
  auto-creates: Study 1, Study 2, Study 3…
- **Users see "Study", not "Study 2".** The room number appears exactly once, in
  the group info line as *"Room 2 · 847 members"* — never in the tab, the list, or
  the chat header. Users cannot choose their room, so a prominent number reads as a
  rank they missed, and invites "how do I get into Study 1?". The quiet version
  still answers the one question that matters: why two friends comparing screens
  see different conversations. No schema change needed — the client renders the
  `category` as the label and keeps `room_number` for the info line.
- **Room assignment is by capacity only. Friends are deliberately NOT grouped
  together.** Friends are nearly always at the same college, so assigning rooms by
  the friendship graph would silently re-create per-college rooms — the thing this
  design explicitly rejected by making groups global. It would also do very little:
  nobody notices two friends among a thousand people. People who want to talk to
  people they already know have friend DMs; these rooms exist to meet students you
  would never otherwise meet.
- New joiners see the **last 50 messages**.
- **30-day rolling window.** `purge_old_group_messages()` deletes older rows.
  DMs are kept until account deletion. Not client-callable.
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
  an opt-in "same gender only" safety toggle. Gender is optional, set on profile
  setup or You → Edit profile. The toggle asks you to set gender first if it is
  empty. Not a dating preference.

### 3.5 Safety

- **Bans are fully automatic. No human reviews reports.**
- **8 unique reporters → 5-day ban.** The number matters less than the rules
  around it, all of which are automatic:
  - one report per reporter per target, **ever** (no repeat stacking)
  - reporter's account must be **7+ days old and Tier 1+**
  - if a reporter is later banned themselves, **their past reports stop counting**
- **Brigades unwind themselves, and this is what makes automatic banning
  survivable.** Each ban records which reports justified it
  (`reports.resolved_by_ban_id`). When any user is banned, every ban that leaned on
  their reports is recounted; if it falls below 8, that ban is **lifted
  automatically**, with the reason stored. Eight coordinated accounts can ban
  someone — but the moment those accounts are themselves banned, their victim is
  released, with nobody noticing or filing anything.
- **Reports are spent when they cause a ban**, so one incident cannot ban the same
  person twice. A second ban needs 8 fresh reports.
- **Lifted bans do not count toward escalation.** A ban that was overturned must not
  push someone closer to permanent.
- **3 unlifted bans → permanent block**, anchored on the hashed college address
  (§4.6). Lifting a permanent ban releases that anchor too — otherwise the user
  stays locked out of signup for a ban that no longer exists.
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

**A college email domain is the only proof Looty accepts, and as of 2026-09-04 it
proves a badge rather than buying access.** A domain is automatic, instant, free,
and effectively unforgeable — a college controls its own domain, so nobody can
fake `@iitb.ac.in`. That is still true and still worth having. What changed is
what it is spent on.

An ID card is the opposite on every axis. Indian college IDs have no standard
format — every college designs its own, and there is no database to check them
against. A genuine card from an unfamiliar college is indistinguishable from a
fabricated one; no reviewer can tell, and neither can a model. Verifying them means
paying a vendor per signup, handling biometric data under DPDP, and staffing a
manual queue for cards the automated check cannot read.

**That path was built into the schema and then removed from the product.** Its
columns remain, dormant — see §4.5.

**That trade was reversed on 2026-09-04.** It used to read: reach is exactly the
domain allowlist, and a student whose college issues no email can never pass Tier
0. Many Indian colleges — particularly state and affiliated ones — issue nothing,
so that capped the product at a list nobody had yet measured. The gate was removed
rather than the list being grown.

**What was bought and what was paid.** Bought: reach stops depending on a list,
and the largest open risk in §7 dissolves. Paid: the peer-only property is no
longer enforced (§1), and the ban anchor got much weaker (§4.6). The second is the
one that can actually hurt, and it was accepted knowingly, not overlooked.

### 4.2 The tiers

| Tier | Reached by | Can do |
|---|---|---|
| **0 — Unverified** | Signed in, address not confirmed — or a banned address | **Read** groups, request a college. No posting, no DMs, no Match. |
| **1 — Student** | Any confirmed sign-in address | **Everything.** Groups, DMs, reports, Match |
| **2 — College Verified** | College email confirmed | Same as Tier 1, plus the **College Verified** badge |

**Tier 2 gates nothing, and never did.** Every RLS policy in every phase compares
`current_tier() >= 1`; not one compares against 2. That is why migration 35 needed
no policy changes at all — waking Tier 1 up opened everything at once. Tier 2's
only jobs are the badge and the strong ban anchor.

**Tier 0 is now rare and is no longer permanent.** It used to be the permanent
home of any student without a college mailbox. Now it means one of two things: the
sign-in address is not confirmed yet, or it is a banned address coming back. Both
are states a person can leave.

**The `Verified` name in code is now misleading.** `Tier.Verified` in
`mobile/src/lib/tiers.ts` is the Gmail tier and verifies nothing about being a
student; its user-facing label is "Student". Renaming the constant would touch
every call site and was deliberately not done — read it as "Tier 1", not as a
claim.

### 4.3 Signup flow

**Signup is two steps now: sign in, set up your profile.** That is the whole flow.

1. **Google Sign-In** — any email accepted. A confirmed address is **Tier 1**, and
   Tier 1 is full access.
2. Email domain checked against the allowlist. **Match → Tier 2 immediately**,
   college auto-assigned. Colleges on Google Workspace have addresses like
   `name@college.ac.in` that *are* Google accounts, so this is one tap and free.
   **No match → nothing happens.** They are Tier 1 and complete.
3. **Profile setup** — username, display name, course length. Photo optional.
   Required of everyone, at any tier.

**Adding a college email is no longer a signup step.** It lives on the You screen
as "Get the College Verified badge", and the verify screen is reached from there.
It was removed from the signup path deliberately: a step that gates nothing but
sits in the middle of onboarding reads as a wall, and every user who could not
pass it would think they had failed at something.

`SignupStep` in `session.tsx` therefore has no `verifyCollege` member any more,
and `_layout.tsx` lost the special case that let Tier 0 users escape it.

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

The domain list did turn out to be the problem, and the answer taken on 2026-09-04
was to remove the gate rather than to reinstate this path. The columns stay
dormant. If the open signup turns out to be the bigger mistake, this is still the
way back.

### 4.6 Ban evasion — the college address is the anchor

A Gmail is free and infinite, so hashing it is worthless as a ban anchor. **A
college address is one per student and hard to get another of**, which makes it the
right thing to anchor to. Permanent bans are enforced against a hashed college
address in `banned_identities`, which survives account deletion — the point of it.

**That reasoning is still correct, and since 2026-09-04 it is also no longer
sufficient.** Most users now have no college address, so most permanent bans have
no strong anchor. Migration 35 adds a second, deliberately weaker anchor:

- `kind = 'college_email'` — the strong one. Unchanged, still owned by
  `evaluate_reports()` / `unwind_bans_from_banned_reporter()` / `resolve_appeal()`.
- `kind = 'account_email'` — the sign-in address. Written by an AFTER INSERT
  trigger on `bans` when `ends_at is null`, released by an AFTER UPDATE trigger
  when `lifted_at` is set. `handle_new_user()` checks it and leaves a returning
  banned address at Tier 0.

The triggers are additive on purpose: the strong path was not edited, so this
change cannot have broken it.

**Do not oversell the weak anchor.** It raises evasion from free to "make another
Gmail", which is close to free. It is a speed bump, and the honest reading is that
permanent bans are now soft for anyone without a college address. This was chosen
knowingly over reinstating phone OTP (DLT registration, weeks) or a Play Integrity
device signal (needs a native build, cannot be tested in Expo Go). Revisit it if
evasion actually shows up — that is the trigger to act on, not a hunch.

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
college_requests    id, requester_id, college_name, city, domain, status
profiles            id, username, display_name, dp_url, college_id,
                    college_email(private, unique — the ban anchor),
                    course_years, start_year, end_year, gender,
                    trust_tier(0|1|2 — all three live since 2026-09-04),
                    onboarding_complete(derived),
                    match_scope, match_same_gender_only,
                    full_name / phone_hash / phone_verified_at — dormant, §4.5
reserved_usernames  username    -- looty, admin, support, official
verifications       id, user_id, method, status, claimed_college_id,
                    ocr_*, face_match_score, image paths, images_deleted_at
email_verifications user_id, email, college_id, code_salt, code_hash,
                    expires_at, attempts, consumed_at
friendships         id, requester_id, addressee_id, status
blocks              blocker_id, blocked_id
threads             id, type(dm|connection), user_a, user_b  -- canonical order
messages            id, thread_id, sender_id, body, image_url, created_at
groups              id, category, room_number, member_count, capacity, name
group_members       group_id, user_id, category  -- unique(user_id, category)
group_messages      id, group_id, sender_id, body  -- NO image column, by design
blocked_terms       term                          -- word filter, ships empty
loots               id, actor_id, target_id, action(loot|pass)  -- unique per pair
connections         id, user_a, user_b, status(active|ended)  -- mutual loots only
subscriptions       user_id, status, product_id, current_period_end
reports             id, reporter_id, target_id, context, reason,
                    resolved_by_ban_id  -- which ban a report was spent on
                    -- unique (reporter_id, target_id)
bans                id, user_id, type, starts_at, ends_at,
                    lifted_at, lift_reason, issued_by
appeals             id, ban_id(unique), user_id, body, status
banned_identities   hash, kind  -- ban anchor; survives account deletion
notification_prefs  user_id, dms, friend_requests, connections, groups
                    -- own-row only; delivery is not wired yet
push_tokens         token, user_id  -- Expo tokens; no client table grants;
                    -- client RPCs register/unregister; Expo Go cannot mint one
thread_reads        thread_id, user_id, last_read_at
                    -- caller-only; no client table grants; mark_thread_read RPC.
                    -- unread in my_threads is "they wrote since I opened", not a
                    -- receipt the other person can see
thread_typing       thread_id, user_id, updated_at
                    -- 1:1 heartbeat; SELECT is peer-only so Realtime works;
                    -- writes via set_typing / clear_typing; 4-second window
```

That is **all 26 tables**, verified against the live database on 2026-09-05.
Account deletion is an Edge Function (`delete-account`): Auth Admin API, removes
avatars and chat-images, re-asserts a permanent-ban hash if needed, then deletes
`auth.users`. The cascade takes the rest. `banned_identities` has no `user_id`
on purpose.

Storage buckets: `avatars` (public-read, DPs) and `chat-images` (private,
participant-read via signed URL).

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

**RESOLVED 2026-09-04, by removing the gate.** This section used to open: "the
domain list is now the product's entire reach — this is the biggest open risk",
because every missing college was a college where Looty was permanently read-only,
and nobody had confirmed how many Indian colleges issue student mailboxes at all.

A confirmed sign-in address now reaches Tier 1 and Tier 1 is full access, so a
missing domain costs a badge and nothing else. Phase 0 is still worth doing — the
badge is worth having and the requests are still the growth signal — but it is no
longer on the critical path.

**The new biggest open risk is what replaced it: anyone can join.** §1 no longer
claims a peer-only space as an enforced property, and the moderation engine is now
the only thing standing between the product and outsiders, with a ban anchor (§4.6)
that a new Gmail defeats. Nothing about this has been tested against real abuse,
because nothing has shipped. Watch for it at launch rather than assuming it.

**A second-order risk worth naming: Play Store content rating.** The DPDP and
rating reasoning in §1 and §3.6 was written for a college-gated population.
Stranger-matching and user images open to any signup is a different profile from
the same features behind a college wall. Non-personalised ads app-wide still
covers the DPDP targeting question, and nothing about the removal of the gate
touches the no-romantic-framing rule. The listing was re-read on 2026-09-05
(`legal/play-listing.md`); still confirm it in Play Console at submission.

**A student can hold their college address after graduating.** Most Indian college
mailboxes stay live for years, so a 2020 graduate can still verify today. The Alumni
badge (§3.1) makes this visible rather than preventing it, which is the intended
behaviour — but it does mean "verified" means "has a college address", not "is
currently enrolled".

**Screenshot handling — DECIDED, split by Android version. The two halves are NOT
equally proven.** Android 14+ notifies via `record_screenshot()` (a system line in
the thread). Below 14, `FLAG_SECURE` is set only while a Connected chat is open.
DMs are not covered. `anon` cannot call the RPC (42501, live).

**Below 14 — solid.** On Android 12 a capture inside a Connected chat returns
nothing, and the flag **clears on leaving**, so the per-Activity trap below is
handled. Repeatable and deterministic.

**14+ — unreliable, and this is an open bug.** On Android 15 the notice fired
**once in six attempts** on 2026-09-05, all in Expo Go, all with the thread open
and focused. When it fires the whole chain is correct: both sides see the line,
delivered live over Realtime. When it does not fire, nothing is written — the RPC
is never reached, and `void supabase.rpc(...)` swallows any error, so a user would
never know. Do not describe this feature as working until it has been re-tested in
a native/EAS build.

The suspect is `expo-screen-capture`'s `registerCallback()`, which guards on an
`isRegistered` flag and never re-registers, while
`registerScreenCaptureCallback` is bound to an Activity instance. Expo Go's
Activity lifecycle is not a standalone app's, so this may be an Expo Go artifact —
unproven either way. A fresh launch does not make it fire; that was tested.

Three implementation traps to respect when building this:

- **`FLAG_SECURE` is per-Activity, not per-screen.** An Expo app has one Activity,
  so setting it naively blocks screenshots *app-wide* — profiles, group
  discussions, everything. It must be set on entering a Connected chat and cleared
  on leaving.
- It also blanks the app in the recent-apps switcher and blocks screen recording
  and casting while active. That is desirable inside the chat; it is not desirable
  everywhere else, which is the same reason it has to be toggled.
- **The guarantee is stronger on older phones than newer ones** — blocked on <14,
  merely notified on 14+. That inversion is unavoidable and should not be papered
  over in the UI copy: do not promise "screenshots are blocked" to anyone.

Note this does not weaken reporting. Reports carry the surrounding messages
server-side (`reports.context_type` / `context_id`), so a user does not need a
screenshot to evidence harassment.

**Phase 0 — college domain list. Coverage for the badge, not a launch gate.** For
each college confirm: do students actually get mailboxes, the exact domain and
subdomain, and roughly what share of students have one. A missing domain now costs
only the College Verified badge. A wrong entry is worse — it hands that badge, and
the strong ban anchor, to whoever holds an address on that domain.

**The repo is public** (owner, 2026-09-01, so GitHub Pages can serve the privacy
policy from `docs/`). Moderation thresholds in §3.5 are therefore readable.
That is accepted; RLS still enforces them.

### Assumptions never explicitly confirmed

Flag if any of these are wrong: image blur in connected chats; non-personalised ads
app-wide; college-scope and same-gender filters in Match; unmatch/leave; message
retention (DMs indefinite, groups 30-day rolling); notification granularity; read
receipts in DMs only, no last-seen. Inbox unread (you have not opened since they
last wrote) is built; that is not a read receipt. Typing indicators are built in
1:1 chats only — groups of a thousand do not get them — and were walked on two
phones on 2026-09-05.

**Rejected, do not revisit without a decision:** invite-based vouching (verified
students inviting others) was considered and declined.

---

## 8. Domain traps — things that look like bugs but are not

- **Tier 2 gates nothing. Do not "fix" a policy to require it.** Every gate reads
  `current_tier() >= 1`, on purpose. A policy that demands 2 would silently lock
  out most of the userbase, and the tests would not catch it, because they mostly
  run as college-confirmed users.
- **`Tier.Verified` is Tier 1 and verifies nothing.** It is the Gmail tier. The
  name is a leftover from the ID-card era; the label users see is "Student".
- **A `create or replace` of `handle_new_user()` must carry forward everything the
  previous definition did.** It creates the profile row, the notification_prefs
  row, and now sets the initial tier. Migration 35 dropped the prefs insert on the
  first attempt and four tests caught it — do not assume the next replace will be
  as lucky.
- **Never block by "is this email Google-hosted".** Many Indian colleges run their
  email on Google Workspace, so the address is `name@college.ac.in` but the mailbox
  is Gmail underneath. Domain checks must be **literal string matches** against the
  allowlist. There is no personal-provider blocklist any more — Gmail is explicitly
  allowed, and now reaches Tier 1.
- **No wildcard domains.** A college may use `@xyz.ac.in` for staff and
  `@student.xyz.ac.in` for students. Store exact domains. A wildcard would let
  `@alumni.xyz.ac.in` through.
- **"Match" the word is banned in user-facing copy.** The feature is Looty Match;
  the state is "Connected". See §1.
- **Alumni are not removed.** Expired course period means a badge, not a ban.
