/**
 * Shown in place of a gated screen when the user's tier is too low.
 *
 * The gated tabs stay visible rather than being hidden, deliberately: a Tier 0
 * user should be able to see what they are missing. That is the whole reason
 * Tier 0 exists as a usable browsing state instead of a wall.
 *
 * Since migration 35 this is a much rarer screen than it was. Tier 1 — which
 * opens everything here — needs only a confirmed sign-in address, so the two
 * ways to see this are a restricted account and an unconfirmed address. It is
 * deliberately NOT the "add your college email" prompt any more: a college
 * address gates nothing, so pointing someone at it to fix a lockout would be a
 * lie.
 *
 * This is presentation. The database refuses the underlying queries on its own.
 */

import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { blockedReason, type Capability } from '@/lib/tiers';

const COPY = {
  postInGroups: 'Confirm your email address to join the conversation.',
  directMessage: 'Confirm your email address to message other students.',
  lootyMatch: 'Confirm your email address to start looting.',
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
        {reason === 'banned' ? 'Restricted' : 'Not confirmed yet'}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {reason === 'banned'
          ? 'This is unavailable while your account is restricted.'
          : `${COPY[capability]} Check your inbox for the confirmation link.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 300 },
  action: { fontSize: 16, fontWeight: '600', marginTop: 8 },
});
