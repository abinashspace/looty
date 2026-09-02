/**
 * The three global rooms: Study, Sports, Friends.
 *
 * Users see the category name, never "Study 2" — the room number is a consequence
 * of capacity, not a place anyone chose. It appears once, quietly, in the subtitle,
 * which is enough to explain why two friends comparing screens see different
 * conversations. See CONTEXT.md §3.3.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Tier, can } from '@/lib/tiers';

const CATEGORIES = [
  { key: 'study', label: 'Study', blurb: 'Notes, doubts, exam panic.' },
  { key: 'sports', label: 'Sports', blurb: 'Matches, teams, and arguments about them.' },
  { key: 'friends', label: 'Friends', blurb: 'Everything else.' },
] as const;

type Row = { id: string; category: string; room_number: number; member_count: number };

export default function Groups() {
  const { session, tier, isBanned } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [rooms, setRooms] = useState<Record<string, Row | undefined>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: memberships }, { data: allRooms }] = await Promise.all([
      supabase.from('group_members').select('group_id, category').eq('user_id', session?.user.id ?? ''),
      supabase.from('groups').select('id, category, room_number, member_count').order('room_number'),
    ]);

    const joined = new Set((memberships ?? []).map((m) => m.category as string));
    const byCategory: Record<string, Row | undefined> = {};

    for (const cat of CATEGORIES) {
      const memberOf = (memberships ?? []).find((m) => m.category === cat.key);
      byCategory[cat.key] = memberOf
        ? (allRooms ?? []).find((r) => r.id === memberOf.group_id)
        // Not a member yet: preview the first room so there is something to read.
        : (allRooms ?? []).find((r) => r.category === cat.key);
    }

    setMine(joined);
    setRooms(byCategory);
    setLoading(false);
  }, [session?.user.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function join(category: string) {
    setJoining(category);
    setError(null);
    const { data, error: err } = await supabase.rpc('join_group', { p_category: category });
    if (err) setError(err.message);
    else if (data) {
      await load();
      router.push(`/(app)/groups/${data}`);
    }
    setJoining(null);
  }

  async function leave(category: string) {
    setLeaving(category);
    setError(null);
    const { error: err } = await supabase.rpc('leave_group', { p_category: category });
    if (err) setError(err.message);
    else await load();
    setLeaving(null);
  }

  function confirmLeave(category: string, label: string) {
    Alert.alert(`Leave ${label}?`, 'You can join again later. Messages stay in the room.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leave(category) },
    ]);
  }

  const canPost = can('postInGroups', tier, isBanned);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={[styles.h1, { color: c.text }]}>Groups</Text>

        {!canPost ? (
          <Notice>
            You can read every group. Confirm your college email to join in.
          </Notice>
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : (
          CATEGORIES.map((cat) => {
            const room = rooms[cat.key];
            const joined = mine.has(cat.key);

            return (
              <Pressable
                key={cat.key}
                accessibilityRole="button"
                disabled={!room}
                onPress={() => room && router.push(`/(app)/groups/${room.id}`)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: c.backgroundElement,
                    borderColor: c.border,
                    opacity: !room ? 0.6 : pressed ? 0.85 : 1,
                  },
                ]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.cardTitle, { color: c.text }]}>{cat.label}</Text>
                  <Text style={{ color: c.textSecondary, fontSize: 14 }}>{cat.blurb}</Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12.5, paddingTop: 2 }}>
                    {room
                      ? `Room ${room.room_number} · ${room.member_count} member${room.member_count === 1 ? '' : 's'}${joined ? '' : ' · preview'}`
                      : 'No rooms yet — be the first in.'}
                  </Text>
                </View>

                {!joined && canPost ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => join(cat.key)}
                    disabled={joining === cat.key}
                    style={[styles.join, { backgroundColor: c.accent, opacity: joining === cat.key ? 0.5 : 1 }]}>
                    {joining === cat.key ? (
                      <ActivityIndicator size="small" color={c.accentText} />
                    ) : (
                      <Text style={{ color: c.accentText, fontWeight: '600', fontSize: 14 }}>Join</Text>
                    )}
                  </Pressable>
                ) : joined && canPost ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => confirmLeave(cat.key, cat.label)}
                    disabled={leaving === cat.key}
                    style={[
                      styles.join,
                      {
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderColor: c.border,
                        opacity: leaving === cat.key ? 0.5 : 1,
                      },
                    ]}>
                    {leaving === cat.key ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>Leave</Text>
                    )}
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })
        )}

        {tier >= Tier.CollegeVerified ? (
          <Text style={[styles.foot, { color: c.textSecondary }]}>
            Rooms hold 1024 people. When one fills, the next opens automatically.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 2 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  cardTitle: { fontSize: 18, fontWeight: '700' },
  join: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  foot: { fontSize: 13, lineHeight: 18, paddingTop: 4 },
});
