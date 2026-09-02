/**
 * Profile setup — the last step before the app proper.
 *
 * Collects username, display name, course length and a photo. Only reached at
 * Tier 2, so everyone here is already a confirmed student.
 *
 * Username rules are enforced in Postgres (shape, reserved list, 14-day cadence).
 * They are mirrored here only so the user finds out before submitting; the
 * database is the authority and its errors are surfaced verbatim when they differ.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { jpegBytesFromUri } from '@/lib/jpeg-bytes';
import { supabase } from '@/lib/supabase';

// A DP is never displayed larger than a Match card, so pixels beyond this are
// bytes nobody sees. The picker hands back a full-camera-resolution crop —
// 300 KB to 1.5 MB — and the Match feed downloads one per card, which makes
// avatar egress the first Supabase limit this app would hit. At 512px it is
// nearer 50 KB. The bucket's 2 MB cap is the backstop, not the plan.
const DP_MAX_PX = 512;
const DP_QUALITY = 0.7;

/**
 * Shrinks a picked photo before it is ever uploaded.
 *
 * Only ever downscales — enlarging a small photo to 512 adds bytes and no detail.
 * Falls back to the original if manipulation fails: a resize going wrong should
 * not be the thing that stops someone finishing signup, and the storage policy's
 * size cap still applies either way.
 */
async function downscale(uri: string, sourceWidth?: number): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(uri);
    if (!sourceWidth || sourceWidth > DP_MAX_PX) context.resize({ width: DP_MAX_PX });
    const rendered = await context.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: DP_QUALITY });
    return out.uri;
  } catch {
    return uri;
  }
}

const COURSES = [
  { label: 'B.Tech / B.E.', years: 4 },
  { label: 'B.Sc / B.Com / B.A.', years: 3 },
  { label: 'M.Tech / M.Sc / MBA', years: 2 },
  { label: 'MBBS', years: 5 },
  { label: 'Other', years: 3 },
];

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function ProfileSetup() {
  const { session, refresh } = useSession();
  const c = useTheme();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [courseIdx, setCourseIdx] = useState<number | null>(null);
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

  const ready =
    USERNAME_RE.test(username) && displayName.trim().length > 0 && courseIdx !== null;

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
      // Downscale here rather than at submit, so the preview shows what will
      // actually be uploaded and Finish stays instant.
      const asset = res.assets[0];
      setPhoto(await downscale(asset.uri, asset.width));
      setError(null);
    }
  }, []);

  async function save() {
    if (!session?.user.id || courseIdx === null) return;
    setBusy(true);
    setError(null);

    try {
      let dpUrl: string | undefined;
      if (photo) {
        // Path must start with the user's own id — storage policy keys on the first
        // folder segment, so anything else is refused.
        const path = `${session.user.id}/dp.jpg`;
        const bytes = await jpegBytesFromUri(photo);
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
        if (upErr) throw new Error(upErr.message);
        dpUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }

      const { error: dbErr } = await supabase
        .from('profiles')
        .update({
          username,
          display_name: displayName.trim(),
          course_years: COURSES[courseIdx].years,
          start_year: new Date().getFullYear(),
          ...(dpUrl ? { dp_url: dpUrl } : {}),
        })
        .eq('id', session.user.id);
      if (dbErr) throw new Error(dbErr.message);

      await refresh();
    } catch (e) {
      // Surface the database's own wording — it knows things this screen does not,
      // like whether a username was taken a second ago.
      setError(e instanceof Error ? e.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Set up your profile</Title>
      <Body>
        Username and display name are what other students see. A photo is optional
        — Looty does not require a face.
      </Body>

      <Pressable onPress={pickPhoto} style={styles.photoRow} accessibilityRole="button">
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Avatar name={displayName} username={username} size={84} />
        )}
        <Text style={{ color: c.accent, fontWeight: '600' }}>
          {photo ? 'Change photo' : 'Add a photo (optional)'}
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

      <View style={{ gap: 8 }}>
        <Text style={[styles.label, { color: c.textSecondary }]}>Course</Text>
        <View style={styles.chips}>
          {COURSES.map((course, i) => {
            const on = courseIdx === i;
            return (
              <Pressable
                key={course.label}
                onPress={() => setCourseIdx(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? c.accent : c.backgroundElement,
                    borderColor: on ? 'transparent' : c.border,
                  },
                ]}>
                <Text style={{ color: on ? c.accentText : c.text, fontSize: 14 }}>
                  {course.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.hint, { color: c.textSecondary }]}>
          Used to work out when you graduate. Alumni keep their account — the profile
          just shows a badge.
        </Text>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Button label="Finish" onPress={save} loading={busy} disabled={!ready} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4 },
  photo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: 'hidden',
  },
  label: { fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  hint: { fontSize: 13, lineHeight: 18 },
});
