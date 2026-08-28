/**
 * Scaffold placeholder. Every screen that exists as a route but has no
 * implementation yet renders one of these, naming the phase that will fill it in.
 *
 * Delete this component once the last stub is replaced.
 */

import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  phase: string;
  children?: string;
};

export function Placeholder({ title, phase, children }: Props) {
  const colors = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.badge, { backgroundColor: colors.backgroundElement }]}>
        <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{phase}</Text>
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {children ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>{children}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 320 },
});
