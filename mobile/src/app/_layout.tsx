/**
 * Root layout — session boundary and signup routing.
 *
 * Routing here is UX only. It decides which screen a user *sees*; it does not
 * decide what they can *do*. Every gated action is refused by Postgres regardless
 * of which screen the app happens to render. See src/lib/tiers.ts.
 */

import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, View, useColorScheme } from 'react-native';

import { Placeholder } from '@/components/placeholder';
import { SessionProvider, useSession } from '@/lib/session';
import { isSupabaseConfigured } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

const STEP_ROUTE = {
  signIn: '/(auth)/sign-in',
  verifyCollege: '/(auth)/verify',
  profileSetup: '/(auth)/profile-setup',
} as const;

function RootNavigator() {
  const { loading, step, isBanned } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    SplashScreen.hideAsync();

    const group = segments[0];

    // A ban is not a logout. The user keeps their account and can still read
    // groups and file an appeal — they just cannot participate. See CONTEXT.md §3.5.
    if (isBanned && group !== 'banned') {
      router.replace('/banned');
      return;
    }

    if (step === 'done') {
      if (group === '(auth)') router.replace('/(app)/groups');
      return;
    }

    // Tier 0 is not always a temporary state: a student whose college issues no
    // email can never pass it. Trapping them on the verification screen would trap
    // them permanently, so they are free to browse groups read-only.
    if (step === 'verifyCollege' && group === '(app)') return;

    if (group !== '(auth)') router.replace(STEP_ROUTE[step]);
  }, [loading, step, isBanned, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
      <Stack.Screen name="banned" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (!isSupabaseConfigured) SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {isSupabaseConfigured ? (
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      ) : (
        <Placeholder title="Supabase not configured" phase="Setup">
          Copy mobile/.env.example to mobile/.env and add your project URL and anon
          key. The project must be created in ap-south-1 (Mumbai) — the region
          cannot be changed afterwards.
        </Placeholder>
      )}
    </ThemeProvider>
  );
}
