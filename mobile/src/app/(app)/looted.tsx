/**
 * Who looted you — the paid feature.
 *
 * Free users get a COUNT and nothing else, because the server refuses to send the
 * identities at all. There is deliberately nothing to blur here: a blurred photo is
 * still a photo that crossed the network, and anyone can read it off the wire or
 * out of a debugger. The placeholders below are placeholders, not censored data.
 *
 * See `looted_you()` vs `looted_you_count()` in migration 11.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { TierGate } from '@/components/tier-gate';
import { Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Admirer = {
  id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
  looted_at: string;
};

export default function Looted() {
  return (
    <TierGate capability="lootyMatch">
      <LootedList />
    </TierGate>
  );
}

function LootedList() {
  const { session } = useSession();
  const c = useTheme();

  const [count, setCount] = useState(0);
  const [people, setPeople] = useState<Admirer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: n }, { data: rows }] = await Promise.all([
      supabase.rpc('looted_you_count'),
      supabase.rpc('looted_you'),
    ]);
    setCount(typeof n === 'number' ? n : 0);
    setPeople((rows as Admirer[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function lootBack(person: Admirer) {
    const { error } = await supabase
      .from('loots')
      .insert({ actor_id: session?.user.id, target_id: person.id, action: 'loot' });

    if (error) {
      Alert.alert(
        'That did not work',
        error.code === '42501' ? 'You are out of loots for today.' : error.message,
      );
      return;
    }
    // They looted first, so this always connects.
    Alert.alert("You're connected", 'You can chat now.');
    await load();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.fill}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  const locked = people.length === 0 && count > 0;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.head}>
        <Text style={[styles.h1, { color: c.text }]}>Looted you</Text>
        <Text style={{ color: c.textSecondary, fontSize: 14 }}>
          {count === 0
            ? 'Nobody yet. Keep looting.'
            : `${count} ${count === 1 ? 'person has' : 'people have'} looted you`}
        </Text>
      </View>

      {locked ? (
        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          <Notice>
            Looty Plus shows you who they are, removes ads, and gives you 50 loots a
            day. ₹119/month, first month ₹49.
          </Notice>

          <View style={styles.grid}>
            {Array.from({ length: Math.min(count, 6) }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.tile,
                  { backgroundColor: c.backgroundElement, borderColor: c.border },
                ]}>
                <Text style={{ color: c.textSecondary, fontSize: 22 }}>?</Text>
              </View>
            ))}
          </View>

          <Text style={{ color: c.textSecondary, fontSize: 12.5, lineHeight: 18 }}>
            These are placeholders, not hidden photos — your device never receives
            their details unless you subscribe.
          </Text>
        </View>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          ListEmptyComponent={
            count === 0 ? (
              <Text style={{ color: c.textSecondary, lineHeight: 21 }}>
                When someone loots you, they show up here.
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar uri={item.dp_url} name={item.display_name} username={item.username} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                  {item.display_name ?? 'Someone'}
                </Text>
                <Text style={{ color: c.textSecondary, fontSize: 14 }} numberOfLines={1}>
                  @{item.username}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => lootBack(item)}
                style={({ pressed }) => [
                  styles.lootBack,
                  { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
                ]}>
                <Text style={{ color: c.accentText, fontWeight: '700', fontSize: 14 }}>
                  Loot back
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 4 },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  lootBack: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
});
