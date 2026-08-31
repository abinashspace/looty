/**
 * Deletes the caller's account.
 *
 * This has to run under service_role: removing a row from auth.users is an
 * Admin API call, not something a client JWT can do. The cascade then takes
 * the profile, messages, friendships, and notification prefs with it.
 *
 * banned_identities is deliberately not cascaded — it has no user_id. A
 * permanent ban must still block that college address after the account is
 * gone, which is the whole point of the table. We re-assert the hash here
 * before deleting, in case a row was somehow missed when the ban was issued.
 *
 * Avatars are removed first so a public-bucket object does not outlive the
 * person it pictured.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not_authenticated' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'not_authenticated' }, 401);
  const userId = userData.user.id;

  let confirm = '';
  try {
    confirm = String(((await req.json()) as { confirm?: string }).confirm ?? '');
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (confirm !== 'delete') return json({ error: 'confirmation_required' }, 400);

  const admin = createClient(url, serviceKey);

  // Re-anchor a permanent ban before the profile row vanishes with the user.
  const { data: profile } = await admin
    .from('profiles')
    .select('college_email')
    .eq('id', userId)
    .maybeSingle();
  const { data: bans } = await admin
    .from('bans')
    .select('type, lifted_at')
    .eq('user_id', userId)
    .is('lifted_at', null);

  const permanentlyBanned = (bans ?? []).some((b) => b.type === 'permanent');
  const collegeEmail = (profile as { college_email?: string | null } | null)?.college_email;
  if (permanentlyBanned && collegeEmail) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(collegeEmail.toLowerCase()),
    );
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await admin.from('banned_identities').upsert(
      { hash, kind: 'college_email' },
      { onConflict: 'hash' },
    );
  }

  const { data: files } = await admin.storage.from('avatars').list(userId);
  if (files?.length) {
    await admin.storage.from('avatars').remove(files.map((f) => `${userId}/${f.name}`));
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: 'could_not_delete', detail: delErr.message }, 500);

  return json({ ok: true });
});
