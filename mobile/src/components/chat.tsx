/**
 * Shared chat pieces: the message list and the composer.
 *
 * The list is inverted, which is how every chat app works and why "load older"
 * means appending rather than prepending. Newest is index 0.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  /** Group threads only — omitted in 1:1, where there is only one other person. */
  senderName?: string | null;
  /** Blocked senders collapse rather than vanish; removing them orphans replies. */
  isBlocked?: boolean;
};

function timeOf(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function MessageList({
  messages,
  meId,
  showSenders = false,
  loading = false,
  emptyText = 'No messages yet.',
}: {
  messages: ChatMessage[];
  meId: string | undefined;
  showSenders?: boolean;
  loading?: boolean;
  emptyText?: string;
}) {
  const c = useTheme();

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      if (item.isBlocked) {
        return (
          <View style={styles.blockedRow}>
            <Text style={[styles.blockedText, { color: c.textSecondary }]}>
              Message from someone you blocked
            </Text>
          </View>
        );
      }

      const mine = item.senderId === meId;
      return (
        <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
          <View
            style={[
              styles.bubble,
              mine
                ? { backgroundColor: c.accent }
                : { backgroundColor: c.backgroundElement, borderColor: c.border, borderWidth: 1 },
            ]}>
            {showSenders && !mine && item.senderName ? (
              <Text style={[styles.sender, { color: c.accent }]}>{item.senderName}</Text>
            ) : null}
            <Text style={[styles.body, { color: mine ? c.accentText : c.text }]}>{item.body}</Text>
            <Text
              style={[
                styles.time,
                { color: mine ? c.accentText : c.textSecondary, opacity: mine ? 0.75 : 1 },
              ]}>
              {timeOf(item.createdAt)}
            </Text>
          </View>
        </View>
      );
    },
    [c, meId, showSenders],
  );

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!messages.length) {
    return (
      <View style={styles.centre}>
        <Text style={{ color: c.textSecondary, textAlign: 'center' }}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <FlatList
      inverted
      data={messages}
      keyExtractor={(m) => m.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      keyboardDismissMode="interactive"
    />
  );
}

export function Composer({
  onSend,
  disabled = false,
  disabledReason,
  placeholder = 'Message',
}: {
  onSend: (text: string) => Promise<string | null>;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
}) {
  const c = useTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    // Clear optimistically — nothing is more irritating than losing what you typed
    // to a network blip. Restored below if the send actually fails.
    setText('');
    const err = await onSend(body);
    if (err) {
      setText(body);
      setError(err);
    }
    setBusy(false);
  }

  if (disabled) {
    return (
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.background }}>
        <View style={[styles.locked, { borderTopColor: c.border }]}>
          <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
            {disabledReason ?? 'You cannot post here.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.background }}>
      {error ? (
        <Text style={[styles.error, { color: c.danger }]} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
      <View style={[styles.composer, { borderTopColor: c.border }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={c.textSecondary}
          multiline
          maxLength={2000}
          style={[
            styles.input,
            { color: c.text, backgroundColor: c.backgroundElement, borderColor: c.border },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={send}
          disabled={!text.trim() || busy}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: c.accent,
              opacity: !text.trim() || busy ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}>
          {busy ? (
            <ActivityIndicator color={c.accentText} size="small" />
          ) : (
            <Text style={{ color: c.accentText, fontWeight: '700' }}>↑</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  list: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9, gap: 2 },
  sender: { fontSize: 12, fontWeight: '700', marginBottom: 1 },
  body: { fontSize: 15.5, lineHeight: 21 },
  time: { fontSize: 11, alignSelf: 'flex-end' },
  blockedRow: { alignItems: 'center', paddingVertical: 4 },
  blockedText: { fontSize: 12, fontStyle: 'italic' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    maxHeight: 120,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 },
  locked: { padding: 16, borderTopWidth: 1 },
});
