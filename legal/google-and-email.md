# What you still have to create (cannot be done from this repo)

## Google Sign-In

The app already has a “Continue with Google” button. It stays **hidden** until
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is in `mobile/.env`.

1. Google Cloud Console → new project (or the existing one).
2. APIs & Services → OAuth consent screen → External, app name **Looty**.
3. Credentials → Create OAuth client → **Web application**.
4. Authorised JavaScript origins:
   - `https://zsfjwlmeeodsiwruvine.supabase.co`
5. Authorised redirect URIs:
   - `https://zsfjwlmeeodsiwruvine.supabase.co/auth/v1/callback`
   - Expo Go will also use an `exp://` / AuthSession redirect; add
     `https://auth.expo.io/@<your-expo-username>/looty` if you use the Expo
     proxy, or the scheme `looty://` once you do an EAS build.
6. Copy the client ID into `mobile/.env` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
7. Supabase dashboard → Authentication → Providers → Google → enable, paste
   the same client ID and secret.

Email/password stays for development. Nothing downstream cares which you used.

## College-email codes (Resend)

`issue-college-code` is deployed. Without `RESEND_API_KEY` it logs the code
(and refuses if `LOOTY_ENV=production`).

1. Create a [Resend](https://resend.com) account (free tier is enough).
2. Verify a sending domain, or use `onboarding@resend.dev` for tests.
3. `npx supabase secrets set RESEND_API_KEY=re_...`
4. Optionally `npx supabase secrets set LOOTY_MAIL_FROM="Looty <noreply@yourdomain>"`
5. Do **not** set `LOOTY_ENV=production` until mail actually sends.

Then “Send code” on the phone delivers to the college mailbox.
