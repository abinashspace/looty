/**
 * A 1:1 conversation — friend DM or Connected chat.
 *
 * Report and Block live in the header next to each other, deliberately: they are
 * the two things someone reaches for in the same moment, and hiding either behind
 * a menu costs exactly the wrong person exactly the wrong amount of time.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Composer, MessageList, type ChatMessage } from '@/components/chat';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Thread = {
  thread_id: string;
  type: 'dm' | 'connection';
  other_id: string;
  other_username: string | null;
  other_display_name: string | null;
  ended_at: string | null;
};

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: threads }, { data: msgs }] = await Promise.all([
      supabase.rpc('my_threads'),
      supabase
        .from('messages')
        .select('id, sender_id, body, created_at')
        .eq('thread_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    setThread(((threads as Thread[]) ?? []).find((t) => t.thread_id === id) ?? null);
    setMessages(
      (msgs ?? []).map((m) => ({
        id: m.id as string,
        senderId: m.sender_id as string,
        body: (m.body as string | null) ?? null,
        createdAt: m.created_at as string,
      })),
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`thread:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, load]);

  async function send(body: string): Promise<string | null> {
    const { error } = await supabase
      .from('messages')
      .insert({ thread_id: id, sender_id: session?.user.id, body });
    if (!error) {
      await load();
      return null;
    }
    // The database re-checks tier, ban, block and thread state at send time, so a
    // refusal here usually means something changed since the thread was opened.
    return error.code === '42501'
      ? 'You cannot send messages in this chat any more.'
      : error.message;
  }

  function confirmBlock() {
    if (!thread) return;
    Alert.alert(
      `Block ${thread.other_display_name ?? 'this person'}?`,
      'They will not be told. This chat disappears for both of you, and neither of you will see the other again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            await supabase
              .from('blocks')
              .insert({ blocker_id: session?.user.id, blocked_id: thread.other_id });
            router.replace('/(app)/chats');
          },
        },
      ],
    );
  }

  function confirmReport() {
    if (!thread) return;
    Alert.alert('Report this person?', 'Pick what happened. Reports are reviewed automatically.', [
      { text: 'Cancel', style: 'cancel' },
      ...(['harassment', 'sexual_content', 'spam', 'impersonation'] as const).map((reason) => ({
        text: reason.replace('_', ' '),
        onPress: async () => {
          const { error } = await supabase.from('reports').insert({
            reporter_id: session?.user.id,
            target_id: thread.other_id,
            context: thread.type,
            context_id: thread.thread_id,
            reason,
          });
          Alert.alert(
            error ? 'Could not report' : 'Reported',
            error
              ? 'You may have already reported this person, or your account is too new to report.'
              : 'Thanks. We only count one report per person, so there is no need to send more.',
          );
        },
      })),
    ]);
  }

  const ended = Boolean(thread?.ended_at);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={{ color: c.accent, fontSize: 16 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {thread?.other_display_name ?? thread?.other_username ?? 'Chat'}
          </Text>
          {thread?.type === 'connection' ? (
            <Text style={{ color: c.textSecondary, fontSize: 12 }}>Connected</Text>
          ) : null}
        </View>
        <Pressable onPress={confirmReport} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: c.textSecondary, fontSize: 14 }}>Report</Text>
        </Pressable>
        <Pressable onPress={confirmBlock} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: c.danger, fontSize: 14 }}>Block</Text>
        </Pressable>
      </View>

      <MessageList
        messages={messages}
        meId={session?.user.id}
        loading={loading}
        emptyText="No messages yet."
      />

      <Composer
        onSend={send}
        disabled={ended}
        disabledReason="This chat has ended."
      />
    </SafeAreaView>
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
  title: { fontSize: 17, fontWeight: '700' },
});
