/**
 * Shown in place of a gated screen when the user's tier is too low.
 *
 * The gated tabs stay visible rather than being hidden, deliberately: an
 * unverified user should be able to see what verification unlocks. That is the
 * whole reason Tier 0 exists as a usable browsing state instead of a wall.
 *
 * This is presentation. The database refuses the underlying queries on its own.
 */

import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { blockedReason, type Capability } from '@/lib/tiers';

const COPY = {
  postInGroups: 'Add your college email to join the conversation.',
  directMessage: 'Add your college email to message other students.',
  lootyMatch: 'Add your college email to start looting.',
} as const;

type Props = {
  capability: Extract<Capability, keyof typeof COPY>;
  children: React.ReactNode;
};

export function TierGate({ capability, children }: Props) {
  const { tier, isBanned } = useSession();
  const colors = useTheme();
  const reason = blockedReason(capability, tier, isBanned);

  if (!reason) return <>{children}</>;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>
        {reason === 'banned' ? 'Restricted' : 'Students only'}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {reason === 'banned'
          ? 'This is unavailable while your account is restricted.'
          : COPY[capability]}
      </Text>
      {reason === 'needsVerification' ? (
        <Link href="/(auth)/verify" style={[styles.action, { color: colors.text }]}>
          Verify now
        </Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 300 },
  action: { fontSize: 16, fontWeight: '600', marginTop: 8 },
});
