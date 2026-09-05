/**
 * In-app privacy note. The full policy is hosted at PRIVACY_URL for Play.
 * This screen is the same facts without leaving the app.
 */

import { useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, LinkButton, Screen, Title } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

const PRIVACY_URL = 'https://abinashspace.github.io/looty/';

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
        Looty is a friends app for college students in India. It is not a
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
        Confirming a college email adds the College Verified badge. A permanent
        restriction keeps a hash of your sign-in address — and of your college
        address if you confirmed one — after you delete the account, so the same
        mailbox cannot return. If the restriction is lifted, those hashes go too.
      </Body>
      <View style={styles.gap} />
      <Body>
        Delete your account from You → Delete account. That removes login, profile,
        photos, messages and tokens. Download a copy from You → Download my data.
      </Body>
      <LinkButton label="Full privacy policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: 4 },
});
