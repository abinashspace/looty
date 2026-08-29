/**
 * Issues a college-email verification code.
 *
 * This runs under service_role, and it has to: the raw code must reach the
 * mailbox and nowhere else. Only its sha256 (salted per row) is stored, and the
 * code is never returned to the caller — otherwise anyone could request a code for
 * an address they do not own and read it straight out of the response.
 *
 * Confirming is the opposite: `confirm_college_email(code)` is a client RPC,
 * because it only succeeds if the caller already has the code.
 *
 * Email delivery uses Resend when RESEND_API_KEY is set. Without it the code is
 * logged instead, so the flow is testable before an email provider exists. That
 * fallback refuses to run when LOOTY_ENV is "production".
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CODE_TTL_MINUTES = 10;
const MAX_REQUESTS_PER_HOUR = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function sixDigitCode(): string {
  // crypto.getRandomValues, not Math.random — this is a credential.
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not_authenticated' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Who is calling — resolved from their own token, never from the request body.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'not_authenticated' }, 401);
  const userId = userData.user.id;

  let email = '';
  try {
    email = String(((await req.json()) as { email?: string }).email ?? '').trim().toLowerCase();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: 'invalid_email' }, 400);

  const admin = createClient(url, serviceKey);

  // Is this actually a recognised college domain? Unknown domains are the common
  // case, not an error — the app offers "request your college" instead.
  const { data: collegeId } = await admin.rpc('college_for_email', { p_email: email });
  if (!collegeId) return json({ error: 'unknown_college_domain' }, 422);

  // One mailbox, one account.
  const { data: taken } = await admin
    .from('profiles')
    .select('id')
    .eq('college_email', email)
    .neq('id', userId)
    .maybeSingle();
  if (taken) return json({ error: 'email_already_claimed' }, 409);

  // Rate limit per user, so this cannot be used to mail-bomb a college address.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from('email_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);
  if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR) return json({ error: 'rate_limited' }, 429);

  const code = sixDigitCode();
  const salt = crypto.randomUUID();
  const codeHash = await sha256Hex(code + salt);

  const { error: insErr } = await admin.from('email_verifications').insert({
    user_id: userId,
    email,
    college_id: collegeId,
    code_salt: salt,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
  });
  if (insErr) return json({ error: 'could_not_issue', detail: insErr.message }, 500);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('LOOTY_MAIL_FROM') ?? 'Looty <onboarding@resend.dev>',
        to: [email],
        subject: `${code} is your Looty code`,
        text:
          `Your Looty verification code is ${code}.\n\n` +
          `It expires in ${CODE_TTL_MINUTES} minutes. If you did not ask for this, ignore this email.`,
      }),
    });
    if (!res.ok) {
      return json({ error: 'send_failed', detail: await res.text() }, 502);
    }
  } else {
    if (Deno.env.get('LOOTY_ENV') === 'production') {
      return json({ error: 'email_not_configured' }, 500);
    }
    // Development only. The code goes to the function logs, never to the caller.
    console.log(`[dev] verification code for ${email}: ${code}`);
  }

  return json({ ok: true, expires_in_minutes: CODE_TTL_MINUTES });
});
