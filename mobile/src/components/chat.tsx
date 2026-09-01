/**
 * Shared chat pieces: the message list and the composer.
 *
 * The list is inverted, which is how every chat app works and why "load older"
 * means appending rather than prepending. Newest is index 0.
 *
 * Images exist only in 1:1 chats. Groups pass no image fields and the composer
 * hides the picker — group_messages has no image column, by design.
 *
 * Connected chats hide a photo behind "Tap to view" and do not fetch it until
 * then. A blurred download is still a download; this is the same honesty as
 * the Looted-you list. Friend DMs show the photo immediately.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { useTheme } from '@/hooks/use-theme';

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  imageUrl?: string | null;
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
  hideImagesUntilTap = false,
  loading = false,
  emptyText = 'No messages yet.',
}: {
  messages: ChatMessage[];
  meId: string | undefined;
  showSenders?: boolean;
  hideImagesUntilTap?: boolean;
  loading?: boolean;
  emptyText?: string;
}) {
  const c = useTheme();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

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
      const showPhoto = Boolean(item.imageUrl) && (mine || !hideImagesUntilTap || revealed[item.id]);

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
            {item.imageUrl && !showPhoto ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View photo"
                onPress={() => setRevealed((r) => ({ ...r, [item.id]: true }))}
                style={[styles.hiddenPhoto, { backgroundColor: mine ? c.accentText : c.border }]}>
                <Text style={{ color: mine ? c.accent : c.text, fontWeight: '600' }}>
                  Photo · tap to view
                </Text>
              </Pressable>
            ) : null}
            {item.imageUrl && showPhoto ? (
              <Image source={{ uri: item.imageUrl }} style={styles.photo} />
            ) : null}
            {item.body ? (
              <Text style={[styles.body, { color: mine ? c.accentText : c.text }]}>{item.body}</Text>
            ) : null}
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
    [c, meId, showSenders, hideImagesUntilTap, revealed],
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
  onSendImage,
  allowImages = false,
  disabled = false,
  disabledReason,
  placeholder = 'Message',
}: {
  onSend: (text: string) => Promise<string | null>;
  onSendImage?: (uri: string, width?: number) => Promise<string | null>;
  allowImages?: boolean;
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

  async function pickImage() {
    if (!onSendImage || busy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Looty needs permission to open your photos.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (res.canceled) return;
    setBusy(true);
    setError(null);
    const asset = res.assets[0];
    const err = await onSendImage(asset.uri, asset.width);
    if (err) setError(err);
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
        {allowImages ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send a photo"
            onPress={pickImage}
            disabled={busy}
            style={({ pressed }) => [
              styles.attach,
              { borderColor: c.border, opacity: busy ? 0.4 : pressed ? 0.7 : 1 },
            ]}>
            <Text style={{ color: c.text, fontSize: 18 }}>＋</Text>
          </Pressable>
        ) : null}
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
  photo: { width: 220, height: 220, borderRadius: 10, marginBottom: 4 },
  hiddenPhoto: {
    width: 220,
    height: 140,
    borderRadius: 10,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  attach: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
