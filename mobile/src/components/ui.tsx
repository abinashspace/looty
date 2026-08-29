/**
 * The small set of building blocks every Looty screen uses.
 *
 * Kept deliberately plain — the product is text-first, and a chat app earns
 * nothing from ornament. Everything here reads its colours from the theme so
 * light and dark both work without per-screen effort.
 */

import { forwardRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const c = useTheme();
  const body = (
    <View style={[styles.body, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        ) : (
          body
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.title, { color: c.text }]}>{children}</Text>;
}

export function Body({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.bodyText, { color: c.textSecondary }]}>{children}</Text>;
}

// ---------------------------------------------------------------------------

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, error, style, ...rest },
  ref,
) {
  const c = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.textSecondary}
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.backgroundElement,
            borderColor: error ? c.danger : c.border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[styles.hint, { color: c.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: c.textSecondary }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------------------

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const c = useTheme();
  const off = disabled || loading;
  const primary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? c.accent : c.backgroundElement,
          borderColor: primary ? 'transparent' : c.border,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={primary ? c.accentText : c.text} />
      ) : (
        <Text style={[styles.buttonText, { color: primary ? c.accentText : c.text }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
      <Text style={[styles.link, { color: c.accent }]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: React.ReactNode }) {
  const c = useTheme();
  const isError = tone === 'error';
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: c.backgroundElement, borderColor: isError ? c.danger : c.border },
      ]}>
      <Text style={[styles.noticeText, { color: isError ? c.danger : c.textSecondary }]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  body: { padding: 24, gap: 16 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  bodyText: { fontSize: 15, lineHeight: 21 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  hint: { fontSize: 13, lineHeight: 18 },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  link: { fontSize: 15, fontWeight: '600' },
  notice: { borderWidth: 1, borderRadius: 10, padding: 12 },
  noticeText: { fontSize: 14, lineHeight: 20 },
});
