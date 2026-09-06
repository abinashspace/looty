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

import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { GenderChips } from '@/components/gender-chips';
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { downscaleProfilePhoto, uploadProfilePhoto } from '@/lib/profile-photo';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const SAVE_ERRORS: Record<string, string> = {
  username_change_too_soon:
    'You changed your username in the last 14 days, so it is locked for now. Put your old one back to carry on.',
  username_reserved: 'That username is taken.',
  under_18: 'You must be 18 or over to use Looty.',
};

const COURSES = [
  { label: 'B.Tech / B.E.', years: 4 },
  { label: 'B.Sc / B.Com / B.A.', years: 3 },
  { label: 'M.Tech / M.Sc / MBA', years: 2 },
  { label: 'MBBS', years: 5 },
  { label: 'Other', years: 3 },
];

/** YYYY-MM-DD from the database back into the DD/MM/YYYY the field shows. */
function fromIso(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Digits only, punctuated as the user types: 01/02/2003. */
function formatDob(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * Strict: rejects 31/02 rather than rolling it into March, which is what `new
 * Date` would do and would quietly shift someone's birthday.
 */
function parseDob(v: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > new Date().getFullYear()) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Mirrors is_adult() in Postgres. The server is the one that enforces it. */
function isAdult(d: Date | null): boolean {
  if (!d) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return d <= cutoff;
}

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function ProfileSetup() {
  const { session, profile, refresh } = useSession();
  const c = useTheme();

  // Prefilled: migration 39 sends every existing account back through this
  // screen, so it is no longer a first-run-only form.
  const [username, setUsername] = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [courseIdx, setCourseIdx] = useState<number | null>(() => {
    const y = profile?.course_years;
    const i = y == null ? -1 : COURSES.findIndex((c) => c.years === y);
    return i >= 0 ? i : null;
  });
  const [gender, setGender] = useState<string | null>(profile?.gender ?? null);
  const [dob, setDob] = useState(() => fromIso(profile?.date_of_birth ?? null));
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

  // Typed as DD/MM/YYYY. A date picker would be friendlier, but every option is
  // a native module and therefore a new build; this ships over the air.
  const dobDate = useMemo(() => parseDob(dob), [dob]);
  const dobError = useMemo(() => {
    if (dob.length < 10) return null;
    if (!dobDate) return 'Use DD/MM/YYYY.';
    if (!isAdult(dobDate)) return 'You must be 18 or over to use Looty.';
    return null;
  }, [dob, dobDate]);

  const ready =
    USERNAME_RE.test(username) &&
    displayName.trim().length > 0 &&
    courseIdx !== null &&
    dobDate !== null &&
    isAdult(dobDate);

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
      setPhoto(await downscaleProfilePhoto(asset.uri, asset.width));
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
        dpUrl = await uploadProfilePhoto(session.user.id, photo);
      }

      const { error: dbErr } = await supabase
        .from('profiles')
        .update({
          // Only send the username when it actually changed. The rules trigger
          // refuses a *change* within 14 days of the last one, and resending the
          // same value counts as a change — which is exactly what stranded every
          // existing account on this screen after migration 39.
          ...(username === profile?.username ? {} : { username }),
          display_name: displayName.trim(),
          course_years: COURSES[courseIdx].years,
          start_year: new Date().getFullYear(),
          date_of_birth: dobDate ? iso(dobDate) : null,
          gender,
          ...(dpUrl ? { dp_url: dpUrl } : {}),
        })
        .eq('id', session.user.id);
      if (dbErr) throw new Error(dbErr.message);

      await refresh();
    } catch (e) {
      // Surface the database's own wording — it knows things this screen does not,
      // like whether a username was taken a second ago. A few codes are opaque
      // enough to be worth translating.
      const raw = e instanceof Error ? e.message : '';
      setError(SAVE_ERRORS[raw] ?? raw ?? 'Could not save your profile.');
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
        label="Date of birth"
        value={dob}
        onChangeText={(t) => setDob(formatDob(t))}
        placeholder="DD/MM/YYYY"
        keyboardType="number-pad"
        maxLength={10}
        error={dobError}
        hint="Looty is 18+."
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

      <GenderChips value={gender} onChange={setGender} disabled={busy} />

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
