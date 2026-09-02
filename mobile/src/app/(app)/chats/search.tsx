/**
 * Find people by username and send friend requests.
 *
 * Every result carries its own relationship, so the button says the right thing —
 * Add, Requested, Accept, or Message — rather than offering to add someone who is
 * already a friend.
 *
 * Search deliberately requires a username. There is no browse-everyone list: Looty
 * is not a directory to be scrolled, and the enumeration rule from migration 15
 * exists precisely to stop that.
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Relationship = 'none' | 'pending_out' | 'pending_in' | 'friends' | 'self';

type Result = {
  id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
  relationship: Relationship;
};

export default function Search() {
  const { session } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const run = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const { data } = await supabase.rpc('search_users', { p_query: q.trim(), p_limit: 20 });
    setResults((data as Result[]) ?? []);
    setSearching(false);
  }, []);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    setTouched(true);
    const t = setTimeout(() => run(query), 300);
    return () => clearTimeout(t);
  }, [query, run]);

  async function addFriend(person: Result) {
    setActing(person.id);
    await supabase
      .from('friendships')
      .insert({ requester_id: session?.user.id, addressee_id: person.id });
    await run(query);
    setActing(null);
  }

  async function accept(person: Result) {
    setActing(person.id);
    await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('requester_id', person.id)
      .eq('addressee_id', session?.user.id ?? '');

    // Same as the Requests screen: accepting and then hunting for where to talk
    // is a pointless extra step.
    const { data: threadId } = await supabase.rpc('open_dm_thread', { p_other: person.id });
    setActing(null);
    await run(query);
    if (threadId) router.push(`/(app)/chats/${threadId}`);
  }

  async function message(person: Result) {
    setActing(person.id);
    const { data: threadId, error } = await supabase.rpc('open_dm_thread', { p_other: person.id });
    setActing(null);
    if (!error && threadId) router.push(`/(app)/chats/${threadId}`);
  }

  function action(person: Result) {
    switch (person.relationship) {
      case 'self':
        return null;
      case 'friends':
        return { label: 'Message', onPress: () => message(person), primary: false };
      case 'pending_out':
        return { label: 'Requested', onPress: () => {}, primary: false, muted: true };
      case 'pending_in':
        return { label: 'Accept', onPress: () => accept(person), primary: true };
      default:
        return { label: 'Add', onPress: () => addFriend(person), primary: true };
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 16 }}>‹</Text>
        </Pressable>
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Search by username"
          placeholderTextColor={c.textSecondary}
          style={[
            styles.input,
            { color: c.text, backgroundColor: c.backgroundElement, borderColor: c.border },
          ]}
        />
      </View>

      {searching ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <View style={{ paddingHorizontal: 20 }}>
          {results.length === 0 && touched && query.trim().length >= 2 ? (
            <Text style={{ color: c.textSecondary, paddingTop: 20, lineHeight: 21 }}>
              Nobody with that username. Usernames are exact — ask them to check
              theirs on their profile.
            </Text>
          ) : results.length === 0 ? (
            <Text style={{ color: c.textSecondary, paddingTop: 20, lineHeight: 21 }}>
              Type at least two characters of someone&apos;s username.
            </Text>
          ) : (
            results.map((person) => {
              const a = action(person);
              return (
                <View key={person.id} style={styles.row}>
                  <Avatar
                    uri={person.dp_url}
                    name={person.display_name}
                    username={person.username}
                    size={48}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                      {person.display_name ?? 'Someone'}
                    </Text>
                    <Text style={{ color: c.textSecondary, fontSize: 14 }} numberOfLines={1}>
                      @{person.username}
                      {person.relationship === 'self' ? ' · you' : ''}
                    </Text>
                  </View>

                  {a ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={acting === person.id || a.muted}
                      onPress={a.onPress}
                      style={({ pressed }) => [
                        styles.action,
                        {
                          backgroundColor: a.primary ? c.accent : c.backgroundElement,
                          borderColor: a.primary ? 'transparent' : c.border,
                          opacity: a.muted ? 0.55 : acting === person.id ? 0.5 : pressed ? 0.85 : 1,
                        },
                      ]}>
                      {acting === person.id ? (
                        <ActivityIndicator size="small" color={a.primary ? c.accentText : c.text} />
                      ) : (
                        <Text
                          style={{
                            color: a.primary ? c.accentText : c.text,
                            fontWeight: '600',
                            fontSize: 14,
                          }}>
                          {a.label}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  action: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, minWidth: 88, alignItems: 'center' },
});
