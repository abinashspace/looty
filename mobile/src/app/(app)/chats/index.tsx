/**
 * The inbox: friend DMs and Connected chats in one list.
 *
 * Both are 1:1 and both live in `threads`, distinguished by type. They are shown
 * together because to a user they are simply "my conversations" — the difference
 * only matters inside the thread, where Connected chats treat images differently.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { can } from '@/lib/tiers';

type Thread = {
  thread_id: string;
  type: 'dm' | 'connection';
  other_id: string;
  other_username: string | null;
  other_display_name: string | null;
  other_dp_url: string | null;
  last_body: string | null;
  last_image: boolean | null;
  last_at: string;
  ended_at: string | null;
};

export default function Chats() {
  const { tier, isBanned } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [incoming, setIncoming] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data }, { data: reqs }] = await Promise.all([
      supabase.rpc('my_threads'),
      supabase.rpc('my_friend_requests'),
    ]);
    setThreads((data as Thread[]) ?? []);
    setIncoming(
      ((reqs as { direction: string }[]) ?? []).filter((r) => r.direction === 'incoming').length,
    );
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!can('directMessage', tier, isBanned)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
        <View style={styles.page}>
          <Text style={[styles.h1, { color: c.text }]}>Chats</Text>
          <Notice>
            {isBanned
              ? 'Messaging is unavailable while your account is restricted.'
              : 'Confirm your college email to message other students.'}
          </Notice>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <View style={styles.page}>
        <View style={styles.titleRow}>
          <Text style={[styles.h1, { color: c.text }]}>Chats</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Find people"
            onPress={() => router.push('/(app)/chats/search')}
            hitSlop={8}>
            <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>Find people</Text>
          </Pressable>
        </View>

        {incoming > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(app)/chats/requests')}
            style={({ pressed }) => [
              styles.requests,
              { backgroundColor: c.backgroundElement, borderColor: c.border, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Text style={{ color: c.text, fontWeight: '600' }}>
              {incoming} friend request{incoming === 1 ? '' : 's'}
            </Text>
            <Text style={{ color: c.accent, fontWeight: '600' }}>View</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.thread_id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          ListEmptyComponent={
            <Text style={{ color: c.textSecondary, lineHeight: 21 }}>
              No conversations yet. Find someone by username above, or loot people in
              Match and see who loots you back.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/(app)/chats/${item.thread_id}`)}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
              <Avatar
                uri={item.other_dp_url}
                name={item.other_display_name}
                username={item.other_username}
                size={52}
              />

              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.nameRow}>
                  <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                    {item.other_display_name ?? item.other_username ?? 'Someone'}
                  </Text>
                  {item.type === 'connection' ? (
                    <View style={[styles.tag, { borderColor: c.border }]}>
                      <Text style={{ color: c.textSecondary, fontSize: 11 }}>Connected</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={{ color: c.textSecondary, fontSize: 14 }} numberOfLines={1}>
                  {item.ended_at
                    ? 'This chat has ended'
                    : item.last_image && !item.last_body
                      ? 'Photo'
                      : (item.last_body ?? 'Say hello')}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
});
