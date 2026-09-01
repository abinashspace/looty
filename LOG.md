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

## 2026-09-01 — Play listing draft, domain candidates, Google button behind env

Laptop-only stretch. No phone.

- `legal/privacy.md` and `legal/play-listing.md` — Play Store text with the
  friends-not-dating constraint written in. Privacy is a draft; Play needs a
  public HTTPS URL before submit.
- `legal/google-and-email.md` — the owner steps for Google Cloud + Resend.
- `colleges/CANDIDATES.md` — IIT / NIT / BITS / large private guesses, all
  `unconfirmed` except `thangavelu.edu.in`. Not inserted on live.
- Sign-in: “Continue with Google” using `expo-auth-session` (SDK 57) and
  `signInWithIdToken`. Hidden unless `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is set.
  Native `@react-native-google-signin` needs a dev build; this path works in
  Expo Go once the Web client and the Supabase Google provider exist.

Email/password is unchanged.

---

## 2026-09-01 — First real college domain; Android signup reached profile setup

Owner ran the app on the Realme over USB. Signed in, entered
`…@thangavelu.edu.in`. The allowlist refused it (only `looty.test.invalid` existed).
They confirmed that mailbox is theirs, so live now has:

- colleges: Thangavelu Engineering College, Chennai, Tamil Nadu
- college_domains: `thangavelu.edu.in`

Send-code then worked. No Resend key, so nothing hit the inbox; a code was written
onto the pending `email_verifications` row and they confirmed. Landed on profile
setup. **Stopped there** — photo / Finish / rest of the app not walked.

Paused by owner. Next USB session: finish profile (picker + 512px downscale), then
groups and a 1:1 photo.

---

## 2026-09-01 — Chat images (private bucket) and push token plumbing

USB was not available (owner at college). Built the two largest remaining pieces
that do not need a phone.

**Chat images.** `messages.image_url` existed since migration 6 and nothing
wrote it. New private bucket `chat-images`, path
`<user_id>/<thread_id>/<uuid>.jpg`. Write requires `can_post_to_thread` on the
path's thread. Read is the uploader, or a participant of a thread that already
references the object — so the other person cannot mint a signed URL until the
message row exists. No SVG. Groups unchanged (no image column).

Connected chats do **not** fetch the file until "Photo · tap to view". Same
honesty as Looted-you: a blurred download is still a download. Friend DMs show
immediately. `delete-account` now walks `chat-images/<user_id>/` as well as
avatars.

**Verified live**, not just pglite: `anon` gets 42501 on the helpers;
participant A uploaded a JPEG; B's signed URL was 404 until the message insert,
then 200; outsider C still 404; `can_write_chat_image` false for C. Three
throwaway accounts deleted. One leftover object was removed via `storage rm`.
The picker has not been tapped on a device.

**Push tokens.** Table has no client grants. `register_push_token` /
`unregister_push_token` are the only path; the same token moves to a new
account on the same phone. `should_notify(user, kind)` honours prefs (groups
off by default) and is **not** client-callable — a client asking whether
someone else wants DMs would be a probe. Nothing is sent yet; Expo Push still
needs USB to prove a notification actually appears.

192 tests. 26 migrations. 24 tables.

---

## 2026-08-31 — The app ran on Android for the first time

Realme RMX3771 over USB. Expo Go 57.0.9 sideloaded (Play Store copy is the wrong
SDK). Metro served the bundle; the owner confirmed the app came up.

Wi-Fi is still unusable — the router isolates clients — so this is USB-only:
`adb reverse tcp:8081 tcp:8081` and `exp://127.0.0.1:8081`. `--localhost` on
`expo start` binds IPv6 `::1` only; `adb reverse` talks IPv4 `127.0.0.1`, which
produced **Failed to download remote update** on first open. Restarting Metro
without `--localhost` fixed it.

Native paths still not walked: image picker, 512px downscale, realtime, screenshot
handling. First render only.

Platform-tools installed via `winget install Google.PlatformTools`. No Android
Studio. A junction at `%LOCALAPPDATA%\Android\Sdk\platform-tools` exists so Expo
can find `adb`. Restart steps are in CONTEXT.md §2.

---

## 2026-08-31 — Profile setup was impossible: the username trigger ran as the caller

Took two real accounts to Tier 2 on live and PATCHed `profiles` as `authenticated`
to finish onboarding. Postgres returned:

```
42501 permission denied for table reserved_usernames
hint: GRANT SELECT ON public.reserved_usernames TO authenticated
```

`enforce_username_rules` is an ordinary (invoker) trigger. It SELECTs
`reserved_usernames`, which has no client grants on purpose — the blocklist is not
something a user should enumerate. So the reserved-name check, written to protect
usernames, made **every username write fail**. Nobody could finish profile setup.

The word-filter trigger in migration 10 was already SECURITY DEFINER for this
exact reason. The username trigger was the same shape and was missed because
every test that set a username ran as superuser, and profile setup has never
been reachable as `authenticated` before (the routing bug of 2026-08-30 sat in
front of it).

**Do not "fix" this by granting SELECT on `reserved_usernames`.** That publishes
the blocklist. Migration 24 makes the trigger SECURITY DEFINER with
`search_path = public`, matching the word filter.

A test now sets a username *as `authenticated`*. The absence test ("reserved
names are refused") would have stayed green under the bug — `42501` is also a
refusal. The positive assertion is the one that catches it.

**Verified live:** the same PATCH then returned 204, `match_feed` showed the
other student, and both accounts were deleted via `delete-account`.

---

## 2026-08-31 — The event trigger was firing; it was aimed at the wrong grant

The empirical test from 2026-08-30, actually run. Created
`public._looty_event_trigger_probe()` on live, called it as `anon` via PostgREST.

**Before the fix:** HTTP 200, body `"reachable"`. ACL:

```
{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

No PUBLIC grant (`=X/` absent). So `lock_functions_on_create` *did* run, and
`revoke … from public` succeeded at removing a grant that was not the one
letting `anon` in.

The grants that matter are Supabase's `ALTER DEFAULT PRIVILEGES` for the
`postgres` role in schema `public`: EXECUTE on every new function to `anon`,
`authenticated` and `service_role` directly. Migration 12 revoked from PUBLIC,
which was never the grantee. pglite does not carry those default privileges, which
is why "a newly created function is closed automatically" passed locally while
being false in production. The 2026-08-30 claim that "Supabase forbids event
triggers" was already known to be false; this is the actual cause.

Migration 22:

- `alter default privileges in schema public revoke execute on functions from public, anon, authenticated` (service_role kept, so Edge Functions still work)
- event trigger now revokes from `anon` as well as PUBLIC

**After the fix, same probe:** `anon_can_execute = false`, ACL
`{postgres=X, service_role=X}`, PostgREST 401 `42501 permission denied`. Then
dropped. `match_feed` and `current_tier` still 42501 to `anon`.

`lock_client_functions()` remains mandatory at the end of every migration that
creates a function. This is the third automatic attempt; it is the first one
verified on the real platform rather than inferred from pglite.

---

## 2026-08-31 — Account deletion, notification prefs, and the live Tier 2 surface

Phase 7's two free pieces, and the live verified-student run that had been
blocked on writes.

**`notification_prefs`** (migration 23): own-row table, created with the profile,
backfilled for the four existing accounts. Defaults: DMs / friend requests /
Connected on, groups off. Push delivery is not built — these rows are what it
will read. Verified live as `anon`: 42501. Verified live as the caller: SELECT
returns the defaults, PATCH `groups=true` returns 204.

**`delete-account` Edge Function:** Auth Admin API, because a client JWT cannot
delete `auth.users`. Removes avatars first, re-asserts a permanent-ban hash if
needed, then deletes the user. Cascade takes profile, prefs, messages,
friendships. `banned_identities` has no `user_id` and is not cascaded, which is
the point. Verified live: unauthenticated call returns 401 `not_authenticated`;
a signed-in call with `{confirm:"delete"}` returns `{ok:true}` and the auth row
is gone.

**Test college on live:** `Looty Test College`, domain `looty.test.invalid`
(RFC 2606, cannot resolve). Codes still have to be written as postgres. Leave
it; it is how a session takes an account to Tier 2 without Phase 0.

**Live Tier 2 surface, two accounts, then both deleted:** confirm → profile
(after the username fix) → join Study → post → `group_thread` → `search_users`
→ friend request / accept → `open_dm_thread` / message / `my_threads` →
`match_feed` saw the other person → mutual loot, `loots_remaining` 9 →
`delete-account` both. The four original debug accounts were not touched.
`college_domains` now has one row, the test domain.

**Still never run on Android.** No SDK on this machine.

178 tests, `tsc --noEmit` clean. 24 migrations, 23 tables, two Edge Functions.

---

## 2026-08-30 — The app rendered for the first time, and signup was broken

Ran the UI for the first time in the project's history. The phone could not reach
the dev server — LAN blocked (the router isolates clients) and ngrok would not open
a tunnel from that network — so it was run in a browser via `react-native-web`,
with `platforms` temporarily widened in `app.json` and reverted afterwards.

**Within five minutes it exposed a bug that made signup impossible for everyone.**

The root layout's routing effect ended with:

```js
if (group !== '(auth)') router.replace(STEP_ROUTE[step]);
```

Creating an account leaves you inside the `(auth)` group, on `sign-in`, holding a
valid session and a Tier 0 profile — so `step` becomes `verifyCollege` and the
redirect to `/verify` **never fires**. The account is created and the user is left
staring at the screen they started on. Trying again then genuinely does return
"User already registered", which reads as the first attempt having failed when in
fact it succeeded. Confirmed against the live database: `auth.users` went from 2 to
4 during the attempts.

The guard was written as loop protection and is doing that job far too broadly — it
blocks every move *between* auth screens, and signup is exactly such a move. It now
compares the full route instead of the group. It still cannot loop, because the only
redirect it issues is to a route it has just established we are not on.

**A second bug made the first one much harder to read.** `sign-in.tsx` cleared its
error only on submit and on toggling mode — never when a field changed. So the
stale "User already registered" sat over a freshly typed address and looked like a
verdict on the new one. Errors now clear on edit.

**The point worth keeping.** 169 tests green, typecheck clean, Android bundle
building — and nobody could create an account. No database test could have caught
it: the schema behaved perfectly throughout, and the bug lives entirely in the
client's routing. This is the same lesson as the two fake security guards, pointed
at the UI instead of the schema: *the thing you have not executed does not work,
whatever the suite says.*

**Also corrected in CONTEXT.md:** the §6 data model listed seven tables twice, named
two that have never been built (`push_tokens`, `notification_prefs`), and omitted
`reserved_usernames`, which does exist. It now lists all 22 live tables, verified
against the database. §2's "21 tables" was also wrong.

**Verified:** `tsc --noEmit` clean; the fix confirmed in the browser by signing in
and landing on `/verify`, a screen that had been unreachable. **Still not verified on
Android at all** — `react-native-web` is a preview, not the target.

---

## 2026-08-30 — Supabase does NOT forbid event triggers; profile photos cut ~10x

Two unrelated things, one of which overturns a documented cause.

**The event-trigger post-mortem is wrong.** CONTEXT.md §2, the 2026-08-29 entry
below, and migration 21's header all say the same thing: that migration 14's event
trigger failed because *Supabase forbids event triggers*, and that its exception
handler swallowed the failure. Queried live:

| name | status | owner | event | tags |
|---|---|---|---|---|
| `lock_functions_on_create` | **enabled** | postgres | ddl_command_end | CREATE FUNCTION |
| `ensure_rls` | **enabled** | postgres | ddl_command_end | CREATE TABLE… |

Both were created by our own migrations and both are running on the production
database right now. Supabase permitted them. The handler never fired.

So the six functions that shipped executable by `anon` were open for **some other
reason, still unknown**. Migration 21's sweep has since revoked and re-granted
everything, which erased the evidence either way — the current ACLs look identical
whether the trigger works or not. Settling it needs the empirical test: create a
throwaway function on live and probe it as `anon`.

**Deliberately not "fixed" in the docs yet.** The stated cause is disproven; the
real one is not established. Replacing one confident wrong explanation with another
is exactly how this file earned its warning about guards that are imaginary. What
can be said now is only that the reason on record is false.

This does not change the standing rule — every migration that creates a function
must still end with `select public.lock_client_functions();`. If the trigger does
work, that rule is belt-and-braces rather than the only thing holding.

**Live security state audited read-only, and it is clean.** First time this has been
checked at depth on real Postgres rather than pglite: 22/22 tables have RLS, zero
readable by `anon`, zero of 49 app functions executable by `anon`, `college_email` /
`full_name` / `phone_hash` / `code_hash` / `code_salt` unreadable by `authenticated`,
`trust_tier` unwritable. `banned_identities`, `blocked_terms` and `reserved_usernames`
have RLS on with no policies at all — deny-all, service-role only, as intended.
Realtime publishes exactly `messages` and `group_messages`.

**Doc drift found, not yet fixed:** CONTEXT §2 says 21 tables, live has 22. §6 lists
`push_tokens` and `notification_prefs`, neither of which exists; omits
`reserved_usernames`, which does; and lists seven tables twice. Also
`sync_onboarding_complete` carries an EXECUTE grant to `authenticated` that no other
trigger function has — harmless, since a trigger function cannot be invoked
directly, but it is the one grant that breaks the pattern.

**Fixed:** §7 still said the repo was public and advised making it private. It was
switched to private on 2026-08-28.

---

**Profile photos are now downscaled to 512px before upload** — roughly 600 KB down
to 50 KB. `expo-image-manipulator` added; the resize happens at pick time, so the
preview shows what will actually be uploaded and Finish stays instant. It only ever
shrinks, and falls back to the original if manipulation fails, since a resize
hiccup should not be what stops someone finishing signup.

**Why now, before any real users exist.** The picker was handing back a
full-camera-resolution square at `quality: 0.8` — 300 KB to 1.5 MB, squeaking under
the bucket's 2 MB cap — and every Looty Match card downloads one. Free-tier egress
is 5 GB/month, so at those sizes a *single* user scrolling 50 cards a day consumes
about 900 MB a month. The free tier would have run out of bandwidth at roughly six
active users, and the number that looks reassuring on the pricing page (50,000
monthly active users) is the one limit this app would never reach.

Doing it later means migrating everyone's existing photo instead of changing four
lines. Order the free tier actually breaks in: egress, then Realtime messages
(2M/month — one busy 1024-member room and its fanout is most of that), then 200
concurrent Realtime connections, then 1 GB storage. Free also has **no backups**,
which is disqualifying for live student data regardless of capacity.

**Verified:** `tsc --noEmit` clean, `expo export --platform android` bundles.
Still never run on a device.

**Not done, and blocked:** the live Tier 2 verification this session set out to do —
seed a test college, take an account to Tier 2, and exercise groups, DMs, friend
requests and Match against real Supabase. Every live check to date has been as
`anon` or Tier 0, so the entire verified-student surface remains pglite-only. The
write to the live database was refused by the tooling; nothing was seeded and no
test rows exist.

---

## 2026-08-29 — CONTEXT.md and README had gone stale at the top

Audit prompted by the owner asking whether the docs were actually current. The
detailed sections were; the summaries at the top were not — which is the worse half,
because that is what anyone reads first.

Stale and now fixed:

- CONTEXT.md still said **"Nothing is shipped. No app exists yet"** and listed the
  repo as holding only the Phase 1 schema. Every screen had been built since.
- The phase table marked Phases 2–5 as **"No UI"** and Phase 1 as "no app, no Edge
  Functions". All wrong.
- "Last updated" was still 2026-08-28.
- README said **"there is no app yet"**, and its requirements list still asked for an
  SMS/DLT provider and a vision API for ID OCR — both removed when verification
  became college-email only — while asking for a Supabase project that exists.

Verified rather than assumed: migration count (21) and test count (169) in
CONTEXT.md were checked against the filesystem and a live test run, and both matched.

**The lesson, and it rhymes with the function-guard one:** appending detail to a
living document is easy to do while leaving its summary describing a project that no
longer exists. Both files claim to be current — that claim needs checking, not
trusting. Worth re-running this audit whenever a phase completes.

---

## 2026-08-29 — Friend requests and username search; the function guard was fake twice

Username search, friend requests both directions, and a friends list. 11 new tests
(169 total). The inbox now shows a request count and a "Find people" entry, and
accepting a request opens the conversation immediately rather than leaving the user
to hunt for it.

`search_users()` returns the **relationship** alongside each person — none,
pending_out, pending_in, friends, self — so the button says Add, Requested, Accept
or Message instead of offering to befriend an existing friend. Doing that in the
client would mean one query per result.

Search is **Tier 1+ only**. Migration 15 stopped Tier 0 enumerating the directory;
an unguarded search would simply have been the way around it. A test pins that.

---

**The important part of this entry: the function lockdown has now failed twice, and
both times the tests said it was fine.**

Postgres grants EXECUTE on every new function to PUBLIC. Two attempts to change
that:

1. **Migration 12** used `alter default privileges ... revoke execute on functions
   from public`. That silently does nothing — `pg_default_acl` stays empty.
2. **Migration 14** replaced it with an event trigger, wrapped in an exception
   handler so a platform that forbids event triggers would not fail the migration.
   **Supabase forbids them.** The handler swallowed the failure exactly as written,
   and the migration reported success.

So every function created since migration 14 — `my_threads`, `group_thread`,
`my_match_prefs`, `search_users`, `my_friends`, `my_friend_requests` — shipped
executable by `anon`, the key that lives inside the APK.

Nothing leaked, because each one checks `auth.uid()` or `current_tier()` and returns
empty. But that is the same "safety by remembering" this was supposed to eliminate.

**Why the tests missed it:** pglite runs event triggers happily. The test
"a newly created function is closed automatically" passed locally while being false
in production. A test that asserts a *mechanism* rather than the *outcome on the
real platform* is worth very little — this is the second time a green suite has
described a guard that was not there.

**Found by** calling the RPCs anonymously against the live project, which is now the
third real problem that technique has surfaced.

**The fix (migration 21)** drops the clever defaults entirely.
`lock_client_functions()` is an explicit, idempotent sweep that revokes PUBLIC and
`anon` across the schema while leaving `authenticated` grants alone, so it is safe
to call after the grants in the same migration.

> **Every migration that creates a function must end with**
> `select public.lock_client_functions();`

Nothing enforces that. Two attempts to automate it both failed while appearing to
work, so the honest answer is a documented rule plus a test that checks the outcome.
Verified live: all six previously-open functions now return `42501` to `anon`, and
all still work for a signed-in user.

---

## 2026-08-29 — Match, Looted-you and the restriction screen: every screen now real

Looty Match feed with loot/pass and the daily quota, the Looted-you list with its
paywall, and the restriction screen with an appeal form. 3 new tests (158 total).
No placeholder screens remain except the deliberate "Supabase not configured" one.

**Bug found while building: the Match filters could not be changed.**
`match_scope` and `match_same_gender_only` were added in migration 11 but never
granted to `authenticated`, so the columns existed and nothing could write them.
Migration 19 grants UPDATE.

Reading them back is a **function, not a SELECT grant** — column grants are
role-wide, so granting SELECT would let anyone read anyone's
`match_same_gender_only`, which quietly announces that a person filters by gender.
`my_match_prefs()` returns only the caller's own.

**The Looted-you paywall shows placeholders, not blurred photos, and the comment
in the file says why.** A blurred photo is still a photo that crossed the network
and can be read off the wire or out of a debugger. `looted_you()` refuses to return
identities to a free account at all, so there is genuinely nothing to blur. The UI
says so in plain words rather than implying censorship it is not performing.

**Routing bug found while building the restriction screen.** The root layout sent
banned users to `/banned` and bounced them back every time they navigated away —
making it a cage. But CONTEXT.md §3.5 says a ban is not a logout and reading groups
still works. The screen is now shown **once per session** to explain what happened
and offer an appeal, after which the user moves freely; everything is already gated
because `current_tier()` returns 0 while banned. The design and the routing now
agree.

**Other decisions:**

- Card height in the feed is **measured, not assumed**, so vertical paging lines up
  on any device rather than on the one it was written for.
- Passing is free and uncapped, so only loots decrement the counter shown in the
  header. That counter is a courtesy — the quota lives in an RLS check, which is
  why hitting it surfaces as a policy refusal rather than a friendly error.
- The Connection alert only appears when the other person had already looted you,
  checked by querying `connections` after the insert rather than guessing.

**Verified live** against the real project: `match_feed`, `loots_remaining`,
`my_match_prefs`, `looted_you_count` and `looted_you` all respond correctly for a
Tier 0 account — empty feed, no identities, no errors.

---

## 2026-08-29 — Chat screens: group rooms and 1:1 DMs, with realtime

Groups list, group room, DM inbox and 1:1 chat, all working against the live
project. 5 new tests (155 total). Looty Match and the Looted-you list remain
placeholders.

**Routing restructured.** `groups.tsx` and `chats.tsx` became `groups/` and
`chats/` directories, each with its own Stack, so a tab can push a room or a
conversation without leaving the tab.

**`my_threads()`** (migration 18) builds the inbox server-side. `threads` stores a
pair as user_a/user_b, so doing it client-side means "work out which column I am,
fetch the other person, fetch their profile, fetch the last message" — three round
trips per row. It also drops threads for blocked pairs while leaving the rows
intact, since deleting them would destroy evidence a report may depend on. A test
pins that the messages survive a block.

**Realtime** enabled on `messages` and `group_messages`. Postgres changes are
broadcast through RLS, so a subscriber only receives rows they could already read —
but clients still filter by thread or group in the subscription itself. Without
that, every message in every room would be pushed to every device, since
`group_messages` is readable by everyone.

**Design decisions:**

- **Group rooms show the category, not the room number.** "Study", with
  "Room 2 · 847 members" as a quiet subtitle — following the decision recorded
  earlier. Non-members see the first room as a preview rather than an empty screen.
- **Report and Block sit side by side in the chat header**, not behind a menu.
  They are what someone reaches for in the same moment, and burying either costs
  exactly the wrong person exactly the wrong amount of time.
- **The composer clears optimistically and restores the text if the send fails.**
  Losing what you typed to a network blip is a small thing that feels like a big one.
- **Blocked senders collapse to a line, not a gap**, in group threads — removing
  their messages entirely would orphan the replies to them.
- The composer's disabled state explains *why* it is disabled — unverified, banned,
  or not a member are three different problems with three different fixes.

**Known gap, stated plainly:** messages are **text-only in the client**. The schema
supports images in DMs and Connected chats, and the spec calls for blur-by-default
in Connected chats, but none of that is built. It needs a second storage bucket and
its policies. Group messages are text-only by design and always will be.

---

## 2026-08-29 — The auth flow is real: sign-in, college verification, profile setup

First actual screens. Sign in / create account, confirm a college email by 6-digit
code, profile setup with photo upload, and your own profile with its tier badge.
Groups, Match, Looted and Chats are still placeholders.

**Supporting pieces:**

- `src/components/ui.tsx` — Screen, Field, Button, LinkButton, Notice. Deliberately
  plain; a text-first chat app earns nothing from ornament.
- Theme gained `accent`, `border`, `danger` — the template palette had no accent at
  all, so nothing could be a primary action.
- **`avatars` storage bucket** (migration 16), public-read because DPs appear on
  Match cards to people you are not connected to. Writes are keyed on the first
  path segment being the uploader's own user id, so nobody can write into another
  user's folder. 2 MB cap, and JPEG/PNG/WebP only — **no SVG**, which can carry
  script.
- **`onboarding_complete` is derived by trigger** (migration 17), not written by the
  client. It gates routing, so a client able to set it could skip profile setup
  entirely. It now computes from the fields that actually constitute a profile.
- **`issue-college-code` Edge Function deployed.** Runs under service_role because
  the raw code must reach the mailbox and nowhere else — only a salted sha256 is
  stored, and the code is never returned to the caller. Uses `crypto.getRandomValues`
  rather than `Math.random`; this is a credential. Rate limited to 3 per user per
  hour so it cannot be used to mail-bomb a college address. Sends via Resend when
  `RESEND_API_KEY` is set, otherwise logs the code — and refuses to do that when
  `LOOTY_ENV=production`.

**Verified live:** the function returns 401 unauthenticated, 422 for an unrecognised
college domain, 400 for a malformed address. `tsc` clean, Android bundle builds,
150/150 database tests.

**Not verified, and honestly cannot be yet:** the happy path. It needs a real
verified college domain in `college_domains`, which is Phase 0 and cannot be done
from a keyboard. Everything around it is covered — `confirm_college_email` has nine
tests for codes, expiry, lockout, reuse and banned addresses.

**Two fixture breakages worth noting**, both caused by the new trigger and both
caught by *positive* assertions rather than negative ones:

- `mkUser` set `onboarding_complete = true` directly. Once the trigger derived it
  from real fields, every fixture profile became incomplete and dropped out of
  `match_feed`. Only "all_india scope widens the feed" caught it — the negative
  assertions all passed happily against an empty feed. A test that only asserts
  absence proves very little.
- The fixture then reused `$2` for both `username` (citext) and `display_name`
  (text), which Postgres rejects as "inconsistent types deduced for parameter".

---

## 2026-08-29 — Live auth verified; profile-enumeration hole found and closed

Enabled email/password auth for development so the UI can be built and tested
without waiting on a Google OAuth client. Google Sign-In will be added later as a
second provider — the session logic is provider-agnostic, so it is a config change.

**Auth config pushed** via `supabase config push`. Only three settings changed:
`enable_confirmations` off (so dev signups work immediately), `otp_length` 8→6, and
an MFA flag. One deliberate edit first: `config.toml` shipped
`max_frequency = "1s"` for auth emails, which on a live project lets anyone
email-bomb an address through the signup form. Raised to 60s before pushing.

**Authenticated behaviour verified against the real project** for the first time,
using a test account. Confirmed: the signup trigger creates the profile row,
`full_name` is refused, self-promotion to Tier 2 is refused, `current_tier()`
returns 0.

**And that test found a real hole.** A Tier 0 user — anyone with a throwaway Gmail —
could run `select * from profiles` and get **every row**: username, display name,
photo URL and college for every verified student on the platform. A scrapeable
student directory, aimed straight at the one thing Looty sells.

Migration 15 restricts profile reads to your own row unless you are Tier 1+.
Verified students enumerating each other stays allowed and is in fact the product —
username search and the Match feed both depend on it. The hole was specifically that
Tier 0 had the same reach.

That created a second problem: Tier 0 can read groups, and a wall of anonymous
uuids is not readable. Added `group_thread(group_id, limit)`, a security-definer
function returning messages already joined to their senders — so an unverified user
learns about exactly the people who posted in the room they are reading, rather than
the whole directory. It also implements the "last 50 messages" default in one place,
and collapses blocked senders (nulled identity plus an `is_blocked` flag) rather
than removing their messages, which would leave replies dangling.

**Note on how this was caught:** not by the test suite, which passed throughout, but
by signing in as a real user against the live project and looking at what came back.
Worth repeating for other surfaces.

---

## 2026-08-28 — Phase 5: moderation engine, and the function lockdown made real

Migrations `…013_moderation_engine` and `…014_lock_new_functions` deployed.
17 new tests (145 total, all passing).

**The engine:** 8 effective reports trigger a 5-day ban, 3 unlifted bans escalate to
permanent, permanent bans anchor the hashed college address. All automatic, no human
anywhere in the path.

**Design decisions:**

- **Reports are *spent* when they cause a ban** (`reports.resolved_by_ban_id`), so
  one incident cannot ban the same person twice. A second ban needs 8 fresh reports.
- **Brigades unwind themselves.** Because each ban records the reports that
  justified it, banning any user triggers a recount of every ban that leaned on
  their reports — and lifts it if the count drops below 8. Eight coordinated
  accounts can ban a victim, but the moment those accounts are banned, the victim is
  released automatically, with the reason recorded. This is the thing that makes
  human-free banning defensible rather than reckless.
- **Lifted bans do not count toward escalation.** A ban that was overturned must not
  push someone closer to permanent.
- **Lifting a permanent ban releases the identity anchor**, or the user stays locked
  out of signup for a ban that no longer exists.
- **`is_banned()` was redefined** to ignore lifted bans — it shadows the Phase 1
  version, so every tier check, feed filter and post gate inherits the change for
  free.
- **No UPDATE grant on `appeals`**: an appellant cannot mark their own appeal
  overturned. `resolve_appeal()` is service-role only.
- **One appeal per ban**, enforced by a unique index — otherwise "appeals are low
  volume" stops being true.

**The function-privilege guard from migration 12 was fake, and a test proved it.**

Migration 12 ended with `alter default privileges in schema public revoke execute
on functions from public`. That line does nothing: `pg_default_acl` stays empty and
new functions still receive the built-in PUBLIC EXECUTE. Verified directly — after
migration 12, a freshly created function was still executable by `anon`.

So migration 13's two trigger functions were wide open. Harmless individually
(trigger functions do not need EXECUTE to fire, and neither exposes anything), but
it showed the guard was imaginary and the next function might not be harmless.

Migration 14 replaces it with an **event trigger** on `ddl_command_end` that revokes
PUBLIC from every function created in `public`, plus a sweep for existing ones. The
event trigger creation is wrapped in an exception handler, since it needs elevated
rights and must not fail the migration if the platform refuses — Supabase accepted
it. A new test creates a throwaway function and asserts `anon` cannot execute it, so
this cannot silently regress again.

**Worth noting how this was found:** the test `anon can execute nothing in public`,
written in the previous session, failed the moment Phase 5 added functions. That is
the entire value of pinning a security property rather than checking it once.

---

## 2026-08-28 — Phase 4: Looty Match, and a function-privilege hole closed

Migrations `…011_match` and `…012_lock_function_execute` deployed. Feed, loot/pass,
daily quota, Connections, the paid "looted you" list. 27 new tests (128 total).

**Screenshot handling decided** (owner): `FLAG_SECURE` on Android <14 so
screenshots are blocked, `ScreenCaptureCallback` on 14+ so they are allowed and the
other person is notified. Recorded in CONTEXT.md §7 with three implementation traps
— chiefly that `FLAG_SECURE` is per-Activity, so an Expo app must toggle it on
entering and leaving a Connected chat or the whole app becomes unscreenshottable.

**Design decisions:**

- **"Looted you" is two functions, not one that blurs.** `looted_you_count()`
  returns a number to everyone; `looted_you()` returns identities only when
  `is_paid()`. Blurring client-side is not privacy — the rows still cross the
  network and anyone can read them off the wire. Free users never receive the
  identities at all.
- **`loots` RLS exposes `actor_id` only, never `target_id`.** A policy letting you
  read rows where you are the target would hand away the paid feature for free.
- **The daily quota counts in IST**, not UTC. A UTC boundary would reset everyone's
  loots at 5:30am India time — surprising, and exploitable by anyone awake then.
- **Passes are free and uncapped.** Charging for passes makes the feed unusable;
  you must be able to skip freely to reach someone worth looting.
- **A pass is final.** `loots` is unique per pair, so it is a decision rather than a
  vote — if A passed B, B looting A later connects nobody.
- **Connections have no INSERT grant.** They exist only as a consequence of a mutual
  loot, created by trigger, which also opens the chat thread immediately.
- **Blocking ends a Connection and its thread**, extending the Phase 2 teardown.
- **No gender preference filter.** There is a same-gender *safety* toggle, opt-in.
  A "show me men / women" filter would read as dating and undercut the
  repositioning.
- **`subscriptions` pulled forward from Phase 6**, since the loot quota depends on
  knowing who is paid. Only the shape needed for `is_paid()`; Play Billing wiring
  is still Phase 6.

**Security hole found and closed — worth remembering.** Probing the live API showed
`anon` could call `looted_you()` and `match_feed()`. **Postgres grants EXECUTE on
every function to PUBLIC by default**, the opposite of tables, which start closed.
So the schema looked locked while every function was callable by anyone holding the
anon key — which ships in the APK.

Nothing actually leaked: each function checks `auth.uid()` and returned empty for an
anonymous caller. But that made safety a property of every function *remembering* to
check, rather than of the permission system, and the first function added without
that check would have been a live hole.

Migration 12 revokes the PUBLIC default on all existing functions, re-grants only
the ones the client actually calls, and sets `alter default privileges` so future
functions start closed. Verified against the live project: anon now receives
`42501 permission denied`. A test pins that no function in `public` is executable by
`anon`.

**Test fixture notes:** pglite binds parameters as text, so `least($1,$2)` on uuids
raises "operator does not exist: uuid = text" — the Phase 4 assertions cast
explicitly. Fixture usernames also have to clear the 3-character minimum.

---

## 2026-08-28 — Room numbers stay quiet; friends deliberately not grouped

Two UX decisions on group rooms, no code change needed — the schema already
carries everything both require.

**Users see "Study", not "Study 2".** The room number appears once, in the group
info line as "Room 2 · 847 members". Reasoning: users cannot pick their room, so a
prominent number reads as a rank they missed and invites "how do I get into
Study 1?". Keeping it visible somewhere still answers the one question that
matters — why two friends comparing screens see different conversations.

**Room assignment stays capacity-only. `join_group()` will NOT prefer rooms where
a user's friends already are.** This was considered and rejected:

- Friends are nearly always at the same college, so assigning by the friendship
  graph would silently re-create **per-college rooms** — precisely what was
  rejected when groups were made global. Arriving there by accident is worse than
  deciding it.
- At 1024 members it achieves almost nothing: nobody notices two friends among a
  thousand people. The benefit is largely imaginary; the cost (uneven room fill,
  more complex joins) is real.
- Groups exist to meet students you would never otherwise meet. People who want to
  talk to people they already know have friend DMs.
- It also does not bite until a category exceeds 1024 members, at which point there
  is real usage data to decide from rather than a guess.

---

## 2026-08-28 — Phase 3: groups

Migration `20260828120010` deployed. Study / Sports / Friends, global, open join,
1024 per room with automatic overflow into Study 2, Study 3 and so on. 22 new tests
(101 total, all passing).

**Design decisions:**

- **`group_messages` has no `image_url` column at all.** "Text only" is enforced by
  the column not existing, rather than by a validation rule someone can later
  relax. Groups are strangers at scale; images there would be the largest
  moderation burden in the app. A test asserts no media column ever appears.
- **Room assignment is automatic and users never pick a number.** "Study 3" is an
  implementation detail of capacity, not a place anyone chose to be.
- **`join_group()` loops with a row lock.** Two people taking the last seat at once:
  the second blocks, re-reads the now-full room, and moves to the next. A
  `unique_violation` catch handles two people creating the same new room number
  simultaneously.
- **`group_members.category` is denormalised** so "one room per category per user"
  is a plain unique constraint. A composite foreign key against
  `groups(id, category)` guarantees it still matches the group it points at.
- **`member_count` is maintained by trigger**, not by the join function, so leaving
  and cascade deletes keep it honest too.
- **Rate limit is per user across all rooms**, not per room — otherwise a spammer
  just spreads the same flood across Study, Sports and Friends. 10 messages/minute.
- **The word filter matches on word boundaries** (`\m … \M`), not substrings. A
  `LIKE '%term%'` filter rejects "Scunthorpe", "assignment", "classic" — the classic
  false-positive trap that makes a filter look broken to real users. There is a test
  using "cat" vs "concatenate" that pins this.
- **`blocked_terms` ships empty.** A word list is a policy decision and a bad one is
  worse than none.

**Bug caught, and the two false passes it was hiding.** The word filter was first
called from inside the RLS `with check`. RLS policies execute as the *calling user*,
so this needed `EXECUTE` on `trips_word_filter` granted to `authenticated` — which
would have handed clients an oracle for probing the word list one guess at a time.
Without that grant, every insert failed with "permission denied for function".

Worse, two word-filter tests were *passing* on this — they asserted a message was
rejected, and it was, but for the wrong reason. Only the positive test ("word
boundaries let 'concatenate' through") exposed it.

Moved into a `security definer` BEFORE INSERT trigger, which runs as the owner. The
list stays private, and the failure is now a clear `message_blocked` instead of a
generic RLS violation the client cannot explain to the user.

**Also:** `groups.name` was going to be a generated column
(`initcap(category) || ' ' || room_number`) but Postgres rejects it — casting an
enum to text is not immutable enough. It is a trigger-maintained column instead,
which keeps the same guarantee that a room's label cannot drift from what it is.

**Test harness fix:** pglite attaches its entire bundled module to thrown errors, so
a failing migration buried the real message under megabytes of minified JS.
Migrations now run inside a try/catch that prints the message, detail, hint and
constraint, then exits.

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
