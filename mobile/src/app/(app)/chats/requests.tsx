/**
 * Friend requests, incoming and outgoing.
 *
 * Both directions live on one screen because they are the same object seen from
 * two sides, and a user who sent a request wants to know it is still pending in
 * the same place they check whether anyone asked them.
 *
 * Declining and cancelling are the same operation — deleting the row — which is
 * why the database has one policy for both and this screen has one handler.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Request = {
  friendship_id: string;
  direction: 'incoming' | 'outgoing';
  other_id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
};

export default function Requests() {
  const { session } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_friend_requests');
    setRequests((data as Request[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function accept(r: Request) {
    setActing(r.friendship_id);
    await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', r.friendship_id);

    // Open the conversation straight away — accepting a request and then hunting
    // for where to talk is a pointless extra step.
    const { data: threadId } = await supabase.rpc('open_dm_thread', { p_other: r.other_id });
    setActing(null);
    await load();
    if (threadId) router.push(`/(app)/chats/${threadId}`);
  }

  async function remove(r: Request) {
    setActing(r.friendship_id);
    await supabase.from('friendships').delete().eq('id', r.friendship_id);
    await load();
    setActing(null);
  }

  const incoming = requests.filter((r) => r.direction === 'incoming');
  const outgoing = requests.filter((r) => r.direction === 'outgoing');

  function Row({ r }: { r: Request }) {
    const busy = acting === r.friendship_id;
    return (
      <View style={styles.row}>
        {r.dp_url ? (
          <Image source={{ uri: r.dp_url }} style={styles.dp} />
        ) : (
          <View style={[styles.dp, { backgroundColor: c.backgroundElement }]} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {r.display_name ?? 'Someone'}
          </Text>
          <Text style={{ color: c.textSecondary, fontSize: 14 }} numberOfLines={1}>
            @{r.username}
          </Text>
        </View>

        {busy ? (
          <ActivityIndicator size="small" />
        ) : r.direction === 'incoming' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => remove(r)}
              style={[styles.btn, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
              <Text style={{ color: c.text, fontSize: 14 }}>Decline</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => accept(r)}
              style={[styles.btn, { backgroundColor: c.accent, borderColor: 'transparent' }]}>
              <Text style={{ color: c.accentText, fontSize: 14, fontWeight: '600' }}>Accept</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => remove(r)}
            style={[styles.btn, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontSize: 14 }}>Cancel</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: c.text }]}>Requests</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {requests.length === 0 ? (
            <Text style={{ color: c.textSecondary, paddingTop: 20, lineHeight: 21 }}>
              No requests right now.
            </Text>
          ) : null}

          {incoming.length ? (
            <>
              <Text style={[styles.section, { color: c.textSecondary }]}>
                Asked to be friends
              </Text>
              {incoming.map((r) => (
                <Row key={r.friendship_id} r={r} />
              ))}
            </>
          ) : null}

          {outgoing.length ? (
            <>
              <Text style={[styles.section, { color: c.textSecondary }]}>You asked</Text>
              {outgoing.map((r) => (
                <Row key={r.friendship_id} r={r} />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  h1: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 13, fontWeight: '600', paddingTop: 20, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dp: { width: 48, height: 48, borderRadius: 24 },
  name: { fontSize: 16, fontWeight: '600' },
  btn: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
});
