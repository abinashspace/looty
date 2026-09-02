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

import { ChatShell, Composer, MessageList, type ChatMessage } from '@/components/chat';
import { useTheme } from '@/hooks/use-theme';
import { signedChatImageUrl, uploadChatImage } from '@/lib/chat-image';
import { useConnectedCapture } from '@/lib/connected-capture';
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
        .select('id, sender_id, body, image_url, kind, created_at')
        .eq('thread_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    setThread(((threads as Thread[]) ?? []).find((t) => t.thread_id === id) ?? null);

    const mapped: ChatMessage[] = await Promise.all(
      (msgs ?? []).map(async (m) => {
        const path = (m.image_url as string | null) ?? null;
        const imageUrl =
          path && !path.startsWith('http') ? await signedChatImageUrl(path) : path;
        const kind: ChatMessage['kind'] = m.kind === 'screenshot' ? 'screenshot' : 'user';
        return {
          id: m.id as string,
          senderId: m.sender_id as string,
          body: (m.body as string | null) ?? null,
          imageUrl,
          kind,
          createdAt: m.created_at as string,
        };
      }),
    );
    setMessages(mapped);
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

  function sendError(code?: string, message?: string) {
    return code === '42501'
      ? 'You cannot send messages in this chat any more.'
      : (message ?? 'Could not send.');
  }

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
    return sendError(error.code, error.message);
  }

  async function sendImage(uri: string, width?: number): Promise<string | null> {
    if (!session?.user.id || !id) return 'Not signed in.';
    try {
      const path = await uploadChatImage({
        userId: session.user.id,
        threadId: id,
        uri,
        sourceWidth: width,
      });
      const { error } = await supabase.from('messages').insert({
        thread_id: id,
        sender_id: session.user.id,
        image_url: path,
      });
      if (error) return sendError(error.code, error.message);
      await load();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not send the photo.';
    }
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

  function confirmLeave() {
    if (!thread || thread.type !== 'connection') return;
    Alert.alert(
      'Leave this chat?',
      'You will not see each other in Match again. You are not blocking them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const me = session?.user.id;
            if (!me) return;
            const lo = me < thread.other_id ? me : thread.other_id;
            const hi = me < thread.other_id ? thread.other_id : me;
            const { error } = await supabase
              .from('connections')
              .update({ status: 'ended', ended_at: new Date().toISOString() })
              .eq('user_a', lo)
              .eq('user_b', hi)
              .eq('status', 'active');
            if (!error) await load();
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
  useConnectedCapture(id, thread?.type === 'connection' && !ended);

  return (
    <ChatShell>
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
        {thread?.type === 'connection' && !ended ? (
          <Pressable onPress={confirmLeave} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: c.textSecondary, fontSize: 14 }}>Leave</Text>
          </Pressable>
        ) : null}
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
        hideImagesUntilTap={thread?.type === 'connection'}
        loading={loading}
        emptyText="No messages yet."
      />

      <Composer
        onSend={send}
        onSendImage={sendImage}
        allowImages
        disabled={ended}
        disabledReason="This chat has ended."
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
  title: { fontSize: 17, fontWeight: '700' },
});
