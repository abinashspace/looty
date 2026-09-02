/**
 * A group room.
 *
 * Messages come from `group_thread()` rather than a plain table read: it joins
 * senders server-side, so a Tier 0 reader learns about the people who posted here
 * without being handed the whole student directory. See CONTEXT.md §4.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatShell, Composer, MessageList, type ChatMessage } from '@/components/chat';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { can } from '@/lib/tiers';

const SEND_ERRORS: Record<string, string> = {
  message_blocked: 'That message was blocked by the word filter.',
  '23514': 'That message was blocked by the word filter.',
  '42501': 'You need to join this room first.',
};

type Room = { id: string; category: string; room_number: number; member_count: number };

export default function GroupRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, tier, isBanned } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: r }, { data: msgs }, { data: mem }] = await Promise.all([
      supabase.from('groups').select('id, category, room_number, member_count').eq('id', id).maybeSingle(),
      supabase.rpc('group_thread', { p_group: id, p_limit: 50 }),
      supabase.from('group_members').select('group_id').eq('group_id', id).eq('user_id', session?.user.id ?? ''),
    ]);

    setRoom((r as Room) ?? null);
    setIsMember((mem?.length ?? 0) > 0);
    setMessages(
      (msgs ?? []).map((m: Record<string, unknown>) => ({
        id: String(m.id),
        senderId: String(m.sender_id),
        body: (m.body as string | null) ?? null,
        senderName: (m.display_name as string | null) ?? (m.username as string | null),
        createdAt: String(m.created_at),
        isBlocked: Boolean(m.is_blocked),
      })),
    );
    setLoading(false);
  }, [id, session?.user.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Subscribe to this room only. group_messages is readable by everyone, so an
  // unfiltered subscription would push every message in every room to every device.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`group:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, load]);

  const canPost = can('postInGroups', tier, isBanned) && isMember;

  async function send(body: string): Promise<string | null> {
    const { error } = await supabase
      .from('group_messages')
      .insert({ group_id: id, sender_id: session?.user.id, body });
    if (!error) {
      await load();
      return null;
    }
    return SEND_ERRORS[error.code ?? ''] ?? SEND_ERRORS[error.message] ?? error.message;
  }

  const title = room ? room.category.charAt(0).toUpperCase() + room.category.slice(1) : 'Group';

  function confirmLeave() {
    if (!room) return;
    Alert.alert(`Leave ${title}?`, 'You can join again later. Messages stay in the room.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('leave_group', { p_category: room.category });
          if (!error) router.back();
        },
      },
    ]);
  }

  return (
    <ChatShell>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 16 }}>‹ Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]}>{title}</Text>
          {room ? (
            <Text style={{ color: c.textSecondary, fontSize: 12 }}>
              Room {room.room_number} · {room.member_count}{' '}
              {room.member_count === 1 ? 'member' : 'members'}
            </Text>
          ) : null}
        </View>
        {isMember ? (
          <Pressable onPress={confirmLeave} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: c.textSecondary, fontSize: 14 }}>Leave</Text>
          </Pressable>
        ) : null}
      </View>

      <MessageList
        messages={messages}
        meId={session?.user.id}
        showSenders
        loading={loading}
        emptyText="Nothing here yet. Say something."
      />

      <Composer
        onSend={send}
        disabled={!canPost}
        disabledReason={
          isBanned
            ? 'You cannot post while your account is restricted.'
            : !can('postInGroups', tier, isBanned)
              ? 'Confirm your college email to post here.'
              : 'Join this group to post.'
        }
      />
    </ChatShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: '700' },
});
