/**
 * Photo, or initials if they skipped one.
 *
 * Profile pictures are optional (CONTEXT.md §3.1). An empty grey block looked
 * like a failed download; two letters from the display name (else username)
 * make the same shape readable without asking for a face.
 */

import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export function initials(name?: string | null, username?: string | null): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words[0]) return words[0].slice(0, 2).toUpperCase();
  const handle = (username ?? '').trim();
  if (handle) return handle.slice(0, 2).toUpperCase();
  return '?';
}

export function Avatar({
  uri,
  name,
  username,
  size = 48,
}: {
  uri?: string | null;
  name?: string | null;
  username?: string | null;
  size?: number;
}) {
  const c = useTheme();
  const label = initials(name, username);
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={round} accessibilityIgnoresInvertColors />;
  }

  return (
    <View
      style={[round, styles.centre, { backgroundColor: c.backgroundElement }]}
      accessibilityLabel={label}>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: Math.round(size * 0.36) }}>
        {label}
      </Text>
    </View>
  );
}

/** Full-bleed Match card. Same initials rule, larger type. */
export function MatchPhoto({
  uri,
  name,
  username,
  style,
}: {
  uri?: string | null;
  name?: string | null;
  username?: string | null;
  style?: StyleProp<ImageStyle>;
}) {
  const c = useTheme();
  const label = initials(name, username);

  if (uri) {
    return <Image source={{ uri }} style={style} resizeMode="cover" accessibilityIgnoresInvertColors />;
  }

  return (
    <View style={[style, styles.centre, { backgroundColor: c.backgroundElement }]}>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: 64, letterSpacing: -1 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
