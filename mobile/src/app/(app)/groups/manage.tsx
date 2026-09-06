/**
 * Group settings, owner only.
 *
 * The invite code lives here and nowhere else. `my_groups()` returns it as null
 * for anyone who is not the owner, so a member cannot read it off the wire
 * either — hiding it in the UI alone would not be hiding it.
 *
 * Removing someone is not the same as them leaving: it writes a removal that
 * blocks the code they already hold. Regenerating the code is the blunter tool,
 * and it locks out everyone who has the old one.
 */

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Button, Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Member = {
  id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
  is_owner: boolean;
  joined_at: string;
};

type Group = { id: string; name: string; invite_code: string | null; is_owner: boolean };

export default function ManageGroup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useTheme();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: mine }, { data: list }] = await Promise.all([
      supabase.rpc('my_groups'),
      supabase.rpc('group_members_list', { p_group: id }),
    ]);
    setGroup(((mine as Group[]) ?? []).find((g) => g.id === id) ?? null);
    setMembers((list as Member[]) ?? []);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function shareCode() {
    if (!group?.invite_code) return;
    await Share.share({
      message: `Join "${group.name}" on Looty with this code: ${group.invite_code}`,
    });
  }

  function confirmRegenerate() {
    Alert.alert(
      'New code?',
      'The current code stops working immediately. Anyone still holding it will not be able to join.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('regenerate_invite_code', { p_group: id });
            if (error) Alert.alert('That did not work', error.message);
            else await load();
          },
        },
      ],
    );
  }

  function confirmRemove(m: Member) {
    const who = m.display_name ?? m.username ?? 'This person';
    Alert.alert(
      `Remove ${who}?`,
      'They lose access and cannot rejoin with the code. You can invite them back later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('remove_group_member', {
              p_group: id,
              p_user: m.id,
            });
            if (error) Alert.alert('That did not work', error.message);
            else await load();
          },
        },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert(
      `Delete ${group?.name ?? 'this group'}?`,
      'Everything in it goes — messages, membership, the code. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('delete_group', { p_group: id });
            if (error) {
              Alert.alert('That did not work', error.message);
              return;
            }
            router.dismissAll?.();
            router.replace('/(app)/groups');
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!group?.is_owner) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.page}>
          <Notice>Only the group owner can manage it.</Notice>
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={[styles.h1, { color: c.text }]} numberOfLines={1}>
          {group.name}
        </Text>

        <Text style={[styles.section, { color: c.textSecondary }]}>INVITE CODE</Text>
        <Pressable
          onPress={shareCode}
          accessibilityRole="button"
          accessibilityLabel="Share invite code"
          style={[styles.code, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
          <Text style={[styles.codeText, { color: c.text }]}>{group.invite_code}</Text>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>Tap to share</Text>
        </Pressable>
        <Text style={{ color: c.textSecondary, fontSize: 13, lineHeight: 18 }}>
          Anyone with this code can join. Share it only with people you want in.
        </Text>
        <Button label="Generate a new code" variant="secondary" onPress={confirmRegenerate} />

        <Text style={[styles.section, { color: c.textSecondary, paddingTop: 12 }]}>
          MEMBERS · {members.length}
        </Text>
        {members.map((m) => (
          <View
            key={m.id}
            style={[styles.row, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
            <Avatar uri={m.dp_url} name={m.display_name} username={m.username} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>
                {m.display_name ?? m.username ?? 'Someone'}
              </Text>
              <Text style={{ color: c.textSecondary, fontSize: 12.5 }} numberOfLines={1}>
                {m.is_owner ? 'Owner' : `@${m.username}`}
              </Text>
            </View>
            {m.is_owner ? null : (
              <Pressable onPress={() => confirmRemove(m)} hitSlop={8} accessibilityRole="button">
                <Text style={{ color: c.danger, fontSize: 13, fontWeight: '600' }}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}

        <View style={{ height: 16 }} />
        <Button label="Delete this group" variant="danger" onPress={confirmDelete} />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  code: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  codeText: { fontSize: 30, fontWeight: '700', letterSpacing: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
});
