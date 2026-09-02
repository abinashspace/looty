# Looty privacy policy

> Hosted at **https://abinashspace.github.io/looty/** (`docs/index.html` on
> this repo). Do not paste dating language anywhere this text is reused.

**Last updated: 1 September 2026.**

Looty is a friends app for verified college students in India. It is not a
dating app.

## Who we are

Looty is operated by the project owner. Contact: the email you put on the Play
Store listing.

## What we collect

| Data | Why |
|---|---|
| Account email (Google or the address you sign up with) | Sign in |
| College email, once you confirm it | Prove you are a student; also the identifier a permanent ban is anchored to (stored as a hash, not the raw address, in `banned_identities`) |
| Username, display name, profile photo, course length, college | Your profile and Looty Match |
| Gender, if you set it | Optional Match filter (“only show me the same gender”) |
| Messages you send (text; photos in 1:1 chats only) | Delivering chat |
| Friend requests, blocks, reports, loots | The product, and automatic safety |
| Device push token, if you allow notifications | Sending the notifications you turned on |
| App diagnostics we cannot avoid (crash logs from the store) | Fixing the app |

We do **not** collect date of birth. There is no age gate. We do **not** ask for
an ID card or a phone number (those columns exist in the database from an
abandoned path and are unused).

## What we do not do

- We do not sell your data.
- We do not run behavioural / personalised advertising. If ads ship, they will
  be non-personalised for everyone, because some users may be under 18 and
  India’s DPDP Act forbids targeted ads to them.
- We do not show your college email, legal name, or phone hash to other users.
  Those columns are unreadable by the app.

## Who can see what

- **Tier 0 (unverified):** your own profile only. You can read group rooms.
- **Tier 2 (college confirmed):** other verified students can see your username,
  display name, photo and college. They cannot see your college email.
- **Chat:** people you are friends with, or Connected with, see messages in that
  thread. Group rooms are public to every Looty user (text only).
- **Photos in Connected chats** are hidden until the other person taps. That is
  a courtesy, not encryption — the file still sits on our storage for that
  thread.

## How long we keep it

- Your account and messages until you delete the account, or we close the
  service.
- Group messages: intended 30-day rolling window (not built yet).
- A **permanent ban** keeps a hash of the college email after the account is
  gone, so the same mailbox cannot sign up again. If that ban is lifted, the
  hash is deleted.

## Your rights (DPDP)

You can:

- See and edit your profile in the app
- Download is not built yet; email support if you need a copy
- **Delete your account** from You → Delete account. That removes the login,
  profile, photos, messages and tokens. A permanent-ban hash is the only thing
  that can remain, and only if you were permanently restricted.

You can turn notification types off in You → Notifications. That does not
uninstall system permission; it stops Looty from sending those kinds.

## Safety

Reports are counted automatically. We do not have a human sitting on every
report. Eight unique eligible reporters can restrict an account; coordinated
fake reports unwind if those reporters are themselves restricted. See the in-app
restriction screen.

## Children

We do not ask your age. The product is built as a friends space for college
students, not as a service aimed at children. If you are not supposed to have
an account, delete it or ask us to.

## Changes

We will date this page when it changes. Continued use after a dated change
means you have seen it.

## Contact

Use the Play Store support email, or the in-app appeal form if your account is
restricted.
