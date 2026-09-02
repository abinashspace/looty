/**
 * Edit display name, username, and optional photo after onboarding.
 *
 * Username cadence (once per 14 days) and reserved names live in Postgres.
 * This screen only mirrors the shape check so the user finds out before Save.
 */

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { downscaleProfilePhoto, uploadProfilePhoto } from '@/lib/profile-photo';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function saveError(message: string): string {
  if (message.includes('username_change_too_soon')) {
    return 'You can change your username once every 14 days.';
  }
  if (message.includes('username_reserved')) {
    return 'That username is reserved.';
  }
  if (message.includes('duplicate') || message.includes('unique') || message.includes('23505')) {
    return 'That username is taken.';
  }
  return message;
}

export default function ProfileEdit() {
  const { session, profile, refresh } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [username, setUsername] = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameError = useMemo(() => {
    if (!username) return null;
    if (!USERNAME_RE.test(username)) {
      return 'Lowercase letters, numbers and underscores. 3–20 characters.';
    }
    return null;
  }, [username]);

  const ready = USERNAME_RE.test(username) && displayName.trim().length > 0 && !busy;

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Looty needs permission to open your photos.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!res.canceled) {
      const asset = res.assets[0];
      setPhoto(await downscaleProfilePhoto(asset.uri, asset.width));
      setError(null);
    }
  }, []);

  async function save() {
    if (!session?.user.id) return;
    setBusy(true);
    setError(null);
    try {
      let dpUrl: string | undefined;
      if (photo) dpUrl = await uploadProfilePhoto(session.user.id, photo);

      const { error: dbErr } = await supabase
        .from('profiles')
        .update({
          username,
          display_name: displayName.trim(),
          ...(dpUrl ? { dp_url: dpUrl } : {}),
        })
        .eq('id', session.user.id);
      if (dbErr) throw new Error(dbErr.message);

      await refresh();
      router.back();
    } catch (e) {
      setError(saveError(e instanceof Error ? e.message : 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
        <Text style={{ color: c.accent, fontSize: 16 }}>‹ Back</Text>
      </Pressable>
      <Title>Edit profile</Title>
      <Body>Username can change once every 14 days. A photo is still optional.</Body>

      <Pressable onPress={pickPhoto} style={styles.photoRow} accessibilityRole="button">
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} accessibilityIgnoresInvertColors />
        ) : (
          <Avatar
            uri={profile?.dp_url}
            name={displayName}
            username={username}
            size={84}
          />
        )}
        <Text style={{ color: c.accent, fontWeight: '600' }}>
          {photo || profile?.dp_url ? 'Change photo' : 'Add a photo (optional)'}
        </Text>
      </Pressable>

      <Field
        label="Username"
        value={username}
        onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        autoCapitalize="none"
        placeholder="rahul_k"
        maxLength={20}
        error={usernameError}
        hint="How people find you. Changeable once every 14 days."
        editable={!busy}
      />
      <Field
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Rahul"
        maxLength={40}
        editable={!busy}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label="Save" onPress={save} loading={busy} disabled={!ready} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4 },
  photo: { width: 84, height: 84, borderRadius: 42, overflow: 'hidden' },
});
