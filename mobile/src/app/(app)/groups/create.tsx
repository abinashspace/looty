/**
 * Make a group.
 *
 * Name and description, nothing else. The group is private the moment it exists
 * and there is no visibility switch, so there is nothing here to get wrong.
 * The invite code is generated server-side and shown once you are inside.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field, Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

const NAME_MAX = 50;
const DESC_MAX = 300;

export default function CreateGroup() {
  const router = useRouter();
  const c = useTheme();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the group a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('create_group', {
      p_name: trimmed,
      p_description: description.trim(),
    });
    setBusy(false);
    if (err) {
      setError(err.message === 'tier_too_low' ? 'Confirm your email address first.' : err.message);
      return;
    }
    // Replace rather than push: backing out of a group you just made should
    // land on the list, not on the form that made it.
    if (data) router.replace(`/(app)/groups/${data}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={[styles.h1, { color: c.text }]}>New group</Text>
        <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 20 }}>
          Private. People join with the code you share — there is no way to find it otherwise.
        </Text>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Field
          label="Name"
          value={name}
          onChangeText={(t) => setName(t.slice(0, NAME_MAX))}
          placeholder="Sem 5 panic"
          hint={`${name.length}/${NAME_MAX}`}
        />
        <Field
          label="Description"
          value={description}
          onChangeText={(t) => setDescription(t.slice(0, DESC_MAX))}
          placeholder="What is this group for?"
          multiline
          hint={`Optional · ${description.length}/${DESC_MAX}`}
        />

        <View style={{ height: 8 }} />
        <Button label="Create group" onPress={create} loading={busy} disabled={!name.trim()} />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
});
