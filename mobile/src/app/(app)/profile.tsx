/**
 * Your own profile, notification switches, and account deletion.
 *
 * Shows the tier badge, because tier is the thing that determines what works and
 * a user who does not know theirs cannot understand why Match is locked.
 *
 * Notification prefs are stored even though push is not sending yet — Play Store
 * wants the controls in-app, and wiring delivery later should not require a
 * migration through live student rows. Account deletion is an Edge Function
 * because removing auth.users is an Admin API call; the client cannot do it.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Body, Button, Field, LinkButton, Notice, Screen, Title, Toggle } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Tier, isAlumni, TIER_LABEL } from '@/lib/tiers';
import { useRouter, type Href } from 'expo-router';

type Prefs = {
  dms: boolean;
  friend_requests: boolean;
  connections: boolean;
  groups: boolean;
};

const PREF_DEFAULTS: Prefs = {
  dms: true,
  friend_requests: true,
  connections: true,
  groups: false,
};

export default function Profile() {
  const { profile, session, tier, isBanned, signOut } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [prefs, setPrefs] = useState<Prefs>(PREF_DEFAULTS);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const uid = session?.user.id;

  useEffect(() => {
    if (!uid) return;
    supabase
      .from('notification_prefs')
      .select('dms, friend_requests, connections, groups')
      .eq('user_id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs(data as Prefs);
      });
  }, [uid]);

  const setPref = useCallback(
    async (key: keyof Prefs, value: boolean) => {
      if (!uid) return;
      const next = { ...prefs, [key]: value };
      setPrefs(next);
      const { data, error } = await supabase
        .from('notification_prefs')
        .update({ [key]: value })
        .eq('user_id', uid)
        .select('user_id');
      if (error || !data?.length) {
        // Row missing on an old account — create it with the new values.
        await supabase.from('notification_prefs').insert({ user_id: uid, ...next });
      }
    },
    [prefs, uid],
  );

  async function downloadData() {
    setExporting(true);
    setExportError(null);
    const { data, error } = await supabase.rpc('export_my_data');
    if (error || !data) {
      setExportError('Could not prepare your data. Try again.');
      setExporting(false);
      return;
    }
    try {
      const file = new File(Paths.cache, 'looty-data.json');
      if (file.exists) file.delete();
      file.create();
      await file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Your Looty data',
        });
      } else {
        setExportError('Sharing is not available on this device.');
      }
    } catch {
      setExportError('Could not save the file. Try again.');
    }
    setExporting(false);
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: { confirm: 'delete' },
    });
    if (error || !data?.ok) {
      let key = '';
      try {
        key = (await (error as { context?: Response })?.context?.json())?.error ?? '';
      } catch {
        /* fall through */
      }
      setDeleteError(
        key === 'not_authenticated'
          ? 'Sign in again, then retry.'
          : 'Could not delete the account. Try again.',
      );
      setDeleting(false);
      return;
    }
    await signOut();
  }

  if (!profile) {
    return (
      <Screen>
        <Title>You</Title>
        <Body>Loading your profile…</Body>
      </Screen>
    );
  }

  const alumni = isAlumni(profile.end_year);
  const confirmToken = profile.username ?? 'DELETE';
  const canDelete = confirm.trim().toLowerCase() === confirmToken.toLowerCase();

  return (
    <Screen>
      <View style={styles.header}>
        <Avatar
          uri={profile.dp_url}
          name={profile.display_name}
          username={profile.username}
          size={72}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: c.text }]}>
            {profile.display_name ?? 'No name yet'}
          </Text>
          <Text style={{ color: c.textSecondary }}>
            {profile.username ? `@${profile.username}` : 'No username yet'}
          </Text>
          <LinkButton label="Edit profile" onPress={() => router.push('/profile-edit' as Href)} />
        </View>
      </View>

      <View style={styles.badges}>
        <View style={[styles.badge, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{TIER_LABEL[tier]}</Text>
        </View>
        {alumni ? (
          <View style={[styles.badge, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>Alumni</Text>
          </View>
        ) : null}
      </View>

      {isBanned ? (
        <Notice tone="error">
          Your account is restricted. You can still read the groups, and you can appeal.
        </Notice>
      ) : tier < Tier.CollegeVerified ? (
        <>
          <Notice>
            You are unverified, so messaging and Looty Match are locked. Confirm a
            college email to unlock them.
          </Notice>
          <Button label="Confirm college email" onPress={() => router.push('/(auth)/verify')} />
        </>
      ) : null}

      <Text style={[styles.section, { color: c.text }]}>Notifications</Text>
      <Body>
        These are what Looty will send you, once notifications are on. Group rooms
        stay off unless you turn them on — a thousand people talking is not a
        notification.
      </Body>
      <Toggle
        label="Direct messages"
        value={prefs.dms}
        onValueChange={(v) => setPref('dms', v)}
      />
      <Toggle
        label="Friend requests"
        value={prefs.friend_requests}
        onValueChange={(v) => setPref('friend_requests', v)}
      />
      <Toggle
        label="When you get Connected"
        hint="Someone you Looted looted you back."
        value={prefs.connections}
        onValueChange={(v) => setPref('connections', v)}
      />
      <Toggle
        label="Group messages"
        value={prefs.groups}
        onValueChange={(v) => setPref('groups', v)}
      />

      <View style={{ height: 8 }} />
      <LinkButton label="Friends" onPress={() => router.push('/(app)/chats/friends' as Href)} />
      <LinkButton label="Privacy" onPress={() => router.push('/privacy' as Href)} />
      <LinkButton label="Blocked" onPress={() => router.push('/blocked' as Href)} />
      {exportError ? <Notice tone="error">{exportError}</Notice> : null}
      <Button
        label="Download my data"
        variant="secondary"
        loading={exporting}
        onPress={downloadData}
      />
      <Button label="Sign out" variant="secondary" onPress={signOut} />

      <Text style={[styles.section, { color: c.text }]}>Delete account</Text>
      <Body>
        This permanently deletes your account, messages, and profile photo. It
        cannot be undone. If you were permanently restricted, the same college
        email cannot be used again.
      </Body>
      <Field
        label={`Type ${profile.username ? `@${profile.username}` : 'DELETE'} to confirm`}
        value={confirm}
        onChangeText={(v) => {
          setConfirm(v);
          setDeleteError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!deleting}
      />
      {deleteError ? <Notice tone="error">{deleteError}</Notice> : null}
      <Button
        label="Delete my account"
        variant="danger"
        disabled={!canDelete}
        loading={deleting}
        onPress={deleteAccount}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  name: { fontSize: 20, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  section: { fontSize: 18, fontWeight: '700', marginTop: 8 },
});
