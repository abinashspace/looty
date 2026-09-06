/**
 * Join a group with a code.
 *
 * A screen rather than a prompt, because `Alert.prompt` is iOS-only and this app
 * is Android-only — it would have silently done nothing.
 *
 * The server upper-cases and trims, so typing is forgiving. The code alphabet
 * deliberately excludes O/0 and I/1, which are the characters people get wrong
 * when a code is read aloud or copied by hand.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field, Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

const JOIN_ERRORS: Record<string, string> = {
  no_such_code: 'That code does not match any group.',
  removed_from_group:
    'You were removed from this group. Only an invitation from the owner can let you back in.',
  group_full: 'That group is full.',
  tier_too_low: 'Confirm your email address first.',
};

export default function JoinGroup() {
  const router = useRouter();
  const c = useTheme();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('join_group_by_code', {
      p_code: code.trim(),
    });
    setBusy(false);
    if (err) {
      setError(JOIN_ERRORS[err.message] ?? err.message);
      return;
    }
    if (data) router.replace(`/(app)/groups/${data}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={[styles.h1, { color: c.text }]}>Join a group</Text>
        <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 20 }}>
          Paste the code the group owner sent you.
        </Text>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Field
          label="Invite code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="ABCD2345"
          maxLength={8}
          editable={!busy}
          hint="Eight characters."
        />

        <Button
          label="Join"
          onPress={join}
          loading={busy}
          disabled={code.trim().length < 8}
        />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
});
