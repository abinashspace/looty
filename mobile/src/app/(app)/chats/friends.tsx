/**
 * Accepted friends. Search finds people; this is who you already added.
 *
 * `thread_id` is null until someone opens the DM. Tapping Message calls
 * open_dm_thread so a first conversation does not need a second hunt.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Friend = {
  other_id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
  thread_id: string | null;
};

export default function Friends() {
  const router = useRouter();
  const c = useTheme();

  const [people, setPeople] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_friends');
    setPeople((data as Friend[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function message(person: Friend) {
    setActing(person.other_id);
    // Always go through open_dm_thread so an ended DM from a prior unfriend reopens.
    const { data } = await supabase.rpc('open_dm_thread', { p_other: person.other_id });
    setActing(null);
    if (data) router.push(`/(app)/chats/${data}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: c.text }]}>Friends</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {people.length === 0 ? (
            <Text style={{ color: c.textSecondary, paddingTop: 20, lineHeight: 21 }}>
              No friends yet. Find someone by username from Chats.
            </Text>
          ) : (
            people.map((p) => (
              <View key={p.other_id} style={styles.row}>
                <Avatar uri={p.dp_url} name={p.display_name} username={p.username} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                    {p.display_name ?? 'Someone'}
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 14 }} numberOfLines={1}>
                    @{p.username}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => message(p)}
                  disabled={acting === p.other_id}
                  style={[
                    styles.btn,
                    { backgroundColor: c.accent, opacity: acting === p.other_id ? 0.5 : 1 },
                  ]}>
                  {acting === p.other_id ? (
                    <ActivityIndicator size="small" color={c.accentText} />
                  ) : (
                    <Text style={{ color: c.accentText, fontWeight: '600', fontSize: 14 }}>
                      Message
                    </Text>
                  )}
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  h1: { fontSize: 20, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  btn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
});
