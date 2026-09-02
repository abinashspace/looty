/**
 * Looty Match — the discovery feed.
 *
 * Vertical, one card per screen. Loot or pass; both are final, because `loots` is
 * unique per pair. A mutual loot becomes a **Connection** — never call it a match
 * anywhere a user can read it (CONTEXT.md §1).
 *
 * Passing is free and uncapped. Only loots count against the daily quota, which is
 * enforced in Postgres — the counter shown here is a courtesy, not a gate.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchPhoto } from '@/components/avatar';
import { Notice } from '@/components/ui';
import { TierGate } from '@/components/tier-gate';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Candidate = {
  id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
};

type Prefs = { match_scope: 'same_college' | 'all_india'; match_same_gender_only: boolean };

export default function Match() {
  return (
    <TierGate capability="lootyMatch">
      <Feed />
    </TierGate>
  );
}

function Feed() {
  const { session } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [cards, setCards] = useState<Candidate[]>([]);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const busy = useRef(false);

  // Card height is measured rather than assumed, so paging lines up on any device.
  const [cardHeight, setCardHeight] = useState(Dimensions.get('window').height);

  const load = useCallback(async () => {
    const [{ data: feed }, { data: left }, { data: p }] = await Promise.all([
      supabase.rpc('match_feed', { p_limit: 20 }),
      supabase.rpc('loots_remaining'),
      supabase.rpc('my_match_prefs'),
    ]);
    setCards((feed as Candidate[]) ?? []);
    setRemaining(typeof left === 'number' ? left : null);
    setPrefs(((p as Prefs[]) ?? [])[0] ?? null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function decide(target: Candidate, action: 'loot' | 'pass') {
    if (busy.current) return;
    busy.current = true;
    setActing(true);

    const { error } = await supabase
      .from('loots')
      .insert({ actor_id: session?.user.id, target_id: target.id, action });

    if (error) {
      // The quota lives in an RLS check, so hitting it surfaces as a policy refusal.
      if (error.code === '42501') {
        setRemaining(0);
      } else {
        Alert.alert('That did not work', error.message);
      }
    } else {
      setCards((prev) => prev.filter((x) => x.id !== target.id));
      if (action === 'loot') {
        setRemaining((r) => (r === null ? r : Math.max(r - 1, 0)));

        // A Connection only exists if they had already looted you.
        const { data: conn } = await supabase
          .from('connections')
          .select('id')
          .or(`user_a.eq.${target.id},user_b.eq.${target.id}`)
          .eq('status', 'active')
          .maybeSingle();

        if (conn) {
          Alert.alert(
            "You're connected",
            `You and ${target.display_name ?? target.username ?? 'they'} looted each other. You can chat now.`,
            [
              { text: 'Later', style: 'cancel' },
              { text: 'Open chat', onPress: () => router.push('/(app)/chats') },
            ],
          );
        }
      }
    }

    busy.current = false;
    setActing(false);
  }

  async function toggleScope() {
    if (!prefs) return;
    const next = prefs.match_scope === 'same_college' ? 'all_india' : 'same_college';
    setPrefs({ ...prefs, match_scope: next });
    await supabase.from('profiles').update({ match_scope: next }).eq('id', session?.user.id ?? '');
    setLoading(true);
    await load();
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  const outOfLoots = remaining === 0;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.bar, { borderBottomColor: c.border }]}>
        <Text style={[styles.h1, { color: c.text }]}>Match</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={toggleScope} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 14, fontWeight: '600' }}>
            {prefs?.match_scope === 'all_india' ? 'All India' : 'My college'}
          </Text>
        </Pressable>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          {remaining === null ? '' : `${remaining} left today`}
        </Text>
      </View>

      {outOfLoots ? (
        <View style={styles.centre}>
          <Notice>
            That is all your loots for today. They reset at midnight. Looty Plus gives
            you 50 a day and shows who looted you.
          </Notice>
        </View>
      ) : cards.length === 0 ? (
        <View style={styles.centre}>
          <Text style={{ color: c.textSecondary, textAlign: 'center', lineHeight: 21 }}>
            {prefs?.match_scope === 'same_college'
              ? 'Nobody new at your college right now. Try All India above.'
              : 'Nobody new right now. Check back later.'}
          </Text>
        </View>
      ) : (
        <View
          style={styles.fill}
          onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
          <FlatList
            data={cards}
            keyExtractor={(x) => x.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            snapToInterval={cardHeight}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({
              length: cardHeight,
              offset: cardHeight * index,
              index,
            })}
            renderItem={({ item }) => (
              <View style={[styles.card, { height: cardHeight }]}>
                <MatchPhoto
                  uri={item.dp_url}
                  name={item.display_name}
                  username={item.username}
                  style={styles.photo}
                />

                <View style={styles.meta}>
                  <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                    {item.display_name ?? 'Someone'}
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 15 }} numberOfLines={1}>
                    @{item.username}
                  </Text>
                </View>

                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Pass"
                    disabled={acting}
                    onPress={() => decide(item, 'pass')}
                    style={({ pressed }) => [
                      styles.action,
                      {
                        backgroundColor: c.backgroundElement,
                        borderColor: c.border,
                        opacity: acting ? 0.5 : pressed ? 0.8 : 1,
                      },
                    ]}>
                    <Text style={{ color: c.text, fontWeight: '600' }}>Pass</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Loot"
                    disabled={acting}
                    onPress={() => decide(item, 'loot')}
                    style={({ pressed }) => [
                      styles.action,
                      {
                        backgroundColor: c.accent,
                        borderColor: 'transparent',
                        opacity: acting ? 0.5 : pressed ? 0.85 : 1,
                      },
                    ]}>
                    <Text style={{ color: c.accentText, fontWeight: '700' }}>Loot</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { paddingHorizontal: 20, paddingVertical: 16, gap: 14, justifyContent: 'center' },
  photo: { width: '100%', flex: 1, borderRadius: 18 },
  meta: { gap: 2 },
  name: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  actions: { flexDirection: 'row', gap: 12 },
  action: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
