/**
 * Root layout — session boundary and signup routing.
 *
 * Routing here is UX only. It decides which screen a user *sees*; it does not
 * decide what they can *do*. Every gated action is refused by Postgres regardless
 * of which screen the app happens to render. See src/lib/tiers.ts.
 */

import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
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
  // The banned screen is an explanation, not a cage — shown once per session.
  const bannedShown = useRef(false);

  useEffect(() => {
    if (loading) return;
    SplashScreen.hideAsync();

    const group = segments[0];

    // A ban is not a logout. The user keeps their account and can still read
    // groups — they just cannot participate. So the banned screen is shown ONCE,
    // to explain what happened and offer an appeal, and after that they move
    // freely. Everything is already gated by tier, because current_tier() returns
    // 0 while banned; bouncing them back here would be a wall the design does not
    // call for. See CONTEXT.md §3.5.
    if (isBanned && !bannedShown.current && group !== 'banned') {
      bannedShown.current = true;
      router.replace('/banned');
      return;
    }
    if (isBanned) return;

    if (step === 'done') {
      if (group === '(auth)') router.replace('/(app)/groups');
      return;
    }

    // Tier 0 is not always a temporary state: a student whose college issues no
    // email can never pass it. Trapping them on the verification screen would trap
    // them permanently, so they are free to browse groups read-only.
    if (step === 'verifyCollege' && group === '(app)') return;

    // Compare against the step's own route, not merely its group. Guarding on
    // `group !== '(auth)'` looks like loop protection but also blocks every move
    // *between* auth screens — which is the one move signup depends on. Creating
    // an account leaves you on sign-in with a session and a Tier 0 profile, so
    // the redirect to /verify never fired and signup could not be completed at
    // all. Matching on the full route still cannot loop, because the only
    // redirect it issues is to a route it has just established we are not on.
    const target = STEP_ROUTE[step];
    if (`/${segments.join('/')}` !== target) router.replace(target);
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
