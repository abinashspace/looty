/**
 * Your own profile.
 *
 * Shows the tier badge, because tier is the thing that determines what works and
 * a user who does not know theirs cannot understand why Match is locked.
 */

import { Image, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Notice, Screen, Title } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { Tier, isAlumni, TIER_LABEL } from '@/lib/tiers';
import { useRouter } from 'expo-router';

export default function Profile() {
  const { profile, tier, isBanned, signOut } = useSession();
  const router = useRouter();
  const c = useTheme();

  if (!profile) {
    return (
      <Screen>
        <Title>You</Title>
        <Body>Loading your profile…</Body>
      </Screen>
    );
  }

  const alumni = isAlumni(profile.end_year);

  return (
    <Screen>
      <View style={styles.header}>
        {profile.dp_url ? (
          <Image source={{ uri: profile.dp_url }} style={styles.dp} />
        ) : (
          <View style={[styles.dp, { backgroundColor: c.backgroundElement }]} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: c.text }]}>
            {profile.display_name ?? 'No name yet'}
          </Text>
          <Text style={{ color: c.textSecondary }}>
            {profile.username ? `@${profile.username}` : 'No username yet'}
          </Text>
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

      <View style={{ height: 8 }} />
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dp: { width: 72, height: 72, borderRadius: 36 },
  name: { fontSize: 20, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});
