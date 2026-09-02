/**
 * People you blocked, and a way to undo it.
 *
 * Profiles of a blocked pair are hidden from each other, so this list comes
 * from `my_blocks()` rather than a join the client cannot see. The blocked
 * person never gets a row here — blocking stays silent.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Row = {
  blocked_id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
};

export default function Blocked() {
  const router = useRouter();
  const c = useTheme();

  const [people, setPeople] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_blocks');
    setPeople((data as Row[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function unblock(id: string) {
    setActing(id);
    await supabase.from('blocks').delete().eq('blocked_id', id);
    await load();
    setActing(null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: c.text }]}>Blocked</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {people.length === 0 ? (
            <Text style={{ color: c.textSecondary, paddingTop: 20, lineHeight: 21 }}>
              You have not blocked anyone. They are not told when you do.
            </Text>
          ) : (
            people.map((p) => (
              <View key={p.blocked_id} style={styles.row}>
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
                  onPress={() => unblock(p.blocked_id)}
                  disabled={acting === p.blocked_id}
                  style={[
                    styles.btn,
                    { backgroundColor: c.backgroundElement, borderColor: c.border },
                  ]}>
                  {acting === p.blocked_id ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Text style={{ color: c.text, fontSize: 14 }}>Unblock</Text>
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
  btn: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
});
