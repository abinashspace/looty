/**
 * Sign in / create account.
 *
 * Email and password for now. Google Sign-In is the intended production entry
 * point and slots in beside this without touching anything downstream — the
 * session context and tier routing never look at how you authenticated.
 *
 * Note what signing in does NOT do: it does not make you a student. Any email
 * works here and lands at Tier 0. The college address is the only thing that
 * proves anything, and that is the next screen.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Field, LinkButton, Notice, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

type Mode = 'signIn' | 'signUp';

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = email.includes('@') && password.length >= 8;

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

  return (
    <Screen>
      <Title>{mode === 'signIn' ? 'Welcome back' : 'Create your account'}</Title>
      <Body>
        Looty is for college students in India. You will confirm your college email
        on the next step.
      </Body>

      <View style={{ height: 8 }} />

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@example.com"
        editable={!busy}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
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
