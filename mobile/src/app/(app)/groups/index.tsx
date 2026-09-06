/**
 * Your groups.
 *
 * Groups are private and user-created. There is no directory and nothing to
 * browse: this screen only ever shows groups you are in, plus invitations
 * waiting on you. The search box searches those, not the world — it exists
 * because someone in twenty groups needs to find one, not to discover new ones.
 *
 * Invitations sit above the list rather than in a notification tray. The owner
 * re-adding someone who left is the case this exists for, and it has to be an
 * accept, never a silent rejoin. See CONTEXT.md §3.3.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { can } from '@/lib/tiers';

type Group = {
  id: string;
  name: string;
  description: string;
  member_count: number;
  is_owner: boolean;
  invite_code: string | null;
  last_body: string | null;
  last_at: string;
};

type Invite = {
  group_id: string;
  name: string;
  description: string;
  member_count: number;
  invited_by: string | null;
  created_at: string;
};

function whenever(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export default function Groups() {
  const { tier, isBanned } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [groups, setGroups] = useState<Group[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: mine }, { data: pending }] = await Promise.all([
      supabase.rpc('my_groups'),
      supabase.rpc('my_group_invites'),
    ]);
    setGroups((mine as Group[]) ?? []);
    setInvites((pending as Invite[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description ?? '').toLowerCase().includes(q),
    );
  }, [groups, query]);

  async function respond(groupId: string, accept: boolean) {
    setBusy(groupId);
    const { error } = await supabase.rpc(
      accept ? 'accept_group_invite' : 'decline_group_invite',
      { p_group: groupId },
    );
    setBusy(null);
    if (error) {
      Alert.alert('That did not work', error.message);
      return;
    }
    await load();
    if (accept) router.push(`/(app)/groups/${groupId}`);
  }

  const canUse = can('postInGroups', tier, isBanned);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <View style={styles.bar}>
        <Text style={[styles.h1, { color: c.text }]}>Groups</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push('/(app)/groups/join')}
          hitSlop={8}
          accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 14, fontWeight: '600' }}>Join</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/(app)/groups/create')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Create a group"
          style={[styles.plus, { backgroundColor: c.accent }]}>
          <Text style={{ color: c.accentText, fontSize: 20, fontWeight: '700', lineHeight: 22 }}>
            +
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {!canUse ? (
          <Notice>Confirm your email address to create or join groups.</Notice>
        ) : null}

        {invites.map((inv) => (
          <View
            key={inv.group_id}
            style={[styles.invite, { backgroundColor: c.bubble, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{inv.name}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 13, paddingTop: 2 }}>
              {inv.invited_by ? `${inv.invited_by} invited you` : 'You were invited'}
              {' · '}
              {inv.member_count} {inv.member_count === 1 ? 'member' : 'members'}
            </Text>
            <View style={styles.inviteActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy === inv.group_id}
                onPress={() => respond(inv.group_id, false)}
                style={[styles.small, { borderColor: c.border, borderWidth: 1 }]}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>Decline</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy === inv.group_id}
                onPress={() => respond(inv.group_id, true)}
                style={[styles.small, { backgroundColor: c.accent }]}>
                <Text style={{ color: c.accentText, fontWeight: '600', fontSize: 13 }}>Accept</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {groups.length > 3 ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your groups"
            placeholderTextColor={c.textSecondary}
            style={[
              styles.search,
              { color: c.text, backgroundColor: c.backgroundElement, borderColor: c.border },
            ]}
          />
        ) : null}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : shown.length === 0 ? (
          <Text style={[styles.empty, { color: c.textSecondary }]}>
            {groups.length === 0
              ? 'No groups yet. Make one and share its code, or join with a code someone sent you.'
              : 'Nothing matches that.'}
          </Text>
        ) : (
          shown.map((g) => (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              onPress={() => router.push(`/(app)/groups/${g.id}`)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: c.backgroundElement,
                  borderColor: c.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.cardTop}>
                  <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                    {whenever(g.last_at)}
                  </Text>
                </View>
                <Text style={{ color: c.textSecondary, fontSize: 14 }} numberOfLines={1}>
                  {g.last_body ?? g.description ?? 'No messages yet.'}
                </Text>
                <Text style={{ color: c.textSecondary, fontSize: 12.5, paddingTop: 2 }}>
                  {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                  {g.is_owner ? ' · you own this' : ''}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  plus: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  page: { padding: 20, paddingTop: 8, gap: 12 },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  invite: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 2 },
  inviteActions: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  small: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  empty: { fontSize: 14, lineHeight: 20, textAlign: 'center', paddingTop: 40, paddingHorizontal: 20 },
});
