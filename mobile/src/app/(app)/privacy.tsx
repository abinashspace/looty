/**
 * In-app privacy note. Play still needs a public HTTPS URL of legal/privacy.md;
 * this is so a student can read the same facts without leaving the app.
 */

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Screen, Title } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

export default function Privacy() {
  const router = useRouter();
  const c = useTheme();

  return (
    <Screen>
      <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
        <Text style={{ color: c.accent, fontSize: 16 }}>‹ Back</Text>
      </Pressable>
      <Title>Privacy</Title>
      <Body>
        Looty is a friends app for verified college students in India. It is not a
        dating app.
      </Body>
      <View style={styles.gap} />
      <Body>
        We store the email you sign in with, the college email you confirm (private
        — other students never see it), your profile, messages, and optional
        notification settings. We do not collect date of birth. We do not sell
        data. Ads, if they ship, are non-personalised for everyone.
      </Body>
      <View style={styles.gap} />
      <Body>
        Confirming a college email is what proves you are a student. A permanent
        restriction keeps a hash of that address after you delete the account, so
        the same mailbox cannot return. If the restriction is lifted, the hash
        goes too.
      </Body>
      <View style={styles.gap} />
      <Body>
        Delete your account from You → Delete account. That removes login, profile,
        photos, messages and tokens.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: 4 },
});
