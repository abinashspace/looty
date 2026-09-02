/**
 * Optional gender. Only used by Match's "same gender only" safety toggle —
 * not a dating preference (CONTEXT.md §3.4).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export const GENDERS = [
  { key: 'woman', label: 'Woman' },
  { key: 'man', label: 'Man' },
  { key: 'non_binary', label: 'Non-binary' },
  { key: 'undisclosed', label: 'Prefer not to say' },
] as const;

export type GenderKey = (typeof GENDERS)[number]['key'];

export function GenderChips({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: c.textSecondary }]}>Gender (optional)</Text>
      <View style={styles.chips}>
        {GENDERS.map((g) => {
          const on = value === g.key;
          return (
            <Pressable
              key={g.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              disabled={disabled}
              onPress={() => onChange(on ? null : g.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? c.accent : c.backgroundElement,
                  borderColor: on ? 'transparent' : c.border,
                  opacity: disabled ? 0.5 : 1,
                },
              ]}>
              <Text style={{ color: on ? c.accentText : c.text, fontSize: 14 }}>{g.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: c.textSecondary }]}>
        Only used if you turn on “same gender only” in Match. Not shown as a dating
        filter.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  hint: { fontSize: 13, lineHeight: 18 },
});
