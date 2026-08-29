/**
 * Session + profile context.
 *
 * Holds the Supabase auth session, the caller's own profile row, and their ban
 * state, so screens can route on trust tier without each one refetching.
 *
 * The shape here matches exactly the columns `authenticated` is granted on
 * `public.profiles`. `full_name` and `phone_hash` are absent on purpose — they are
 * not merely hidden, they are ungranted, and selecting them errors.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from './supabase';
import { Tier, effectiveTier, type TrustTier } from './tiers';

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  dp_url: string | null;
  college_id: string | null;
  course_years: number | null;
  start_year: number | null;
  end_year: number | null;
  gender: string | null;
  trust_tier: TrustTier;
  created_at: string;
  phone_verified_at: string | null;
  onboarding_complete: boolean;
};

const PROFILE_COLUMNS =
  'id, username, display_name, dp_url, college_id, course_years, start_year, end_year, gender, trust_tier, created_at, phone_verified_at, onboarding_complete';

/** Where a user is in signup. Drives which screen the root layout shows. */
export type SignupStep =
  | 'signIn'
  | 'verifyCollege'
  | 'profileSetup'
  | 'done';

type SessionState = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  isBanned: boolean;
  /** Ban-adjusted tier — what the UI should actually gate on. */
  tier: TrustTier;
  /** Next incomplete signup step, or 'done'. */
  step: SignupStep;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

/**
 * Signup order (CONTEXT.md §4.3): sign in → college email → profile.
 *
 * Anyone who signs in with a recognised college domain is already Tier 2 and skips
 * the middle step entirely. Everyone else is offered "add your college email".
 *
 * Note that `verifyCollege` is NOT a wall. A student whose college issues no email
 * can never pass Tier 0, so trapping them on a verification screen would trap them
 * forever. They browse groups read-only and can request their college instead —
 * the root layout lets them through.
 */
function resolveStep(session: Session | null, profile: Profile | null): SignupStep {
  if (!session) return 'signIn';
  if ((profile?.trust_tier ?? Tier.Unverified) < Tier.CollegeVerified) return 'verifyCollege';
  if (!profile?.onboarding_complete) return 'profileSetup';
  return 'done';
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isBanned, setIsBanned] = useState(false);

  const load = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      setIsBanned(false);
      return;
    }

    const [{ data: row }, { data: bans }] = await Promise.all([
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', uid).maybeSingle(),
      // RLS restricts this to the caller's own bans, so an empty result means
      // "not banned". The authoritative check still lives server-side in
      // current_tier(); this only decides which screen to show.
      supabase
        .from('bans')
        .select('id, ends_at')
        .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`),
    ]);

    setProfile((row as Profile) ?? null);
    setIsBanned((bans?.length ?? 0) > 0);
  }, []);

  useEffect(() => {
    let active = true;

    // No project wired up yet — stay signed out rather than firing requests at a
    // placeholder URL. The root layout shows a setup screen in this case.
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await load(data.session?.user.id);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      await load(next?.user.id);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const refresh = useCallback(
    () => load(session?.user.id),
    [load, session?.user.id],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setIsBanned(false);
  }, []);

  const value = useMemo<SessionState>(() => {
    const raw = profile?.trust_tier ?? Tier.Unverified;
    return {
      loading,
      session,
      profile,
      isBanned,
      tier: effectiveTier(raw, isBanned),
      step: resolveStep(session, profile),
      refresh,
      signOut,
    };
  }, [loading, session, profile, isBanned, refresh, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
