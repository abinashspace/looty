/**
 * College email verification — the College Verified badge.
 *
 * This used to be the only route to full access and a mandatory signup step.
 * Since migration 35 it gates nothing: a confirmed sign-in address is Tier 1 and
 * Tier 1 opens groups, DMs and Match. What confirming a college address buys is
 * the badge, and a ban anchor that is actually hard to get another of.
 *
 * So it is reached from the profile screen, not from signup, and every word on
 * it has to stop implying that anything is locked — it is not.
 *
 * Two states on one screen: ask for the address, then ask for the code. Kept
 * together because they are one thought, and splitting them across routes makes
 * "wrong address, go back" needlessly awkward.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Field, LinkButton, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const REQUEST_ERRORS: Record<string, string> = {
  unknown_college_domain:
    "We don't recognise that college yet. You can request it below — your access is unaffected either way.",
  email_already_claimed: 'That address is already linked to another Looty account.',
  rate_limited: 'Too many codes requested. Try again in an hour.',
  invalid_email: 'That does not look like an email address.',
  email_not_configured: 'Email sending is not set up yet. Nothing you did wrong.',
};

const CONFIRM_ERRORS: Record<string, string> = {
  invalid_code: 'That code is not right. Check and try again.',
  expired: 'That code has expired. Ask for a new one.',
  too_many_attempts: 'Too many wrong attempts. Ask for a new code.',
  no_pending: 'Ask for a code first.',
  email_already_claimed: 'That address is already linked to another account.',
  identity_banned: 'This college address cannot be used.',
};

export default function Verify() {
  const { refresh } = useSession();
  const router = useRouter();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('issue-college-code', {
      body: { email: email.trim().toLowerCase() },
    });

    if (err) {
      // supabase-js surfaces non-2xx as an error; dig out our own code if present.
      let key = '';
      try {
        key = (await (err as { context?: Response }).context?.json())?.error ?? '';
      } catch {
        /* fall through to the generic message */
      }
      setError(REQUEST_ERRORS[key] ?? 'Could not send the code. Try again.');
    } else if (data?.ok) {
      setStep('code');
    } else {
      setError('Could not send the code. Try again.');
    }
    setBusy(false);
  }

  async function confirmCode() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('confirm_college_email', {
      p_code: code.trim(),
    });

    if (err) {
      setError('Something went wrong. Try again.');
    } else if (data === 'ok') {
      // Tier just became 2. Nothing unlocks — the badge appears — so send them
      // back where they came from rather than through any signup routing.
      await refresh();
      router.back();
    } else {
      setError(CONFIRM_ERRORS[String(data)] ?? 'That did not work. Try again.');
    }
    setBusy(false);
  }

  return (
    <Screen>
      {step === 'email' ? (
        <>
          <Title>Confirm your college</Title>
          <Body>
            Enter your college email address and we will send a 6-digit code to
            check it is yours. This adds the College Verified badge to your
            profile. Nothing is locked without it.
          </Body>

          <View style={{ height: 8 }} />

          <Field
            label="College email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@college.ac.in"
            hint="Not your Gmail — the address your college gave you."
            editable={!busy}
          />

          {error ? <Notice tone="error">{error}</Notice> : null}

          <Button
            label="Send code"
            onPress={requestCode}
            loading={busy}
            disabled={!email.includes('@')}
          />

          <Notice>
            No college email? Nothing changes — you already have full access. The
            badge is the only difference.
          </Notice>

          <View style={{ alignItems: 'center', gap: 14, paddingTop: 4 }}>
            <LinkButton label="Request my college" onPress={() => router.push('/(auth)/college')} />
            <LinkButton label="Not now" onPress={() => router.back()} />
          </View>
        </>
      ) : (
        <>
          <Title>Enter your code</Title>
          <Body>We sent a 6-digit code to {email}. It expires in 10 minutes.</Body>

          <View style={{ height: 8 }} />

          <Field
            label="6-digit code"
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            placeholder="000000"
            maxLength={6}
            editable={!busy}
          />

          {error ? <Notice tone="error">{error}</Notice> : null}

          <Button label="Confirm" onPress={confirmCode} loading={busy} disabled={code.length !== 6} />

          <View style={{ alignItems: 'center', gap: 14, paddingTop: 4 }}>
            <LinkButton
              label="Use a different address"
              onPress={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
