/**
 * Sign in / create account.
 *
 * Email and password for development. Google Sign-In is the intended production
 * entry point and slots in beside this without touching anything downstream —
 * the session context and tier routing never look at how you authenticated.
 *
 * Google only appears when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is set. You also
 * have to enable the Google provider in the Supabase dashboard with the same
 * client. Until both exist, email/password is the path.
 *
 * Note what signing in does NOT do: it does not make you a student. Any email
 * works here and lands at Tier 0. The college address is the only thing that
 * proves anything, and that is the next screen.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

import { Body, Button, Field, LinkButton, Notice, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'signIn' | 'signUp';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [googleRequest, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: googleWebClientId || 'disabled.apps.googleusercontent.com',
    webClientId: googleWebClientId || 'disabled.apps.googleusercontent.com',
  });

  const canSubmit = email.includes('@') && password.length >= 8;
  const googleReady = Boolean(googleWebClientId) && googleRequest && !busy;

  useEffect(() => {
    if (googleResponse?.type !== 'success') return;
    const idToken = googleResponse.params.id_token;
    if (!idToken) {
      setError('Google did not return a sign-in token.');
      return;
    }
    setBusy(true);
    setError(null);
    supabase.auth
      .signInWithIdToken({ provider: 'google', token: idToken })
      .then(({ error: err }) => {
        if (err) setError(err.message);
      })
      .finally(() => setBusy(false));
  }, [googleResponse]);

  // Clear the last failure as soon as the user changes anything. Without this a
  // stale "User already registered" sits over a freshly typed address and reads
  // as a verdict on the new one.
  function edit(set: (v: string) => void) {
    return (v: string) => {
      set(v);
      setError(null);
      setNotice(null);
    };
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);

    const creds = { email: email.trim(), password };
    const { data, error: err } =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword(creds)
        : await supabase.auth.signUp(creds);

    if (err) {
      setError(err.message);
    } else if (mode === 'signUp' && !data.session) {
      // Only happens if email confirmation is switched back on.
      setNotice('Check your email to confirm your account, then sign in.');
      setMode('signIn');
    }
    // On success the session listener takes over and routes onward.
    setBusy(false);
  }

  async function google() {
    setError(null);
    setNotice(null);
    const result = await promptGoogle();
    if (result.type === 'cancel' || result.type === 'dismiss') return;
    if (result.type === 'error') {
      setError(result.error?.message ?? 'Google sign-in failed.');
    }
  }

  return (
    <Screen>
      <Title>{mode === 'signIn' ? 'Welcome back' : 'Create your account'}</Title>
      <Body>
        Looty is for college students in India. You will confirm your college email
        on the next step.
      </Body>

      <View style={{ height: 8 }} />

      {googleWebClientId ? (
        <>
          <Button
            label="Continue with Google"
            onPress={google}
            loading={busy}
            disabled={!googleReady}
          />
          <Body>Or use email for now.</Body>
        </>
      ) : null}

      <Field
        label="Email"
        value={email}
        onChangeText={edit(setEmail)}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@example.com"
        editable={!busy}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={edit(setPassword)}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        placeholder="At least 8 characters"
        hint={mode === 'signUp' ? 'At least 8 characters.' : undefined}
        editable={!busy}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice>{notice}</Notice> : null}

      <Button
        label={mode === 'signIn' ? 'Sign in' : 'Create account'}
        onPress={submit}
        loading={busy}
        disabled={!canSubmit}
      />

      <View style={{ alignItems: 'center', paddingTop: 4 }}>
        <LinkButton
          label={mode === 'signIn' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          onPress={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError(null);
            setNotice(null);
          }}
        />
      </View>
    </Screen>
  );
}
